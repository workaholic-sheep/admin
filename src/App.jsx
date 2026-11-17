import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowDownAZ,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileCheck2,
  FileText,
  CreditCard,
  Eye,
  EyeOff,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { CASE_TYPES, countCaseTypes, isCaseTypeSelected, updateCaseTypeValue } from './case-types.js';

const frequencies = [
  'Once a Month',
  'Twice a Month',
  'Every Other Month',
  'Once a Week',
  'Twice a Week',
  'Every other Week',
];

const CENTRAL_TIME_ZONE = 'America/Chicago';

function centralDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (String(value || '').trim().toLowerCase() === 'done') return 'Done';
  const parsed = dateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(parsed) : '—';
}

function daysUntil(value, today = centralDateKey()) {
  const date = dateValue(value);
  if (!date) return null;
  return Math.round((date - new Date(`${today}T00:00:00`)) / 86400000);
}

function normalizeClientName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function greeting(now) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function Metric({ label, value, note, tone, icon: Icon, featured = false, onClick }) {
  return (
    <button className={`metric metric-${tone} ${featured ? 'metric-featured' : ''}`} type="button" onClick={onClick} aria-label={`${label}: ${value}. ${note}`}>
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={17} strokeWidth={1.8} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </button>
  );
}

function ComingSoon({ title, icon: Icon }) {
  return (
    <section className="coming-soon" aria-labelledby="coming-soon-title">
      <div className="coming-soon-mark"><Icon size={22} /></div>
      <span className="eyebrow">BBeckford Law · Admin Portal</span>
      <h1 id="coming-soon-title">{title}</h1>
      <p>Coming soon</p>
    </section>
  );
}

function Status({ value }) {
  const normalized = String(value || '').toLowerCase();
  const tone = normalized.includes('up to date') || normalized.includes('responsive')
    ? 'positive'
    : normalized.includes('pending') || normalized.includes('unresponsive')
      ? 'caution'
      : 'neutral';
  return <span className={`status status-${tone}`}><i />{value || 'Not set'}</span>;
}

