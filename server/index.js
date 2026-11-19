import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SheetSetupError, createGoogleSheetStore, spreadsheetIdFrom } from './google-sheets.js';
import { createSessionAuth } from './session-auth.js';
import { createReminderWorkbookStore } from './payment-reminders.js';
import { CredentialError, createCredentialService, createCredentialWorkbookStore, credentialInput, credentialKeyFor } from './credentials.js';
import { createWorkbookStore } from './workbook.js';
import { CaseNotFoundError, CaseSetupError, createCaseAssignments } from './case-assignments.js';
import { TEAM_MEMBERS } from '../src/team.js';
import { nameParts } from '../src/names.js';
import { CASE_STATUSES } from '../src/case-status.js';
import { createGoogleTabs, createWorkbookTabs } from './sheet-tabs.js';
import { CASE_TYPES, isCaseTypeSelected } from '../src/case-types.js';
import {
  DECISIONS, WorkPermitError, createWorkPermitWorkbookStore, formatANumber, workPermitStatus, isTrackingToken, newTrackingToken, pauseClock, resumeClock,
} from './work-permits.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workbookPath = resolve(process.env.WORKBOOK_PATH || resolve(root, "Prototype of Client's Tracker .xlsx"));
const courtWorkbookPath = resolve(process.env.COURT_WORKBOOK_PATH || resolve(root, 'Prototype of Reports.xlsx'));
const workPermitWorkbookPath = resolve(process.env.WORK_PERMIT_WORKBOOK_PATH || resolve(root, 'BBeckford_WorkPermit_Database.xlsx'));
const reminderWorkbookPath = resolve(process.env.PAYMENT_REMINDER_WORKBOOK_PATH || resolve(root, 'BBeckford_PaymentReminders.xlsx'));
const caseWorkbookPath = resolve(process.env.CASES_WORKBOOK_PATH || resolve(root, 'BBeckford_Clients_Additional_Info.xlsx'));
const credentialWorkbookPath =resolve(process.env.CREDENTIALS_WORKBOOK_PATH || resolve(root, 'BBeckford_Credentials.xlsx'));
const port = Number(process.env.PORT || 3001);
const production = process.env.NODE_ENV === 'production';
const useGoogleSheets = process.env.DATA_SOURCE === 'google-sheets' || Boolean(process.env.GOOGLE_SHEET_ID);
if (production && !useGoogleSheets) {
  throw new Error('Production requires DATA_SOURCE=google-sheets. Refusing to serve the bundled Excel workbook.');
}
if (production && (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY)) {
  throw new Error('Production requires GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY.');
}
if (production && !process.env.GOOGLE_COURT_SHEET_ID) {
  throw new Error('Production requires GOOGLE_COURT_SHEET_ID for the separate court-date spreadsheet.');
}
const sourceName = useGoogleSheets ? 'Google Sheets' : 'Excel';
const store = useGoogleSheets
  ? createGoogleSheetStore({
    spreadsheetId: spreadsheetIdFrom(process.env.GOOGLE_SHEET_ID),
    sheetName: process.env.GOOGLE_SHEET_NAME || 'MasterData',
    courtSpreadsheetId: spreadsheetIdFrom(process.env.GOOGLE_COURT_SHEET_ID),
    courtSheetName: process.env.GOOGLE_COURT_SHEET_NAME || 'COURT DATE LIST',
    workPermitSpreadsheetId: spreadsheetIdFrom(process.env.GOOGLE_WORK_PERMIT_SHEET_ID),
    workPermitSheetName: process.env.GOOGLE_WORK_PERMIT_SHEET_NAME || 'WorkPermits',
    reminderSheetName: process.env.GOOGLE_PAYMENT_REMINDER_SHEET_NAME || 'PaymentReminders',
    reminderSpreadsheetId: spreadsheetIdFrom(process.env.GOOGLE_PAYMENT_REMINDER_SHEET_ID),
    credentialSheetName: process.env.GOOGLE_CREDENTIALS_SHEET_NAME || 'Credentials',
    credentialSpreadsheetId: spreadsheetIdFrom(process.env.GOOGLE_CREDENTIALS_SHEET_ID),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
  })
  : createWorkbookStore(workbookPath, courtWorkbookPath);
