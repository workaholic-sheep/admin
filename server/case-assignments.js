import { CASE_TYPES, isCaseTypeSelected } from '../src/case-types.js';
import { splitName } from '../src/names.js';
import { DEFAULT_CASE_STATUS, normalizeCaseStatus } from '../src/case-status.js';

// Clients_Additional_Info spreadsheet:
//   Client_Info  – one row per MasterData client, kept in step with MasterData.
//   VAWA, I-485… – one tab per case type; a client is "in" a case type when its Id is in that tab.
// MasterData's old CaseType column is read once (first sync) to seed the case tabs and never written.

export const CLIENT_INFO_TAB = 'Client_Info';
export const CLIENT_INFO_HEADERS = ['Id', 'First Name', 'Middle Name', 'Last Name', 'Email', 'Phone', 'Address', 'Current Address'];
export const CASE_TAB_HEADERS = ['Id', 'First Name', 'Middle Name', 'Last Name', 'Email', 'Phone', 'Status', 'Team Member', 'Date Added'];
// Columns the app keeps equal to MasterData. Everything else (Date Added, Status, Team Member,
// any column staff add themselves) is written once at most and then left alone.
const CLIENT_INFO_SYNCED = ['Id', 'First Name', 'Middle Name', 'Last Name', 'Email', 'Phone', 'Address', 'Current Address'];
const CASE_TAB_SYNCED = ['Id', 'First Name', 'Middle Name', 'Last Name', 'Email', 'Phone'];

export class CaseSetupError extends Error {}
export class CaseNotFoundError extends Error {}

const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  id: ['id', 'clientid', 'idno', 'clientidno'],
  firstname: ['firstname', 'first'],
  middlename: ['middlename', 'middle'],
  lastname: ['lastname', 'last', 'surname'],
  email: ['email', 'emailaddress'],
  phone: ['phone', 'phonenumber', 'phoneno'],
  address: ['address', 'homeaddress', 'mailingaddress'],
  currentaddress: ['currentaddress'],
  dateadded: ['dateadded', 'added', 'addedon'],
  status: ['status', 'casestatus', 'progress'],
  teammember: ['teammember', 'assignedto', 'handledby', 'staff'],
};

function columnOf(headers, name) {
  const accepted = ALIASES[key(name)] || [key(name)];
  return headers.findIndex((header) => accepted.includes(key(header)));
}


function centralToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clientValues(client) {
  // MasterData has separate name columns now; splitting is only for older single-name rows.
  const name = client.firstName || client.lastName ? { first: client.firstName || '', middle: client.middleName || '', last: client.lastName || '' } : splitName(client.name);
  return {
    Id: client.id,
    'First Name': name.first,
    'Middle Name': name.middle,
    'Last Name': name.last,
    Email: client.email || '',
    Phone: client.phone || '',
    Address: client.address || '',
    'Current Address': client.currentAddress || '',
    'Date Added': centralToday(),
    Status: DEFAULT_CASE_STATUS,
  };
}

function rowFor(headers, values) {
  const row = headers.map(() => '');
  for (const [name, value] of Object.entries(values)) {
    const column = columnOf(headers, name);
    if (column !== -1) row[column] = String(value ?? '');
  }
  return row;
}

// Id → { teamMember, status } for one case tab. A blank status counts as Not Started.
function detailsIn(tab) {
  const result = new Map();
  if (!tab) return result;
  const idColumn = columnOf(tab.headers, 'Id');
  const teamColumn = columnOf(tab.headers, 'Team Member');
  const statusColumn = columnOf(tab.headers, 'Status');
  if (idColumn === -1) return result;
  for (const row of tab.rows) {
    const id = String(row[idColumn] ?? '').trim();
    if (!id) continue;
    result.set(id, {
      teamMember: teamColumn === -1 ? '' : String(row[teamColumn] ?? '').trim(),
      status: normalizeCaseStatus(statusColumn === -1 ? '' : row[statusColumn]),
    });
  }
  return result;
}

function idsIn(tab) {
  if (!tab) return new Set();
  const column = columnOf(tab.headers, 'Id');
  return new Set(column === -1 ? [] : tab.rows.map((row) => String(row[column] ?? '').trim()).filter(Boolean));
}

