import { useEffect, useState } from 'react';

function longDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function CountdownRing({ days, unit, fraction, tone }) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(1, Math.max(0, fraction));
  return (
    <svg className={`track-ring tone-${tone}`} viewBox="0 0 200 200" role="img" aria-label={`${days} ${unit}`}>
      <circle className="track-ring-base" cx="100" cy="100" r={radius} />
      <circle className="track-ring-fill" cx="100" cy="100" r={radius} strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 100 100)" />
      <text x="100" y="98" textAnchor="middle" className="track-ring-number">{days}</text>
      <text x="100" y="124" textAnchor="middle" className="track-ring-label">{unit}</text>
    </svg>
  );
}

// Plain-language wording for each stage; staff-only details never reach this page.
function stageView(status) {
  const { stage, countdown, clock } = status;
  const paused = clock?.paused;
  switch (stage) {
    case 'waiting':
      return {
        tone: paused ? 'caution' : 'info',
        ring: { days: countdown.days, unit: 'days to go', fraction: countdown.counted / countdown.of },
        headline: paused ? 'Your asylum clock is paused' : `${countdown.days} days until you can apply for a work permit`,
        body: paused
          ? `The clock stopped on ${longDate(clock.pausedSince)}. Days while it is paused don't count toward the ${status.fileAfterDays} days. Our office will tell you when it restarts.`
          : `You can apply for a work permit once your asylum case reaches ${status.fileAfterDays} days. Estimated date: ${longDate(countdown.date)}.`,
      };
    case 'ready-to-file':
      return {
        tone: 'positive',
        headline: `You've reached ${status.fileAfterDays} days`,
        body: 'You can now apply for a work permit. Our office is preparing your application (Form I-765).',
      };
    case 'filed':
      return countdown
        ? {
          tone: 'info',
          ring: { days: countdown.days, unit: 'days to go', fraction: countdown.counted / countdown.of },
          headline: 'Your work permit application has been filed',
          body: `Filed on ${longDate(status.i765FiledDate)}. USCIS can approve it after day ${status.approveAfterDays} of your asylum case${countdown.date ? `, about ${longDate(countdown.date)}` : ''}.`,
        }
        : {
          tone: 'info',
          headline: 'Waiting for a decision from USCIS',
          body: `Your work permit application was filed on ${longDate(status.i765FiledDate)} and has been pending for ${status.daysPending} days. We'll let you know as soon as there's a decision.`,
        };
    case 'active':
      return countdown
        ? {
          tone: 'positive',
          ring: { days: countdown.days, unit: 'days left', fraction: countdown.days / countdown.of },
          headline: 'Your work permit is active',
          body: `It is valid until ${longDate(countdown.date)}.`,
        }
        : { tone: 'positive', headline: 'Your work permit has been approved', body: 'Our office will confirm the dates on your card.' };
    case 'renewal-due':
      return {
        tone: 'caution',
        ring: { days: countdown.days, unit: 'days left', fraction: countdown.days / countdown.of },
        headline: 'Time to renew your work permit',
        body: `Your work permit expires on ${longDate(countdown.date)}. Renewals no longer extend it automatically, so it's important to file early. Our office will contact you.`,
      };
    case 'expired':
      return {
        tone: 'danger',
        headline: 'Your work permit has expired',
        body: `It expired on ${longDate(status.expiryDate)}. Please contact our office right away.`,
      };
    case 'denied':
      return { tone: 'danger', headline: 'Please contact our office', body: 'We need to speak with you about your work permit application.' };
    default:
      return { tone: 'info', headline: 'Your case is being set up', body: 'Your countdown will appear here once our office records your asylum filing date.' };
  }
}

export default function TrackPage({ token }) {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    document.title = 'Work Permit Tracker';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    let active = true;
    fetch(`/api/track/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'This tracking link is not valid. Please contact our office.');
        if (active) setState({ phase: 'ready', permit: result });
      })
      .catch((error) => { if (active) setState({ phase: 'error', message: error.message }); });
    return () => { active = false; robots.remove(); };
  }, [token]);

  const permit = state.phase === 'ready' ? state.permit : null;
  const details = permit?.status;
  const view = details ? stageView(details) : null;

  return (
    <main className="track-screen">
      <section className="track-card">
        <img className="track-logo" src="/logo.png" alt="Law office logo" width="88" height="88" />
        <span className="eyebrow">WORK PERMIT TRACKER</span>
        {state.phase === 'loading' && <p className="track-muted">Loading your tracker…</p>}
        {state.phase === 'error' && <p className="track-message" role="alert">{state.message}</p>}
        {view && <>
          <h1>{permit.name}</h1>
          {view.ring && <CountdownRing {...view.ring} tone={view.tone} />}
          <p className={`track-status tone-${view.tone}`}>{view.headline}</p>
          <p className="track-message">{view.body}</p>
          <dl className="track-facts">
            {details.filingDate && <div><dt>Asylum application filed</dt><dd>{longDate(details.filingDate)}</dd></div>}
            {details.clock && details.stage !== 'active' && details.stage !== 'renewal-due' && details.stage !== 'expired' && <div><dt>Days on your asylum clock</dt><dd>{details.clock.counted}</dd></div>}
            {details.clock?.pausedDays > 0 && <div><dt>Days paused</dt><dd>{details.clock.pausedDays}</dd></div>}
            {details.i765FiledDate && <div><dt>Work permit application filed</dt><dd>{longDate(details.i765FiledDate)}</dd></div>}
            {details.receiptNumber && <div><dt>USCIS receipt number</dt><dd>{details.receiptNumber}</dd></div>}
            {details.approvedDate && <div><dt>Approved</dt><dd>{longDate(details.approvedDate)}</dd></div>}
            {details.expiryDate && <div><dt>Valid until</dt><dd>{longDate(details.expiryDate)}</dd></div>}
          </dl>
          <p className="track-note">Dates are estimates based on current USCIS rules and can change. Please contact our office with any questions.</p>
        </>}
      </section>
    </main>
  );
}
