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
    .map((line) => line.replace(/[|]/g, ' ').replace(/^[^A-Za-z0-9<]+/, '').replace(/\s+/g, ' ').trim())
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
  const word = value.match(/^(MALE|FEMALE|MASCULINO|FEMENINO|[MFX])\b/i)?.[1]?.toUpperCase()
    || lines.join('\n').match(/SEX[O]?\s*[:.]?\s*(MALE|FEMALE|[MFX])\b/i)?.[1]?.toUpperCase();
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

const STATES = 'ALABAMA|ALASKA|ARIZONA|ARKANSAS|CALIFORNIA|COLORADO|CONNECTICUT|DELAWARE|FLORIDA|GEORGIA|HAWAII|IDAHO|ILLINOIS|INDIANA|IOWA|KANSAS|KENTUCKY|LOUISIANA|MAINE|MARYLAND|MASSACHUSETTS|MICHIGAN|MINNESOTA|MISSISSIPPI|MISSOURI|MONTANA|NEBRASKA|NEVADA|NEW|HAMPSHIRE|JERSEY|MEXICO|YORK|NORTH|CAROLINA|DAKOTA|OHIO|OKLAHOMA|OREGON|PENNSYLVANIA|RHODE|ISLAND|SOUTH|TENNESSEE|TEXAS|UTAH|VERMONT|VIRGINIA|WASHINGTON|WEST|WISCONSIN|WYOMING|COLUMBIA|DISTRICT';
const CARD_WORDS = new RegExp(`^(?:${STATES}|USA|UNITED|STATES|AMERICA|OF|DRIVER|DRIVERS|DRIVER'S|LICENSE|LICENCE|CLASS|IDENTIFICATION|CARD|ID|REAL|DONOR|VETERAN|NONE|RESTRICTIONS|ENDORSEMENTS|SEX|HGT|WGT|EYES|HAIR|EXP|ISS|DOB|DD|DL|LN|FN|OPERATOR|COMMERCIAL|PERMIT|AUTHORIZATION|EMPLOYMENT|PASSPORT|BRO|BLK|BLU|BRN|GRN|HAZ)$`, 'i');

// A line that looks like part of a printed name: 1–4 alphabetic words, none of them card boilerplate.
function nameLine(line) {
  const text = line.replace(/^(?:\d{1,2}[a-z]?|[lI])\s+/, '').trim();
  const words = text.split(/\s+/);
  if (!words.length || words.length > 4) return '';
  if (!words.every((word) => /^[A-Za-z][A-Za-z'-]+$/.test(word))) return '';
  if (words.every((word) => CARD_WORDS.test(word))) return '';
  return text;
}

function readName(lines) {
  const isName = (value) => Boolean(cleanName(value)) && !/\d/.test(value);
  const stopAtLabel = (value) => value.split(/\s+(?:LN|FN|DOB|D0B|SEX|EXP|ISS|CLASS)\b/i)[0];
  const surname = stopAtLabel(labeled(lines, 'LN|LAST\\s*NAME|SURNAME|FAMILY\\s*NAME|APELLIDOS?', isName));
  const given = stopAtLabel(labeled(lines, 'FN|FIRST\\s*NAME|GIVEN\\s*NAMES?|NOMBRES?', isName));
  if (surname || given) return cleanName(`${given} ${surname}`);

  // US licenses number their fields: "1 FAMILYNAME" and "2 GIVEN NAMES".
  // OCR often reads the "1" as l or I and the "2" as Z, and can run the number into the name.
  const numbered = (pattern) => {
    const index = lines.findIndex((line) => {
      const match = line.match(new RegExp(`^(?:${pattern})[\\s.:]*([A-Z][A-Z'-]+(?: [A-Z][A-Z'-]+)*)`));
      return match && !CARD_WORDS.test(match[1].split(' ')[0]);
    });
    if (index < 0) return { index, name: '' };
    const match = lines[index].match(new RegExp(`^(?:${pattern})[\\s.:]*([A-Z][A-Z'-]+(?: [A-Z][A-Z'-]+)*)`));
    return { index, name: cleanName(match[1]) };
  };
  const family = numbered('1|l|I(?=\\s)');
  const givenField = numbered('2|Z(?=\\s)');
  if (family.name && givenField.name) return `${givenField.name} ${family.name}`;
  const neighbour = (index) => nameLine(lines[index + 1] || '') || nameLine(lines[index - 1] || '');
  if (givenField.name) {
    const other = neighbour(givenField.index);
    if (other) return cleanName(`${givenField.name} ${other}`);
  }
  if (family.name) {
    const other = neighbour(family.index);
    if (other) return cleanName(`${other} ${family.name}`);
  }

  const labeledName = cleanName(labeled(lines, '(?<!LAST |FIRST |FAMILY |GIVEN )NAME', isName));
  if (labeledName) return labeledName;

  // Licenses print the name directly above the street address: family name, then given names.
  const street = lines.findIndex((line) => STREET_PATTERN.test(line.replace(/^8\s+(?=\d)/, '')));
  if (street > 0) {
    const above = [];
    for (let index = street - 1; index >= 0 && above.length < 2; index -= 1) {
      const text = nameLine(lines[index]);
      if (!text) break;
      above.unshift(text);
    }
    if (above.length === 2) return cleanName(`${above[1]} ${above[0]}`);
    if (above.length === 1) return cleanName(above[0]);
  }
  return '';
}

// Without a readable DOB label, the birth date is the oldest date on the card that is at least 14 years back;
// the other dates are issue and expiry dates.
function oldestBirthDate(text) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 14);
  const limit = cutoff.toISOString().slice(0, 10);
  return [...text.matchAll(new RegExp(DATE_PATTERN.source, 'gi'))]
    .map((match) => toIsoDate(match[1]))
    .filter((date) => date && date <= limit && date >= '1900-01-01')
    .sort()[0] || '';
}

function readAddress(lines) {
  const labeledAddress = labeled(lines, 'ADDRESS|ADDR|DOMICILIO', (value) => /\d/.test(value));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/^8\s+(?=\d)/, '').replace(/[.,]+$/, '');
    if (!STREET_PATTERN.test(line)) continue;
    const next = lines[index + 1] || '';
    return CITY_PATTERN.test(next) ? `${line}, ${next}` : line;
  }
  if (labeledAddress) return labeledAddress;
  const city = lines.findIndex((line) => CITY_PATTERN.test(line));
  if (city < 0) return '';
  const previous = (lines[city - 1] || '').replace(/^8\s+(?=\d)/, '');
  return /^\d+\s+\S/.test(previous) ? `${previous}, ${lines[city]}` : lines[city];
}

