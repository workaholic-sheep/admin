// Reads an ID or document photo in the browser with Tesseract OCR and pulls out intake details.
// The image never leaves the computer; only the OCR engine files are downloaded.

const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
const DATE_PATTERN = new RegExp(
  `\\b(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s*(?:${MONTHS})[A-Z]*\\s*\\d{2,4})\\b`,
  'i',
);
const STREET_PATTERN = /^\d+[A-Z]?\s+[A-Z0-9 .'#-]+?\b(ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|BLVD|BOULEVARD|CT|COURT|WAY|PL|PLACE|PKWY|PARKWAY|HWY|HIGHWAY|CIR|CIRCLE|TRL|TRAIL|TER|TERRACE|LOOP|SQ)\b.*$/i;
const CITY_PATTERN = /^[A-Z][A-Z .'-]+,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i;

function cleanLines(text) {
  return String(text || '')
    .replace(/[«‹]/g, '<')
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_match, start, letter) => start + letter.toUpperCase())
    .trim();
}

function cleanName(value) {
  const name = String(value || '')
    .replace(/[^A-Za-zÀ-ÿ' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || name.length > 60) return '';
  return name;
}

// Finds the value after a label, either on the same line or the line below
// (passports print "Surname / Nom" with the value underneath).
function labeled(lines, labelPattern, accept = (value) => Boolean(value)) {
  const pattern = new RegExp(`(?:^|[^A-Z])(?:${labelPattern})(?![A-Z])\\s*[:.#]?\\s*(.*)$`, 'i');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    const rest = match[1].trim();
    if (rest && !rest.startsWith('/') && accept(rest)) return rest;
    const next = lines[index + 1];
    if (next && accept(next)) return next;
  }
  return '';
}

function fullYear(year) {
  if (year >= 100) return year;
  return year > new Date().getFullYear() % 100 ? 1900 + year : 2000 + year;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > new Date()) return '';
  return date.toISOString().slice(0, 10);
}

// Turns a printed birth date into YYYY-MM-DD. Numeric dates are read US-style (month first)
// unless the first number cannot be a month.
export function toIsoDate(text) {
  const value = String(text || '').toUpperCase();
  let match = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (match) {
    const [first, second, year] = match.slice(1).map(Number);
    const [month, day] = first > 12 ? [second, first] : [first, second];
    return isoDate(fullYear(year), month, day);
  }
  match = value.match(new RegExp(`\\b(\\d{1,2})\\s*(${MONTHS})[A-Z]*\\s*(\\d{2,4})\\b`));
  if (match) return isoDate(fullYear(Number(match[3])), MONTHS.split('|').indexOf(match[2]) + 1, Number(match[1]));
  return '';
}

function mrzDate(yymmdd) {
  return isoDate(fullYear(Number(yymmdd.slice(0, 2))), Number(yymmdd.slice(2, 4)), Number(yymmdd.slice(4, 6)));
}

const GENDERS = { M: 'Male', MALE: 'Male', MASCULINO: 'Male', H: 'Male', F: 'Female', FEMALE: 'Female', FEMENINO: 'Female', X: 'Other' };

function readGender(lines) {
  const value = labeled(lines, 'SEX|SEXO|GENDER', (text) => /^(MALE|FEMALE|MASCULINO|FEMENINO|[MFX])\b/i.test(text));
  const word = value.match(/^(MALE|FEMALE|MASCULINO|FEMENINO|[MFX])\b/i)?.[1]?.toUpperCase();
  return GENDERS[word] || '';
}

function readMrz(lines) {
  const mrz = lines
    .map((line) => line.toUpperCase().replace(/\s/g, ''))
    .filter((line) => (line.match(/</g) || []).length >= 3 && line.length >= 30);
  const nameLine = mrz.find((line) => /^P[A-Z0-9<][A-Z<]{3}[A-Z<]+$/.test(line) && line.includes('<<'));
  if (!nameLine) return null;
  const [surname = '', given = ''] = nameLine.slice(5).split('<<');
  const result = {
    name: cleanName(`${given.replace(/<+/g, ' ')} ${surname.replace(/<+/g, ' ')}`),
    country: nameLine.slice(2, 5).replace(/</g, ''),
  };
  const dataLine = mrz.find((line) => line !== nameLine && /^[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}/.test(line));
  if (dataLine) {
    result.idNumber = dataLine.slice(0, 9).replace(/</g, '');
    result.nationality = dataLine.slice(10, 13).replace(/</g, '');
    result.dateOfBirth = mrzDate(dataLine.slice(13, 19));
    result.gender = GENDERS[dataLine[20]] || '';
  }
  return result;
}