function FilterMenu({ label, value, options, icon: Icon, onChange }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function focusOption(position) {
    const menuItems = rootRef.current?.querySelectorAll('.filter-option');
    menuItems?.[position]?.focus();
  }

  function onTriggerKeyDown(event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    window.requestAnimationFrame(() => {
      const selectedIndex = options.findIndex((option) => option.value === value);
      focusOption(selectedIndex < 0 ? 0 : selectedIndex);
    });
  }

  function onOptionKeyDown(event, index) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption((index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  }

  return (
    <div className="filter-control filter-menu" ref={rootRef}>
      <button
        className="filter-trigger"
        type="button"
        ref={triggerRef}
        aria-label={`${label}: ${selectedOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <Icon size={15} />
        <span>{selectedOption.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && <div className="filter-menu-popover" id={menuId} role="menu" aria-label={label}>
        {options.map((option, index) => <button
          className="filter-option"
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value}
          key={option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onKeyDown={(event) => onOptionKeyDown(event, index)}
        >
          <span>{option.label}</span>
          {option.value === value && <Check size={14} />}
        </button>)}
      </div>}
    </div>
  );
}

function CaseTypePicker({ value, onChange }) {
  const knownTypes = new Set(CASE_TYPES.map((type) => type.toUpperCase()));
  const otherValues = String(value || '').split(/\s*\+\s*/).filter((part) => part && !knownTypes.has(part.toUpperCase()));

  return (
    <fieldset className="case-type-picker field field-wide">
      <legend>Case type</legend>
      <div className="case-type-options">
        {CASE_TYPES.map((caseType) => <label className="case-type-option" key={caseType}>
          <input type="checkbox" checked={isCaseTypeSelected(value, caseType)} onChange={(event) => onChange(updateCaseTypeValue(value, caseType, event.target.checked))} />
          <span>{caseType}</span>
        </label>)}
      </div>
      {otherValues.length > 0 && <span className="field-hint">Other existing value retained: {otherValues.join(' + ')}</span>}
    </fieldset>
  );
}

function ClientForm({ onClose, onCreated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    caseType: '',
    translator: 'No',
    onboardingDate: centralDateKey(),
    frequency: 'Once a Month',
    interviewDate: '',
    lastContactDate: '',
    outcome: '',
    nextContactDate: '',
    lastAttorneyDate: '',
    paymentStatus: 'Pending',
    notes: '',
  });

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to add this client.');
      onCreated(result);
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="drawer intake-drawer" role="dialog" aria-modal="true" aria-labelledby="intake-title">
        <div className="drawer-header">
          <div>
            <span className="eyebrow">NEW RECORD</span>
            <h2 id="intake-title">Client intake</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close intake"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="intake-form">
          <div className="form-section-title"><span>01</span><h3>Client details</h3></div>
          <div className="form-grid">
            <label className="field field-wide">Client name <b>*</b><input autoFocus name="name" value={form.name} onChange={update} required maxLength={120} placeholder="Full name" /></label>
            <label className="field">Email<input name="email" type="email" value={form.email} onChange={update} maxLength={180} placeholder="name@example.com" /></label>
            <label className="field">Phone<input name="phone" value={form.phone} onChange={update} maxLength={40} placeholder="Phone number" /></label>
            <CaseTypePicker value={form.caseType} onChange={(caseType) => setForm((current) => ({ ...current, caseType }))} />
            <label className="field">Meeting frequency<select name="frequency" value={form.frequency} onChange={update}>{frequencies.map((frequency) => <option key={frequency}>{frequency}</option>)}</select><ChevronDown size={15} /></label>
            <label className="field">Translator needed<select name="translator" value={form.translator} onChange={update}><option>No</option><option>Yes</option></select><ChevronDown size={15} /></label>
          </div>

          <div className="form-section-title"><span>02</span><h3>Case follow-up</h3></div>
          <div className="form-grid">
            <label className="field">Date onboarded<input type="date" name="onboardingDate" value={form.onboardingDate} onChange={update} /></label>
            <label className="field">Date of interview<input type="date" name="interviewDate" value={form.interviewDate} onChange={update} /></label>
            <label className="field">Date contacted<input type="date" name="lastContactDate" value={form.lastContactDate} onChange={update} /></label>
            <label className="field">Next contact<input type="date" name="nextContactDate" value={form.nextContactDate} onChange={update} /></label>
            <label className="field">Last date with attorney<input type="date" name="lastAttorneyDate" value={form.lastAttorneyDate} onChange={update} /></label>
            <label className="field">Outcome<select name="outcome" value={form.outcome} onChange={update}><option value="">Choose outcome</option><option>Responsive</option><option>Unresponsive</option></select><ChevronDown size={15} /></label>
            <label className="field">Payment status<select name="paymentStatus" value={form.paymentStatus} onChange={update}><option>Pending</option><option>Up to Date</option></select><ChevronDown size={15} /></label>
            <label className="field field-wide">Notes<textarea name="notes" value={form.notes} onChange={update} rows={3} maxLength={2000} placeholder="Add a note for this client" /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-footer"><span>Saved to MasterData</span><button className="button button-primary" type="submit" disabled={saving}><Plus size={16} />{saving ? 'Saving…' : 'Add client'}</button></div>
        </form>
      </section>
    </div>
  );
}

function editValues(client) {
  return {
    name: client.name || '',
    email: client.email || '',
    phone: client.phone || '',
    caseType: client.caseType || '',
    translator: client.translator || 'No',
    onboardingDate: client.onboardingDate || '',
    frequency: client.frequency || frequencies[0],
    interviewDate: client.interviewDate || '',
    lastContactDate: client.lastContactDate || '',
    outcome: client.outcome || '',
    nextContactDate: client.nextContactDate || '',
    lastAttorneyDate: client.lastAttorneyDate || '',
    paymentStatus: client.paymentStatus || 'Pending',
    notes: client.notes || '',
  };
}

function ClientDetails({ client, courtDates, onClose, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => editValues(client));
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  useEffect(() => {
    if (!editing) setForm(editValues(client));
  }, [client, editing]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await onUpdate(client, form);
      setForm(editValues(updated));
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setError('');
    setForm(editValues(client));
    setEditing(false);
  }

  const frequencyOptions = [...new Set([form.frequency, ...frequencies].filter(Boolean))];
  const outcomeOptions = [...new Set([form.outcome, 'Responsive', 'Unresponsive'].filter(Boolean))];
  const clientCourtDates = courtDates
    .filter((event) => normalizeClientName(event.clientName) === normalizeClientName(client.name))
    .sort((left, right) => left.date.localeCompare(right.date));
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="drawer detail-drawer" role="dialog" aria-modal="true" aria-labelledby="client-name">
        <div className="drawer-header">
          <div><span className="eyebrow">CLIENT RECORD · {client.id || 'NO ID'}</span><h2 id="client-name">{client.name}</h2></div>
          <div className="detail-actions">
            {editing ? <><button className="button button-secondary" type="button" onClick={cancel} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" form="edit-client-form" disabled={saving}><Check size={15} />{saving ? 'Saving…' : 'Save'}</button></> : <button className="button button-secondary" type="button" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
            <button className="icon-button" onClick={onClose} aria-label="Close client details"><X size={18} /></button>
          </div>
        </div>
        {editing ? <form id="edit-client-form" className="edit-client-form" onSubmit={save}>
          <div className="detail-status"><span className="eyebrow">EDIT CLIENT · {client.id}</span></div>
          <div className="form-grid detail-edit-grid">
            <label className="field field-wide">Client name<input name="name" value={form.name} onChange={update} required maxLength={120} /></label>
            <label className="field">Email<input name="email" type="email" value={form.email} onChange={update} maxLength={180} /></label>
            <label className="field">Phone<input name="phone" value={form.phone} onChange={update} maxLength={40} /></label>
            <CaseTypePicker value={form.caseType} onChange={(caseType) => setForm((current) => ({ ...current, caseType }))} />
            <label className="field">Meeting frequency<select name="frequency" value={form.frequency} onChange={update}>{frequencyOptions.map((frequency) => <option key={frequency}>{frequency}</option>)}</select><ChevronDown size={15} /></label>
            <label className="field">Translator needed<select name="translator" value={form.translator} onChange={update}><option>No</option><option>Yes</option></select><ChevronDown size={15} /></label>
            <label className="field">Date onboarded<input type="date" name="onboardingDate" value={form.onboardingDate} onChange={update} /></label>
            <label className="field">Date of interview<input type="date" name="interviewDate" value={form.interviewDate} onChange={update} /></label>
            <label className="field">Date contacted<input type="date" name="lastContactDate" value={form.lastContactDate} onChange={update} /></label>
            <label className="field">Next date of contact<input type={form.nextContactDate.toLowerCase() === 'done' ? 'text' : 'date'} name="nextContactDate" value={form.nextContactDate.toLowerCase() === 'done' ? 'done' : form.nextContactDate} onChange={update} /><span className="field-hint">Enter a date or type done.</span></label>
            <label className="field">Last date with attorney<input type="date" name="lastAttorneyDate" value={form.lastAttorneyDate} onChange={update} /></label>
            <label className="field">Outcome<select name="outcome" value={form.outcome} onChange={update}><option value="">Not set</option>{outcomeOptions.map((outcome) => <option key={outcome}>{outcome}</option>)}</select><ChevronDown size={15} /></label>
            <label className="field">Payment status<select name="paymentStatus" value={form.paymentStatus} onChange={update}><option>Pending</option><option>Up to Date</option></select><ChevronDown size={15} /></label>
            <label className="field field-wide">Notes<textarea name="notes" value={form.notes} onChange={update} rows={4} maxLength={2000} /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
        </form> : <>
          <div className="detail-status"><Status value={client.paymentStatus} /><span className="detail-frequency">{client.frequency || 'Frequency not set'}</span></div>
          <dl className="detail-grid">
            <div><dt>Client ID</dt><dd>{client.id || '—'}</dd></div>
            <div><dt>Email</dt><dd>{client.email || '—'}</dd></div>
            <div><dt>Phone</dt><dd>{client.phone || '—'}</dd></div>
            <div><dt>Translator needed</dt><dd>{client.translator || '—'}</dd></div>
            <div><dt>Date onboarded</dt><dd>{formatDate(client.onboardingDate)}</dd></div>
            <div><dt>Date of interview</dt><dd>{formatDate(client.interviewDate)}</dd></div>
            <div><dt>Date contacted</dt><dd>{formatDate(client.lastContactDate)}</dd></div>
            <div><dt>Outcome</dt><dd>{client.outcome || '—'}</dd></div>
            <div><dt>Next date of contact</dt><dd>{formatDate(client.nextContactDate)}</dd></div>
            <div><dt>Last date with attorney</dt><dd>{formatDate(client.lastAttorneyDate)}</dd></div>
            <div><dt>Payment status</dt><dd>{client.paymentStatus || '—'}</dd></div>
          </dl>
          <section className="detail-court-dates">
            <div className="detail-court-heading"><h3>Court dates</h3><span>{clientCourtDates.length}</span></div>
            {clientCourtDates.length ? <div className="court-date-list">{clientCourtDates.map((event) => <article className="court-date-item" key={event.id}>
              <div className="court-date-main"><CalendarDays size={16} /><div><strong>{formatDate(event.date)}</strong><span>{event.time || 'Time not listed'}{event.status ? ` · ${event.status}` : ''}</span></div></div>
              {event.address && <p>{event.address}</p>}
              {(event.judge || event.country || event.alienNumber) && <small>{[event.judge && `Judge ${event.judge}`, event.country, event.alienNumber && `A# ${event.alienNumber}`].filter(Boolean).join(' · ')}</small>}
              {event.note && <small>{event.note}</small>}
              {event.additionalNote && <small>{event.additionalNote}</small>}
            </article>)}</div> : <p className="court-date-empty">No court dates on file.</p>}
          </section>
          <section className="detail-notes"><h3>Notes</h3><p>{client.notes || 'No notes recorded.'}</p></section>
        </>}
      </section>
    </div>
  );
}

