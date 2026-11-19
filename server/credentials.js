import ExcelJS from 'exceljs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';

// Shared staff password manager. Passwords are encrypted with AES-256-GCM before they
// reach the sheet or workbook, so the spreadsheet alone never reveals them.

export const CREDENTIAL_SHEET = 'Credentials';
export const CREDENTIAL_HEADERS = ['CredentialID', 'Website', 'URL', 'Username', 'PasswordEncrypted', 'Notes', 'UpdatedAt'];

export class CredentialError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const LIMITS = { website: 100, url: 300, username: 200, password: 500, notes: 1000 };
const DEV_KEY = 'local-development-only-credentials-key';

// Any long random string works; it is hashed to the 32-byte AES key.
export function createCipher(secret) {
  if (!secret) return null;
  const key = createHash('sha256').update(String(secret)).digest();
  return {
    encrypt(plainText) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
      return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
    },
    decrypt(stored) {
      const text = String(stored || '');
      if (!text) return '';
      if (!text.startsWith('v1:')) throw new CredentialError('This password was not saved by the app, so it cannot be read. Edit the entry and enter the password again.', 422);
      const raw = Buffer.from(text.slice(3), 'base64');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        throw new CredentialError('This password could not be decrypted. CREDENTIALS_KEY may have changed since it was saved.', 422);
      }
    },
  };
}

export function credentialKeyFor({ production, secret }) {
  if (secret) return secret;
  return production ? '' : DEV_KEY;
}

export function mapCredentialRow(row) {
  return {
    id: String(row.CredentialID ?? '').trim(),
    website: String(row.Website ?? '').trim(),
    url: String(row.URL ?? '').trim(),
    username: String(row.Username ?? '').trim(),
    passwordEncrypted: String(row.PasswordEncrypted ?? '').trim(),
    notes: String(row.Notes ?? '').trim(),
    updatedAt: String(row.UpdatedAt ?? '').trim(),
  };
}

export function credentialRow(record) {
  return [record.id, record.website, record.url, record.username, record.passwordEncrypted, record.notes, record.updatedAt];
}

// What the browser sees in the list: never the password, encrypted or not.
export function publicCredential({ passwordEncrypted, ...record }) {
  return { ...record, hasPassword: Boolean(passwordEncrypted) };
}

function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let parsed;
  try { parsed = new URL(withScheme); } catch { throw new CredentialError('Enter a valid website address, such as uscis.gov.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new CredentialError('Website address must start with http:// or https://.');
  return parsed.href;
}

export function credentialInput(body, { requirePassword }) {
  const input = body || {};
  const value = {
    website: String(input.website ?? '').trim(),
    username: String(input.username ?? '').trim(),
    password: String(input.password ?? ''),
    notes: String(input.notes ?? '').trim(),
  };
  if (!value.website) throw new CredentialError('Enter the website name.');
  for (const [field, limit] of Object.entries(LIMITS)) {
    const length = field === 'url' ? String(input.url ?? '').trim().length : value[field].length;
    if (length > limit) throw new CredentialError(`${field[0].toUpperCase()}${field.slice(1)} must be ${limit} characters or fewer.`);
  }
  if (requirePassword && !value.password) throw new CredentialError('Enter the password.');
  value.url = normalizeUrl(input.url);
  return value;
}

export function nextCredentialId(records) {
  const highest = records.reduce((max, record) => Math.max(max, Number(record.id.match(/\d+/)?.[0] || 0)), 0);
  return `CR-${String(highest + 1).padStart(3, '0')}`;
}

// Business rules on top of any store that can list and save the full table.
export function createCredentialService(store, secret) {
  const cipher = createCipher(secret);
  let queue = Promise.resolve();
  const queued = (task) => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };
  const requireCipher = () => {
    if (!cipher) throw new CredentialError('The password manager is not set up. Add a CREDENTIALS_KEY environment variable and redeploy.', 503);
    return cipher;
  };
  const find = (records, id) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new CredentialError('Credential not found.', 404);
    return index;
  };
  const stamp = () => new Date().toISOString();

  return {
    async list() {
      requireCipher();
      return (await store.list()).map(publicCredential);
    },
    add: (input) => queued(async () => {
      const activeCipher = requireCipher();
      const records = await store.list();
      const record = { id: nextCredentialId(records), website: input.website, url: input.url, username: input.username, passwordEncrypted: activeCipher.encrypt(input.password), notes: input.notes, updatedAt: stamp() };
      await store.save([...records, record]);
      return publicCredential(record);
    }),
    update: (id, input) => queued(async () => {
      const activeCipher = requireCipher();
      const records = await store.list();
      const index = find(records, id);
      const existing = records[index];
      // A blank password on edit keeps the saved one.
      const passwordEncrypted = input.password ? activeCipher.encrypt(input.password) : existing.passwordEncrypted;
      records[index] = { ...existing, website: input.website, url: input.url, username: input.username, notes: input.notes, passwordEncrypted, updatedAt: stamp() };
      await store.save(records);
      return publicCredential(records[index]);
    }),
    remove: (id) => queued(async () => {
      requireCipher();
      const records = await store.list();
      const [removed] = records.splice(find(records, id), 1);
      await store.save(records);
      return publicCredential(removed);
    }),
    async reveal(id) {
      const activeCipher = requireCipher();
      const records = await store.list();
      return activeCipher.decrypt(records[find(records, id)].passwordEncrypted);
    },
  };
}

const exists = (filePath) => stat(filePath).then(() => true, () => false);

function cellText(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('');
  return String(cell.text ?? value);
}

export function createCredentialWorkbookStore(filePath) {
  async function list() {
    if (!(await exists(filePath))) return [];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet(CREDENTIAL_SHEET);
    if (!sheet) return [];
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => { headers[column] = cellText(cell).trim(); });
    const records = [];
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = {};
      headers.forEach((header, column) => { if (header) values[header] = cellText(row.getCell(column)); });
      const record = mapCredentialRow(values);
      if (record.id && record.website) records.push(record);
    }
    return records;
  }

  async function save(records) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(CREDENTIAL_SHEET);
    sheet.addRow(CREDENTIAL_HEADERS);
    records.forEach((record) => sheet.addRow(credentialRow(record)));
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [{ width: 12 }, { width: 28 }, { width: 36 }, { width: 28 }, { width: 50 }, { width: 40 }, { width: 24 }];
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    try {
      await workbook.xlsx.writeFile(filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw new CredentialError('The credentials workbook is locked by Excel. Close it and try again.', 423);
      throw error;
    }
  }

  return { list, save };
}
