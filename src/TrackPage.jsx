import { useEffect, useState } from 'react';

function longDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function ProgressRing({ counted, total, paused }) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(1, counted / total);
  return (
    <svg className={`track-ring ${paused ? 'is-paused' : ''}`} viewBox="0 0 200 200" role="img" aria-label={`${counted} of ${total} days counted`}>
      <circle className="track-ring-base" cx="100" cy="100" r={radius} />
      <circle className="track-ring-fill" cx="100" cy="100" r={radius} strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 100 100)" />
      <text x="100" y="96" textAnchor="middle" className="track-ring-number">{counted}</text>
      <text x="100" y="122" textAnchor="middle" className="track-ring-label">of {total} days</text>
    </svg>
  );
}

export default function TrackPage({ token }) {
  const [state, setState] = useState({ status: 'loading' });

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
        if (active) setState({ status: 'ready', ...result });
      })
      .catch((error) => { if (active) setState({ status: 'error', message: error.message }); });
    return () => { active = false; robots.remove(); };
  }, [token]);

  const progress = state.progress;

  return (
    <main className="track-screen">
      <section className="track-card">
        <img className="track-logo" src="/logo.png" alt="Law office logo" width="88" height="88" />
        <span className="eyebrow">WORK PERMIT TRACKER</span>
        {state.status === 'loading' && <p className="track-muted">Loading your tracker…</p>}
        {state.status === 'error' && <p className="track-message" role="alert">{state.message}</p>}
        {state.status === 'ready' && <>
          <h1>{state.name}</h1>
          {!progress.started
            ? <p className="track-message">Your filing date has not been recorded yet. Your 150-day progress will appear here once it is.</p>
            : <>
              <ProgressRing counted={progress.daysCounted} total={progress.totalDays} paused={progress.paused} />
              <p className={`track-status ${progress.paused ? 'is-paused' : ''} ${progress.complete ? 'is-complete' : ''}`}>
                {progress.complete ? 'Your 150-day waiting period is complete.' : progress.paused ? 'Your clock is currently paused.' : 'Your clock is running.'}
              </p>
              <dl className="track-facts">
                <div><dt>Filed</dt><dd>{longDate(progress.filingDate)}</dd></div>
                <div><dt>Days remaining</dt><dd>{progress.daysRemaining}</dd></div>
                {progress.paused && <div><dt>Paused since</dt><dd>{longDate(progress.pausedSince)}</dd></div>}
                {!progress.paused && !progress.complete && <div><dt>Estimated 150th day</dt><dd>{longDate(progress.estimatedDate)}</dd></div>}
                {progress.pausedDays > 0 && <div><dt>Days paused</dt><dd>{progress.pausedDays}</dd></div>}
              </dl>
              <p className="track-note">Dates are estimates and can change if the clock is paused. Please contact our office with any questions.</p>
            </>}
        </>}
      </section>
    </main>
  );
}
