import { SCHEDULE_ADDED_BY } from '../src/team.js';
import { ISSUE_CATEGORIES, centralToDate, formatDuration } from '../src/issues.js';
import { centralTimestamp } from './case-assignments.js';

// Team issue log in the Issues tab of Clients_Additional_Info. Times are stamped by the server in
// Central Time; "Time Open" is written when an issue is marked solved so the sheet shows it too.

export const ISSUES_TAB = 'Issues';
export const ISSUE_HEADERS = ['Issue ID', 'Category', 'Title', 'Details', 'Reported By', 'Affected Team Member', 'Reported At (CT)', 'Status', 'Solved By', 'Solved At (CT)', 'Time Open', 'Resolution'];

export class IssueError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  issueid: ['issueid', 'id'],
  category: ['category', 'type', 'kind'],
  title: ['title', 'issue', 'subject', 'summary'],
  details: ['details', 'description', 'notes', 'note'],
  reportedby: ['reportedby', 'addedby', 'by'],
  affectedteammember: ['affectedteammember', 'affectedteammembers', 'affected', 'affectedmember', 'affectedmembers', 'teammember', 'whoisaffected'],
  reportedatct: ['reportedatct', 'reportedat', 'createdat', 'created', 'dateandtimect'],
  status: ['status'],
  solvedby: ['solvedby', 'resolvedby', 'fixedby'],
  solvedatct: ['solvedatct', 'solvedat', 'resolvedat', 'fixedat'],
  timeopen: ['timeopen', 'duration', 'howlong', 'lasted'],
  resolution: ['resolution', 'fix', 'solution', 'howsolved'],
};
const columnOf = (headers, name) => {
  const accepted = ALIASES[key(name)] || [key(name)];
  return headers.findIndex((header) => accepted.includes(key(header)));
};

const FIELDS = {
  id: 'Issue ID', category: 'Category', title: 'Title', details: 'Details', reportedBy: 'Reported By', affected: 'Affected Team Member', reportedAt: 'Reported At (CT)',
  status: 'Status', solvedBy: 'Solved By', solvedAt: 'Solved At (CT)', timeOpen: 'Time Open', resolution: 'Resolution',
};

function toIssue(headers, row) {
  const issue = {};
  for (const [field, header] of Object.entries(FIELDS)) {
    const column = columnOf(headers, header);
    issue[field] = column === -1 ? '' : String(row[column] ?? '').trim();
  }
  issue.category = ISSUE_CATEGORIES.find((category) => key(category) === key(issue.category)) || (/tech/i.test(issue.category) ? 'Tech' : 'Other');
  issue.status = /solved|resolved|fixed|closed|done/i.test(issue.status) ? 'Solved' : 'Open';
  return issue;
}

function rowFor(headers, issue) {
  const row = headers.map(() => '');
  for (const [field, header] of Object.entries(FIELDS)) {
    const column = columnOf(headers, header);
    if (column !== -1) row[column] = String(issue[field] ?? '');
  }
  return row;
}

const person = (value, message) => {
  const name = String(value ?? '').trim();
  if (!SCHEDULE_ADDED_BY.includes(name)) throw new IssueError(message);
  return name;
};

export function issueInput(body) {
  const input = body || {};
  const category = String(input.category ?? '').trim();
  if (!ISSUE_CATEGORIES.includes(category)) throw new IssueError(`Choose a category: ${ISSUE_CATEGORIES.join(' or ')}.`);
  const title = String(input.title ?? '').trim();
  const details = String(input.details ?? '').trim();
  if (!title) throw new IssueError('Say in a few words what the issue is.');
  if (title.length > 200) throw new IssueError('The title must be 200 characters or fewer.');
  if (details.length > 2000) throw new IssueError('Details must be 2,000 characters or fewer.');
  // Optional; one or more people, saved as "Kyle, Sam".
  const affected = [...new Set((Array.isArray(input.affected) ? input.affected : String(input.affected ?? '').split(',')).map((name) => String(name).trim()).filter(Boolean))];
  const unknown = affected.find((name) => !SCHEDULE_ADDED_BY.includes(name));
  if (unknown) throw new IssueError(`"${unknown}" isn't on the team list.`);
  return { category, title, details, reportedBy: person(input.reportedBy, 'Choose who is reporting this.'), affected: SCHEDULE_ADDED_BY.filter((name) => affected.includes(name)).join(', ') };
}

