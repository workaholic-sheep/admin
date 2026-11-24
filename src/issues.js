// Shared by the server and the Issues pages.
export const ISSUE_CATEGORIES = ['Tech', 'Other'];
export const ISSUE_STATUSES = ['Open', 'Solved'];

// "2026-11-19 2:05 PM" (Central Time, as written by the server) → Date. null when it can't be read.
export function centralToDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[6].toUpperCase() === 'PM') hour += 12;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, Number(match[5]));
  // Central's offset from UTC at a moment: the wall clock there, read as if it were UTC, minus the moment.
  const offsetAt = (moment) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(moment)).map(({ type, value: part }) => [type, Number(part)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - moment;
  };
  let moment = wall - offsetAt(wall);
  moment = wall - offsetAt(moment); // second pass settles the hour around a DST change
  return new Date(moment);
}

// 1 day 3 hours → "1d 3h"; shows the two largest units. Blank when it can't be worked out.
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const parts = [[Math.floor(minutes / 1440), 'd'], [Math.floor(minutes / 60) % 24, 'h'], [minutes % 60, 'm']];
  const first = parts.findIndex(([amount]) => amount > 0);
  return parts.slice(first, first + 2).filter(([amount]) => amount > 0).map(([amount, unit]) => `${amount}${unit}`).join(' ');
}

// How long an issue was (or has so far been) open.
export function issueDuration(issue, now = new Date()) {
  const start = centralToDate(issue.reportedAt);
  const end = issue.status === 'Solved' ? centralToDate(issue.solvedAt) : now;
  return start && end ? end - start : NaN;
}