function Dashboard({ clients, courtDates, onShowClients, onShowResults, onSelectClient, onCompleteFollowUp, now }) {
  const today = centralDateKey(now);
  const dueClients = useMemo(() => clients
    .map((client) => ({ ...client, dueIn: daysUntil(client.nextContactDate, today) }))
    .filter((client) => client.dueIn !== null && client.dueIn >= 0)
    .sort((left, right) => left.dueIn - right.dueIn), [clients, today]);
  const dueSoon = dueClients.filter((client) => client.dueIn <= 7).length;
  const pendingPayments = clients.filter((client) => client.paymentStatus.toLowerCase() === 'pending').length;
  const caseTypeCounts = countCaseTypes(clients);
  const nextFollowUp = dueClients.find((client) => client.dueIn >= 0) || null;
  const rosterNames = new Set(clients.map((client) => normalizeClientName(client.name)));
  const nextCourtDate = courtDates
    .filter((event) => rosterNames.has(normalizeClientName(event.clientName)) && event.status.toLowerCase() !== 'done')
    .map((event) => ({ ...event, daysUntil: daysUntil(event.date, today) }))
    .filter((event) => event.daysUntil !== null && event.daysUntil >= 0)
    .sort((left, right) => left.daysUntil - right.daysUntil)[0] || null;
  const nextClients = dueClients.slice(0, 6);
  const [completingId, setCompletingId] = useState('');

  async function complete(client) {
    setCompletingId(client.id);
    await onCompleteFollowUp(client);
    setCompletingId('');
  }

  return (
    <>
      <div className="welcome-row"><div><span className="eyebrow">{new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now).toUpperCase()}</span><h1>{greeting(now)}.</h1><p className="page-subtitle">Here’s the client overview.</p></div><button className="button button-secondary" onClick={onShowClients}>View all clients <ArrowRight size={16} /></button></div>
      <div className="metric-grid">
        <Metric label="Next follow-up" value={nextFollowUp ? formatDate(nextFollowUp.nextContactDate, { month: 'short', day: 'numeric' }) : '—'} note={nextFollowUp?.name || 'No upcoming follow-up'} tone="blue" icon={CalendarClock} featured onClick={() => onShowResults('follow-ups')} />
        <Metric label="Next court date" value={nextCourtDate ? formatDate(nextCourtDate.date, { month: 'short', day: 'numeric' }) : '—'} note={nextCourtDate?.clientName || 'No upcoming court date'} tone="green" icon={CalendarDays} featured onClick={() => onShowResults('court-dates')} />
        <Metric label="Total clients" value={clients.length} note="In MasterData" tone="green" icon={UsersRound} onClick={() => onShowResults('clients')} />
        <Metric label="Upcoming this week" value={dueSoon} note="Scheduled in the next 7 days" tone="amber" icon={CalendarClock} onClick={() => onShowResults('follow-ups-week')} />
        <Metric label="Payments pending" value={pendingPayments} note={`${clients.length ? Math.round((pendingPayments / clients.length) * 100) : 0}% of client roster`} tone="rose" icon={CreditCard} onClick={() => onShowResults('payments')} />
        <Metric label="VAWA" value={caseTypeCounts.VAWA} note="Assigned clients" tone="rose" icon={ShieldCheck} onClick={() => onShowResults('case:VAWA')} />
        <Metric label="I-485" value={caseTypeCounts['I-485']} note="Assigned clients" tone="blue" icon={FileCheck2} onClick={() => onShowResults('case:I-485')} />
        <Metric label="I-589" value={caseTypeCounts['I-589']} note="Assigned clients" tone="amber" icon={FileText} onClick={() => onShowResults('case:I-589')} />
      </div>
      <div className="dashboard-grid">
        <section className="surface followup-surface">
          <div className="section-heading"><div><span className="eyebrow">CLIENT CASE</span><h2>Next follow-ups</h2></div><button className="text-button" onClick={onShowClients}>All clients <ArrowRight size={15} /></button></div>
          {nextClients.length ? <div className="followup-list">{nextClients.map((client) => <div className="followup-row" key={client.id || client.email}><button className="followup-open" onClick={() => onSelectClient(client)}><span className="due-marker"><CalendarClock size={17} /></span><span className="followup-person"><strong>{client.name}</strong><small>{client.email || client.frequency || 'No contact details'}</small></span><span className="due-date">{client.dueIn === 0 ? 'Today' : `In ${client.dueIn}d`}<small>{formatDate(client.nextContactDate, { month: 'short', day: 'numeric' })}</small></span><ArrowRight className="row-arrow" size={15} /></button><button className="followup-done" onClick={() => complete(client)} disabled={completingId === client.id} aria-label={`Mark follow-up done for ${client.name}`}><Check size={14} /><span>{completingId === client.id ? 'Saving…' : 'Done'}</span></button></div>)}</div> : <div className="empty-state"><CalendarClock size={22} /><p>No upcoming follow-ups.</p></div>}
        </section>
      </div>
    </>
  );
}

