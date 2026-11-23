import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';

export const WORK_PERMIT_SHEET = 'WorkPermits';

// Asylum-based EAD, category (c)(8), under 8 CFR 208.7 as of November 2026:
// the I-765 may be filed once the asylum clock reaches 150 days, and USCIS may not
// approve it before day 180. Applicant-caused delays stop the clock (Pause/Resume).
// A February 2026 proposed rule (USCIS-2025-0370) would replace this with 365 days;
// if it is finalized, update these numbers for applications filed after its effective date.
export const FILE_AFTER_DAYS = 150;
export const APPROVE_AFTER_DAYS = 180;
// Renewals can be filed up to 180 days before expiry. Renewals filed on or after
// Oct 30, 2025 get no automatic extension, so an expired card means no work authorization.
export const RENEW_WINDOW_DAYS = 180;
export const DECISIONS = ['Pending', 'Approved', 'Denied'];

// New columns are appended after the existing ones so sheets keep their layout.
export const WORK_PERMIT_HEADERS = [
  'ClientID', 'ClientName', 'OriginalNote', 'Section',
  'FilingDate', 'ClockStatus', 'PausedSince', 'PausedDays', 'TrackingToken',
  'ANumber', 'EADDecision', 'EADApprovedDate', 'EADExpiryDate',
  // Same fields as the EOIR "Asylum EAD Clock Information" screen (a snapshot as of EOIRAsOf).
  'NTADate', 'EOIRAsOf', 'EOIRClockStatus', 'EOIRClockDays', 'AsylumType', 'AsylumDecision',
  'AppealFiledDate', 'DHSDaysAtReferral', 'DHSStatusAtReferral', 'EOIREvents',
];

export const EOIR_CLOCK_STATUSES = ['Running', 'Stopped'];
export const EOIR_EVENT_FIELDS = ['event', 'date', 'city', 'decision', 'action', 'elapsed', 'cumulative'];

// EOIREvents holds one event per line: "Hearing | 2026-10-30 | CHI | 9V - Vacated … | Run | 30 | 85".
export function parseEoirEvents(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => parts.some(Boolean))
    .map((parts) => Object.fromEntries(EOIR_EVENT_FIELDS.map((field, index) => [field, parts[index] ?? ''])));
}

export function formatEoirEvents(events = []) {
  return events.map((event) => EOIR_EVENT_FIELDS.map((field) => String(event[field] ?? '').replace(/[|\r\n]+/g, ' ').trim()).join(' | ')).join('\n');
}

export class WorkPermitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (value) => String(value ?? '').trim();
const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const dateOrBlank = (value) => (isDateKey(text(value)) ? text(value) : '');

// A-Numbers are 8 or 9 digits, shown EOIR-style as 245-943-700 (8 digits get a leading 0).
export function formatANumber(value) {
  const digits = String(value ?? '').replace(/^\s*A/i, '').replace(/[\s-]/g, '');
  if (!/^\d{8,9}$/.test(digits)) return '';
  const nine = digits.padStart(9, '0');
  return `${nine.slice(0, 3)}-${nine.slice(3, 6)}-${nine.slice(6)}`;
}

