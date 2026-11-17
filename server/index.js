import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SheetSetupError, createGoogleSheetStore } from './google-sheets.js';
import { createSessionAuth } from './session-auth.js';
import { createReminderWorkbookStore } from './payment-reminders.js';
import { createWorkbookStore } from './workbook.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workbookPath = resolve(process.env.WORKBOOK_PATH || resolve(root, "Prototype of Client's Tracker .xlsx"));
const courtWorkbookPath = resolve(process.env.COURT_WORKBOOK_PATH || resolve(root, 'Prototype of Reports.xlsx'));
const workPermitWorkbookPath = resolve(process.env.WORK_PERMIT_WORKBOOK_PATH || resolve(root, 'BBeckford_WorkPermit_Database.xlsx'));
const reminderWorkbookPath = resolve(process.env.PAYMENT_REMINDER_WORKBOOK_PATH || resolve(root, 'BBeckford_PaymentReminders.xlsx'));
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
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'MasterData',
    courtSpreadsheetId: process.env.GOOGLE_COURT_SHEET_ID,
    courtSheetName: process.env.GOOGLE_COURT_SHEET_NAME || 'COURT DATE LIST',
    workPermitSpreadsheetId: process.env.GOOGLE_WORK_PERMIT_SHEET_ID,
    workPermitSheetName: process.env.GOOGLE_WORK_PERMIT_SHEET_NAME || 'WorkPermits',
    reminderSheetName: process.env.GOOGLE_PAYMENT_REMINDER_SHEET_NAME || 'PaymentReminders',
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY,
  })
  : createWorkbookStore(workbookPath, courtWorkbookPath, workPermitWorkbookPath);
const reminderStore = useGoogleSheets ? store.reminders : createReminderWorkbookStore(reminderWorkbookPath);
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

app.use('/api', (request, response, next) => {
  if (sessionAuth.isAuthenticated(request)) return next();
  return response.status(401).json({ error: 'Sign in to access client records.' });
});

app.post('/api/clients/:clientId/follow-up/done', async (request, response, next) => {
  try {
    const client = await store.completeFollowUp(request.params.clientId);
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.json({ client, modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message === 'Client not found.') return response.status(404).json({ error: error.message });
    if (error.message.includes('scheduled follow-up') || error.message.includes('already marked done')) {
      return response.status(409).json({ error: error.message });
    }
    next(error);
  }
});

app.get('/api/clients', async (_request, response, next) => {
  try {
    const clients = await store.list();
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.json({ clients, modifiedAt, source: sourceName });
  } catch (error) {
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

app.get('/api/work-permits', async (_request, response, next) => {
  const notConfigured = { workPermits: [], configured: false, source: sourceName };
  if (!store.workPermitsConfigured) return response.json(notConfigured);
  if (!useGoogleSheets && !(await stat(workPermitWorkbookPath).catch(() => null))) return response.json(notConfigured);
  try {
    const workPermits = await store.listWorkPermits();
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workPermitWorkbookPath)).mtime.toISOString();
    response.json({ workPermits, configured: true, modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message.includes('tab was not found')) return response.status(500).json({ error: error.message });
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
    response.json({ reminders: await reminderStore.list(), source: sourceName });
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

app.post('/api/clients', async (request, response, next) => {
  try {
    const input = request.body || {};
    const name = String(input.name || '').trim();
    const email = String(input.email || '').trim();
    if (!name) return response.status(400).json({ error: 'Client name is required.' });
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
    });
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.status(201).json({ client, modifiedAt, source: sourceName });
  } catch (error) {
    if (error.message.includes('already exists')) return response.status(409).json({ error: error.message });
    if (error.message.includes('locked by Excel')) return response.status(423).json({ error: error.message });
    next(error);
  }
});

app.put('/api/clients/:clientId', async (request, response, next) => {
  try {
    const input = request.body || {};
    const name = String(input.name || '').trim();
    const email = String(input.email || '').trim();
    if (!name) return response.status(400).json({ error: 'Client name is required.' });
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
    });
    const modifiedAt = useGoogleSheets ? new Date().toISOString() : (await stat(workbookPath)).mtime.toISOString();
    response.json({ client, modifiedAt, source: sourceName });
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