function CourtDateList({ clients, courtDates, error = '', onSelectClient }) {
  const [when, setWhen] = useState('upcoming');
  const [search, setSearch] = useState('');
  const today = centralDateKey();
  const clientsByName = new Map(clients.map((client) => [normalizeClientName(client.name), client]));
  const events = courtDates
    .map((event) => ({ ...event, client: clientsByName.get(normalizeClientName(event.clientName)), dueIn: daysUntil(event.date, today) }))
    .map((event) => ({ ...event, isUpcoming: event.dueIn !== null && event.dueIn >= 0 && event.status.toLowerCase() !== 'done' }));
  const upcomingCount = events.filter((event) => event.isUpcoming).length;
  const query = search.trim().toLowerCase();
  const visible = events
    .filter((event) => when === 'all' || (when === 'upcoming' ? event.isUpcoming : !event.isUpcoming))
    .filter((event) => !query || [event.clientName, event.address, event.judge, event.alienNumber].some((value) => String(value || '').toLowerCase().includes(query)))
    .sort((left, right) => when === 'upcoming' ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date));
  const open = (event) => event.client && onSelectClient(event.client);
  const empty = error
    ? ['Could not load court dates', error]
    : !courtDates.length
      ? ['No court dates found', 'The court date list is empty or not connected.']
      : ['No matching court dates', when === 'upcoming' ? 'Try “Past” or “All dates”.' : 'Try a different search.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">COURT CALENDAR · {upcomingCount} UPCOMING · {events.length} TOTAL</span><h1>Court dates</h1><p className="page-subtitle">{visible.length} court dates shown</p></div></div>
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, location, judge or A-number" aria-label="Search court dates" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={when} onChange={setWhen} icon={CalendarDays} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past or done' }, { value: 'all', label: 'All dates' }]} />
        </div>
        <div className="table-scroll"><table className="client-table court-results-table"><thead><tr><th>Client</th><th>Court date</th><th>Time</th><th>Location</th><th>Judge</th><th>Status</th></tr></thead><tbody>
          {visible.map((event) => <tr key={event.id} className={event.client ? '' : 'row-static'} onClick={() => open(event)} tabIndex={event.client ? 0 : undefined} onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && open(event)}><td><strong>{event.client?.name || event.clientName}</strong><small>{event.client ? event.client.id : 'Not matched to a client record'}</small></td><td>{formatDate(event.date)}{event.rescheduleDate && <small>Rescheduled</small>}</td><td>{event.time || '—'}</td><td>{event.address || '—'}</td><td>{event.judge || '—'}</td><td>{event.status || '—'}</td></tr>)}
          {!visible.length && <tr><td colSpan="6"><div className="table-empty"><CalendarDays size={22} /><strong>{empty[0]}</strong><span>{empty[1]}</span></div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {events.length} court dates</span><span><i className="sync-dot" /> Synced from court list</span></div>
      </section>
    </>
  );
}