export function createCaseAssignments(tabs, setupMessage = '') {
  let queue = Promise.resolve();
  let cached = null;
  const queued = (task) => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };
  const requireTabs = () => {
    if (!tabs) throw new CaseSetupError(setupMessage || 'The Clients_Additional_Info spreadsheet is not set up.');
    return tabs;
  };

  // Creates a missing tab, fills an empty header row, and adds any of our columns the tab lacks
  // after the existing ones, so headings staff typed themselves keep their place.
  async function ensure(tab, title, defaults) {
    if (!tab) return requireTabs().create(title, defaults);
    const headers = tab.headers.some(Boolean) ? [...tab.headers] : [];
    const missing = defaults.filter((name) => columnOf(headers, name) === -1);
    if (!missing.length) return tab;
    headers.push(...missing);
    await requireTabs().setHeaders(tab, headers);
    return { ...tab, headers, rows: tab.rows.map((row) => [...row, ...missing.map(() => '')]) };
  }

  function remember(map) {
    cached = Object.fromEntries(CASE_TYPES.map((type) => [type, detailsIn(map.get(type))]));
    return cached;
  }

  async function load() {
    return remember(await requireTabs().read(CASE_TYPES));
  }

  async function addToTab(map, type, clients) {
    const tab = await ensure(map.get(type), type, CASE_TAB_HEADERS);
    const present = idsIn(tab);
    const fresh = clients.filter((client) => client.id && !present.has(client.id));
    if (fresh.length) await requireTabs().append(tab, fresh.map((client) => rowFor(tab.headers, clientValues(client))));
    map.set(type, { ...tab, rows: [...tab.rows, ...fresh.map((client) => rowFor(tab.headers, clientValues(client)))] });
    return fresh.map((client) => client.id);
  }

  async function removeFromTab(map, type, ids) {
    const tab = map.get(type);
    const column = tab ? columnOf(tab.headers, 'Id') : -1;
    if (column === -1) return [];
    const wanted = new Set(ids);
    const doomed = tab.rows.map((row, index) => ({ id: String(row[column] ?? '').trim(), rowNumber: index + 2 })).filter((entry) => wanted.has(entry.id));
    if (doomed.length) await requireTabs().deleteRows(tab, doomed.map((entry) => entry.rowNumber));
    map.set(type, { ...tab, rows: tab.rows.filter((row) => !wanted.has(String(row[column] ?? '').trim())) });
    return doomed.map((entry) => entry.id);
  }

  // Updates cells in `columns` that differ from MasterData; returns the number of cells written.
  async function refreshRows(tab, clientsById, columns) {
    const idColumn = columnOf(tab.headers, 'Id');
    if (idColumn === -1) return 0;
    const cells = [];
    tab.rows.forEach((row, index) => {
      const client = clientsById.get(String(row[idColumn] ?? '').trim());
      if (!client) return;
      const values = clientValues(client);
      for (const name of columns) {
        const column = columnOf(tab.headers, name);
        if (column !== -1 && String(row[column] ?? '') !== String(values[name] ?? '')) cells.push({ rowNumber: index + 2, column, value: values[name] });
      }
    });
    if (cells.length) await requireTabs().update(tab, cells);
    return cells.length;
  }

  return {
    configured: Boolean(tabs),
    load,
    // Last known assignments, loading them if this server instance has none yet.
    current: async () => cached || load(),

    assign: (type, clients, add) => queued(async () => {
      if (!CASE_TYPES.includes(type)) throw new CaseSetupError(`Unknown case type "${type}".`);
      const map = await requireTabs().read(CASE_TYPES);
      const changed = add ? await addToTab(map, type, clients) : await removeFromTab(map, type, clients.map((client) => client.id));
      remember(map);
      return changed;
    }),

    // Saves one per-case detail ('Team Member' or 'Status') for this client's case of one type.
    setCaseDetail: (type, clientId, field, value) => queued(async () => {
      if (!CASE_TYPES.includes(type)) throw new CaseSetupError(`Unknown case type "${type}".`);
      const map = await requireTabs().read(CASE_TYPES);
      if (!map.get(type)) throw new CaseNotFoundError(`This client is not in ${type}.`);
      const tab = await ensure(map.get(type), type, CASE_TAB_HEADERS);
      const idColumn = columnOf(tab.headers, 'Id');
      const index = tab.rows.findIndex((row) => String(row[idColumn] ?? '').trim() === clientId);
      if (index === -1) throw new CaseNotFoundError(`This client is not in ${type}.`);
      const column = columnOf(tab.headers, field);
      await requireTabs().update(tab, [{ rowNumber: index + 2, column, value }]);
      tab.rows[index][column] = value;
      map.set(type, tab);
      return remember(map);
    }),

    // Makes the case tabs match a "VAWA + I-485" style value from the intake or edit form.
    setForClient: (client, caseTypeValue) => queued(async () => {
      const map = await requireTabs().read(CASE_TYPES);
      for (const type of CASE_TYPES) {
        const wanted = isCaseTypeSelected(caseTypeValue, type);
        const has = idsIn(map.get(type)).has(client.id);
        if (wanted && !has) await addToTab(map, type, [client]);
        if (!wanted && has) await removeFromTab(map, type, [client.id]);
      }
      return remember(map);
    }),

    // Copies MasterData into Client_Info (new clients appended, changed details updated) and keeps
    // the name/contact columns of the case tabs current. Rows are never deleted from Client_Info.
    sync: (clients) => queued(async () => {
      const map = await requireTabs().read([CLIENT_INFO_TAB, ...CASE_TYPES]);
      const withIds = clients.filter((client) => client.id);
      const byId = new Map(withIds.map((client) => [client.id, client]));
      const info = await ensure(map.get(CLIENT_INFO_TAB), CLIENT_INFO_TAB, CLIENT_INFO_HEADERS);
      const known = idsIn(info);
      // One time only: while Client_Info is still empty, seed the case tabs from MasterData's old
      // CaseType column. This runs before Client_Info is filled, so an interrupted first sync retries it
      // (adding is skipped for clients already in a tab).
      let imported = 0;
      if (known.size === 0) {
        for (const type of CASE_TYPES) {
          const members = withIds.filter((client) => isCaseTypeSelected(client.legacyCaseType, type));
          if (members.length) imported += (await addToTab(map, type, members)).length;
        }
      }
      let written = await refreshRows(info, byId, CLIENT_INFO_SYNCED);
      for (const type of CASE_TYPES) {
        if (map.get(type)) written += await refreshRows(map.get(type), byId, CASE_TAB_SYNCED);
      }
      const fresh = withIds.filter((client) => !known.has(client.id));
      if (fresh.length) await requireTabs().append(info, fresh.map((client) => rowFor(info.headers, { ...clientValues(client), 'Date Added': '' })));
      written += fresh.length;
      remember(map);
      return { written, added: fresh.length, imported };
    }),
  };
}
