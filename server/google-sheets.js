import { google } from 'googleapis';
import { ADDRESS_HEADERS, CURRENT_ADDRESS_HEADERS, DOB_HEADERS, GENDER_HEADERS, ID_HEADERS, ageFrom, mapMasterData } from './workbook.js';
import { REMINDER_HEADERS, REMINDER_SHEET, canonicalReminderHeader, mapReminder, nextReminderId, reminderCells } from './payment-reminders.js';
import { CREDENTIAL_HEADERS, CREDENTIAL_SHEET, credentialRow, mapCredentialRow } from './credentials.js';
import { WORK_PERMIT_HEADERS, WorkPermitError, mapWorkPermit, newWorkPermit, workPermitCells } from './work-permits.js';

const SHEET_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const normalize = (value) => String(value ?? '').trim().toLowerCase();

// Wide enough for columns added after the original A–P layout (Date of Birth, Gender, Address, …).
const CLIENT_COLUMNS = 'A:AZ';

function quoteSheetName(name) {
  return `'${name.replaceAll("'", "''")}'`;
}

function parseDateFormula(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `=DATE(${Number(match[1])},${Number(match[2])},${Number(match[3])})` : '';
}

function safeUserText(value) {
  const text = String(value ?? '').trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export class SheetSetupError extends Error {}

// Accepts either a bare spreadsheet ID or the full Google Sheets address.
export function spreadsheetIdFrom(value) {
  const text = String(value ?? '').trim();
  return text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] || text;
}

export const looksLikeSpreadsheetId = (value) => /^[A-Za-z0-9_-]{25,}$/.test(String(value || ''));

// Turns Google API failures into messages that say what to fix in the spreadsheet.
export function explainGoogleError(error, { label, envName, serviceAccountEmail, write = false }) {
  if (error instanceof SheetSetupError || error instanceof WorkPermitError) return error;
  const status = Number(error?.code || error?.response?.status || 0);
  const detail = String(error?.message || '');
  if (/not supported for this document/i.test(detail)) {
    return new SheetSetupError(`The ${label} file is an Excel file stored in Google Drive, which Google's API can't read. Open it in Drive, choose File → Save as Google Sheets, then put the new sheet's ID in ${envName}.`);
  }
  if (status === 403) {
    return new SheetSetupError(write
      ? `The app can't save to the ${label} spreadsheet. Share it with ${serviceAccountEmail} as Editor.`
      : `The ${label} spreadsheet isn't shared with the app. Share it with ${serviceAccountEmail} (Viewer or Editor).`);
  }
  if (status === 404) {
    return new SheetSetupError(`The ${label} spreadsheet was not found. Check the ID in ${envName}.`);
  }
  return error;
}

function columnLetters(index) {
  let letters = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    index = Math.floor((index - 1) / 26);
  }
  return letters;
}

function mappedClient(headers, values) {
  const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  const client = mapMasterData(record);
  for (const field of ['id', 'name', 'email', 'phone', 'translator', 'frequency', 'outcome', 'paymentStatus', 'notes']) {
    client[field] = String(client[field] ?? '');
  }
  client.daysRemaining = String(client.daysRemaining ?? '');
  client.caseType = String(client.caseType ?? '');
  for (const field of ['age', 'gender', 'address']) client[field] = String(client[field] ?? '');
  return client;
}

function firstIndex(indexes, labels) {
  return labels.map((label) => indexes.get(normalize(label))).find((index) => index !== undefined);
}

function ageFormula(indexes, rowNumber) {
  const dobIndex = firstIndex(indexes, DOB_HEADERS);
  if (dobIndex === undefined) return '';
  const cell = `${columnLetters(dobIndex + 1)}${rowNumber}`;
  return `=IF(${cell}="","",DATEDIF(${cell},TODAY(),"Y"))`;
}

function googleDate(value) {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  const isoDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];
  const readableDate = text.match(/[A-Za-z]+ \d{1,2}, \d{4}/);
  return readableDate ? new Date(readableDate[0]).toISOString().slice(0, 10) : '';
}

