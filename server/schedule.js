import { CASE_TYPES } from '../src/case-types.js';
import { SCHEDULE_ADDED_BY } from '../src/team.js';
import { SCHEDULE_MODES, SCHEDULE_STATUSES, timeFrom24h, timeTo24h } from '../src/schedule.js';
import { centralTimestamp } from './case-assignments.js';

// Attorney schedule in the Schedule_Tracker tab of Clients_Additional_Info. Dates and times are
// Central Time wall-clock values, stored as text ("2026-11-20", "2:30 PM") so the sheet reads naturally.

export const SCHEDULE_TAB = 'Schedule_Tracker';
export const SCHEDULE_HEADERS = ['Schedule ID', 'Date', 'Time (CT)', 'Mode', 'Link / Location', 'Purpose', 'Client Id', 'Client Name', 'Case Type', 'Added By', 'Status', 'Created At (CT)'];

export class ScheduleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Headings staff may already have typed in the tab.
const ALIASES = {
  scheduleid: ['scheduleid', 'id', 'appointmentid'],
  date: ['date', 'meetingdate', 'appointmentdate'],
  timect: ['timect', 'time', 'timecentral', 'meetingtime'],
  mode: ['mode', 'modeofcommunication', 'communication', 'type', 'meetingtype'],
  linklocation: ['linklocation', 'link', 'location', 'zoomlink', 'address'],
  purpose: ['purpose', 'title', 'subject', 'description', 'notes', 'note'],
  clientid: ['clientid'],
  clientname: ['clientname', 'client', 'name'],
  casetype: ['casetype', 'case'],
  addedby: ['addedby', 'teammember', 'scheduledby', 'createdby'],
  status: ['status'],
  createdatct: ['createdatct', 'createdat', 'created'],
};
const columnOf = (headers, name) => {
  const accepted = ALIASES[key(name)] || [key(name)];
  return headers.findIndex((header) => accepted.includes(key(header)));
};

const FIELDS = {
  id: 'Schedule ID', date: 'Date', time: 'Time (CT)', mode: 'Mode', location: 'Link / Location', purpose: 'Purpose',
  clientId: 'Client Id', clientName: 'Client Name', caseType: 'Case Type', addedBy: 'Added By', status: 'Status', createdAt: 'Created At (CT)',
};

function normalizeMode(value) {
  const text = key(value);
  if (text.includes('zoom') || text.includes('video') || text.includes('virtual')) return 'Zoom';
  if (text.includes('person') || text.includes('office')) return 'In Person';
  if (text.includes('phone') || text.includes('call')) return 'Phone Call';
  return String(value ?? '').trim();
}

function toEntry(headers, row) {
  const entry = {};
  for (const [field, header] of Object.entries(FIELDS)) {
    const column = columnOf(headers, header);
    entry[field] = column === -1 ? '' : String(row[column] ?? '').trim();
  }
  // Dates typed into the sheet by hand may read back as 11/20/2026.
  const us = entry.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) entry.date = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  entry.mode = normalizeMode(entry.mode);
  entry.time = timeFrom24h(timeTo24h(entry.time)) || entry.time;
  entry.status = SCHEDULE_STATUSES.find((status) => key(status) === key(entry.status)) || (entry.status || 'Scheduled');
  return entry;
}

function rowFor(headers, entry) {
  const row = headers.map(() => '');
  for (const [field, header] of Object.entries(FIELDS)) {
    const column = columnOf(headers, header);
    if (column !== -1) row[column] = String(entry[field] ?? '');
  }
  return row;
}