function detectType(text) {
  const upper = text.toUpperCase();
  if (/EMPLOYMENT\s+AUTHORI[ZS]ATION/.test(upper)) return 'work permit (EAD)';
  if (/PERMANENT\s+RESIDENT/.test(upper)) return 'green card';
  if (/PASSPORT|PASAPORTE/.test(upper)) return 'passport';
  if (/DRIVER|DRIVING|LICEN[CS]E/.test(upper)) return "driver's license";
  if (/IDENTIFICATION\s+CARD|\bID\s+CARD\b/.test(upper)) return 'ID card';
  return 'document';
}

function readName(lines) {
  const isName = (value) => Boolean(cleanName(value)) && !/\d/.test(value);
  const surname = labeled(lines, 'LN|LAST\\s*NAME|SURNAME|FAMILY\\s*NAME|APELLIDOS?', isName);
  const given = labeled(lines, 'FN|FIRST\\s*NAME|GIVEN\\s*NAMES?|NOMBRES?', isName);
  if (surname || given) return cleanName(`${given} ${surname}`);

  // US licenses number their fields: "1 FAMILYNAME" and "2 GIVEN NAMES".
  const numbered = (number) => lines
    .map((line) => line.match(new RegExp(`^${number}\\s+([A-Z][A-Z' -]+)$`)))
    .find(Boolean)?.[1] || '';
  const family = cleanName(numbered(1));
  const first = cleanName(numbered(2));
  if (family && first) return `${first} ${family}`;

  return cleanName(labeled(lines, '(?<!LAST |FIRST |FAMILY |GIVEN )NAME', isName));
}

function readAddress(lines) {
  const labeledAddress = labeled(lines, 'ADDRESS|ADDR|DOMICILIO', (value) => /\d/.test(value));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^8\s+(?=\d)/, '');
    if (!STREET_PATTERN.test(line)) continue;
    const next = lines[index + 1] || '';
    return CITY_PATTERN.test(next) ? `${line}, ${next}` : line;
  }
  return labeledAddress;
}

export function parseDocumentText(text) {
  const lines = cleanLines(text);
  const joined = lines.join('\n');
  const mrz = readMrz(lines);
  const docType = mrz ? 'passport' : detectType(joined);

  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = joined.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)?.[0] || '';
  const printedBirthDate = labeled(lines, 'DOB|DATE\\s*OF\\s*BIRTH|BIRTH\\s*DATE|FECHA\\s*DE\\s*NACIMIENTO', (value) => DATE_PATTERN.test(value)).match(DATE_PATTERN)?.[1] || '';
  const dateOfBirth = mrz?.dateOfBirth || toIsoDate(printedBirthDate);
  const aNumberMatch = joined.match(/\b(?:USCIS\s*#?\s*:?\s*|A[-#]?\s?)(\d{3}[-\s]?\d{3}[-\s]?\d{3}|\d{8})\b/i);
  const aNumber = aNumberMatch ? `A${aNumberMatch[1].replace(/\D/g, '').padStart(9, '0')}` : '';
  const idNumber = mrz?.idNumber
    || labeled(lines, 'DLN|DL\\s*NO|DL|LIC(?:ENSE)?\\s*(?:NO|#)|PASSPORT\\s*(?:NO|NUMBER)|ID\\s*(?:NO|#)', (value) => /\d/.test(value))
      .match(/[A-Z0-9-]*\d[A-Z0-9-]*/i)?.[0]
    || '';
  const nationality = mrz?.nationality || labeled(lines, 'NATIONALITY|NACIONALIDAD|COUNTRY\\s*OF\\s*BIRTH', (value) => /^[A-Z ]{3,}$/i.test(value));

  const idLabel = docType === 'passport' ? 'Passport #' : docType === "driver's license" ? "Driver's license #" : 'ID #';
  const details = [
    // A birth date that was found but could not be turned into a calendar date stays visible in notes.
    ['Date of birth', dateOfBirth ? '' : printedBirthDate],
    ['A-Number', aNumber],
    [idLabel, idNumber],
    ['Nationality', nationality],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value: value.trim() }));

  const name = mrz?.name || readName(lines);
  return {
    docType,
    fields: {
      name: name ? titleCase(name) : '',
      email,
      phone,
      dateOfBirth,
      gender: mrz?.gender || readGender(lines),
      address: readAddress(lines),
    },
    details,
    text: joined,
  };
}

// Upscales and grayscales the photo, which noticeably improves Tesseract on phone pictures of cards.
async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be opened. Use a JPG, PNG, or WebP photo.');
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(2.5, Math.max(1, 2000 / longest));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.filter = 'grayscale(1) contrast(1.35)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

export async function scanDocument(file, onProgress = () => {}) {
  if (!file.type.startsWith('image/')) throw new Error('Upload a photo or scan of the document (JPG, PNG, or WebP). PDFs are not supported yet.');
  onProgress(0, 'Preparing image');
  const image = await prepareImage(file);
  const { createWorker } = await import('tesseract.js');
  onProgress(0.05, 'Loading reader');
  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress(0.1 + message.progress * 0.9, 'Reading text');
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return parseDocumentText(data.text);
  } finally {
    await worker.terminate();
  }
}