function centralNowInput() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CENTRAL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatResponseTime(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return value || '—';
  const [, year, month, day, hour, minute] = match.map(Number);
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(Date.UTC(year, month - 1, day, hour, minute)))} CT`;
}

const emptyReminder = { name: '', responded: 'No', response: '', respondedAt: '' };

function PaymentReminders({ clients }) {
  const [reminders, setReminders] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyReminder);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const listId = useId();

  useEffect(() => {
    let active = true;
    fetch('/api/payment-reminders')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load payment reminders.');
        if (active) { setReminders(result.reminders || []); setLoadState('ready'); }
      })
      .catch((error) => { if (active) { setLoadError(error.message); setLoadState('error'); } });
    return () => { active = false; };
  }, []);

  function startEdit(reminder) {
    setEditing(reminder ? reminder.id : 'new');
    setForm(reminder ? { ...emptyReminder, ...reminder, respondedAt: reminder.respondedAt.replace(' ', 'T') } : emptyReminder);
    setFormError('');
  }

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'responded' && value === 'Yes' && !current.respondedAt ? { respondedAt: centralNowInput() } : {}),
    }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const isNew = editing === 'new';
      const response = await fetch(isNew ? '/api/payment-reminders' : `/api/payment-reminders/${encodeURIComponent(editing)}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this reminder.');
      setReminders((current) => isNew ? [...current, result.reminder] : current.map((item) => item.id === result.reminder.id ? result.reminder : item));
      setEditing(null);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  const respondedCount = reminders.filter((reminder) => reminder.responded === 'Yes').length;
  const query = search.trim().toLowerCase();
  const visible = reminders
    .filter((reminder) => filter === 'all' || (filter === 'responded' ? reminder.responded === 'Yes' : reminder.responded !== 'Yes'))
    .filter((reminder) => !query || [reminder.name, reminder.response].some((value) => value.toLowerCase().includes(query)));
  const empty = loadState === 'loading' ? ['Loading reminders…', '']
    : loadState === 'error' ? ['Could not load reminders', loadError]
      : !reminders.length ? ['No reminders yet', 'Use “Add name” to log each client you reminded.']
        : ['No matching reminders', 'Try a different search or filter.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">PAYMENT REMINDERS · {reminders.length} REMINDED · {respondedCount} RESPONDED · {reminders.length - respondedCount} WAITING</span><h1>November payment reminders</h1><p className="page-subtitle">Track who answered the November payment reminder.</p></div><button className="button button-primary" onClick={() => startEdit(null)} disabled={loadState !== 'ready'}><Plus size={16} />Add name</button></div>
      {editing && <form className="surface reminder-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field">Name<input name="name" value={form.name} onChange={update} list={listId} maxLength={200} placeholder="Client name" required autoFocus /><datalist id={listId}>{clients.map((client) => <option key={client.id || client.name} value={client.name} />)}</datalist></label>
          <label className="field">Did they respond?<select name="responded" value={form.responded} onChange={update}><option>No</option><option>Yes</option></select><ChevronDown size={15} /></label>
          {form.responded === 'Yes' && <>
            <label className="field field-wide">What they responded<textarea name="response" value={form.response} onChange={update} rows={3} maxLength={2000} placeholder="Their reply" /></label>
            <label className="field">Date and time responded (CT)<input type="datetime-local" name="respondedAt" value={form.respondedAt} onChange={update} /></label>
          </>}
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing === 'new' ? 'Add reminder' : 'Save changes'}</button></div>
      </form>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or response" aria-label="Search payment reminders" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={filter} onChange={setFilter} icon={SlidersHorizontal} options={[{ value: 'all', label: 'Everyone' }, { value: 'responded', label: 'Responded' }, { value: 'waiting', label: 'No response yet' }]} />
        </div>
        <div className="table-scroll"><table className="client-table reminder-table"><thead><tr><th>Name</th><th>Responded</th><th>Response</th><th>Date and time</th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>
          {visible.map((reminder) => <tr key={reminder.id} className="row-static"><td><strong>{reminder.name}</strong></td><td><span className={`status ${reminder.responded === 'Yes' ? 'status-positive' : 'status-caution'}`}><i />{reminder.responded === 'Yes' ? 'Yes' : 'No'}</span></td><td>{reminder.response || <span className="muted">—</span>}</td><td>{reminder.responded === 'Yes' ? formatResponseTime(reminder.respondedAt) : <span className="muted">—</span>}</td><td><button className="icon-button" onClick={() => startEdit(reminder)} aria-label={`Edit reminder for ${reminder.name}`} title="Edit"><Pencil size={14} /></button></td></tr>)}
          {!visible.length && <tr><td colSpan="5"><div className="table-empty"><CreditCard size={22} /><strong>{empty[0]}</strong>{empty[1] && <span>{empty[1]}</span>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {reminders.length} reminders</span><span><i className="sync-dot" /> Saved to PaymentReminders</span></div>
      </section>
    </>
  );
}

function WorkPermitList() {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('All');

  useEffect(() => {
    let active = true;
    fetch('/api/work-permits')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load work permit records.');
        return result;
      })
      .then((result) => {
        if (!active) return;
        setRecords(result.workPermits || []);
        setStatus(result.configured ? 'ready' : 'not-configured');
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message);
        setStatus('error');
      });
    return () => { active = false; };
  }, []);

  const query = search.trim().toLowerCase();
  const visible = records.filter((record) => (section === 'All' || record.section === section)
    && (!query || [record.id, record.name, record.note].some((value) => value.toLowerCase().includes(query))));
  const pendingCount = records.filter((record) => record.section === 'Pending').length;
  const emptyMessage = status === 'loading'
    ? ['Loading work permits…', '']
    : status === 'not-configured'
      ? ['Work permit data is not connected', 'Add BBeckford_WorkPermit_Database.xlsx to the project folder, or set GOOGLE_WORK_PERMIT_SHEET_ID.']
      : status === 'error'
        ? ['Could not load work permits', error]
        : ['No matching records', 'Try a different search or section.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">WORK PERMITS · {records.length} RECORDS · {pendingCount} PENDING</span><h1>Work permit tracker</h1><p className="page-subtitle">{visible.length} records shown</p></div></div>
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, note or ID" aria-label="Search work permits" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Section" value={section} onChange={setSection} icon={SlidersHorizontal} options={[{ value: 'All', label: 'All sections' }, { value: 'Regular', label: 'Regular' }, { value: 'Pending', label: 'Pending' }]} />
        </div>
        <div className="table-scroll"><table className="client-table work-permit-table"><thead><tr><th>ID</th><th>Client</th><th>Note</th><th>Section</th></tr></thead><tbody>
          {visible.map((record) => <tr key={record.id}><td>{record.id}</td><td><strong>{record.name}</strong></td><td>{record.note || <span className="muted">No note</span>}</td><td><span className={`status ${record.section === 'Pending' ? 'status-caution' : 'status-neutral'}`}><i />{record.section || 'Not set'}</span></td></tr>)}
          {!visible.length && <tr><td colSpan="4"><div className="table-empty"><Briefcase size={22} /><strong>{emptyMessage[0]}</strong>{emptyMessage[1] && <span>{emptyMessage[1]}</span>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {records.length} records</span><span><i className="sync-dot" /> Read-only view</span></div>
      </section>
    </>
  );
}

function ClientList({ clients, search, onSearch, onSelectClient, view = 'clients' }) {
  const [frequency, setFrequency] = useState('All frequencies');
  const [payment, setPayment] = useState('All payment statuses');
  const [sortOrder, setSortOrder] = useState('name');
  const today = centralDateKey();
  const caseType = view.startsWith('case:') ? view.slice('case:'.length) : '';
  const titles = {
    clients: 'Client roster',
    payments: 'Payment list',
    'follow-ups': 'Upcoming follow-ups',
    'follow-ups-week': 'Follow-ups this week',
  };
  const title = caseType ? `${caseType} clients` : titles[view] || 'Client roster';
  const visibleClients = clients.filter((client) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query || [client.id, client.name, client.email, client.phone].some((value) => value.toLowerCase().includes(query));
    const matchesFrequency = frequency === 'All frequencies' || client.frequency === frequency;
    const matchesPayment = payment === 'All payment statuses' || client.paymentStatus === payment;
    const matchesCaseType = !caseType || isCaseTypeSelected(client.caseType, caseType);
    const followUpDays = daysUntil(client.nextContactDate, today);
    const matchesFollowUps = view !== 'follow-ups' && view !== 'follow-ups-week' || followUpDays !== null && followUpDays >= 0;
    const matchesWeek = view !== 'follow-ups-week' || followUpDays <= 7;
    const matchesPayments = view !== 'payments' || client.paymentStatus.toLowerCase() === 'pending';
    return matchesQuery && matchesFrequency && matchesPayment && matchesCaseType && matchesFollowUps && matchesWeek && matchesPayments;
  }).sort((left, right) => {
    if (view === 'follow-ups' || view === 'follow-ups-week') return left.nextContactDate.localeCompare(right.nextContactDate);
    if (sortOrder === 'clientId') {
      const leftNumber = Number(left.id.match(/\d+/)?.[0] || 0);
      const rightNumber = Number(right.id.match(/\d+/)?.[0] || 0);
      return leftNumber - rightNumber || left.name.localeCompare(right.name);
    }
    return left.name.localeCompare(right.name);
  });

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">MASTERDATA · {clients.length} RECORDS</span><h1>{title}</h1><p className="page-subtitle">{visibleClients.length} clients shown</p></div></div>
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, email or ID" aria-label="Search clients" />{search && <button className="clear-search" onClick={() => onSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Meeting frequency" value={frequency} onChange={setFrequency} icon={SlidersHorizontal} options={[{ value: 'All frequencies', label: 'All frequencies' }, ...frequencies.map((item) => ({ value: item, label: item }))]} />
          <FilterMenu label="Payment status" value={payment} onChange={setPayment} icon={CreditCard} options={[{ value: 'All payment statuses', label: 'All payment statuses' }, { value: 'Pending', label: 'Pending' }, { value: 'Up to Date', label: 'Up to Date' }]} />
          <FilterMenu label="Sort clients" value={sortOrder} onChange={setSortOrder} icon={ArrowDownAZ} options={[{ value: 'name', label: 'Name A-Z' }, { value: 'clientId', label: 'CL number' }]} />
        </div>
        <div className="table-scroll"><table className="client-table"><thead><tr><th>Client</th><th>Meeting frequency</th><th>Next contact</th><th>Payment</th><th aria-label="Open client" /></tr></thead><tbody>
          {visibleClients.map((client) => <tr key={client.id || client.email} onClick={() => onSelectClient(client)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onSelectClient(client)}><td><div className="client-name-cell"><span className="client-initials">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.id} <i /> {client.email || 'No email'}</small></span></div></td><td>{client.frequency || <span className="muted">Not set</span>}</td><td><span className={daysUntil(client.nextContactDate) < 0 ? 'text-overdue' : ''}>{formatDate(client.nextContactDate)}</span></td><td><Status value={client.paymentStatus} /></td><td><ArrowRight size={15} className="row-arrow" /></td></tr>)}
          {!visibleClients.length && <tr><td colSpan="5"><div className="table-empty"><Search size={22} /><strong>No matching clients</strong><span>Try another name or filter.</span></div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visibleClients.length} of {clients.length}</span><span><i className="sync-dot" /> Synced from MasterData</span></div>
      </section>
    </>
  );
}

