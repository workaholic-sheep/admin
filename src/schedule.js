// Shared by the server and the Schedule page.
export const SCHEDULE_MODES = ['Zoom', 'In Person', 'Phone Call'];
export const SCHEDULE_STATUSES = ['Scheduled', 'Done', 'Cancelled'];

// "14:30" → "2:30 PM"
export function timeFrom24h(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// "2:30 PM", "2pm", "14:30" → "14:30" (blank when it can't be read)
export function timeTo24h(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = match[2] || '00';
  if (match[3]?.startsWith('p') && hour < 12) hour += 12;
  if (match[3]?.startsWith('a') && hour === 12) hour = 0;
  if (hour > 23 || Number(minute) > 59) return '';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}
