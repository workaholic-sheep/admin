export const CASE_TYPES = ['VAWA', 'I-485', 'I-589'];

const normalizeType = (value) => String(value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const splitTypes = (value) => String(value ?? '').split(/[+,;|/]+/).map((part) => part.trim()).filter(Boolean);

export function isCaseTypeSelected(value, caseType) {
  const target = normalizeType(caseType);
  return splitTypes(value).some((part) => normalizeType(part) === target);
}

export function updateCaseTypeValue(value, caseType, checked) {
  const selected = new Set(CASE_TYPES.filter((type) => isCaseTypeSelected(value, type)));
  const unknown = splitTypes(value).filter((part) => !CASE_TYPES.some((type) => normalizeType(type) === normalizeType(part)));
  if (checked) selected.add(caseType);
  else selected.delete(caseType);
  return [...CASE_TYPES.filter((type) => selected.has(type)), ...unknown].join(' + ');
}

export function countCaseTypes(clients) {
  const clientIds = Object.fromEntries(CASE_TYPES.map((type) => [type, new Set()]));
  for (const client of clients) {
    const identity = String(client.id || client.email || client.name || '').trim().toLowerCase();
    if (!identity) continue;
    const assigned = new Set(splitTypes(client.caseType).map(normalizeType));
    for (const type of CASE_TYPES) {
      if (assigned.has(normalizeType(type))) clientIds[type].add(identity);
    }
  }
  return Object.fromEntries(CASE_TYPES.map((type) => [type, clientIds[type].size]));
}