export function mapWorkPermit(row) {
  const pausedDays = Number.parseInt(text(row.PausedDays), 10);
  const decision = DECISIONS.find((value) => value.toLowerCase() === text(row.EADDecision).toLowerCase()) || 'Pending';
  return {
    aNumber: formatANumber(row.ANumber) || text(row.ANumber),
    decision,
    approvedDate: dateOrBlank(row.EADApprovedDate),
    expiryDate: dateOrBlank(row.EADExpiryDate),
    id: text(row.ClientID),
    name: text(row.ClientName),
    note: text(row.OriginalNote),
    section: text(row.Section),
    filingDate: isDateKey(text(row.FilingDate)) ? text(row.FilingDate) : '',
    clockStatus: text(row.ClockStatus).toLowerCase() === 'paused' ? 'Paused' : 'Running',
    pausedSince: isDateKey(text(row.PausedSince)) ? text(row.PausedSince) : '',
    pausedDays: Number.isFinite(pausedDays) && pausedDays > 0 ? pausedDays : 0,
    trackingToken: text(row.TrackingToken),
    ntaDate: dateOrBlank(row.NTADate),
    eoirAsOf: dateOrBlank(row.EOIRAsOf),
    eoirClockStatus: EOIR_CLOCK_STATUSES.find((value) => value.toLowerCase() === text(row.EOIRClockStatus).toLowerCase()) || '',
    eoirClockDays: /^\d+$/.test(text(row.EOIRClockDays)) ? text(row.EOIRClockDays) : '',
    asylumType: text(row.AsylumType),
    asylumDecision: text(row.AsylumDecision),
    appealFiledDate: dateOrBlank(row.AppealFiledDate),
    dhsDaysAtReferral: /^\d+$/.test(text(row.DHSDaysAtReferral)) ? text(row.DHSDaysAtReferral) : '',
    dhsStatusAtReferral: text(row.DHSStatusAtReferral),
    eoirEvents: parseEoirEvents(row.EOIREvents),
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
    ANumber: record.aNumber,
    EADDecision: record.decision === 'Pending' ? '' : record.decision,
    EADApprovedDate: record.decision === 'Approved' ? record.approvedDate : '',
    EADExpiryDate: record.decision === 'Approved' ? record.expiryDate : '',
    NTADate: record.ntaDate || '',
    EOIRAsOf: record.eoirAsOf || '',
    EOIRClockStatus: record.eoirClockStatus || '',
    EOIRClockDays: record.eoirClockDays || '',
    AsylumType: record.asylumType || '',
    AsylumDecision: record.asylumDecision || '',
    AppealFiledDate: record.appealFiledDate || '',
    DHSDaysAtReferral: record.dhsDaysAtReferral || '',
    DHSStatusAtReferral: record.dhsStatusAtReferral || '',
    EOIREvents: formatEoirEvents(record.eoirEvents),
  };
}

export function centralToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayNumber = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);
const addDays = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Asylum clock: days since the I-589 was filed, minus paused days.
function asylumClock(record, today) {
  const paused = record.clockStatus === 'Paused';
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(record.filingDate));
  const currentPause = paused && record.pausedSince ? Math.max(0, dayNumber(today) - dayNumber(record.pausedSince)) : 0;
  const pausedDays = record.pausedDays + currentPause;
  const counted = Math.max(0, elapsed - pausedDays);
  // Date the clock will reach `day`; unknown while paused.
  const dateForDay = (day) => (paused ? '' : addDays(today, Math.max(0, day - counted)));
  return { counted, pausedDays, paused, pausedSince: paused ? record.pausedSince : '', dateForDay };
}

/*
 * Works out where a client is in the asylum work permit process and what to count down to.
 * stage: not-started | waiting | ready-to-file | active | renewal-due | expired | denied
 * countdown: { days, date, of, label } — `of` is the length of the span the ring shows.
 * This object is sent to the client's public page, so it must never include the A-Number or notes.
 */
