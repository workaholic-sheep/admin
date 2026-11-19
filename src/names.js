// MasterData keeps First / Middle / Last Name in separate columns; the app shows the joined name.

export function joinName(first, middle, last) {
  return [first, middle, last].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
}

// Only for a single full name with nothing better to go on (old "Client Name" sheets, document scans):
// "Maria Elena Lopez Garcia" → Maria / Elena Lopez / Garcia.
export function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', middle: '', last: '' };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts.at(-1) };
}

// Name parts from a form or request: the separate fields when given, otherwise split `name`.
export function nameParts(input = {}) {
  const given = { first: String(input.firstName ?? '').trim(), middle: String(input.middleName ?? '').trim(), last: String(input.lastName ?? '').trim() };
  const parts = given.first || given.last || given.middle ? given : splitName(input.name);
  return { firstName: parts.first, middleName: parts.middle, lastName: parts.last, name: joinName(parts.first, parts.middle, parts.last) };
}
