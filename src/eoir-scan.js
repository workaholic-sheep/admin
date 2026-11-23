// Reads the text of an "EOIR Asylum EAD Clock Information" screenshot (after OCR) and turns it
// into work permit form values. Pure functions, so they can be tested without a browser.

const DATE = String.raw`(\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{4})`;
// Spaces/tabs only, so an empty field never borrows the next line as its value.
const SEP = String.raw`[ \t]*[:;.]?[ \t]*`;

// "09/30/2026" → "2026-09-30"; blank if it isn't a real date.
export function eoirDate(value) {
  const match = String(value || '').replace(/\s+/g, '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : '';
}

const titleCase = (value) => value.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_all, start, letter) => start + letter.toUpperCase());

// EOIR writes "LAST, FIRST MIDDLE": the comma marks the surname, so "GARCIA LOPEZ, MARIA ELENA"
// → { first: "Maria", middle: "Elena", last: "Garcia Lopez" }.
export function eoirNameParts(value) {
  const cleaned = String(value || '').replace(/[^A-Za-zÀ-ÿ,' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const [last = '', given = ''] = cleaned.split(',').map((part) => part.trim());
  if (!given) return { first: titleCase(cleaned), middle: '', last: '' };
  const [first, ...middle] = given.split(' ');
  return { first: titleCase(first), middle: titleCase(middle.join(' ')), last: titleCase(last) };
}

// "SIWILA, DENNIS" → "Dennis Siwila".
export function eoirName(value) {
  const { first, middle, last } = eoirNameParts(value);
  const name = [first, middle, last].filter(Boolean).join(' ');
  return name.length >= 3 ? name : '';
}

function find(text, pattern) {
  // "m" so that $ means the end of a line: the screen reads as "Label: value" one per line.
  return text.match(new RegExp(pattern, 'im'))?.[1]?.trim() || '';
}

// Value after a label up to the next label on the same line (two-column layout) or the line end.
function phrase(text, label, nextLabels) {
  const stop = nextLabels.length ? `(?=\\s+(?:${nextLabels.join('|')})\\b|$)` : '$';
  const value = find(text, `${label}${SEP}([^\\n]*?)${stop}`);
  // An empty field reads as the next label, or as nothing.
  return /^(?:[A-Z][A-Za-z' ]+:)/.test(value) ? '' : value;
}

const LABELS = ['NTA\\s*Date', 'As\\s*of', 'Asylum\\s*Type', 'Asylum\\s*Decision', 'Date\\s*Appeal', 'DHS\\s*Days', 'DHS\\s*Status', 'Init\\s*Asylum', 'EAD\\s*Clock', 'Name', 'A-?\\s*Number'];

export function parseEoirText(text) {
  const source = String(text || '').replace(/[|]/g, ' ').replace(/[‘’`´]/g, "'").replace(/[ \t]+/g, ' ');
  const digits = find(source, String.raw`A\s*-?\s*Number${SEP}([0-9][0-9 -]{6,12}[0-9])`).replace(/\D/g, '');
  const clock = source.match(/EAD\s*Clock\s*is\s*(running|stopped|paused)\S*\s*[:;.]?\s*(\d+)\s*Days?/i);
  const fields = {
    aNumber: /^\d{8,9}$/.test(digits) ? digits.padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1-$2-$3') : '',
    name: eoirName(phrase(source, 'Name', LABELS.filter((label) => label !== 'Name'))),
    nameParts: eoirNameParts(phrase(source, 'Name', LABELS.filter((label) => label !== 'Name'))),
    ntaDate: eoirDate(find(source, `NTA\\s*Date${SEP}${DATE}`)),
    asOf: eoirDate(find(source, `As\\s*of${SEP}${DATE}`)),
    filingDate: eoirDate(find(source, `Init\\s*Asylum\\s*Rec\\S{0,3}\\s*Date${SEP}${DATE}`)),
    clockStatus: clock ? (clock[1].toLowerCase() === 'running' ? 'Running' : 'Stopped') : '',
    clockDays: clock ? Number(clock[2]) : null,
    asylumType: find(source, `Asylum\\s*Type${SEP}([A-Za-z][A-Za-z -]*?)(?=\\s+[A-Z][A-Za-z' ]+:|$)`),
    asylumDecision: phrase(source, 'Asylum\\s*Decision', LABELS),
    appealDate: eoirDate(find(source, `Date\\s*Appeal\\s*Filed${SEP}${DATE}`)),
    dhsDays: find(source, String.raw`DHS\s*Days\s*At\s*Referral${SEP}(\d+)`),
    dhsStatus: phrase(source, 'DHS\\s*Status\\s*At\\s*Referral', []),
  };
  // Event rows: "Hearing 10/30/2026 CHI 9V - Vacated master calendar hearing Run 30 85"
  const events = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(new RegExp(`^([A-Za-z][A-Za-z /-]*?)\\s+${DATE}\\s+([A-Z]{2,4})\\s+(.*?)\\s+(Run|Stop|Stopped|Start|N\\s*/\\s*A)\\s+(\\d+)\\s+(\\d+)$`, 'i'));
    if (!match || /^today$/i.test(match[1].trim())) continue;
    events.push({ event: match[1].trim(), date: eoirDate(match[2]), city: match[3], decision: match[4].replace(/^N\s*\/\s*A$/i, '').trim(), action: match[5].replace(/\s+/g, ''), elapsed: Number(match[6]), cumulative: Number(match[7]) });
  }
  return { fields, events };
}

// The scan found enough to be worth filling the form.
export const eoirScanFound = ({ fields }) => Boolean(fields.aNumber || fields.name) && Boolean(fields.filingDate || fields.clockDays !== null);

const dayNumber = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);
const formatUs = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '');
const EOIR_BLOCK = /\n*EOIR \(as of [^)]*\):[\s\S]*?(?=\n\n|$)/;

// Applies a scan to the work permit form, one EOIR field per form field. Returns the form keys it
// filled (for highlighting). Paused days are set so the app's clock matches EOIR's count on the
// "As of" date: (As of − Init Asylum Rec'd) − EOIR elapsed days.
export function applyEoirScan(form, scan) {
  const { fields, events } = scan;
  const next = { ...form };
  const keys = [];
  const set = (key, value) => {
    if (value === '' || value === null || value === undefined) return;
    next[key] = value;
    keys.push(key);
  };
  if (!String(form.name || '').trim()) set('name', fields.name);
  set('aNumber', fields.aNumber);
  set('filingDate', fields.filingDate);
  set('ntaDate', fields.ntaDate);
  set('eoirAsOf', fields.asOf);
  set('eoirClockStatus', fields.clockStatus);
  set('eoirClockDays', fields.clockDays === null ? '' : String(fields.clockDays));
  set('asylumType', fields.asylumType);
  set('asylumDecision', fields.asylumDecision);
  set('appealFiledDate', fields.appealDate);
  set('dhsDaysAtReferral', fields.dhsDays);
  set('dhsStatusAtReferral', fields.dhsStatus);
  if (events.length) set('eoirEvents', events.map((event) => ({ ...event, elapsed: String(event.elapsed), cumulative: String(event.cumulative) })));
  if (fields.filingDate && fields.asOf && fields.clockDays !== null) {
    const calendarDays = dayNumber(fields.asOf) - dayNumber(fields.filingDate);
    if (calendarDays >= fields.clockDays) set('pausedDays', calendarDays - fields.clockDays);
  }
  // Earlier scans wrote an "EOIR (as of …)" summary into the note; those details now have their own fields.
  const note = String(form.note || '');
  if (EOIR_BLOCK.test(note)) next.note = note.replace(EOIR_BLOCK, '').trim();
  return { next, keys, clockStopped: fields.clockStatus === 'Stopped' };
}

// Plain-text lines describing a scan, for forms without EOIR fields (client intake notes).
export function eoirSummaryLines(scan) {
  const { fields, events } = scan;
  return [
    fields.aNumber && `A-Number: ${fields.aNumber}`,
    fields.filingDate && `Init Asylum Rec'd Date: ${formatUs(fields.filingDate)}`,
    fields.clockDays !== null && `EAD clock ${fields.clockStatus === 'Stopped' ? 'stopped' : 'running'}: ${fields.clockDays} days`,
    fields.ntaDate && `NTA ${formatUs(fields.ntaDate)}`,
    fields.asylumType && `Asylum type: ${fields.asylumType}`,
    fields.asylumDecision && `Asylum decision: ${fields.asylumDecision}`,
    fields.appealDate && `Appeal filed ${formatUs(fields.appealDate)}`,
    fields.dhsDays && `DHS days at referral: ${fields.dhsDays}`,
    fields.dhsStatus && `DHS status at referral: ${fields.dhsStatus}`,
    ...events.map((item) => `${item.event} ${formatUs(item.date)} ${item.city}${item.decision ? ` – ${item.decision}` : ''} (${item.action}, ${item.elapsed}/${item.cumulative} days)`),
  ].filter(Boolean);
}

// Replaces any earlier "EOIR (as of …)" block in a note with a fresh one.
export function withEoirSummary(note, scan) {
  const lines = eoirSummaryLines(scan);
  const kept = String(note || '').replace(EOIR_BLOCK, '').trim();
  if (!lines.length) return kept;
  return `${kept ? `${kept}\n\n` : ''}EOIR (as of ${formatUs(scan.fields.asOf) || 'scan'}):\n${lines.join('\n')}`.slice(0, 2000);
}