const workPermitStore = useGoogleSheets ? store.workPermits : createWorkPermitWorkbookStore(workPermitWorkbookPath);
const reminderStore = useGoogleSheets ? store.reminders : createReminderWorkbookStore(reminderWorkbookPath);
// Case types and Client_Info live in the separate Clients_Additional_Info spreadsheet.
// If it isn't configured, client lists still load; only case-type features report the setup step.
const casesSheetId = spreadsheetIdFrom(process.env.GOOGLE_CASES_SHEET_ID);
let caseSetupMessage = `Case types are saved in the Clients_Additional_Info spreadsheet, which isn't connected yet. Set GOOGLE_CASES_SHEET_ID to its ID and share it with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the service account'} as Editor.`;
let caseTabs = null;
try {
  if (!useGoogleSheets) caseTabs = createWorkbookTabs(caseWorkbookPath);
  else if (casesSheetId) caseTabs = createGoogleTabs({ spreadsheetId: casesSheetId, serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: process.env.GOOGLE_PRIVATE_KEY, envName: 'GOOGLE_CASES_SHEET_ID', label: 'Clients_Additional_Info' });
} catch (error) {
  caseSetupMessage = error.message;
}
const cases = createCaseAssignments(caseTabs, caseSetupMessage);
const SYNC_EVERY_MS = 60 * 1000;
let lastSync = 0;
// Without CREDENTIALS_KEY in production the rest of the app still runs; only the password manager reports that it needs setup.
const credentials = createCredentialService(
  useGoogleSheets ? store.credentials : createCredentialWorkbookStore(credentialWorkbookPath),
  credentialKeyFor({ production, secret: process.env.CREDENTIALS_KEY }),
);
const sessionAuth = createSessionAuth({
  enabled: production,
  password: process.env.APP_PASSWORD,
  secret: process.env.SESSION_SECRET,
});
const app = express();
if (production) app.set('trust proxy', 1);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', source: sourceName });
});

app.get('/api/session', (request, response) => {
  response.json({ authenticated: sessionAuth.isAuthenticated(request), loginRequired: sessionAuth.enabled });
});

app.post('/api/login', loginLimiter, (request, response) => {
  if (!sessionAuth.enabled) return response.json({ authenticated: true });
  if (!sessionAuth.passwordMatches(request.body?.password)) {
    return response.status(401).json({ error: 'Incorrect workspace password.' });
  }
  response.setHeader('Set-Cookie', sessionAuth.setCookie());
  return response.json({ authenticated: true });
});

app.post('/api/logout', (_request, response) => {
  response.setHeader('Set-Cookie', sessionAuth.clearCookie());
  response.json({ authenticated: false });
});

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in a minute.' },
});

// Public client view, reached through the private link. Never returns staff notes or section.
app.get('/api/track/:token', trackLimiter, async (request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const { token } = request.params;
  const notFound = () => response.status(404).json({ error: 'This tracking link is not valid. Please contact our office.' });
  if (!isTrackingToken(token)) return notFound();
  try {
    if (!(await workPermitStore.configured())) return notFound();
    const record = (await workPermitStore.list()).find((item) => item.trackingToken === token);
    if (!record) return notFound();
    response.json({ name: record.name, status: workPermitStatus(record) });
  } catch (error) {
    console.error(error);
    response.status(503).json({ error: 'Your tracker is temporarily unavailable. Please try again later.' });
  }
});

app.use('/api', (request, response, next) => {
  if (sessionAuth.isAuthenticated(request)) return next();
  return response.status(401).json({ error: 'Sign in to access client records.' });
});

