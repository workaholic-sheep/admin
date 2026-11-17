import ExcelJS from 'exceljs';
import { stat } from 'node:fs/promises';

export const REMINDER_SHEET = 'PaymentReminders';
// Email is last so sheets created before it existed keep their column positions.
export const REMINDER_HEADERS = ['ReminderID', 'Name', 'Responded', 'Response', 'ResponseDateTime', 'Email'];

// Accepts headings typed by hand ("name", "Client Name", "Email Address", ...).
const HEADER_ALIASES = {
  reminderid: 'ReminderID', id: 'ReminderID',
  name: 'Name', clientname: 'Name', client: 'Name', fullname: 'Name',
  email: 'Email', emailaddress: 'Email', clientemail: 'Email',
  responded: 'Responded', didtheyrespond: 'Responded',
  response: 'Response', whattheyresponded: 'Response', reply: 'Response',
  responsedatetime: 'ResponseDateTime', respondedat: 'ResponseDateTime', dateandtime: 'ResponseDateTime', datetime: 'ResponseDateTime', responsedate: 'ResponseDateTime',
};

export function canonicalReminderHeader(header) {
  const key = String(header ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] || String(header ?? '').trim();
}

export function mapReminder(row) {
  return {
    id: String(row.ReminderID ?? '').trim(),
    name: String(row.Name ?? '').trim(),
    email: String(row.Email ?? '').trim(),
    responded: String(row.Responded ?? '').trim().toLowerCase() === 'yes' ? 'Yes' : 'No',
    response: String(row.Response ?? '').trim(),
    respondedAt: String(row.ResponseDateTime ?? '').trim(),
  };
}

export function reminderCells(reminder) {
  return {
    ReminderID: reminder.id,
    Name: reminder.name,
    Responded: reminder.responded,
    Response: reminder.response,
    ResponseDateTime: reminder.respondedAt,
    Email: reminder.email || '',
  };
}

export function reminderRow(reminder) {
  return [reminder.id, reminder.name, reminder.responded, reminder.response, reminder.respondedAt, reminder.email || ''];
}

export function nextReminderId(reminders) {
  const highest = reminders.reduce((max, reminder) => Math.max(max, Number(reminder.id.match(/\d+/)?.[0] || 0)), 0);
  return `PR-${String(highest + 1).padStart(3, '0')}`;
}

const exists = (filePath) => stat(filePath).then(() => true, () => false);

function cellValue(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  return String(cell.text ?? value);
}

function readSheet(sheet) {
  if (!sheet) return [];
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => { headers[column] = canonicalReminderHeader(cellValue(cell)); });
  const reminders = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const record = {};
    headers.forEach((header, column) => { if (header) record[header] = cellValue(row.getCell(column)); });
    const reminder = mapReminder(record);
    // Rows added by hand may have no ID; give them a stable one based on the row.
    if (reminder.name) reminders.push({ ...reminder, id: reminder.id || `R${rowNumber}` });
  }
  return reminders;
}

export function createReminderWorkbookStore(filePath) {
  let queue = Promise.resolve();

  async function list() {
    if (!(await exists(filePath))) return [];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return readSheet(workbook.getWorksheet(REMINDER_SHEET));
  }

  // The whole sheet is rewritten on each save; this file is owned by the tracker alone.
  async function save(reminders) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(REMINDER_SHEET);
    sheet.addRow(REMINDER_HEADERS);
    reminders.forEach((reminder) => sheet.addRow(reminderRow(reminder)));
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [{ width: 12 }, { width: 28 }, { width: 11 }, { width: 60 }, { width: 20 }, { width: 32 }];
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    try {
      await workbook.xlsx.writeFile(filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw new Error('The payment reminder workbook is locked by Excel. Close it and try again.');
      throw error;
    }
  }

  function queued(task) {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  }

  return {
    list,
    load: async () => ({ reminders: await list(), notice: '' }),
    add: (input) => queued(async () => {
      const reminders = await list();
      const reminder = { ...input, id: nextReminderId(reminders) };
      await save([...reminders, reminder]);
      return reminder;
    }),
    update: (id, input) => queued(async () => {
      const reminders = await list();
      const index = reminders.findIndex((reminder) => reminder.id === id);
      if (index === -1) throw new Error('Reminder not found.');
      reminders[index] = { ...input, id };
      await save(reminders);
      return reminders[index];
    }),
  };
}