export function solveInput(body) {
  const resolution = String(body?.resolution ?? '').trim();
  if (resolution.length > 1000) throw new IssueError('The resolution must be 1,000 characters or fewer.');
  return { resolution };
}

export function createIssues(tabs, setupMessage = '') {
  let queue = Promise.resolve();
  const queued = (task) => {
    const operation = queue.then(task);
    queue = operation.catch(() => {});
    return operation;
  };
  const requireTabs = () => {
    if (!tabs) throw new IssueError(setupMessage || 'The Clients_Additional_Info spreadsheet is not connected.', 503);
    return tabs;
  };

  // Uses the tab if staff made one; fills an empty heading row and adds any of our columns it lacks.
  async function open() {
    const tab = (await requireTabs().read([ISSUES_TAB])).get(ISSUES_TAB);
    if (!tab) return requireTabs().create(ISSUES_TAB, ISSUE_HEADERS);
    const headers = tab.headers.some(Boolean) ? [...tab.headers] : [];
    const missing = ISSUE_HEADERS.filter((name) => columnOf(headers, name) === -1);
    if (!missing.length) return tab;
    headers.push(...missing);
    await requireTabs().setHeaders(tab, headers);
    return { ...tab, headers, rows: tab.rows.map((row) => [...row, ...missing.map(() => '')]) };
  }

  const issuesOf = (tab) => tab.rows.map((row, index) => ({ ...toIssue(tab.headers, row), rowNumber: index + 2 })).filter((issue) => issue.id && issue.title);
  const strip = ({ rowNumber, ...issue }) => issue;
  const find = (tab, id) => {
    const issue = issuesOf(tab).find((item) => item.id === id);
    if (!issue) throw new IssueError('That issue was not found. It may have been deleted.', 404);
    return issue;
  };
  // Writes only our columns, so anything staff keep in extra columns stays.
  const write = async (tab, existing, issue) => {
    const row = rowFor(tab.headers, issue);
    const cells = Object.values(FIELDS).map((header) => columnOf(tab.headers, header)).filter((column) => column !== -1)
      .map((column) => ({ rowNumber: existing.rowNumber, column, value: row[column] }));
    await requireTabs().update(tab, cells);
    return issue;
  };

  return {
    async list() {
      const tab = (await requireTabs().read([ISSUES_TAB])).get(ISSUES_TAB);
      return tab ? issuesOf(tab).map(strip) : [];
    },
    add: (input) => queued(async () => {
      const tab = await open();
      const highest = issuesOf(tab).reduce((max, issue) => Math.max(max, Number(issue.id.match(/\d+/)?.[0] || 0)), 0);
      const issue = { ...input, id: `I-${String(highest + 1).padStart(5, '0')}`, reportedAt: centralTimestamp(), status: 'Open', solvedBy: '', solvedAt: '', timeOpen: '', resolution: '' };
      await requireTabs().append(tab, [rowFor(tab.headers, issue)]);
      return issue;
    }),
    solve: (id, input) => queued(async () => {
      const tab = await open();
      const existing = find(tab, id);
      if (existing.status === 'Solved') throw new IssueError('This issue was already marked solved.', 409);
      const solvedAt = centralTimestamp();
      const start = centralToDate(existing.reportedAt);
      const end = centralToDate(solvedAt);
      const timeOpen = start && end ? formatDuration(end - start) : '';
      return write(tab, existing, { ...strip(existing), ...input, status: 'Solved', solvedAt, timeOpen });
    }),
    reopen: (id) => queued(async () => {
      const tab = await open();
      const existing = find(tab, id);
      return write(tab, existing, { ...strip(existing), status: 'Open', solvedBy: '', solvedAt: '', timeOpen: '', resolution: '' });
    }),
    remove: (id) => queued(async () => {
      const tab = await open();
      const existing = find(tab, id);
      await requireTabs().deleteRows(tab, [existing.rowNumber]);
      return strip(existing);
    }),
  };
}
