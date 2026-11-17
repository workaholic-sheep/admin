import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';

export const WORK_PERMIT_SHEET = 'WorkPermits';
export const CLOCK_DAYS = 150;
// New columns are appended after the original four so existing sheets keep their layout.
export const WORK_PERMIT_HEADERS = ['ClientID', 'ClientName', 'OriginalNote', 'Section', 'FilingDate', 'ClockStatus', 'PausedSince', 'PausedDays', 'TrackingToken'];

export class WorkPermitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (value) => String(value ?? '').trim();
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function mapWorkPermit(row) {
  const pausedDays = Number.parseInt(text(row.PausedDays), 10);
  return {
    id: text(row.ClientID),
    name: text(row.ClientName),
    note: text(row.OriginalNote),
    section: text(row.Section),
    filingDate: isDateKey(text(row.FilingDate)) ? text(row.FilingDate) : '',
    clockStatus: text(row.ClockStatus).toLowerCase() === 'paused' ? 'Paused' : 'Running',
    pausedSince: isDateKey(text(row.PausedSince)) ? text(row.PausedSince) : '',
    pausedDays: Number.isFinite(pausedDays) && pausedDays > 0 ? pausedDays : 0,
    trackingToken: text(row.TrackingToken),
  };
}

export function workPermitCells(record) {
  return {
    ClientID: record.id,
    ClientName: record.name,
    OriginalNote: record.note,
    Section: record.section,
    FilingDate: record.filingDate,
    ClockStatus: record.filingDate ? record.clockStatus : '',
    PausedSince: record.clockStatus === 'Paused' ? record.pausedSince : '',
    PausedDays: record.pausedDays ? String(record.pausedDays) : '',
    TrackingToken: record.trackingToken,
  };
}

export function centralToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayNumber = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);
const addDays = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function clockProgress(record, today = centralToday()) {
  if (!record.filingDate) return { started: false, totalDays: CLOCK_DAYS };
  const paused = record.clockStatus === 'Paused';
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(record.filingDate));
  const currentPause = paused && record.pausedSince ? Math.max(0, dayNumber(today) - dayNumber(record.pausedSince)) : 0;
  const pausedDays = record.pausedDays + currentPause;
  const daysCounted = Math.min(CLOCK_DAYS, Math.max(0, elapsed - pausedDays));
  const daysRemaining = CLOCK_DAYS - daysCounted;
  return {
    started: true,
    totalDays: CLOCK_DAYS,
    filingDate: record.filingDate,
    daysCounted,
    daysRemaining,
    pausedDays,
    paused,
    pausedSince: paused ? record.pausedSince : '',
    complete: daysRemaining === 0,
    estimatedDate: paused ? '' : addDays(today, daysRemaining),
  };
}

export function pauseClock(record, today = centralToday()) {
  if (!record.filingDate) throw new WorkPermitError('Add a filing date before pausing the clock.');
  if (record.clockStatus === 'Paused') throw new WorkPermitError('The clock is already paused.', 409);
  return { ...record, clockStatus: 'Paused', pausedSince: today };
}

export function resumeClock(record, today = centralToday()) {
  if (record.clockStatus !== 'Paused') throw new WorkPermitError('The clock is not paused.', 409);
  const pausedFor = record.pausedSince ? Math.max(0, dayNumber(today) - dayNumber(record.pausedSince)) : 0;
  return { ...record, clockStatus: 'Running', pausedSince: '', pausedDays: record.pausedDays + pausedFor };
}

export function newTrackingToken() {
  return randomBytes(24).toString('base64url');
}

export function isTrackingToken(value) {
  return /^[A-Za-z0-9_-]{24,64}$/.test(String(value || ''));
}

function cellValue(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  return String(cell.text ?? value);
}

export function createWorkPermitWorkbookStore(filePath) {
  let queue = Promise.resolve();

  async function list() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet(WORK_PERMIT_SHEET);
    if (!sheet) throw new WorkPermitError(`The ${WORK_PERMIT_SHEET} tab was not found in the work permit workbook.`, 500);
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => { headers[column] = cellValue(cell).trim(); });
    const records = [];
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const raw = {};
      headers.forEach((header, column) => { if (header) raw[header] = cellValue(row.getCell(column)); });
      const record = mapWorkPermit(raw);
      if (record.id && record.name) records.push(record);
    }
    return records;
  }

  // Rebuilds the workbook as one Excel Table; the file is owned by the work permit module.
  async function save(records) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(WORK_PERMIT_SHEET);
    sheet.addTable({
      name: WORK_PERMIT_SHEET,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleLight9', showRowStripes: true },
      columns: WORK_PERMIT_HEADERS.map((name) => ({ name, filterButton: true })),
      rows: records.map((record) => { const cells = workPermitCells(record); return WORK_PERMIT_HEADERS.map((header) => cells[header]); }),
    });
    sheet.columns = [10, 30, 70, 10, 12, 12, 12, 11, 36].map((width) => ({ width }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    try {
      await workbook.xlsx.writeFile(filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw new WorkPermitError('The work permit workbook is locked by Excel. Close it and try again.', 423);
      throw error;
    }
  }

  return {
    configured: () => stat(filePath).then(() => true, () => false),
    list,
    update(id, mutate) {
      const operation = queue.then(async () => {
        const records = await list();
        const index = records.findIndex((record) => record.id === id);
        if (index === -1) throw new WorkPermitError('Work permit not found.', 404);
        records[index] = mutate(records[index]);
        await save(records);
        return records[index];
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
