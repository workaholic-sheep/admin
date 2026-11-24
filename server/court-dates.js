// New court dates, kept in the Court_Dates tab of Clients_Additional_Info. The old COURT DATE LIST
// tracker is still read separately (see listCourtDates in google-sheets.js / workbook.js); entries
// from here carry source: 'court-dates' so the app can show the two apart.

export const COURT_DATES_TAB = 'Court_Dates';

const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Headings staff are likely to type; the first match wins.
const ALIASES = {
  clientId: ['clientid', 'id', 'clid'],
  clientName: ['clientname', 'name', 'client', 'fullname'],
  firstName: ['firstname'],
  lastName: ['lastname'],
  date: ['courtdate', 'date', 'hearingdate'],
  rescheduleDate: ['rescheduledate', 'rescheduled', 'newdate', 'rescheduledto'],
  time: ['time', 'courttime', 'hearingtime', 'timect'],
  address: ['address', 'courtaddress', 'location', 'court', 'courtlocation'],
  judge: ['judge', 'judgename'],
  hearingType: ['hearingtype', 'type', 'hearing'],
  alienNumber: ['aliennumber', 'anumber', 'a', 'alien'],
  country: ['country'],
  status: ['status'],
  note: ['note', 'notes', 'comment', 'comments'],
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (value) => String(value).padStart(2, '0');

// Sheet dates come back as displayed text: 11/20/2026, 2026-11-20, Nov 20, 2026, or a serial number.
export function courtDateKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let match = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
  match = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${pad2(match[1])}-${pad2(match[2])}`;
  }
  match = text.match(/\b([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})\b/);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
    if (month !== -1) return `${match[3]}-${pad2(month + 1)}-${pad2(match[2])}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

function columnsFor(headers) {
  const keys = headers.map(key);
  const columns = {};
  for (const [field, accepted] of Object.entries(ALIASES)) {
    columns[field] = accepted.map((name) => keys.indexOf(name)).find((index) => index !== -1) ?? -1;
  }
  return columns;
}

export function readCourtDatesTab(tab) {
  if (!tab || !tab.headers.some(Boolean)) return [];
  const columns = columnsFor(tab.headers);
  const cell = (row, field) => (columns[field] === -1 ? '' : String(row[columns[field]] ?? '').trim());
  const records = [];
  tab.rows.forEach((row, index) => {
    const clientName = cell(row, 'clientName') || [cell(row, 'firstName'), cell(row, 'lastName')].filter(Boolean).join(' ');
    const clientId = cell(row, 'clientId');
    const originalDate = courtDateKey(cell(row, 'date'));
    const rescheduleDate = courtDateKey(cell(row, 'rescheduleDate'));
    const date = rescheduleDate || originalDate;
    if (!(clientName || clientId) || !date) return;
    records.push({
      id: `court-dates-${index + 2}`,
      source: 'court-dates',
      clientId,
      clientName,
      date,
      originalDate,
      rescheduleDate,
      time: cell(row, 'time'),
      address: cell(row, 'address'),
      judge: cell(row, 'judge'),
      hearingType: cell(row, 'hearingType'),
      alienNumber: cell(row, 'alienNumber'),
      country: cell(row, 'country'),
      status: cell(row, 'status'),
      note: cell(row, 'note'),
      additionalNote: '',
    });
  });
  return records;
}

export async function listNewCourtDates(tabs) {
  if (!tabs) return [];
  const tab = (await tabs.read([COURT_DATES_TAB])).get(COURT_DATES_TAB);
  return readCourtDatesTab(tab);
}

export class CourtDateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Heading used when the app has to add a column the tab doesn't have yet.
const HEADINGS = {
  clientId: 'Client Id', clientName: 'Client Name', date: 'Court Date', time: 'Time', address: 'Court Address',
  judge: 'Judge', hearingType: 'Hearing Type', status: 'Status', note: 'Notes', createdAt: 'Created At (CT)',
};
ALIASES.createdAt = ['createdatct', 'createdat', 'created', 'dateadded'];
const ALWAYS = ['clientId', 'clientName', 'date'];
const LIMITS = { address: 300, judge: 100, hearingType: 100, status: 50, note: 1000 };

function time12(value) {
  const match = String(value ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// Validates a request body; `clients` is MasterData, used to check the Id and fill in the name.
// An edit (withClient false) keeps the row's client, so no client is needed.
export function courtDateInput(body, clients, { withClient = true } = {}) {
  const input = body || {};
  let client = null;
  const clientId = String(input.clientId ?? '').trim();
  if (withClient) {
    client = clients.find((item) => item.id === clientId);
    if (!client) throw new CourtDateError('Choose a client from the list.', clientId ? 404 : 400);
  }
  const date = String(input.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new CourtDateError('Choose the court date.');
  const rawTime = String(input.time ?? '').trim();
  const time = rawTime ? time12(rawTime) : '';
  if (rawTime && !time) throw new CourtDateError('Choose a valid time.');
  const result = client ? { clientId, clientName: client.name, date, time } : { date, time };
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = String(input[field] ?? '').trim();
    if (value.length > limit) throw new CourtDateError(`${HEADINGS[field]} must be ${limit} characters or fewer.`);
    result[field] = value;
  }
  result.status ||= 'Scheduled';
  return result;
}

const sheetDate = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
const sameName = (left, right) => key(left) === key(right);
// Fields an edit may change; the client and Created At stay as they were.
const EDITABLE = ['date', 'time', 'address', 'judge', 'hearingType', 'status', 'note'];

// Adds headings for any of `fields` the tab lacks (Client Name is covered by First / Last Name columns).
async function withColumns(tabs, tab, fields) {
  const headers = tab.headers.some(Boolean) ? [...tab.headers] : [];
  const columns = columnsFor(headers);
  const missing = fields.filter((field) => columns[field] === -1 && !(field === 'clientName' && columns.firstName !== -1));
  if (!missing.length) return tab;
  headers.push(...missing.map((field) => HEADINGS[field]));
  await tabs.setHeaders(tab, headers);
  return { ...tab, headers, rows: tab.rows.map((row) => [...row, ...missing.map(() => '')]) };
}

export function createCourtDates(tabs, setupMessage = '', timestamp = () => new Date().toISOString()) {
  let queue = Promise.resolve();
  const queued = (task) => {
    const operation = queue.then(async () => {
      if (!tabs) throw new CourtDateError(setupMessage || 'The Clients_Additional_Info spreadsheet is not connected.', 503);
      return task();
    });
    queue = operation.catch(() => {});
    return operation;
  };
  const readTab = async () => (await tabs.read([COURT_DATES_TAB])).get(COURT_DATES_TAB);

  // Ids are row positions, which move when staff add or remove rows in the sheet, so the row must
  // still hold the client and date the app showed (`expected`) before it is changed.
  async function findRow(id, expected = {}) {
    const rowNumber = Number(String(id).match(/^court-dates-(\d+)$/)?.[1]);
    const tab = await readTab();
    const row = tab && rowNumber >= 2 ? tab.rows[rowNumber - 2] : null;
    const current = row && readCourtDatesTab({ headers: tab.headers, rows: [row] })[0];
    const stillThere = current && current.date === expected.date
      && (expected.clientId ? current.clientId === expected.clientId : sameName(current.clientName, expected.clientName));
    if (!stillThere) throw new CourtDateError('That court date moved or changed in the sheet. Refresh and try again.', 409);
    return { tab, rowNumber, current };
  }

  return {
    // Writes only into columns the tab has; adds a column only when the field has a value
    // (Client Id, Client Name and Court Date are always ensured). Other columns are left blank.
    add: (input) => queued(async () => {
        const values = { ...input, date: sheetDate(input.date), createdAt: timestamp() };
        let tab = await readTab();
        const wanted = Object.keys(HEADINGS).filter((field) => ALWAYS.includes(field) || values[field]);
        tab = tab ? await withColumns(tabs, tab, wanted) : await tabs.create(COURT_DATES_TAB, wanted.map((field) => HEADINGS[field]));
        const columns = columnsFor(tab.headers);
        const row = tab.headers.map(() => '');
        for (const field of Object.keys(HEADINGS)) if (columns[field] !== -1) row[columns[field]] = String(values[field] ?? '');
        // Tabs with First / Last Name columns instead of one name column.
        if (columns.clientName === -1 && columns.firstName !== -1) {
          const [first, ...rest] = input.clientName.split(/\s+/);
          row[columns.firstName] = first;
          if (columns.lastName !== -1) row[columns.lastName] = rest.join(' ');
        }
        // Rows below the last non-empty one, so blank rows staff left at the bottom are reused.
        let used = tab.rows.length;
        while (used && !tab.rows[used - 1].some((value) => String(value).trim())) used -= 1;
        await tabs.append({ ...tab, rows: tab.rows.slice(0, used) }, [row]);
        return { ...readCourtDatesTab({ headers: tab.headers, rows: [row] })[0], id: `court-dates-${used + 2}` };
    }),

    // Changes only the editable cells; a rescheduled row gets its new date in Reschedule Date.
    update: (id, expected, input) => queued(async () => {
      const found = await findRow(id, expected);
      const intoReschedule = Boolean(found.current.rescheduleDate);
      const values = { ...input, date: sheetDate(input.date) };
      const tab = await withColumns(tabs, found.tab, EDITABLE.filter((field) => field !== 'date' && values[field]));
      const columns = columnsFor(tab.headers);
      const cells = EDITABLE.map((field) => ({ field, column: field === 'date' && intoReschedule ? columns.rescheduleDate : columns[field] }))
        .filter(({ column }) => column !== -1)
        .map(({ field, column }) => ({ rowNumber: found.rowNumber, column, value: String(values[field] ?? '') }));
      await tabs.update(tab, cells);
      const row = [...tab.rows[found.rowNumber - 2]];
      cells.forEach(({ column, value }) => { row[column] = value; });
      return { ...readCourtDatesTab({ headers: tab.headers, rows: [row] })[0], id };
    }),

    remove: (id, expected) => queued(async () => {
      const found = await findRow(id, expected);
      await tabs.deleteRows(found.tab, [found.rowNumber]);
      return { ...found.current, id };
    }),
  };
}
