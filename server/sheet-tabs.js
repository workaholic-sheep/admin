import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import { stat } from 'node:fs/promises';
import { SheetSetupError, explainGoogleError, looksLikeSpreadsheetId } from './google-sheets.js';

// Small tab-level API over one spreadsheet (Google Sheets, or a local Excel file in development).
// A tab is { title, sheetId, headers: string[], rows: string[][] }; rows exclude the header,
// so rows[i] lives on sheet row i + 2. Every value is written as plain text, never as a formula.

const SHEET_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const sameTitle = (left, right) => String(left).toLowerCase().replace(/[^a-z0-9]/g, '') === String(right).toLowerCase().replace(/[^a-z0-9]/g, '');
const quote = (title) => `'${title.replaceAll("'", "''")}'`;
const pad = (row, length) => Array.from({ length }, (_, index) => String(row?.[index] ?? ''));

export function columnLetters(index) {
  let letters = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  return letters;
}

function findTitle(titles, wanted) {
  return titles.find((title) => title === wanted) || titles.find((title) => sameTitle(title, wanted)) || '';
}

export function createGoogleTabs({ spreadsheetId, serviceAccountEmail, privateKey, envName, label }, api = google) {
  if (!looksLikeSpreadsheetId(spreadsheetId)) {
    throw new SheetSetupError(`${envName} must be the spreadsheet ID from the ${label} address (the part between /d/ and /edit).`);
  }
  const client = () => api.sheets({
    version: 'v4',
    auth: new api.auth.JWT({ email: serviceAccountEmail, key: String(privateKey || '').replace(/\\n/g, '\n'), scopes: [SHEET_SCOPE] }),
  });
  const run = async (write, task) => {
    try {
      return await task(client());
    } catch (error) {
      throw explainGoogleError(error, { label, envName, serviceAccountEmail, write });
    }
  };

  return {
    read: (wantedTitles) => run(false, async (sheets) => {
      const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
      const known = (data.sheets || []).map((sheet) => sheet.properties).filter(Boolean);
      const found = wantedTitles.map((wanted) => known.find((props) => props.title === findTitle(known.map((item) => item.title), wanted)) || null);
      const present = found.filter(Boolean);
      const ranges = present.length
        ? (await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: present.map((props) => `${quote(props.title)}!A:Z`), valueRenderOption: 'FORMATTED_VALUE' })).data.valueRanges || []
        : [];
      const result = new Map();
      wantedTitles.forEach((wanted, index) => {
        const props = found[index];
        if (!props) return result.set(wanted, null);
        const [headerRow = [], ...rows] = ranges[present.indexOf(props)]?.values || [];
        const headers = headerRow.map((header) => String(header ?? '').trim());
        return result.set(wanted, { title: props.title, sheetId: props.sheetId, headers, rows: rows.map((row) => pad(row, Math.max(headers.length, row.length))) });
      });
      return result;
    }),
    create: (title, headers) => run(true, async (sheets) => {
      const { data } = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
      const sheetId = data.replies?.[0]?.addSheet?.properties?.sheetId;
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `${quote(title)}!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] } });
      return { title, sheetId, headers: [...headers], rows: [] };
    }),
    setHeaders: (tab, headers) => run(true, (sheets) => sheets.spreadsheets.values.update({ spreadsheetId, range: `${quote(tab.title)}!A1:${columnLetters(headers.length)}1`, valueInputOption: 'RAW', requestBody: { values: [headers] } })),
    append: (tab, rows) => run(true, async (sheets) => {
      // Written to explicit rows below the last one read, so a stray blank row can't misplace them.
      const start = tab.rows.length + 2;
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `${quote(tab.title)}!A${start}:${columnLetters(tab.headers.length)}${start + rows.length - 1}`, valueInputOption: 'RAW', requestBody: { values: rows } });
    }),
    update: (tab, cells) => run(true, (sheets) => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: cells.map(({ rowNumber, column, value }) => ({ range: `${quote(tab.title)}!${columnLetters(column + 1)}${rowNumber}`, values: [[value]] })) },
    })),
    deleteRows: (tab, rowNumbers) => run(true, (sheets) => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      // Bottom-up, so earlier deletions don't shift the rows still to be deleted.
      requestBody: { requests: [...rowNumbers].sort((a, b) => b - a).map((rowNumber) => ({ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } })) },
    })),
  };
}

const exists = (filePath) => stat(filePath).then(() => true, () => false);

function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  return String(cell.text ?? value);
}

export function createWorkbookTabs(filePath, label = 'Clients_Additional_Info workbook') {
  async function open() {
    const workbook = new ExcelJS.Workbook();
    if (await exists(filePath)) await workbook.xlsx.readFile(filePath);
    return workbook;
  }
  const sheetFor = (workbook, title) => workbook.worksheets.find((sheet) => sheet.name === findTitle(workbook.worksheets.map((item) => item.name), title));
  async function change(task) {
    const workbook = await open();
    const result = task(workbook);
    try {
      await workbook.xlsx.writeFile(filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw new SheetSetupError(`The ${label} is open in Excel. Close it and try again.`);
      throw error;
    }
    return result;
  }
  const writeRow = (sheet, rowNumber, values) => values.forEach((value, index) => { sheet.getCell(rowNumber, index + 1).value = String(value ?? ''); });

  return {
    async read(wantedTitles) {
      const workbook = await open();
      const result = new Map();
      for (const wanted of wantedTitles) {
        const sheet = sheetFor(workbook, wanted);
        if (!sheet) { result.set(wanted, null); continue; }
        const width = Math.max(sheet.columnCount, 1);
        const lastRow = sheet.lastRow?.number || 0;
        const readRow = (number) => Array.from({ length: width }, (_, index) => cellText(sheet.getCell(number, index + 1)).trim());
        const headers = lastRow ? readRow(1).map((header) => header.trim()) : [];
        while (headers.length && !headers.at(-1)) headers.pop();
        const rows = [];
        for (let number = 2; number <= lastRow; number += 1) rows.push(readRow(number));
        result.set(wanted, { title: sheet.name, sheetId: sheet.id, headers, rows });
      }
      return result;
    },
    create: (title, headers) => change((workbook) => {
      writeRow(workbook.addWorksheet(title), 1, headers);
      return { title, sheetId: null, headers: [...headers], rows: [] };
    }),
    setHeaders: (tab, headers) => change((workbook) => writeRow(sheetFor(workbook, tab.title), 1, headers)),
    append: (tab, rows) => change((workbook) => {
      const sheet = sheetFor(workbook, tab.title);
      rows.forEach((row, index) => writeRow(sheet, tab.rows.length + 2 + index, row));
    }),
    update: (tab, cells) => change((workbook) => {
      const sheet = sheetFor(workbook, tab.title);
      cells.forEach(({ rowNumber, column, value }) => { sheet.getCell(rowNumber, column + 1).value = String(value ?? ''); });
    }),
    deleteRows: (tab, rowNumbers) => change((workbook) => {
      const sheet = sheetFor(workbook, tab.title);
      [...rowNumbers].sort((a, b) => b - a).forEach((rowNumber) => sheet.spliceRows(rowNumber, 1));
    }),
  };
}
