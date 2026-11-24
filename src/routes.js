import { CASE_TYPES } from './case-types.js';

// Address for each admin tab. Filtered client lists live under /clients/<view>.
export const PAGE_PATHS = { dashboard: '/', clients: '/clients', payments: '/payment', 'court-dates': '/courtdate', 'work-permits': '/workpermit', schedule: '/schedule', pdf: '/pdf', forms: '/forms', credentials: '/credentials', 'issues-tech': '/issues/tech', 'issues-other': '/issues/other' };
const RESULT_VIEWS = ['clients', 'follow-ups', 'follow-ups-week', 'payments'];

export function pathForPage(page) {
  if (PAGE_PATHS[page]) return PAGE_PATHS[page];
  const view = page.startsWith('results:') ? page.slice('results:'.length) : '';
  if (view === 'court-dates') return PAGE_PATHS['court-dates'];
  if (view === 'clients') return PAGE_PATHS.clients;
  if (view.startsWith('case:')) return `/clients/${encodeURIComponent(view.slice('case:'.length))}`;
  if (RESULT_VIEWS.includes(view)) return `/clients/${view}`;
  return '/';
}

export function pageFromPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const page = Object.keys(PAGE_PATHS).find((key) => PAGE_PATHS[key].toLowerCase() === path.toLowerCase());
  if (page) return page;
  const match = path.match(/^\/clients\/([^/]+)$/i);
  if (!match) return 'dashboard';
  let segment;
  try { segment = decodeURIComponent(match[1]); } catch { return 'clients'; }
  if (RESULT_VIEWS.includes(segment)) return `results:${segment}`;
  const caseType = CASE_TYPES.find((type) => type.toLowerCase() === segment.toLowerCase());
  return caseType ? `results:case:${caseType}` : 'clients';
}