// Validates a request body; `clients` is MasterData, used to fill in the client's name.
export function scheduleInput(body, clients) {
  const input = body || {};
  const date = String(input.date ?? '').trim();
  const time24 = String(input.time ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new ScheduleError('Choose the date.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time24)) throw new ScheduleError('Choose the time.');
  const mode = String(input.mode ?? '').trim();
  if (!SCHEDULE_MODES.includes(mode)) throw new ScheduleError(`Choose how you'll meet: ${SCHEDULE_MODES.join(', ')}.`);
  const addedBy = String(input.addedBy ?? '').trim();
  if (!SCHEDULE_ADDED_BY.includes(addedBy)) throw new ScheduleError('Choose who is adding this.');
  const status = String(input.status || 'Scheduled').trim();
  if (!SCHEDULE_STATUSES.includes(status)) throw new ScheduleError('Choose a valid status.');
  const purpose = String(input.purpose ?? '').trim();
  const location = String(input.location ?? '').trim();
  if (!purpose) throw new ScheduleError('Say what the appointment is for.');
  if (purpose.length > 300) throw new ScheduleError('Purpose must be 300 characters or fewer.');
  if (location.length > 500) throw new ScheduleError('Link or location must be 500 characters or fewer.');
  const caseType = String(input.caseType ?? '').trim();
  if (caseType && !CASE_TYPES.includes(caseType)) throw new ScheduleError('Choose a valid case type.');
  const clientId = String(input.clientId ?? '').trim();
  const client = clientId ? clients.find((item) => item.id === clientId) : null;
  if (clientId && !client) throw new ScheduleError('That client was not found.', 404);
  return { date, time: timeFrom24h(time24), mode, location, purpose, clientId, clientName: client?.name || '', caseType, addedBy, status };
}

export function createSchedule(tabs, setupMessage = '') {
  let queue = Promise.resolve();
  const queued = (task) => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };
  const requireTabs = () => {
    if (!tabs) throw new ScheduleError(setupMessage || 'The Clients_Additional_Info spreadsheet is not connected.', 503);
    return tabs;
  };

  // Uses the tab staff created; fills an empty heading row and adds any of our columns it lacks.
  async function open() {
    const tab = (await requireTabs().read([SCHEDULE_TAB])).get(SCHEDULE_TAB);
    if (!tab) return requireTabs().create(SCHEDULE_TAB, SCHEDULE_HEADERS);
    const headers = tab.headers.some(Boolean) ? [...tab.headers] : [];
    const missing = SCHEDULE_HEADERS.filter((name) => columnOf(headers, name) === -1);
    if (!missing.length) return tab;
    headers.push(...missing);
    await requireTabs().setHeaders(tab, headers);
    return { ...tab, headers, rows: tab.rows.map((row) => [...row, ...missing.map(() => '')]) };
  }

  const entriesOf = (tab) => tab.rows.map((row, index) => ({ ...toEntry(tab.headers, row), rowNumber: index + 2 })).filter((entry) => entry.id && entry.date);
  const strip = ({ rowNumber, ...entry }) => entry;
  const find = (tab, id) => {
    const entry = entriesOf(tab).find((item) => item.id === id);
    if (!entry) throw new ScheduleError('That appointment was not found. It may have been deleted.', 404);
    return entry;
  };

  return {
    async list() {
      const tab = (await requireTabs().read([SCHEDULE_TAB])).get(SCHEDULE_TAB);
      return tab ? entriesOf(tab).map(strip) : [];
    },
    add: (input) => queued(async () => {
      const tab = await open();
      const highest = entriesOf(tab).reduce((max, entry) => Math.max(max, Number(entry.id.match(/\d+/)?.[0] || 0)), 0);
      const entry = { ...input, id: `S-${String(highest + 1).padStart(5, '0')}`, createdAt: centralTimestamp() };
      await requireTabs().append(tab, [rowFor(tab.headers, entry)]);
      return entry;
    }),
    update: (id, input) => queued(async () => {
      const tab = await open();
      const existing = find(tab, id);
      const entry = { ...input, id, createdAt: existing.createdAt };
      const row = rowFor(tab.headers, entry);
      // Only our columns are written, so anything staff keep in extra columns stays.
      const cells = Object.values(FIELDS).map((header) => columnOf(tab.headers, header)).filter((column) => column !== -1)
        .map((column) => ({ rowNumber: existing.rowNumber, column, value: row[column] }));
      await requireTabs().update(tab, cells);
      return entry;
    }),
    remove: (id) => queued(async () => {
      const tab = await open();
      const existing = find(tab, id);
      await requireTabs().deleteRows(tab, [existing.rowNumber]);
      return strip(existing);
    }),
  };
}