function LoginScreen({ onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
      onAuthenticated();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <img className="login-logo" src="/logo.png" alt="Company logo" width="96" height="96" />
        <span className="eyebrow">ADMIN PORTAL</span>
        <h1>BBeckford Law</h1>
        <p>Sign in to your client workspace.</p>
        <form onSubmit={submit}>
          <label className="field">Workspace password<span className="password-input"><input autoFocus type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={15} /></button>
        </form>
      </section>
    </main>
  );
}

function CentralClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const date = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(now);

  return <span className="central-clock"><Clock3 size={15} /><span><b>{date}</b><time>{time}</time></span></span>;
}

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [clients, setClients] = useState([]);
  const [courtDates, setCourtDates] = useState([]);
  const [courtDatesError, setCourtDatesError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataSource, setDataSource] = useState('Excel');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [authStatus, setAuthStatus] = useState('checking');
  const [loginRequired, setLoginRequired] = useState(false);
  const [, setCentralDay] = useState(() => centralDateKey());

  useEffect(() => {
    let active = true;
    fetch('/api/session')
      .then((response) => response.json())
      .then((result) => {
        if (!active) return;
        setLoginRequired(result.loginRequired);
        setAuthStatus(result.authenticated ? 'authenticated' : 'anonymous');
      })
      .catch(() => active && setAuthStatus('anonymous'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const today = centralDateKey();
      setCentralDay((current) => current === today ? current : today);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    let active = true;
    const loadCourtDates = async () => {
      try {
        const response = await fetch('/api/court-dates');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load court dates.');
        if (active) {
          setCourtDates(result.courtDates || []);
          setCourtDatesError('');
        }
      } catch (error) {
        if (active) setCourtDatesError(error.message || 'Could not load court dates.');
      }
    };
    const load = async () => {
      try {
        const response = await fetch('/api/clients');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the client data.');
        if (active) {
          setClients(result.clients);
          setLastUpdated(result.modifiedAt);
          setDataSource(result.source || 'Excel');
          setLoadError('');
        }
      } catch (error) {
        if (active) setLoadError(error.message);
      } finally {
        loadCourtDates();
      }
    };
    load();
    const timer = window.setInterval(load, 20000);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [authStatus]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function refreshWorkbook() {
    setRefreshing(true);
    try {
      const response = await fetch('/api/clients');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not refresh client data.');
      const courtResponse = await fetch('/api/court-dates');
      const courtResult = await courtResponse.json().catch(() => ({}));
      if (courtResponse.ok) {
        setCourtDates(courtResult.courtDates || []);
        setCourtDatesError('');
      } else {
        setCourtDatesError(courtResult.error || 'Could not load court dates.');
      }
      setClients(result.clients);
      setLastUpdated(result.modifiedAt);
      setDataSource(result.source || 'Excel');
      setLoadError('');
      setToast('Client data refreshed');
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function completeFollowUp(client) {
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}/follow-up/done`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not mark this follow-up done.');
      setClients((current) => current.map((item) => item.id === client.id ? result.client : item));
      setLastUpdated(result.modifiedAt);
      setDataSource(result.source || dataSource);
      setLoadError('');
      setToast(`${client.name} follow-up marked done`);
    } catch (error) {
      setLoadError(error.message);
    }
  }

  async function updateClient(client, changes) {
    const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update this client.');
    setClients((current) => current.map((item) => item.id === client.id ? result.client : item));
    setSelectedClient(result.client);
    setLastUpdated(result.modifiedAt);
    setDataSource(result.source || dataSource);
    setToast(`${result.client.name} updated`);
    return result.client;
  }

  function createdClient(result) {
    setClients((current) => [...current, result.client].sort((left, right) => left.name.localeCompare(right.name)));
    setLastUpdated(result.modifiedAt);
    setDataSource(result.source || dataSource);
    setIntakeOpen(false);
    setPage('clients');
    setSearch(result.client.name);
    setToast(`Submitted: ${result.client.name}`);
  }

  function showMetricResults(view) {
    setSearch('');
    setPage(`results:${view}`);
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    setAuthStatus('anonymous');
  }

  const updatedLabel = lastUpdated
    ? `Synced ${new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(lastUpdated))} CT`
    : 'Waiting for data';
  const resultView = page.startsWith('results:') ? page.slice('results:'.length) : '';
  const pageTitle = ({ dashboard: 'Overview', clients: 'Clients', payments: 'Payment', 'court-dates': 'Court Date', 'work-permits': 'Work Permit' })[page]
    || (resultView === 'court-dates' ? 'Court dates' : resultView.startsWith('case:') ? `${resultView.slice('case:'.length)} clients` : ({ payments: 'Payment list', 'follow-ups': 'Upcoming follow-ups', 'follow-ups-week': 'Follow-ups this week', clients: 'Client roster' })[resultView])
    || 'Overview';
  if (authStatus === 'checking') return <main className="login-screen"><img className="login-mark" src="/logo.png" alt="Loading" width="48" height="48" /></main>;
  if (authStatus !== 'authenticated') return <LoginScreen onAuthenticated={() => setAuthStatus('authenticated')} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" onClick={(event) => { event.preventDefault(); setPage('dashboard'); }}><img className="brand-mark" src="/logo.png" alt="" width="36" height="36" /><span className="brand-name">BBeckford Law<span>ADMIN PORTAL</span></span></a>
        <div className="sidebar-section"><span className="nav-caption">WORKSPACE</span><button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => setPage('dashboard')}><LayoutDashboard size={18} /><span>Overview</span></button><button className={`nav-item ${page === 'clients' || (page.startsWith('results:') && page !== 'results:court-dates') ? 'active' : ''}`} onClick={() => setPage('clients')}><UsersRound size={18} /><span>Clients</span><span className="nav-count">{clients.length}</span></button><button className={`nav-item ${page === 'payments' ? 'active' : ''}`} onClick={() => setPage('payments')}><CreditCard size={18} /><span>Payment</span></button><button className={`nav-item ${page === 'court-dates' || page === 'results:court-dates' ? 'active' : ''}`} onClick={() => setPage('court-dates')}><CalendarDays size={18} /><span>Court Date</span></button><button className={`nav-item ${page === 'work-permits' ? 'active' : ''}`} onClick={() => setPage('work-permits')}><Briefcase size={18} /><span>Work Permit</span></button></div>
        <div className="sidebar-bottom"><div className="workbook-chip"><FileSpreadsheet size={17} /><span><b>MasterData</b><small>{dataSource === 'Google Sheets' ? 'Google Sheets' : 'Excel workbook'}</small></span><span className="live-mark" title="Live data connection" /></div><div className="sidebar-user"><span className="user-avatar">CS</span><span><b>Case services</b><small>{loginRequired ? 'Private workspace' : 'Local workspace'}</small></span><Menu size={17} /></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><b>{pageTitle}</b></div><div className="topbar-actions"><CentralClock /><span className="sync-state"><i className="sync-dot" />{updatedLabel}</span><button className={`icon-button refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={refreshWorkbook} aria-label="Refresh client data" title="Refresh data"><RefreshCw size={17} /></button>{loginRequired && <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>}{page !== 'payments' && page !== 'court-dates' && page !== 'work-permits' && <button className="button button-primary top-add" onClick={() => setIntakeOpen(true)}><Plus size={16} />Add client</button>}</div></header>
        <div className="page-content">
          {loadError && <div className="load-error" role="alert"><span>{loadError}</span><button onClick={refreshWorkbook}>Retry <RefreshCw size={14} /></button></div>}
          {page === 'dashboard'
            ? <Dashboard clients={clients} courtDates={courtDates} now={new Date()} onShowClients={() => setPage('clients')} onShowResults={showMetricResults} onSelectClient={setSelectedClient} onCompleteFollowUp={completeFollowUp} />
            : page === 'clients'
              ? <ClientList clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} />
              : page === 'work-permits'
                ? <WorkPermitList />
              : page === 'payments'
                ? <PaymentReminders clients={clients} />
              : page === 'court-dates' || resultView === 'court-dates'
                ? <CourtDateList clients={clients} courtDates={courtDates} error={courtDatesError} onSelectClient={setSelectedClient} />
                : resultView
                  ? <ClientList key={resultView} clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} view={resultView} />
              : <ComingSoon title={page === 'payments' ? 'Payment' : 'Court Date'} icon={page === 'payments' ? CreditCard : CalendarDays} />}
          <footer className="page-footer"><span><i className="sync-dot" /> {dataSource} connection active</span><span>{dataSource === 'Google Sheets' ? 'Sheet checked every 20 seconds' : 'Workbook checked every 20 seconds'}</span></footer>
        </div>
      </main>
      {intakeOpen && <ClientForm onClose={() => setIntakeOpen(false)} onCreated={createdClient} />}
      {selectedClient && <ClientDetails client={selectedClient} courtDates={courtDates} onClose={() => setSelectedClient(null)} onUpdate={updateClient} />}
      {toast && <div className="toast"><span><Check size={15} /></span>{toast}</div>}
    </div>
  );
}