function googleTime(value) {
  if (typeof value !== 'number' || value < 0 || value >= 1) return String(value ?? '').trim();
  const totalMinutes = Math.round(value * 1440) % 1440;
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = String(totalMinutes % 60).padStart(2, '0');
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

export function createGoogleSheetStore({
  spreadsheetId,
  sheetName = 'MasterData',
  courtSpreadsheetId = '',
  courtSheetName = 'COURT DATE LIST',
  workPermitSpreadsheetId = '',
  workPermitSheetName = 'WorkPermits',
  reminderSheetName = REMINDER_SHEET,
  reminderSpreadsheetId: reminderSpreadsheetIdOption = '',
  credentialSheetName = CREDENTIAL_SHEET,
  credentialSpreadsheetId: credentialSpreadsheetIdOption = '',
  serviceAccountEmail,
  privateKey,
}, api = google) {
  let activeSheetName = '';
  let queuedWrite = Promise.resolve();
  const resolvedTitles = new Map();

  // Finds the real tab title, ignoring case and stray spaces (e.g. "COURT DATE LIST ").
  async function resolveTab(sheets, targetSpreadsheetId, wanted, label) {
    if (!looksLikeSpreadsheetId(targetSpreadsheetId)) {
      const envName = label === 'court date' ? 'GOOGLE_COURT_SHEET_ID' : 'GOOGLE_WORK_PERMIT_SHEET_ID';
      throw new SheetSetupError(`${envName} is set to "${targetSpreadsheetId}", which looks like a name, not a spreadsheet ID. Use the long ID from the sheet's web address (the part between /d/ and /edit), or paste the whole address. Put the tab name in ${envName.replace('_ID', '_NAME')} instead.`);
    }
    const cacheKey = `${targetSpreadsheetId}|${wanted}`;
    if (resolvedTitles.has(cacheKey)) return resolvedTitles.get(cacheKey);
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId, fields: 'sheets.properties.title' });
    const titles = (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
    const title = titles.find((candidate) => candidate === wanted)
      || titles.find((candidate) => normalize(candidate).replace(/\s+/g, ' ') === normalize(wanted).replace(/\s+/g, ' '));
    if (!title) throw new SheetSetupError(`The ${label} spreadsheet has no tab named "${wanted.trim()}". Tabs found: ${titles.map((name) => `"${name}"`).join(', ') || 'none'}.`);
    resolvedTitles.set(cacheKey, title);
    return title;
  }

  async function readOtherSheet({ targetSpreadsheetId, tab, columns, label, envName, options = {} }) {
    const sheets = getSheetsClient();
    try {
      const title = await resolveTab(sheets, targetSpreadsheetId, tab, label);
      const response = await sheets.spreadsheets.values.get({ spreadsheetId: targetSpreadsheetId, range: `${quoteSheetName(title)}!${columns}`, ...options });
      return response.data.values || [];
    } catch (error) {
      resolvedTitles.delete(`${targetSpreadsheetId}|${tab}`);
      throw explainGoogleError(error, { label, envName, serviceAccountEmail });
    }
  }

  function getSheetsClient() {
    if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
      throw new Error('Google Sheets requires GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY.');
    }
    const auth = new api.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: [SHEET_SCOPE],
    });
    return api.sheets({ version: 'v4', auth });
  }

  async function getRows() {
    const sheets = getSheetsClient();
    const readSheet = async (targetSheet) => {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${quoteSheetName(targetSheet)}!${CLIENT_COLUMNS}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });
      const values = response.data.values || [];
      if (!values.length) return null;
      return { headers: values[0].map((header) => String(header ?? '')), rows: values.slice(1) };
    };

    if (activeSheetName) {
      const data = await readSheet(activeSheetName);
      if (!data) throw new Error(`The ${activeSheetName} tab is empty or unavailable.`);
      return { sheets, sheetName: activeSheetName, quotedSheet: quoteSheetName(activeSheetName), range: `${quoteSheetName(activeSheetName)}!${CLIENT_COLUMNS}`, ...data };
    }

    const hasCaseType = (data) => Boolean(data?.headers.some((header) => ['caetype', 'casetype', 'case type'].includes(normalize(header))));
    let data;
    let configuredData;
    let configuredError;
    const candidates = [...new Set(['MasterData(Klievont)', sheetName])];
    for (const candidate of candidates) {
      let candidateData;
      try {
        candidateData = await readSheet(candidate);
      } catch (error) {
        if (normalize(candidate) === normalize(sheetName)) configuredError = error;
        continue;
      }
      if (!candidateData) continue;
      if (normalize(candidate) === normalize(sheetName)) configuredData = candidateData;
      if (normalize(candidate) === normalize('MasterData(Klievont)') && hasCaseType(candidateData)) {
        activeSheetName = candidate;
        data = candidateData;
        break;
      }
    }

    if (!activeSheetName && configuredData) {
      activeSheetName = sheetName;
      data = configuredData;
    }
    if (!activeSheetName) throw configuredError || new Error(`The ${sheetName} tab is empty or unavailable.`);
    if (!data) throw new Error(`The ${activeSheetName} tab is empty or unavailable.`);
    return { sheets, sheetName: activeSheetName, quotedSheet: quoteSheetName(activeSheetName), range: `${quoteSheetName(activeSheetName)}!${CLIENT_COLUMNS}`, ...data };
  }

  async function list() {
    const { headers, rows } = await getRows();
    return rows
      .map((row) => mappedClient(headers, row))
      .filter((client) => client.name)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function listCourtDates() {
    if (!courtSpreadsheetId) return [];
    const values = await readOtherSheet({
      targetSpreadsheetId: courtSpreadsheetId,
      tab: courtSheetName,
      columns: 'B:L',
      label: 'court date',
      envName: 'GOOGLE_COURT_SHEET_ID',
      options: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' },
    });
    if (!values.length) return [];
    const rawHeaders = values[0].map((header) => String(header ?? '').trim());
    const headers = rawHeaders.map((header) => normalize(header));
    const index = (label) => headers.indexOf(normalize(label));
    const nameIndex = index('NAME');
    const courtDateIndex = index('COURT DATE');
    const rescheduleIndex = index('RESCHEDULE DATE');
    const noteIndex = rawHeaders.indexOf('Note');
    const additionalNoteIndex = rawHeaders.indexOf('NOTE');
    const records = [];
    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const clientName = String(row[nameIndex] ?? '').trim();
      if (!clientName) continue;
      const courtDate = googleDate(row[courtDateIndex]);
      const rescheduleDate = googleDate(row[rescheduleIndex]);
      const date = rescheduleDate || courtDate;
      if (!date) continue;
      records.push({
        id: String(rowIndex + 1),
        clientName,
        date,
        originalDate: courtDate,
        rescheduleDate,
        note: String(row[noteIndex] ?? '').trim(),
        additionalNote: String(row[additionalNoteIndex] ?? '').trim(),
        country: String(row[index('COUNTRY')] ?? '').trim(),
        alienNumber: String(row[index('ALIEN NUMBER')] ?? '').trim(),
        time: googleTime(row[index('TIME')]),
        address: String(row[index('ADDRESS')] ?? row[index('COURT ADDRESS')] ?? '').trim(),
        judge: String(row[index('JUDGE')] ?? '').trim(),
        status: String(row[index('STATUS')] ?? '').trim(),
      });
    }
    return records;
  }

  async function appendClient(input) {
    const { sheets, headers, rows, range } = await getRows();
    const email = String(input.email ?? '').trim();
    const clients = rows.map((row) => mappedClient(headers, row));
    if (email && clients.some((client) => normalize(client.email) === normalize(email))) {
      throw new Error('A client with this email already exists.');
    }

    const nextId = clients.reduce((largest, client) => {
      const match = client.id.match(/^CL-(\d+)$/i);
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1;
    const clientId = `CL-${String(nextId).padStart(3, '0')}`;
    const rowNumber = rows.length + 2;
    const row = Array(headers.length).fill('');
    const indexes = new Map(headers.map((header, index) => [normalize(header), index]));
    const put = (header, value, isFormula = false) => {
      const index = indexes.get(normalize(header));
      if (index === undefined) return;
      row[index] = !isFormula && typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value;
    };
    const putFormula = (header, value) => put(header, value, true);
    const dateFormula = parseDateFormula;

    put('ID No.', clientId);
    put('ClientID', clientId);
    put('Id', clientId);
    put('First Name', String(input.firstName ?? '').trim());
    put('Middle Name', String(input.middleName ?? '').trim());
    put('Last Name', String(input.lastName ?? '').trim());
    for (const header of CURRENT_ADDRESS_HEADERS) put(header, String(input.currentAddress ?? '').trim());
    put('Client Name', String(input.name ?? '').trim());
    put('ClientName', String(input.name ?? '').trim());
    put('Email', email);
    put('PHONE', String(input.phone ?? '').trim());
    put('Translator Needed', input.translator || 'No');
    putFormula('Date Onboarded', dateFormula(input.onboardingDate) || '=TODAY()');
    put('Meeting Frequency', input.frequency || '');
    putFormula('Date of Interview', dateFormula(input.interviewDate));
    putFormula('Date Contacted', dateFormula(input.lastContactDate));
    put('Outcome', input.outcome || '');
    put('Outcome ', input.outcome || '');
    putFormula('Next date of Contact', dateFormula(input.nextContactDate));
    putFormula('Last Date With Attorney', dateFormula(input.lastAttorneyDate));
    put('Payment Status', input.paymentStatus || 'Pending');
    putFormula('Todays Date', '=TODAY()');
    const nextContactLetter = columnLetters((indexes.get(normalize('Next date of Contact')) ?? 10) + 1);
    const todayLetter = columnLetters((indexes.get(normalize('Todays Date')) ?? 13) + 1);
    putFormula('Days Remaining', `=IF(${nextContactLetter}${rowNumber}="","",${nextContactLetter}${rowNumber}-${todayLetter}${rowNumber})`);
    const dateOfBirth = dateFormula(input.dateOfBirth);
    for (const header of DOB_HEADERS) putFormula(header, dateOfBirth);
    for (const header of GENDER_HEADERS) put(header, String(input.gender ?? '').trim());
    for (const header of ADDRESS_HEADERS) put(header, String(input.address ?? '').trim());
    if (dateOfBirth) putFormula('Age', ageFormula(indexes, rowNumber));
    put('NOTES', input.notes || '');

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return {
      id: clientId,
      name: String(input.name ?? '').trim(),
      caseType: input.caseType || '',
      email,
      phone: String(input.phone ?? '').trim(),
      translator: input.translator || 'No',
      onboardingDate: input.onboardingDate || new Date().toISOString().slice(0, 10),
      frequency: input.frequency || '',
      interviewDate: input.interviewDate || '',
      lastContactDate: input.lastContactDate || '',
      outcome: input.outcome || '',
      nextContactDate: input.nextContactDate || '',
      lastAttorneyDate: input.lastAttorneyDate || '',
      paymentStatus: input.paymentStatus || 'Pending',
      notes: input.notes || '',
      dateOfBirth: input.dateOfBirth || '',
      age: ageFrom(input.dateOfBirth),
      gender: String(input.gender ?? '').trim(),
      address: String(input.address ?? '').trim(),
      daysRemaining: input.nextContactDate
        ? Math.round((new Date(`${input.nextContactDate}T00:00:00Z`) - new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000)
        : '',
    };
  }

  async function completeFollowUp(clientId) {
    const { sheets, headers, rows, quotedSheet } = await getRows();
    const idIndex = headers.findIndex((header) => ID_HEADERS.map(normalize).includes(normalize(header)));
    const nextContactIndex = headers.findIndex((header) => normalize(header) === normalize('Next date of Contact'));
    const rowIndex = rows.findIndex((row) => String(row[idIndex] ?? '') === clientId);
    if (rowIndex < 0) throw new Error('Client not found.');
    const row = rows[rowIndex];
    const scheduledDate = String(row[nextContactIndex] ?? '').trim();
    if (!scheduledDate) throw new Error('This client has no scheduled follow-up to complete.');
    if (normalize(scheduledDate) === 'done') throw new Error('This follow-up is already marked done.');

    const rowNumber = rowIndex + 2;
    const cell = `${columnLetters(nextContactIndex + 1)}${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedSheet}!${cell}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['done']] },
    });
    row[nextContactIndex] = 'done';
    return mappedClient(headers, row);
  }

  async function updateClient(clientId, input) {
    const { sheets, headers, rows, quotedSheet } = await getRows();
    const indexes = new Map(headers.map((header, index) => [normalize(header), index]));
    const idIndex = ID_HEADERS.map((header) => indexes.get(normalize(header))).find((index) => index !== undefined);
    const rowIndex = rows.findIndex((row) => String(row[idIndex] ?? '') === clientId);
    if (rowIndex < 0) throw new Error('Client not found.');

    const email = String(input.email ?? '').trim();
    if (email && rows.some((row, index) => index !== rowIndex && normalize(row[indexes.get(normalize('Email'))]) === normalize(email))) {
      throw new Error('A client with this email already exists.');
    }
    const nextContact = String(input.nextContactDate ?? '').trim();
    const nextContactValue = normalize(nextContact) === 'done' ? 'done' : parseDateFormula(nextContact);
    if (nextContact && !nextContactValue) throw new Error('Next contact must be a date or done.');

    const updates = [];
    const put = (header, value, isFormula = false) => {
      const columnIndex = indexes.get(normalize(header));
      if (columnIndex === undefined) return;
      const cell = `${columnLetters(columnIndex + 1)}${rowIndex + 2}`;
      updates.push({
        range: `${quotedSheet}!${cell}`,
        values: [[isFormula ? value : safeUserText(value)]],
      });
    };
    const putDate = (header, value) => put(header, parseDateFormula(value), true);

    put('Client Name', input.name);
    put('First Name', String(input.firstName ?? '').trim());
    put('Middle Name', String(input.middleName ?? '').trim());
    put('Last Name', String(input.lastName ?? '').trim());
    put('ClientName', input.name);
    put('Email', email);
    put('PHONE', input.phone);
    put('Translator Needed', input.translator);
    putDate('Date Onboarded', input.onboardingDate);
    put('Meeting Frequency', input.frequency);
    putDate('Date of Interview', input.interviewDate);
    putDate('Date Contacted', input.lastContactDate);
    put('Outcome ', input.outcome);
    put('Next date of Contact', nextContactValue, normalize(nextContact) !== 'done');
    putDate('Last Date With Attorney', input.lastAttorneyDate);
    put('Payment Status', input.paymentStatus);
    put('NOTES', input.notes);
    for (const header of DOB_HEADERS) putDate(header, input.dateOfBirth);
    for (const header of GENDER_HEADERS) put(header, input.gender);
    for (const header of ADDRESS_HEADERS) put(header, input.address);
    for (const header of CURRENT_ADDRESS_HEADERS) put(header, String(input.currentAddress ?? '').trim());
    if (parseDateFormula(input.dateOfBirth)) put('Age', ageFormula(indexes, rowIndex + 2), true);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      valueInputOption: 'USER_ENTERED',
      requestBody: { data: updates },
    });

    const updatedRow = [...rows[rowIndex]];
    for (const update of updates) {
      const column = update.range.match(/!([A-Z]+)/)?.[1];
      const index = [...column].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      updatedRow[index] = update.values[0][0];
    }
    const updatedClient = mappedClient(headers, updatedRow);
    return {
      ...updatedClient,
      onboardingDate: String(input.onboardingDate ?? ''),
      interviewDate: String(input.interviewDate ?? ''),
      lastContactDate: String(input.lastContactDate ?? ''),
      nextContactDate: normalize(nextContact) === 'done' ? 'done' : nextContact,
      lastAttorneyDate: String(input.lastAttorneyDate ?? ''),
      dateOfBirth: String(input.dateOfBirth ?? ''),
      age: ageFrom(input.dateOfBirth) || (parseDateFormula(input.dateOfBirth) ? '' : updatedClient.age),
    };
  }

  // Reminders live in their own spreadsheet when GOOGLE_PAYMENT_REMINDER_SHEET_ID is set, else in the client spreadsheet.
  const reminderSpreadsheetId = reminderSpreadsheetIdOption || spreadsheetId;
  const reminderSpreadsheetLabel = reminderSpreadsheetIdOption ? 'payment reminder' : 'client';
  const reminderContext = (write = false) => ({
    label: reminderSpreadsheetLabel,
    envName: reminderSpreadsheetIdOption ? 'GOOGLE_PAYMENT_REMINDER_SHEET_ID' : 'GOOGLE_SHEET_ID',
    serviceAccountEmail,
    write,
  });

  function checkReminderSpreadsheetId() {
    if (reminderSpreadsheetIdOption && !looksLikeSpreadsheetId(reminderSpreadsheetIdOption)) {
      throw new SheetSetupError(`GOOGLE_PAYMENT_REMINDER_SHEET_ID is set to "${reminderSpreadsheetIdOption}", which looks like a name, not a spreadsheet ID. Use the long ID from the sheet's web address (the part between /d/ and /edit), or paste the whole address. Put the tab name in GOOGLE_PAYMENT_REMINDER_SHEET_NAME instead.`);
    }
  }
  // "PaymentReminders", "Payment Reminders " and "payment_reminders" all count as the same tab.
  const sameTitle = (left, right) => normalize(left).replace(/[^a-z0-9]/g, '') === normalize(right).replace(/[^a-z0-9]/g, '');

  async function findReminderTab(sheets) {
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: reminderSpreadsheetId, fields: 'sheets.properties.title' });
    const titles = (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
    return { title: titles.find((title) => title === reminderSheetName) || titles.find((title) => sameTitle(title, reminderSheetName)) || '', titles };
  }

  // Reads the tab by heading name, so column order and heading spelling don't matter.
  async function readReminderTab(sheets, title) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: reminderSpreadsheetId, range: `${quoteSheetName(title)}!A:Z`, valueRenderOption: 'FORMATTED_VALUE' });
    const [headerRow = [], ...rows] = response.data.values || [];
    const headers = headerRow.map((header) => canonicalReminderHeader(header));
    const reminders = rows
      .map((row, index) => {
        const rowNumber = index + 2;
        const reminder = mapReminder(Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])));
        return { ...reminder, id: reminder.id || `R${rowNumber}`, rowNumber };
      })
      .filter((reminder) => reminder.name);
    return { headers, rows, reminders };
  }

  async function loadReminders() {
    const sheets = getSheetsClient();
    try {
      checkReminderSpreadsheetId();
      const { title, titles } = await findReminderTab(sheets);
      if (!title) {
        return {
          reminders: [],
          notice: `No "${reminderSheetName}" tab was found in the ${reminderSpreadsheetLabel} spreadsheet, so there are no reminders to show. Tabs found: ${titles.map((name) => `"${name}"`).join(', ') || 'none'}. The tab is created automatically when you add the first name, or you can import it there.`,
        };
      }
      const { headers, rows, reminders } = await readReminderTab(sheets, title);
      if (rows.length && !headers.includes('Name')) {
        return { reminders: [], notice: `The "${title}" tab has no Name column, so its rows can't be shown. Headings found: ${headers.filter(Boolean).map((name) => `"${name}"`).join(', ') || 'none'}.` };
      }
      return { reminders, notice: '' };
    } catch (error) {
      throw explainGoogleError(error, reminderContext());
    }
  }

  // Creates the tab if needed and appends any missing headings after the existing ones.
  async function prepareReminderTab(sheets) {
    checkReminderSpreadsheetId();
    let { title } = await findReminderTab(sheets);
    if (!title) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: reminderSpreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: reminderSheetName } } }] } });
      title = reminderSheetName;
    }
    const tab = await readReminderTab(sheets, title);
    const headers = tab.headers.length && tab.headers.some(Boolean) ? [...tab.headers] : [];
    const missing = REMINDER_HEADERS.filter((header) => !headers.includes(header));
    if (missing.length) {
      const start = headers.length + 1;
      headers.push(...missing);
      await sheets.spreadsheets.values.update({
        spreadsheetId: reminderSpreadsheetId,
        range: `${quoteSheetName(title)}!${columnLetters(start)}1:${columnLetters(headers.length)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [missing] },
      });
    }
    return { title, headers, reminders: tab.reminders };
  }

  const strip = ({ rowNumber, ...reminder }) => reminder;

  async function addReminder(input) {
    const sheets = getSheetsClient();
    try {
      const { title, headers, reminders } = await prepareReminderTab(sheets);
      const reminder = { ...input, id: nextReminderId(reminders) };
      const cells = reminderCells(reminder);
      const row = headers.map((header) => cells[header] ?? '');
      await sheets.spreadsheets.values.append({ spreadsheetId: reminderSpreadsheetId, range: `${quoteSheetName(title)}!A:${columnLetters(headers.length)}`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } });
      return reminder;
    } catch (error) {
      throw explainGoogleError(error, reminderContext(true));
    }
  }

  async function updateReminder(id, input) {
    const sheets = getSheetsClient();
    try {
      const { title, headers, reminders } = await prepareReminderTab(sheets);
      const existing = reminders.find((reminder) => reminder.id === id);
      if (!existing) throw new Error('Reminder not found.');
      // A row that had no ID keeps the one it was shown with.
      const reminder = { ...input, id };
      const cells = reminderCells(reminder);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: reminderSpreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: REMINDER_HEADERS.map((header) => ({
            range: `${quoteSheetName(title)}!${columnLetters(headers.indexOf(header) + 1)}${existing.rowNumber}`,
            values: [[cells[header]]],
          })),
        },
      });
      return reminder;
    } catch (error) {
      if (error.message === 'Reminder not found.') throw error;
      throw explainGoogleError(error, reminderContext(true));
    }
  }

  // Credentials live in their own spreadsheet when GOOGLE_CREDENTIALS_SHEET_ID is set, else in the client spreadsheet.
  const credentialSpreadsheetId = credentialSpreadsheetIdOption || spreadsheetId;
  const credentialContext = (write = false) => ({
    label: credentialSpreadsheetIdOption ? 'credentials' : 'client',
    envName: credentialSpreadsheetIdOption ? 'GOOGLE_CREDENTIALS_SHEET_ID' : 'GOOGLE_SHEET_ID',
    serviceAccountEmail,
    write,
  });

  async function findCredentialTab(sheets, create) {
    if (!looksLikeSpreadsheetId(credentialSpreadsheetId)) {
      throw new SheetSetupError(`GOOGLE_CREDENTIALS_SHEET_ID is set to "${credentialSpreadsheetId}", which looks like a name, not a spreadsheet ID. Use the long ID from the sheet's web address.`);
    }
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: credentialSpreadsheetId, fields: 'sheets.properties.title' });
    const titles = (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
    const title = titles.find((name) => name === credentialSheetName) || titles.find((name) => sameTitle(name, credentialSheetName)) || '';
    if (title || !create) return title;
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: credentialSpreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: credentialSheetName } } }] } });
    return credentialSheetName;
  }

  async function listCredentials() {
    const sheets = getSheetsClient();
    try {
      const title = await findCredentialTab(sheets, false);
      if (!title) return [];
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: credentialSpreadsheetId, range: `${quoteSheetName(title)}!A:G`, valueRenderOption: 'FORMATTED_VALUE' });
      const [headerRow = [], ...rows] = data.values || [];
      const headers = headerRow.map((header) => String(header ?? '').trim());
      return rows
        .map((row) => mapCredentialRow(Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']))))
        .filter((record) => record.id && record.website);
    } catch (error) {
      throw explainGoogleError(error, credentialContext());
    }
  }

  // Rewrites the tab top-down, then clears rows left over below, so a failed save never blanks the tab first.
  async function saveCredentials(records) {
    const sheets = getSheetsClient();
    try {
      const title = await findCredentialTab(sheets, true);
      const values = [CREDENTIAL_HEADERS, ...records.map(credentialRow)];
      const lastColumn = columnLetters(CREDENTIAL_HEADERS.length);
      await sheets.spreadsheets.values.update({ spreadsheetId: credentialSpreadsheetId, range: `${quoteSheetName(title)}!A1:${lastColumn}${values.length}`, valueInputOption: 'RAW', requestBody: { values } });
      await sheets.spreadsheets.values.clear({ spreadsheetId: credentialSpreadsheetId, range: `${quoteSheetName(title)}!A${values.length + 1}:${lastColumn}` });
    } catch (error) {
      throw explainGoogleError(error, credentialContext(true));
    }
  }

  async function listWorkPermits() {
    const values = await readOtherSheet({
      targetSpreadsheetId: workPermitSpreadsheetId,
      tab: workPermitSheetName,
      columns: 'A:Z',
      label: 'work permit',
      envName: 'GOOGLE_WORK_PERMIT_SHEET_ID',
      options: { valueRenderOption: 'FORMATTED_VALUE' },
    });
    const [headerRow = [], ...rows] = values;
    const headers = headerRow.map((header) => String(header ?? '').trim());
    return rows
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
      .map(mapWorkPermit)
      .filter((record) => record.id && record.name);
  }

  async function addWorkPermit(input) {
    const sheets = getSheetsClient();
    const context = { label: 'work permit', envName: 'GOOGLE_WORK_PERMIT_SHEET_ID', serviceAccountEmail, write: true };
    try {
      const title = await resolveTab(sheets, workPermitSpreadsheetId, workPermitSheetName, 'work permit');
      const quoted = quoteSheetName(title);
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: workPermitSpreadsheetId, range: `${quoted}!A:Z`, valueRenderOption: 'FORMATTED_VALUE' });
      const values = data.values || [];
      const headers = (values[0] || []).map((header) => String(header ?? '').trim());
      const missing = WORK_PERMIT_HEADERS.filter((header) => !headers.includes(header));
      if (missing.length) {
        const start = headers.length + 1;
        headers.push(...missing);
        await sheets.spreadsheets.values.update({
          spreadsheetId: workPermitSpreadsheetId,
          range: `${quoted}!${columnLetters(start)}1:${columnLetters(headers.length)}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missing] },
        });
      }
      const existing = values.slice(1).map((row) => mapWorkPermit(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))));
      const record = newWorkPermit(input, existing);
      const cells = workPermitCells(record);
      await sheets.spreadsheets.values.append({
        spreadsheetId: workPermitSpreadsheetId,
        range: `${quoted}!A:${columnLetters(headers.length)}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [headers.map((header) => cells[header] ?? '')] },
      });
      return record;
    } catch (error) {
      resolvedTitles.delete(`${workPermitSpreadsheetId}|${workPermitSheetName}`);
      throw explainGoogleError(error, context);
    }
  }

  async function updateWorkPermit(id, mutate) {
    const sheets = getSheetsClient();
    const context = { label: 'work permit', envName: 'GOOGLE_WORK_PERMIT_SHEET_ID', serviceAccountEmail, write: true };
    try {
      const title = await resolveTab(sheets, workPermitSpreadsheetId, workPermitSheetName, 'work permit');
      const quoted = quoteSheetName(title);
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: workPermitSpreadsheetId, range: `${quoted}!A:Z`, valueRenderOption: 'FORMATTED_VALUE' });
      const values = data.values || [];
      const headers = (values[0] || []).map((header) => String(header ?? '').trim());
      const missing = WORK_PERMIT_HEADERS.filter((header) => !headers.includes(header));
      if (missing.length) {
        const start = headers.length + 1;
        headers.push(...missing);
        await sheets.spreadsheets.values.update({
          spreadsheetId: workPermitSpreadsheetId,
          range: `${quoted}!${columnLetters(start)}1:${columnLetters(headers.length)}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missing] },
        });
      }
      const idColumn = headers.indexOf('ClientID');
      const rowIndex = values.findIndex((row, index) => index > 0 && String(row[idColumn] ?? '').trim() === id);
      if (rowIndex === -1) throw new WorkPermitError('Work permit not found.', 404);
      const current = mapWorkPermit(Object.fromEntries(headers.map((header, index) => [header, values[rowIndex][index] ?? ''])));
      const next = mutate(current);
      const cells = workPermitCells(next);
      const rowNumber = rowIndex + 1;
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: workPermitSpreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: WORK_PERMIT_HEADERS.map((header) => ({
            range: `${quoted}!${columnLetters(headers.indexOf(header) + 1)}${rowNumber}`,
            values: [[cells[header]]],
          })),
        },
      });
      return next;
    } catch (error) {
      resolvedTitles.delete(`${workPermitSpreadsheetId}|${workPermitSheetName}`);
      throw explainGoogleError(error, context);
    }
  }

  // Deletes the client's whole row from the work permit tab.
  async function removeWorkPermit(id) {
    const sheets = getSheetsClient();
    const context = { label: 'work permit', envName: 'GOOGLE_WORK_PERMIT_SHEET_ID', serviceAccountEmail, write: true };
    try {
      const title = await resolveTab(sheets, workPermitSpreadsheetId, workPermitSheetName, 'work permit');
      const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: workPermitSpreadsheetId, fields: 'sheets.properties(sheetId,title)' });
      const sheetId = (meta.sheets || []).find((sheet) => sheet.properties?.title === title)?.properties?.sheetId;
      if (sheetId === undefined) throw new SheetSetupError(`The work permit spreadsheet has no tab named "${title}".`);
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: workPermitSpreadsheetId, range: `${quoteSheetName(title)}!A:Z`, valueRenderOption: 'FORMATTED_VALUE' });
      const values = data.values || [];
      const headers = (values[0] || []).map((header) => String(header ?? '').trim());
      const idColumn = headers.indexOf('ClientID');
      const rowIndex = idColumn === -1 ? -1 : values.findIndex((row, index) => index > 0 && String(row[idColumn] ?? '').trim() === id);
      if (rowIndex === -1) throw new WorkPermitError('Work permit not found.', 404);
      const record = mapWorkPermit(Object.fromEntries(headers.map((header, index) => [header, values[rowIndex][index] ?? ''])));
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: workPermitSpreadsheetId,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] },
      });
      return record;
    } catch (error) {
      resolvedTitles.delete(`${workPermitSpreadsheetId}|${workPermitSheetName}`);
      throw explainGoogleError(error, context);
    }
  }

  return {
    list,
    listCourtDates,
    workPermits: {
      configured: async () => Boolean(workPermitSpreadsheetId),
      list: listWorkPermits,
      add: (input) => {
        const operation = queuedWrite.then(() => addWorkPermit(input));
        queuedWrite = operation.catch(() => {});
        return operation;
      },
      update: (id, mutate) => {
        const operation = queuedWrite.then(() => updateWorkPermit(id, mutate));
        queuedWrite = operation.catch(() => {});
        return operation;
      },
      remove: (id) => {
        const operation = queuedWrite.then(() => removeWorkPermit(id));
        queuedWrite = operation.catch(() => {});
        return operation;
      },
    },
    credentials: { list: listCredentials, save: saveCredentials },
    reminders: {
      load: async () => {
        const { reminders, notice } = await loadReminders();
        return { reminders: reminders.map(strip), notice };
      },
      add: (input) => {
        const operation = queuedWrite.then(() => addReminder(input));
        queuedWrite = operation.catch(() => {});
        return operation;
      },
      update: (id, input) => {
        const operation = queuedWrite.then(() => updateReminder(id, input));
        queuedWrite = operation.catch(() => {});
        return operation;
      },
    },
    add(input) {
      const operation = queuedWrite.then(() => appendClient(input));
      queuedWrite = operation.catch(() => {});
      return operation;
    },
    completeFollowUp(clientId) {
      const operation = queuedWrite.then(() => completeFollowUp(clientId));
      queuedWrite = operation.catch(() => {});
      return operation;
    },
    update(clientId, input) {
      const operation = queuedWrite.then(() => updateClient(clientId, input));
      queuedWrite = operation.catch(() => {});
      return operation;
    },
  };
}
