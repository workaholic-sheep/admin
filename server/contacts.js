// Contact lists kept as tabs in Clients_Additional_Info (for now just Physicians).
// Read-only: the page shows whatever columns staff keep on the tab.

export const CONTACT_TABS = { physicians: 'Physicians' };

export class ContactError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createContacts(tabs, setupMessage = '') {
  return {
    async list(kind) {
      const title = CONTACT_TABS[kind];
      if (!title) throw new ContactError('That contact list does not exist.', 404);
      if (!tabs) throw new ContactError(setupMessage || 'The Clients_Additional_Info spreadsheet is not connected.', 503);
      const tab = (await tabs.read([title])).get(title);
      if (!tab) throw new ContactError(`There is no "${title}" tab in Clients_Additional_Info yet.`, 404);
      // Columns without a heading are left out; so are rows with nothing in the shown columns.
      const columns = tab.headers.map((header, index) => ({ header, index })).filter((column) => column.header);
      const rows = tab.rows
        .map((row, index) => ({ rowNumber: index + 2, values: columns.map((column) => String(row[column.index] ?? '').trim()) }))
        .filter((row) => row.values.some(Boolean));
      return { title: tab.title, headers: columns.map((column) => column.header), rows };
    },
  };
}