app.post('/api/clients/:clientId/follow-up/done', async (request, response, next) => {
  try {
    const client = await store.completeFollowUp(request.params.clientId);
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.json({ client: withCaseTypes(client, (await caseAssignments()).assignments), modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message === 'Client not found.') return response.status(404).json({ error: error.message });
    if (error.message.includes('scheduled follow-up') || error.message.includes('already marked done')) {
      return response.status(409).json({ error: error.message });
    }
    next(error);
  }
});

// A client's case types come from the case tabs, shown as "VAWA + I-485" like the old CaseType value;
// caseTeam says who handles each one ({ VAWA: 'Kyle' }) and caseStatus how far along it is ({ VAWA: 'Ongoing' }).
function withCaseTypes(client, assignments) {
  const types = assignments ? CASE_TYPES.filter((type) => assignments[type]?.has(client.id)) : [];
  const detail = (type) => assignments[type].get(client.id) || {};
  return {
    ...client,
    caseType: types.join(' + '),
    caseTeam: Object.fromEntries(types.map((type) => [type, detail(type).teamMember || ''])),
    caseStatus: Object.fromEntries(types.map((type) => [type, detail(type).status || 'Not Started'])),
  };
}

// After an intake or edit: case-type checkboxes go to the case tabs (not MasterData), and the
// next client-list load copies the change into Client_Info. The client itself is already saved,
// so a case-tab failure is returned as a message rather than failing the request.
async function saveCaseTypes(client, caseTypeValue) {
  lastSync = 0;
  if (!cases.configured && !CASE_TYPES.some((type) => isCaseTypeSelected(caseTypeValue, type))) return { client: withCaseTypes(client, null), caseError: '' };
  try {
    const assignments = await cases.setForClient(client, String(caseTypeValue || ''));
    return { client: withCaseTypes(client, assignments), caseError: '' };
  } catch (error) {
    console.error(error);
    const { assignments } = await caseAssignments();
    return { client: withCaseTypes(client, assignments), caseError: `Saved, but case types could not be updated: ${error.message}` };
  }
}

async function caseAssignments(fresh = false) {
  try {
    return { assignments: fresh ? await cases.load() : await cases.current(), caseError: '' };
  } catch (error) {
    console.error(error);
    return { assignments: null, caseError: error.message };
  }
}

// Copies MasterData into Client_Info at most once a minute per server instance (and right after
// edits made in the app). Failures are reported but never block the client list.
async function syncClientInfo(clients, force = false) {
  if (!cases.configured || (!force && Date.now() - lastSync < SYNC_EVERY_MS)) return '';
  lastSync = Date.now();
  try {
    await cases.sync(clients.map((client) => ({ ...client, legacyCaseType: client.caseType })));
    return '';
  } catch (error) {
    console.error(error);
    lastSync = 0;
    return `Client_Info could not be updated: ${error.message}`;
  }
}

app.get('/api/clients', async (_request, response, next) => {
  try {
    const clients = await store.list();
    const syncError = await syncClientInfo(clients);
    const { assignments, caseError } = await caseAssignments(true);
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.json({ clients: clients.map((client) => withCaseTypes(client, assignments)), caseError: caseError || syncError, modifiedAt, source: sourceName });
  } catch (error) {
    next(error);
  }
});

// Per-case details on a case tab: who handles it (blank clears) and its status.
const CASE_DETAILS = {
  team: { field: 'Team Member', key: 'teamMember', allowed: (value) => !value || TEAM_MEMBERS.includes(value), error: 'Choose someone from the team list.' },
  status: { field: 'Status', key: 'status', allowed: (value) => CASE_STATUSES.includes(value), error: 'Choose Not Started, Ongoing or Completed.' },
};

app.put(['/api/case-assignments/team', '/api/case-assignments/status'], async (request, response, next) => {
  const detail = CASE_DETAILS[request.path.endsWith('/status') ? 'status' : 'team'];
  const caseType = String(request.body?.caseType || '');
  const clientId = String(request.body?.clientId || '');
  const value = String(request.body?.[detail.key] || '').trim();
  if (!CASE_TYPES.includes(caseType)) return response.status(400).json({ error: 'Choose a valid case type.' });
  if (!clientId) return response.status(400).json({ error: 'Choose a client.' });
  if (!detail.allowed(value)) return response.status(400).json({ error: detail.error });
  try {
    const assignments = await cases.setCaseDetail(caseType, clientId, detail.field, value);
    const client = withCaseTypes({ id: clientId }, assignments);
    response.json({ caseType, clientId, caseTeam: client.caseTeam, caseStatus: client.caseStatus });
  } catch (error) {
    if (error instanceof CaseNotFoundError) return response.status(404).json({ error: error.message });
    if (error instanceof CaseSetupError) return response.status(503).json({ error: error.message });
    next(error);
  }
});

// Case notes: an add-only log in the Case_Notes tab. The server stamps each note in Central Time.
app.get('/api/case-notes', async (request, response, next) => {
  const clientId = String(request.query.clientId || '');
  const caseType = String(request.query.caseType || '');
  if (!clientId && !CASE_TYPES.includes(caseType)) return response.status(400).json({ error: 'Choose a client or a case type.' });
  try {
    response.json({ notes: await cases.listNotes({ clientId, caseType }) });
  } catch (error) {
    if (error instanceof CaseSetupError) return response.status(503).json({ error: error.message });
    next(error);
  }
});

app.post('/api/case-notes', async (request, response, next) => {
  const clientId = String(request.body?.clientId || '');
  const caseType = String(request.body?.caseType || '');
  const teamMember = String(request.body?.teamMember || '').trim();
  const text = String(request.body?.text || '').trim();
  if (!CASE_TYPES.includes(caseType)) return response.status(400).json({ error: 'Choose a valid case type.' });
  if (!TEAM_MEMBERS.includes(teamMember)) return response.status(400).json({ error: 'Choose who is writing this note.' });
  if (!text) return response.status(400).json({ error: 'Write a note first.' });
  if (text.length > 2000) return response.status(400).json({ error: 'Notes must be 2,000 characters or fewer.' });
  try {
    const client = (await store.list()).find((item) => item.id === clientId);
    if (!client) return response.status(404).json({ error: 'Client not found.' });
    const { assignments } = await caseAssignments();
    if (assignments && !assignments[caseType]?.has(clientId)) return response.status(404).json({ error: `This client is not in ${caseType}.` });
    response.status(201).json({ note: await cases.addNote({ client, caseType, teamMember, text }) });
  } catch (error) {
    if (error instanceof CaseSetupError) return response.status(503).json({ error: error.message });
    next(error);
  }
});

// Drag and drop: add or remove many clients from one case type, touching only that case tab.
app.post('/api/case-assignments', async (request, response, next) => {
  const caseType = String(request.body?.caseType || '');
  const add = request.body?.add !== false;
  const ids = Array.isArray(request.body?.clientIds) ? [...new Set(request.body.clientIds.map(String))].slice(0, 500) : [];
  if (!CASE_TYPES.includes(caseType)) return response.status(400).json({ error: 'Choose a valid case type.' });
  if (!ids.length) return response.status(400).json({ error: 'Choose at least one client.' });
  try {
    const clients = (await store.list()).filter((client) => ids.includes(client.id));
    if (!clients.length) return response.status(404).json({ error: 'Those clients were not found in MasterData.' });
    const changed = await cases.assign(caseType, clients, add);
    const { assignments } = await caseAssignments();
    response.json({ changed, clients: clients.map((client) => withCaseTypes(client, assignments)) });
  } catch (error) {
    if (error instanceof CaseSetupError) return response.status(503).json({ error: error.message });
    next(error);
  }
});

app.get('/api/court-dates', async (_request, response, next) => {
  try {
    const courtDates = await store.listCourtDates();
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(courtWorkbookPath)).mtime.toISOString();
    response.json({ courtDates, modifiedAt, source: sourceName });
  } catch (error) {
    next(error);
  }
});

