// Progress of one client's case. Saved as text in the case tab's Status column.
export const CASE_STATUSES = ['Not Started', 'Ongoing', 'Completed'];
export const DEFAULT_CASE_STATUS = 'Not Started';

// Accepts what staff might type in the sheet ("ongoing", "In progress", "done"); blank means not started.
export function normalizeCaseStatus(value) {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!key || key === 'notstarted' || key === 'new' || key === 'todo') return 'Not Started';
  if (key === 'ongoing' || key === 'inprogress' || key === 'started' || key === 'pending') return 'Ongoing';
  if (key === 'completed' || key === 'complete' || key === 'done' || key === 'finished') return 'Completed';
  return String(value).trim();
}

export const caseStatusTone = (status) => ({ 'Not Started': 'danger', Ongoing: 'caution', Completed: 'positive' })[normalizeCaseStatus(status)] || 'neutral';