export function workPermitStatus(record, today = centralToday()) {
  const base = {
    filingDate: record.filingDate,
    approvedDate: record.decision === 'Approved' ? record.approvedDate : '',
    expiryDate: record.decision === 'Approved' ? record.expiryDate : '',
    fileAfterDays: FILE_AFTER_DAYS,
    approveAfterDays: APPROVE_AFTER_DAYS,
    clock: null,
    countdown: null,
  };
  const clock = record.filingDate ? asylumClock(record, today) : null;
  if (clock) base.clock = { counted: clock.counted, pausedDays: clock.pausedDays, paused: clock.paused, pausedSince: clock.pausedSince };

  if (record.decision === 'Denied') return { ...base, stage: 'denied', label: 'Denied' };

  if (record.decision === 'Approved') {
    if (!record.expiryDate) return { ...base, stage: 'active', label: 'Work permit approved' };
    const daysLeft = dayNumber(record.expiryDate) - dayNumber(today);
    const validFor = record.approvedDate ? Math.max(1, dayNumber(record.expiryDate) - dayNumber(record.approvedDate)) : Math.max(1, daysLeft);
    const countdown = { days: Math.max(0, daysLeft), date: record.expiryDate, of: validFor, label: 'until the work permit expires' };
    if (daysLeft < 0) return { ...base, stage: 'expired', label: 'Expired', countdown: { ...countdown, days: 0 } };
    if (daysLeft <= RENEW_WINDOW_DAYS) return { ...base, stage: 'renewal-due', label: 'Renewal due', countdown };
    return { ...base, stage: 'active', label: 'Work permit active', countdown };
  }

  if (!clock) return { ...base, stage: 'not-started', label: "Needs Init Asylum Rec'd Date" };
  // From day 150 the I-765 can be filed; count down to day 180, the earliest USCIS can approve.
  if (clock.counted >= FILE_AFTER_DAYS) {
    if (clock.counted >= APPROVE_AFTER_DAYS) return { ...base, stage: 'ready-to-file', label: `Eligible – past day ${APPROVE_AFTER_DAYS}` };
    return {
      ...base,
      stage: 'ready-to-file',
      label: 'Eligible to file I-765',
      countdown: { days: APPROVE_AFTER_DAYS - clock.counted, date: clock.dateForDay(APPROVE_AFTER_DAYS), of: APPROVE_AFTER_DAYS, counted: clock.counted, label: `until USCIS can approve (day ${APPROVE_AFTER_DAYS})` },
    };
  }
  return {
    ...base,
    stage: 'waiting',
    label: clock.paused ? 'Clock paused' : 'Waiting – asylum clock',
    countdown: { days: FILE_AFTER_DAYS - clock.counted, date: clock.dateForDay(FILE_AFTER_DAYS), of: FILE_AFTER_DAYS, counted: clock.counted, label: `until the I-765 can be filed (day ${FILE_AFTER_DAYS})` },
  };
}

export function pauseClock(record, today = centralToday()) {
  if (!record.filingDate) throw new WorkPermitError("Add the Init Asylum Rec'd Date before pausing the clock.");
  if (record.decision !== 'Pending') throw new WorkPermitError('The asylum clock no longer applies once the work permit is decided.');
  if (record.clockStatus === 'Paused') throw new WorkPermitError('The clock is already paused.', 409);
  return { ...record, clockStatus: 'Paused', pausedSince: today };
}

export function resumeClock(record, today = centralToday()) {
  if (record.clockStatus !== 'Paused') throw new WorkPermitError('The clock is not paused.', 409);
  const pausedFor = record.pausedSince ? Math.max(0, dayNumber(today) - dayNumber(record.pausedSince)) : 0;
  return { ...record, clockStatus: 'Running', pausedSince: '', pausedDays: record.pausedDays + pausedFor };
}

export function nextWorkPermitId(records) {
  const highest = records.reduce((max, record) => Math.max(max, Number(record.id.match(/\d+/)?.[0] || 0)), 0);
  return `WP-${String(highest + 1).padStart(3, '0')}`;
}

export function newWorkPermit(input, records) {
  return {
    ...mapWorkPermit({}),
    ...input,
    id: nextWorkPermitId(records),
    clockStatus: 'Running',
    pausedSince: '',
    trackingToken: '',
  };
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
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
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
    sheet.columns = [10, 30, 70, 10, 12, 12, 12, 11, 36, 14, 12, 15, 14].map((width) => ({ width }));
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
    add(input) {
      const operation = queue.then(async () => {
        const records = await list();
        const record = newWorkPermit(input, records);
        await save([...records, record]);
        return record;
      });
      queue = operation.catch(() => {});
      return operation;
    },
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
    remove(id) {
      const operation = queue.then(async () => {
        const records = await list();
        const record = records.find((item) => item.id === id);
        if (!record) throw new WorkPermitError('Work permit not found.', 404);
        await save(records.filter((item) => item.id !== id));
        return record;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