// Staff view: everything except the private tracking token, plus the computed 150-day progress.
function staffWorkPermit(record) {
  const { trackingToken, ...rest } = record;
  return { ...rest, hasLink: Boolean(trackingToken), status: workPermitStatus(record) };
}

// Validates the fields staff can set on a work permit; shared by add and edit.
function workPermitInput(body = {}) {
  const name = String(body.name || '').trim();
  const note = String(body.note || '').trim();
  const section = String(body.section || 'Regular').trim();
  const pausedDays = Number(body.pausedDays || 0);
  const rawANumber = String(body.aNumber || '').trim();
  const aNumber = formatANumber(rawANumber);
  const decision = DECISIONS.includes(body.decision) ? body.decision : 'Pending';
  const dates = {};
  for (const [field, label] of [['filingDate', "Init Asylum Rec'd Date"], ['approvedDate', 'approval date'], ['expiryDate', 'expiry date']]) {
    const value = String(body[field] || '').trim();
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return { error: `Enter a valid ${label}.` };
    dates[field] = value;
  }
  if (!name) return { error: 'Client name is required.' };
  if (name.length > 200) return { error: 'Client name must be 200 characters or fewer.' };
  if (note.length > 2000) return { error: 'Note must be 2,000 characters or fewer.' };
  if (!['Regular', 'Pending'].includes(section)) return { error: 'Section must be Regular or Pending.' };
  if (!Number.isInteger(pausedDays) || pausedDays < 0 || pausedDays > 3650) return { error: 'Days paused must be a whole number of 0 or more.' };
  if (rawANumber && !aNumber) return { error: 'A-Number should be 8 or 9 digits, like 245-943-700.' };
  if (decision === 'Approved' && !dates.expiryDate) return { error: 'Add the card expiry date for an approved work permit.' };
  if (dates.approvedDate && dates.expiryDate && dates.expiryDate <= dates.approvedDate) return { error: 'The expiry date must be after the approval date.' };
  return { value: { name, note, section, ...dates, pausedDays, aNumber, decision } };
}