export function parseDocumentText(text) {
  const lines = cleanLines(text);
  const joined = lines.join('\n');
  const mrz = readMrz(lines);
  const docType = mrz ? 'passport' : detectType(joined);

  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = joined.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)?.[0] || '';
  const printedBirthDate = labeled(lines, 'D[O0]B|DATE\\s*OF\\s*BIRTH|BIRTH\\s*DATE|FECHA\\s*DE\\s*NACIMIENTO', (value) => DATE_PATTERN.test(value)).match(DATE_PATTERN)?.[1] || '';
  const dateOfBirth = mrz?.dateOfBirth || toIsoDate(printedBirthDate) || oldestBirthDate(joined);
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
  const scale = Math.min(2.5, Math.max(1, 1400 / longest));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.filter = 'grayscale(1) contrast(1.35)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

// Combines two readings of the same document, keeping the first value found for each field.
export function mergeScans(first, second) {
  const fields = { ...first.fields };
  for (const [key, value] of Object.entries(second.fields)) if (!fields[key] && value) fields[key] = value;
  const labels = new Set(first.details.map((detail) => detail.label));
  return {
    docType: first.docType === 'document' ? second.docType : first.docType,
    fields,
    details: [...first.details, ...second.details.filter((detail) => !labels.has(detail.label))],
    text: `${first.text}\n\n--- second pass ---\n${second.text}`,
  };
}

let workerPromise = null;
let reportProgress = () => {};

function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('eng', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') reportProgress(message.progress);
        },
      }))
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

// Downloads and starts the OCR engine in the background so the first scan does not wait for it.
export function warmUpScanner() {
  getWorker().catch(() => {});
}

export async function scanDocument(file, onProgress = () => {}) {
  if (!file.type.startsWith('image/')) throw new Error('Upload a photo or scan of the document (JPG, PNG, or WebP). PDFs are not supported yet.');
  onProgress(0, 'Preparing image');
  const [image, worker] = await Promise.all([prepareImage(file), getWorker().then((ready) => {
    onProgress(0.1, 'Reading text');
    return ready;
  })]);
  const read = async (mode, start, label) => {
    reportProgress = (value) => onProgress(start + value * 0.45, label);
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    return parseDocumentText((await worker.recognize(image)).data.text);
  };
  try {
    const first = await read('3', 0.1, 'Reading text');
    if (first.fields.name && first.fields.dateOfBirth) return first;
    // Sparse-text mode finds scattered fields on ID cards that the default page layout misses.
    return mergeScans(first, await read('11', 0.55, 'Reading again'));
  } finally {
    reportProgress = () => {};
  }
}