async function requireWorkPermits(response) {
  if (await workPermitStore.configured()) return true;
  response.status(409).json({ error: 'Work permit data is not connected.' });
  return false;
}

app.get('/api/work-permits', async (_request, response, next) => {
  try {
    if (!(await workPermitStore.configured())) return response.json({ workPermits: [], configured: false, source: sourceName });
    const workPermits = (await workPermitStore.list()).map(staffWorkPermit);
    response.json({ workPermits, configured: true, source: sourceName });
  } catch (error) {
    next(error);
  }
});

app.put('/api/work-permits/:id', async (request, response, next) => {
  const input = workPermitInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  const { value } = input;
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.update(request.params.id, (current) => ({
      ...current,
      ...value,
      // The clock can't stay paused without a start date or once a decision is made.
      ...(value.filingDate && value.decision === 'Pending' ? {} : { clockStatus: 'Running', pausedSince: '' }),
    }));
    response.json({ workPermit: staffWorkPermit(record) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work-permits', async (request, response, next) => {
  const input = workPermitInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.add(input.value);
    response.status(201).json({ workPermit: staffWorkPermit(record) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/work-permits/:id', async (request, response, next) => {
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.remove(request.params.id);
    response.json({ removed: { id: record.id, name: record.name } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work-permits/:id/pause', async (request, response, next) => {
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.update(request.params.id, (current) => pauseClock(current));
    response.json({ workPermit: staffWorkPermit(record) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work-permits/:id/resume', async (request, response, next) => {
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.update(request.params.id, (current) => resumeClock(current));
    response.json({ workPermit: staffWorkPermit(record) });
  } catch (error) {
    next(error);
  }
});

// Returns the client's private tracking token, creating one the first time.
app.post('/api/work-permits/:id/link', async (request, response, next) => {
  try {
    if (!(await requireWorkPermits(response))) return;
    const record = await workPermitStore.update(request.params.id, (current) => (
      isTrackingToken(current.trackingToken) ? current : { ...current, trackingToken: newTrackingToken() }
    ));
    response.json({ token: record.trackingToken, workPermit: staffWorkPermit(record) });
  } catch (error) {
    next(error);
  }
});

function reminderInput(body = {}) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const responded = body.responded === 'Yes' ? 'Yes' : 'No';
  const response = responded === 'Yes' ? String(body.response || '').trim() : '';
  const respondedAt = responded === 'Yes' ? String(body.respondedAt || '').trim().replace('T', ' ') : '';
  if (!name) return { error: 'Name is required.' };
  if (name.length > 200) return { error: 'Name must be 200 characters or fewer.' };
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'Enter a valid email address.' };
  if (response.length > 2000) return { error: 'Response must be 2,000 characters or fewer.' };
  if (respondedAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(respondedAt)) return { error: 'Enter a valid response date and time.' };
  return { value: { name, email, responded, response, respondedAt } };
}

function reminderError(error, response, next) {
  if (error.message === 'Reminder not found.') return response.status(404).json({ error: error.message });
  if (error.message.includes('locked by Excel')) return response.status(423).json({ error: error.message });
  return next(error);
}

app.get('/api/payment-reminders', async (_request, response, next) => {
  try {
    const { reminders, notice } = await reminderStore.load();
    response.json({ reminders, notice, source: sourceName });
  } catch (error) {
    next(error);
  }
});

app.post('/api/payment-reminders', async (request, response, next) => {
  const input = reminderInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    response.status(201).json({ reminder: await reminderStore.add(input.value) });
  } catch (error) {
    reminderError(error, response, next);
  }
});

app.put('/api/payment-reminders/:reminderId', async (request, response, next) => {
  const input = reminderInput(request.body);
  if (input.error) return response.status(400).json({ error: input.error });
  try {
    response.json({ reminder: await reminderStore.update(request.params.reminderId, input.value) });
  } catch (error) {
    reminderError(error, response, next);
  }
});

// Password manager. Responses are never cached, and the list never includes passwords;
// a password is decrypted only when staff ask to show or copy it.
app.use('/api/credentials', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});

const credentialRoute = (handler) => async (request, response, next) => {
  try {
    await handler(request, response);
  } catch (error) {
    if (error instanceof CredentialError) return response.status(error.status).json({ error: error.message });
    return next(error);
  }
};

app.get('/api/credentials', credentialRoute(async (_request, response) => {
  response.json({ credentials: await credentials.list(), source: sourceName });
}));

app.post('/api/credentials', credentialRoute(async (request, response) => {
  response.status(201).json({ credential: await credentials.add(credentialInput(request.body, { requirePassword: true })) });
}));

app.put('/api/credentials/:id', credentialRoute(async (request, response) => {
  response.json({ credential: await credentials.update(request.params.id, credentialInput(request.body, { requirePassword: false })) });
}));

app.delete('/api/credentials/:id', credentialRoute(async (request, response) => {
  response.json({ credential: await credentials.remove(request.params.id) });
}));

app.post('/api/credentials/:id/reveal', credentialRoute(async (request, response) => {
  response.json({ password: await credentials.reveal(request.params.id) });
}));

// Date of birth, gender, and address are optional; reject malformed values before they reach the sheet.
function personalDetailsError(input) {
  const dateOfBirth = String(input.dateOfBirth || '').trim();
  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return 'Enter the date of birth in the expected calendar format.';
  if (dateOfBirth && dateOfBirth > new Date().toISOString().slice(0, 10)) return 'Date of birth cannot be in the future.';
  if (String(input.gender || '').trim().length > 30) return 'Gender must be 30 characters or fewer.';
  if (String(input.address || '').trim().length > 300) return 'Address must be 300 characters or fewer.';
  return '';
}

app.post('/api/clients', async (request, response, next) => {
  try {
    const input = request.body || {};
    const names = nameParts(input);
    const { name } = names;
    const email = String(input.email || '').trim();
    if (!names.firstName && !names.lastName) return response.status(400).json({ error: 'Enter a first or last name for the client.' });
    if (name.length > 160) return response.status(400).json({ error: 'The client name must be 160 characters or fewer.' });
    if (String(input.currentAddress || '').trim().length > 300) return response.status(400).json({ error: 'Current address must be 300 characters or fewer.' });
    const personalError = personalDetailsError(input);
    if (personalError) return response.status(400).json({ error: personalError });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: 'Enter a valid email address.' });
    }

    const client = await store.add({
      name,
      email,
      phone: String(input.phone || '').trim(),
      caseType: String(input.caseType || '').trim(),
      frequency: String(input.frequency || '').trim(),
      translator: String(input.translator || 'No').trim(),
      onboardingDate: String(input.onboardingDate || '').trim(),
      interviewDate: String(input.interviewDate || '').trim(),
      lastContactDate: String(input.lastContactDate || '').trim(),
      outcome: String(input.outcome || '').trim(),
      nextContactDate: String(input.nextContactDate || '').trim(),
      lastAttorneyDate: String(input.lastAttorneyDate || '').trim(),
      paymentStatus: String(input.paymentStatus || 'Pending').trim(),
      notes: String(input.notes || '').trim(),
      dateOfBirth: String(input.dateOfBirth || '').trim(),
      gender: String(input.gender || '').trim(),
      address: String(input.address || '').trim(),
      currentAddress: String(input.currentAddress || '').trim(),
      firstName: names.firstName,
      middleName: names.middleName,
      lastName: names.lastName,
    });
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    const { client: saved, caseError } = await saveCaseTypes({ ...client, ...names, currentAddress: String(input.currentAddress || '').trim() }, input.caseType);
    response.status(201).json({ client: saved, caseError, modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message.includes('already exists')) return response.status(409).json({ error: error.message });
    if (error.message.includes('locked by Excel')) return response.status(423).json({ error: error.message });
    next(error);
  }
});

app.put('/api/clients/:clientId', async (request, response, next) => {
  try {
    const input = request.body || {};
    const names = nameParts(input);
    const { name } = names;
    const email = String(input.email || '').trim();
    if (!names.firstName && !names.lastName) return response.status(400).json({ error: 'Enter a first or last name for the client.' });
    if (name.length > 160) return response.status(400).json({ error: 'The client name must be 160 characters or fewer.' });
    if (String(input.currentAddress || '').trim().length > 300) return response.status(400).json({ error: 'Current address must be 300 characters or fewer.' });
    const personalError = personalDetailsError(input);
    if (personalError) return response.status(400).json({ error: personalError });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response.status(400).json({ error: 'Enter a valid email address.' });
    }
    const dates = [
      input.onboardingDate,
      input.interviewDate,
      input.lastContactDate,
      input.lastAttorneyDate,
    ].filter(Boolean);
    if (dates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(String(value)))) {
      return response.status(400).json({ error: 'Enter dates in the expected calendar format.' });
    }
    const nextContactDate = String(input.nextContactDate || '').trim();
    if (nextContactDate && nextContactDate.toLowerCase() !== 'done' && !/^\d{4}-\d{2}-\d{2}$/.test(nextContactDate)) {
      return response.status(400).json({ error: 'Next contact must be a date or done.' });
    }
    const notes = String(input.notes || '').trim();
    if (notes.length > 2000) return response.status(400).json({ error: 'Notes must be 2,000 characters or fewer.' });

    const client = await store.update(request.params.clientId, {
      name,
      email,
      phone: String(input.phone || '').trim(),
      caseType: String(input.caseType || '').trim(),
      frequency: String(input.frequency || '').trim(),
      translator: String(input.translator || '').trim(),
      onboardingDate: String(input.onboardingDate || '').trim(),
      interviewDate: String(input.interviewDate || '').trim(),
      lastContactDate: String(input.lastContactDate || '').trim(),
      outcome: String(input.outcome || '').trim(),
      nextContactDate,
      lastAttorneyDate: String(input.lastAttorneyDate || '').trim(),
      paymentStatus: String(input.paymentStatus || '').trim(),
      notes,
      dateOfBirth: String(input.dateOfBirth || '').trim(),
      gender: String(input.gender || '').trim(),
      address: String(input.address || '').trim(),
      currentAddress: String(input.currentAddress || '').trim(),
      firstName: names.firstName,
      middleName: names.middleName,
      lastName: names.lastName,
    });
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    const { client: saved, caseError } = await saveCaseTypes(client, input.caseType);
    response.json({ client: saved, caseError, modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message === 'Client not found.') return response.status(404).json({ error: error.message });
    if (error.message.includes('already exists')) return response.status(409).json({ error: error.message });
    if (error.message.includes('locked by Excel')) return response.status(423).json({ error: error.message });
    next(error);
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = resolve(root, 'dist');
  app.use(express.static(dist));
  app.use((request, response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api/')) {
      response.sendFile(resolve(dist, 'index.html'), (error) => error && next(error));
      return;
    }
    next();
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error instanceof SheetSetupError) return response.status(500).json({ error: error.message });
  if (error instanceof WorkPermitError) return response.status(error.status).json({ error: error.message });
  const missingFile = String(error?.message || '').match(/^File not found: (.+)$/);
  if (!useGoogleSheets && missingFile) {
    return response.status(500).json({ error: `Workbook not found: ${missingFile[1].split(/[\\/]/).pop()}. Add it to the project folder.` });
  }
  const message = useGoogleSheets
    ? 'Google Sheets could not be read or updated. Check the spreadsheet ID, service-account access, and Render environment variables.'
    : 'The workbook could not be read or updated. Close it in Excel and try again.';
  response.status(500).json({ error: message });
});

if (process.env.VERCEL !== '1') {
  const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
  app.listen(port, host, () => {
    console.log(`Case Management Tool listening at http://${host}:${port}`);
    console.log(useGoogleSheets ? `Data source: Google Sheets (${process.env.GOOGLE_SHEET_NAME || 'MasterData'})` : `Workbook: ${workbookPath}`);
  });
}

export default app;
