import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowDownAZ,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  FileCheck2,
  FileText,
  CreditCard,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  GripVertical,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Link2,
  LogOut,
  Menu,
  Moon,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScanText,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import { CASE_TYPES, countCaseTypes, isCaseTypeSelected, updateCaseTypeValue } from './case-types.js';
import { pageFromPath, pathForPage } from './routes.js';
import { scanDocument, warmUpScanner } from './document-scan.js';

const frequencies = [
  'Once a Month',
  'Twice a Month',
  'Every Other Month',
  'Once a Week',
  'Twice a Week',
  'Every other Week',
];

const CENTRAL_TIME_ZONE = 'America/Chicago';

// Extra sidebar tabs. Those without `built: true` show a "Coming soon" page for now.
const EXTRA_TABS = [
  { page: 'pdf', label: 'PDF', icon: FileText },
  { page: 'asylum', label: 'Asylum', icon: Globe },
  { page: 'forms', label: 'Forms', icon: ClipboardList },
  { page: 'credentials', label: 'Credentials', icon: KeyRound, built: true },
];

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141a17' : '#f4f6f3');
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable; theme still applies for this visit */ }
  }, [theme]);
  return [theme, () => setTheme((current) => current === 'dark' ? 'light' : 'dark')];
}

function ThemeToggle({ theme, onToggle, className = 'icon-button' }) {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return <button className={`${className} theme-toggle`} type="button" onClick={onToggle} aria-label={label} title={label}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>;
}

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

function ageFromBirthDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const [todayYear, todayMonth, todayDay] = centralDateKey().split('-').map(Number);
  const age = todayYear - year - (todayMonth < month || (todayMonth === month && todayDay < day) ? 1 : 0);
  return age >= 0 && age < 130 ? String(age) : '';
}

const genders = ['Male', 'Female', 'Other'];

function PersonalFields({ form, onChange, scanned = () => undefined }) {
  const age = ageFromBirthDate(form.dateOfBirth);
  const genderOptions = [...new Set([...genders, form.gender].filter(Boolean))];
  return <>
    <label className="field">Date of birth<input className={scanned('dateOfBirth')} type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={onChange} max={centralDateKey()} />{age && <span className="field-hint">Age {age}</span>}</label>
    <label className="field">Gender<select className={scanned('gender')} name="gender" value={form.gender} onChange={onChange}><option value="">Not set</option>{genderOptions.map((gender) => <option key={gender}>{gender}</option>)}</select><ChevronDown size={15} /></label>
    <label className="field field-wide">Address<input className={scanned('address')} name="address" value={form.address} onChange={onChange} maxLength={300} placeholder="Street, city, state, ZIP" /></label>
  </>;
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
        {CASE_TYPES.map((caseType) => <label className={`case-type-option ${isCaseTypeSelected(value, caseType) ? 'selected' : ''}`} key={caseType}>
          <input type="checkbox" checked={isCaseTypeSelected(value, caseType)} onChange={(event) => onChange(updateCaseTypeValue(value, caseType, event.target.checked))} />
          <span>{caseType}</span>
        </label>)}
      </div>
      {otherValues.length > 0 && <span className="field-hint">Other existing value retained: {otherValues.join(' + ')}</span>}
    </fieldset>
  );
}

function DocumentScanner({ onScanned }) {
  const inputRef = useRef(null);
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [rawText, setRawText] = useState('');

  useEffect(() => warmUpScanner(), []);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function read(file) {
    if (!file || state === 'scanning') return;
    setPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : '');
    setState('scanning');
    setMessage('');
    setRawText('');
    setProgress({ value: 0, label: 'Preparing image' });
    try {
      const result = await scanDocument(file, (value, label) => setProgress({ value, label }));
      setRawText(result.text || '');
      const summary = onScanned(result);
      setState(summary.found ? 'done' : 'empty');
      setMessage(summary.found ? summary.text : 'No details could be read. Try a sharper, well-lit photo taken straight on.');
    } catch (scanError) {
      setState('error');
      setMessage(scanError.message || 'This document could not be read.');
    }
  }

  function choose(event) {
    read(event.target.files?.[0]);
    event.target.value = '';
  }

  function drop(event) {
    event.preventDefault();
    setDragging(false);
    read(event.dataTransfer.files?.[0]);
  }

  const scanning = state === 'scanning';
  const percent = Math.round(progress.value * 100);
  return (
    <div
      className={`document-scan is-${state}${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      {preview ? <img className="document-scan-preview" src={preview} alt="Uploaded document" /> : <span className="document-scan-icon"><ScanText size={20} /></span>}
      <div className="document-scan-body" aria-live="polite">
        <strong>{scanning ? `${progress.label}… ${percent}%` : 'Fill from an ID or document'}</strong>
        {scanning
          ? <span className="clock-bar"><i style={{ width: `${percent}%` }} /></span>
          : <span>{message || "Upload or drop a photo of a driver's license, passport, or EAD card. It is read on this computer and never uploaded."}</span>}
        {!scanning && rawText && <details className="document-scan-text"><summary>Show text read</summary><pre>{rawText}</pre></details>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={choose} />
      <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={scanning}>
        {scanning ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{preview && !scanning ? 'Scan another' : 'Upload'}
      </button>
    </div>
  );
}

function applyScan(current, result) {
  const next = { ...current };
  const filled = [];
  const labels = { name: 'name', email: 'email', phone: 'phone', dateOfBirth: 'date of birth', gender: 'gender', address: 'address' };
  for (const [key, label] of Object.entries(labels)) {
    if (result.fields[key]) {
      next[key] = result.fields[key];
      filled.push({ key, label });
    }
  }
  if (result.details.length) {
    const block = `From scanned ${result.docType}: ${result.details.map(({ label, value }) => `${label} ${value}`).join('; ')}`;
    next.notes = (current.notes.trim() ? `${current.notes.trim()}\n${block}` : block).slice(0, 2000);
  }
  return { next, filled };
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
    dateOfBirth: '',
    gender: '',
    address: '',
  });

  const [scannedFields, setScannedFields] = useState(() => new Set());
  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setScannedFields((current) => {
      if (!current.has(name)) return current;
      const next = new Set(current);
      next.delete(name);
      return next;
    });
  };
  const scanned = (name) => (scannedFields.has(name) ? 'is-scanned' : undefined);

  function fillFromScan(result) {
    const { next, filled } = applyScan(form, result);
    setForm(next);
    const fields = new Set(filled.map((field) => field.key));
    if (result.details.length) fields.add('notes');
    setScannedFields(fields);
    const parts = [];
    if (filled.length) parts.push(`filled ${filled.map((field) => field.label).join(', ')}`);
    if (result.details.length) parts.push(`added ${result.details.map((detail) => detail.label.toLowerCase()).join(', ')} to notes`);
    return { found: parts.length > 0, text: `Read a ${result.docType}: ${parts.join('; ')}. Check each highlighted value before saving.` };
  }

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
          <DocumentScanner onScanned={fillFromScan} />
          <div className="form-section-title"><span>01</span><h3>Client details</h3></div>
          <div className="form-grid">
            <label className="field field-wide"><span>Client name <b>*</b></span><input autoFocus className={scanned('name')} name="name" value={form.name} onChange={update} required maxLength={120} placeholder="Full name" /></label>
            <label className="field">Email<input className={scanned('email')} name="email" type="email" value={form.email} onChange={update} maxLength={180} placeholder="name@example.com" /></label>
            <label className="field">Phone<input className={scanned('phone')} name="phone" value={form.phone} onChange={update} maxLength={40} placeholder="Phone number" /></label>
            <PersonalFields form={form} onChange={update} scanned={scanned} />
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
            <label className="field field-wide">Notes<textarea className={scanned('notes')} name="notes" value={form.notes} onChange={update} rows={3} maxLength={2000} placeholder="Add a note for this client" /></label>
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
    dateOfBirth: client.dateOfBirth || '',
    gender: client.gender || '',
    address: client.address || '',
  };
}

// The client's fields exactly as stored, for saves that change one thing (e.g. case type).
// Unlike editValues, blanks stay blank instead of picking up form defaults.
function unchangedFields(client) {
  return { ...editValues(client), frequency: client.frequency || '', translator: client.translator || '', paymentStatus: client.paymentStatus || '' };
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
            <PersonalFields form={form} onChange={update} />
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
            <div><dt>Date of birth</dt><dd>{formatDate(client.dateOfBirth)}</dd></div>
            <div><dt>Age</dt><dd>{ageFromBirthDate(client.dateOfBirth) || client.age || '—'}</dd></div>
            <div><dt>Gender</dt><dd>{client.gender || '—'}</dd></div>
            <div className="detail-wide"><dt>Address</dt><dd>{client.address || '—'}</dd></div>
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

const emptyReminder = { name: '', email: '', responded: 'No', response: '', respondedAt: '' };

function clientSuggestions(clients, text) {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  const seen = new Set();
  return clients
    .filter((client) => client.name && client.name.toLowerCase().includes(query))
    .filter((client) => {
      const key = `${client.name.toLowerCase()}|${(client.email || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Number(!left.name.toLowerCase().startsWith(query)) - Number(!right.name.toLowerCase().startsWith(query)) || left.name.localeCompare(right.name))
    .slice(0, 8);
}

function NameSuggest({ value, clients, onChange, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const suggestions = clientSuggestions(clients, value);
  const showList = open && suggestions.length > 0;

  function pick(client) {
    onPick(client);
    setOpen(false);
  }

  function keyDown(event) {
    if (!showList) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % suggestions.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + suggestions.length) % suggestions.length); }
    else if (event.key === 'Enter') { event.preventDefault(); pick(suggestions[active]); }
    else if (event.key === 'Escape') setOpen(false);
  }

  return (
    <span className="name-suggest">
      <input
        name="name" value={value} maxLength={200} placeholder="Start typing a client name" required autoFocus autoComplete="off"
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={keyDown}
      />
      {showList && <ul className="suggest-list" id={listId} role="listbox">
        {suggestions.map((client, index) => <li key={`${client.id}-${client.email}`} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); pick(client); }} onMouseEnter={() => setActive(index)}><strong>{client.name}</strong><small>{client.email || 'No email on file'}{client.id ? ` · ${client.id}` : ''}</small></li>)}
      </ul>}
    </span>
  );
}

function PaymentReminders({ clients }) {
  const [reminders, setReminders] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyReminder);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const trackerEmails = useMemo(() => new Map(clients.filter((client) => client.email).map((client) => [normalizeClientName(client.name), client.email])), [clients]);
  const emailFor = (reminder) => reminder.email || trackerEmails.get(normalizeClientName(reminder.name)) || '';

  useEffect(() => {
    let active = true;
    fetch('/api/payment-reminders')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load payment reminders.');
        if (active) { setReminders(result.reminders || []); setNotice(result.notice || ''); setLoadState('ready'); }
      })
      .catch((error) => { if (active) { setLoadError(error.message); setLoadState('error'); } });
    return () => { active = false; };
  }, []);

  function startEdit(reminder) {
    setEditing(reminder ? reminder.id : 'new');
    setForm(reminder ? { ...emptyReminder, ...reminder, email: emailFor(reminder), respondedAt: reminder.respondedAt.replace(' ', 'T') } : emptyReminder);
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
    .filter((reminder) => !query || [reminder.name, emailFor(reminder), reminder.response].some((value) => value.toLowerCase().includes(query)));
  const empty = loadState === 'loading' ? ['Loading reminders…', '']
    : loadState === 'error' ? ['Could not load reminders', loadError]
      : !reminders.length ? [notice ? 'No reminders found' : 'No reminders yet', notice || 'Use “Add name” to log each client you reminded.']
        : ['No matching reminders', 'Try a different search or filter.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">PAYMENT REMINDERS · {reminders.length} REMINDED · {respondedCount} RESPONDED · {reminders.length - respondedCount} WAITING</span><h1>November payment reminders</h1><p className="page-subtitle">Track who answered the November payment reminder.</p></div><button className="button button-primary" onClick={() => startEdit(null)} disabled={loadState !== 'ready'}><Plus size={16} />Add name</button></div>
      {editing && <form className="surface reminder-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field">Name<NameSuggest value={form.name} clients={clients} onChange={(name) => setForm((current) => ({ ...current, name }))} onPick={(client) => setForm((current) => ({ ...current, name: client.name, email: client.email || current.email }))} /></label>
          <label className="field">Email<input type="email" name="email" value={form.email} onChange={update} maxLength={200} placeholder="Filled in when you pick a client" /></label>
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
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or response" aria-label="Search payment reminders" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={filter} onChange={setFilter} icon={SlidersHorizontal} options={[{ value: 'all', label: 'Everyone' }, { value: 'responded', label: 'Responded' }, { value: 'waiting', label: 'No response yet' }]} />
        </div>
        <div className="table-scroll"><table className="client-table reminder-table"><thead><tr><th>Name</th><th>Email</th><th>Responded</th><th>Response</th><th>Date and time</th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>
          {visible.map((reminder) => <tr key={reminder.id} className="row-static"><td><strong>{reminder.name}</strong></td><td>{emailFor(reminder) || <span className="muted">—</span>}{!reminder.email && emailFor(reminder) && <small className="email-source">From client tracker</small>}</td><td><span className={`status ${reminder.responded === 'Yes' ? 'status-positive' : 'status-caution'}`}><i />{reminder.responded === 'Yes' ? 'Yes' : 'No'}</span></td><td>{reminder.response || <span className="muted">—</span>}</td><td>{reminder.responded === 'Yes' ? formatResponseTime(reminder.respondedAt) : <span className="muted">—</span>}</td><td><button className="icon-button" onClick={() => startEdit(reminder)} aria-label={`Edit reminder for ${reminder.name}`} title="Edit"><Pencil size={14} /></button></td></tr>)}
          {!visible.length && <tr><td colSpan="6"><div className="table-empty"><CreditCard size={22} /><strong>{empty[0]}</strong>{empty[1] && <span>{empty[1]}</span>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {reminders.length} reminders</span><span><i className="sync-dot" /> Saved to PaymentReminders</span></div>
      </section>
    </>
  );
}

const STAGE_TONES = {
  'not-started': 'neutral', waiting: 'info', 'ready-to-file': 'caution', filed: 'info',
  active: 'positive', 'renewal-due': 'caution', expired: 'danger', denied: 'danger',
};
const ACTION_STAGES = ['not-started', 'ready-to-file', 'renewal-due', 'expired', 'denied'];
const shortDate = (value) => formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });

function permitDetail(status) {
  const { stage, countdown, clock } = status;
  if (stage === 'not-started') return "Add the Init Asylum Rec'd Date";
  if (stage === 'waiting') return clock?.paused
    ? `${countdown.days} days to file · paused since ${shortDate(clock.pausedSince)}`
    : `${countdown.days} days to file · ${shortDate(countdown.date)}`;
  if (stage === 'ready-to-file') return countdown
    ? `${countdown.days} days until USCIS can approve (day ${status.approveAfterDays})${countdown.date ? ` · ${shortDate(countdown.date)}` : ' · clock paused'}`
    : `Day ${clock?.counted ?? '—'} of the asylum clock · record the decision when it arrives`;
  if (stage === 'active') return countdown ? `${countdown.days} days left · expires ${shortDate(countdown.date)}` : 'Add the card expiry date';
  if (stage === 'renewal-due') return `${countdown.days} days left · file the renewal now`;
  if (stage === 'expired') return `Expired ${shortDate(status.expiryDate)} · not authorized to work`;
  return 'Work permit denied · contact the client';
}

// Mirrors the two EOIR clock lines: "EAD Clock is running / N Days Elapsed" and "Init Asylum Rec'd Date".
function EadClock({ status }) {
  const clock = status?.clock;
  const usDate = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : '—';
  };
  return (
    <dl className={`ead-clock ${clock?.paused ? 'is-stopped' : ''}`}>
      <div><dt>{clock ? `EAD Clock is ${clock.paused ? 'stopped' : 'running'}:` : 'EAD Clock:'}</dt><dd>{clock ? `${clock.counted} Days Elapsed` : 'No Clock'}</dd></div>
      <div><dt>Init Asylum Rec'd Date:</dt><dd>{usDate(status?.filingDate)}</dd></div>
    </dl>
  );
}

function PermitStatus({ status }) {
  if (!status) return <span className="muted">—</span>;
  const { countdown } = status;
  const tone = status.clock?.paused && status.stage === 'waiting' ? 'caution' : STAGE_TONES[status.stage];
  // Clock stages fill as days are counted; validity stages show the time remaining.
  const percent = !countdown ? null
    : countdown.counted !== undefined ? Math.round((countdown.counted / countdown.of) * 100)
      : Math.round((countdown.days / countdown.of) * 100);
  return (
    <span className={`permit-status tone-${tone}`}>
      <span className={`status status-${tone}`}><i />{status.label}</span>
      {percent !== null && <span className="clock-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={status.label}><i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></span>}
      <small>{permitDetail(status)}</small>
    </span>
  );
}

const emptyPermitForm = { name: '', note: '', section: 'Regular', filingDate: '', pausedDays: 0, aNumber: '', decision: 'Pending', approvedDate: '', expiryDate: '' };

function WorkPermitList({ clients = [], onToast }) {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('All');
  const [stageFilter, setStageFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyPermitForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [shared, setShared] = useState(null);

  const replace = (record) => setRecords((current) => current.map((item) => item.id === record.id ? record : item));

  async function send(url, options = {}) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
    return result;
  }

  function startAdd() {
    setEditing('new');
    setForm(emptyPermitForm);
    setFormError('');
  }

  function startEdit(record) {
    setEditing(record.id);
    setForm({
      ...emptyPermitForm,
      ...Object.fromEntries(Object.keys(emptyPermitForm).map((key) => [key, record[key] ?? emptyPermitForm[key]])),
      section: record.section || 'Regular',
    });
    setFormError('');
  }

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const isNew = editing === 'new';
      const body = JSON.stringify({ ...form, pausedDays: Number(form.pausedDays || 0) });
      const result = isNew
        ? await send('/api/work-permits', { method: 'POST', body })
        : await send(`/api/work-permits/${encodeURIComponent(editing)}`, { method: 'PUT', body });
      if (isNew) setRecords((current) => [...current, result.workPermit]);
      else replace(result.workPermit);
      setEditing(null);
      onToast(`${result.workPermit.name} ${isNew ? `added as ${result.workPermit.id}` : 'updated'}`);
    } catch (saveError) {
      setFormError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleClock(record) {
    setBusyId(record.id);
    try {
      const action = record.clockStatus === 'Paused' ? 'resume' : 'pause';
      const result = await send(`/api/work-permits/${encodeURIComponent(record.id)}/${action}`, { method: 'POST' });
      replace(result.workPermit);
      onToast(`${record.name}: clock ${action === 'pause' ? 'paused' : 'resumed'}`);
    } catch (actionError) {
      onToast(actionError.message);
    } finally {
      setBusyId('');
    }
  }

  async function removeRecord(record) {
    if (!window.confirm(`Remove ${record.name} (${record.id}) from work permits? This deletes their row from the spreadsheet and their tracking link will stop working.`)) return;
    setBusyId(record.id);
    try {
      await send(`/api/work-permits/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (editing === record.id) setEditing(null);
      if (shared?.id === record.id) setShared(null);
      onToast(`${record.name} removed from work permits`);
    } catch (removeError) {
      onToast(removeError.message);
    } finally {
      setBusyId('');
    }
  }

  async function copyLink(record) {
    setBusyId(record.id);
    try {
      const result = await send(`/api/work-permits/${encodeURIComponent(record.id)}/link`, { method: 'POST' });
      replace(result.workPermit);
      const url = `${window.location.origin}/track/${result.token}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch { /* Clipboard can be blocked; the link is shown below for manual copying. */ }
      setShared({ id: record.id, name: record.name, url, copied });
      if (copied) onToast(`Tracking link copied for ${record.name}`);
    } catch (linkError) {
      onToast(linkError.message);
    } finally {
      setBusyId('');
    }
  }

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
  const stageOf = (record) => record.status?.stage || 'not-started';
  const matchesStage = (record) => stageFilter === 'all'
    || (stageFilter === 'action' ? ACTION_STAGES.includes(stageOf(record)) : stageOf(record) === stageFilter);
  const visible = records.filter((record) => (section === 'All' || record.section === section) && matchesStage(record)
    && (!query || [record.id, record.name, record.note, record.aNumber || '', (record.aNumber || '').replace(/-/g, '')].some((value) => value.toLowerCase().includes(query))));
  const pendingCount = records.filter((record) => record.section === 'Pending').length;
  // Warns (without blocking) when adding someone who already has a work permit record.
  const duplicate = editing && form.name.trim()
    ? records.find((record) => record.id !== editing && normalizeClientName(record.name) === normalizeClientName(form.name))
    : null;
  const actionCount = records.filter((record) => ACTION_STAGES.includes(stageOf(record))).length;
  const activeCount = records.filter((record) => ['active', 'renewal-due'].includes(stageOf(record))).length;
  const emptyMessage = status === 'loading'
    ? ['Loading work permits…', '']
    : status === 'not-configured'
      ? ['Work permit data is not connected', 'Add BBeckford_WorkPermit_Database.xlsx to the project folder, or set GOOGLE_WORK_PERMIT_SHEET_ID.']
      : status === 'error'
        ? ['Could not load work permits', error]
        : ['No matching records', 'Try a different search or section.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">WORK PERMITS · {records.length} RECORDS · {actionCount} NEED ACTION · {activeCount} WITH WORK PERMIT · {pendingCount} PENDING</span><h1>Work permit tracker</h1><p className="page-subtitle">{visible.length} records shown</p></div><button className="button button-primary" onClick={startAdd} disabled={status !== 'ready'}><Plus size={16} />Add client</button></div>
      {shared && <div className="surface share-panel" role="status">
        <div><strong>{shared.copied ? 'Link copied' : 'Copy this link'} for {shared.name}</strong><span>Anyone with this link can see this client's 150-day progress. Internal notes stay hidden.</span></div>
        <input readOnly value={shared.url} onFocus={(event) => event.target.select()} aria-label={`Tracking link for ${shared.name}`} />
        <button className="icon-button" onClick={() => setShared(null)} aria-label="Close"><X size={15} /></button>
      </div>}
      {editing && <form className="surface reminder-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field">Client name<NameSuggest value={form.name} clients={clients} onChange={(name) => setForm((current) => ({ ...current, name }))} onPick={(client) => setForm((current) => ({ ...current, name: client.name }))} />
            {duplicate && <span className="field-hint">Already in work permits as {duplicate.id}.</span>}</label>
          <label className="field">Section<select name="section" value={form.section} onChange={update}><option>Regular</option><option>Pending</option></select><ChevronDown size={15} /></label>
          <div className="form-section-title field-wide"><span>01</span><h3>Asylum clock</h3></div>
          <label className="field">Init Asylum Rec'd Date (I-589) — starts the EAD clock<input type="date" name="filingDate" value={form.filingDate} onChange={update} /></label>
          <label className="field">Days paused so far<input type="number" name="pausedDays" min="0" max="3650" step="1" value={form.pausedDays} onChange={update} /><span className="field-hint">Applicant-caused delays don't count toward 150/180 days.</span></label>
          <label className="field">A-Number<input name="aNumber" value={form.aNumber} onChange={update} maxLength={14} inputMode="numeric" placeholder="e.g. 245-943-700" /><span className="field-hint">Staff only — never shown on the client's link.</span></label>
          <label className="field field-wide">Internal note (never shown to the client)<textarea name="note" value={form.note} onChange={update} rows={3} maxLength={2000} /></label>
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing === 'new' ? 'Add client' : 'Save changes'}</button></div>
      </form>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, note or ID" aria-label="Search work permits" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Status" value={stageFilter} onChange={setStageFilter} icon={CalendarClock} options={[
            { value: 'all', label: 'All statuses' },
            { value: 'action', label: 'Needs action' },
            { value: 'not-started', label: "Needs Init Asylum Rec'd Date" },
            { value: 'waiting', label: 'Waiting – asylum clock' },
            { value: 'ready-to-file', label: 'Eligible (day 150+)' },
            { value: 'active', label: 'Work permit active' },
            { value: 'renewal-due', label: 'Renewal due' },
            { value: 'expired', label: 'Expired' },
            { value: 'denied', label: 'Denied' },
          ]} />
          <FilterMenu label="Section" value={section} onChange={setSection} icon={SlidersHorizontal} options={[{ value: 'All', label: 'All sections' }, { value: 'Regular', label: 'Regular' }, { value: 'Pending', label: 'Pending' }]} />
        </div>
        {/* One card per client: fits the page width and stacks on narrow screens instead of scrolling sideways. */}
        <ul className="permit-list">
          {visible.map((record) => {
            const paused = record.clockStatus === 'Paused';
            const busy = busyId === record.id;
            return (
              <li key={record.id} className="permit-card">
                <div className="permit-client">
                  <div className="permit-title"><strong>{record.name}</strong><span className={`status ${record.section === 'Pending' ? 'status-caution' : 'status-neutral'}`}><i />{record.section || 'Not set'}</span></div>
                  <small className="permit-meta">{record.id}{record.aNumber && <> · A-Number {record.aNumber}</>}</small>
                  {record.note && <p className="permit-note">{record.note}</p>}
                </div>
                <EadClock status={record.status} />
                <PermitStatus status={record.status} />
                <div className="permit-actions">
                  <button className="button button-secondary" onClick={() => startEdit(record)} aria-label={`Edit ${record.name}`}><Pencil size={14} />Edit</button>
                  <button className={`button button-secondary clock-button ${paused ? 'is-paused' : ''}`} onClick={() => toggleClock(record)} disabled={busy || !record.filingDate || record.decision !== 'Pending'} title={!record.filingDate ? "Add the Init Asylum Rec'd Date first" : record.decision !== 'Pending' ? 'The clock no longer applies after a decision' : ''}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button>
                  <button className="button button-secondary" onClick={() => copyLink(record)} disabled={busy}><Link2 size={14} />Copy link</button>
                  <button className="button button-secondary button-remove" onClick={() => removeRecord(record)} disabled={busy} aria-label={`Remove ${record.name}`}><Trash2 size={14} />Remove</button>
                </div>
              </li>
            );
          })}
          {!visible.length && <li className="permit-empty"><div className="table-empty"><Briefcase size={22} /><strong>{emptyMessage[0]}</strong>{emptyMessage[1] && <span>{emptyMessage[1]}</span>}</div></li>}
        </ul>
        <div className="table-foot"><span>Showing {visible.length} of {records.length} records</span><span><i className="sync-dot" /> Saved to WorkPermits</span></div>
      </section>
    </>
  );
}

const emptyCredential = { website: '', url: '', username: '', password: '', notes: '' };
const REVEAL_SECONDS = 30;

// Strong random password from the browser's secure generator; avoids look-alike characters.
function generatePassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?';
  const limit = 256 - (256 % alphabet.length);
  let password = '';
  while (password.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) if (byte < limit && password.length < length) password += alphabet[byte % alphabet.length];
  }
  return password;
}

function siteHost(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

function CredentialsPage({ onToast }) {
  const [records, setRecords] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyCredential);
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [revealed, setRevealed] = useState({});
  const [busyId, setBusyId] = useState('');
  const [rowError, setRowError] = useState('');
  const hideTimers = useRef({});

  useEffect(() => {
    let active = true;
    fetch('/api/credentials')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load credentials.');
        if (active) { setRecords(result.credentials || []); setLoadState('ready'); }
      })
      .catch((error) => { if (active) { setLoadError(error.message); setLoadState('error'); } });
    const timers = hideTimers.current;
    return () => { active = false; Object.values(timers).forEach(window.clearTimeout); };
  }, []);

  function hide(id) {
    window.clearTimeout(hideTimers.current[id]);
    setRevealed(({ [id]: _removed, ...rest }) => rest);
  }

  async function fetchPassword(record) {
    const response = await fetch(`/api/credentials/${encodeURIComponent(record.id)}/reveal`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not read this password.');
    return result.password;
  }

  async function toggleReveal(record) {
    if (revealed[record.id] !== undefined) return hide(record.id);
    setBusyId(record.id);
    setRowError('');
    try {
      const password = await fetchPassword(record);
      setRevealed((current) => ({ ...current, [record.id]: password }));
      // Shown passwords hide themselves so they aren't left on an unattended screen.
      hideTimers.current[record.id] = window.setTimeout(() => hide(record.id), REVEAL_SECONDS * 1000);
    } catch (error) {
      setRowError(error.message);
    } finally {
      setBusyId('');
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${label} copied`);
    } catch {
      setRowError('Your browser blocked copying. Use Show and copy it by hand.');
    }
  }

  async function copyPassword(record) {
    setBusyId(record.id);
    setRowError('');
    try {
      await copy(revealed[record.id] ?? await fetchPassword(record), `${record.website} password`);
    } catch (error) {
      setRowError(error.message);
    } finally {
      setBusyId('');
    }
  }

  function startEdit(record) {
    setEditing(record ? record.id : 'new');
    setForm(record ? { ...emptyCredential, website: record.website, url: record.url, username: record.username, notes: record.notes } : emptyCredential);
    setShowFormPassword(false);
    setFormError('');
  }

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const isNew = editing === 'new';
      const response = await fetch(isNew ? '/api/credentials' : `/api/credentials/${encodeURIComponent(editing)}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this login.');
      setRecords((current) => isNew ? [...current, result.credential] : current.map((item) => item.id === result.credential.id ? result.credential : item));
      if (!isNew) hide(result.credential.id);
      setEditing(null);
      setForm(emptyCredential);
      onToast(`${result.credential.website} ${isNew ? 'saved' : 'updated'}`);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(record) {
    if (!window.confirm(`Delete the saved login for ${record.website}? This cannot be undone.`)) return;
    setBusyId(record.id);
    setRowError('');
    try {
      const response = await fetch(`/api/credentials/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete this login.');
      hide(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      if (editing === record.id) setEditing(null);
      onToast(`${record.website} deleted`);
    } catch (error) {
      setRowError(error.message);
    } finally {
      setBusyId('');
    }
  }

  const query = search.trim().toLowerCase();
  const visible = records
    .filter((record) => !query || [record.website, record.url, record.username, record.notes].some((value) => value.toLowerCase().includes(query)))
    .sort((left, right) => left.website.localeCompare(right.website));
  const empty = loadState === 'loading' ? ['Loading saved logins…', '']
    : loadState === 'error' ? ['Could not load saved logins', loadError]
      : !records.length ? ['No saved logins yet', 'Use “Add website” to save the first one.']
        : ['No matching logins', 'Try a different search.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">CREDENTIALS · {records.length} SAVED</span><h1>Password manager</h1><p className="page-subtitle">Shared website logins for staff. Passwords are encrypted and only shown when you ask.</p></div><button className="button button-primary" onClick={() => startEdit(null)} disabled={loadState !== 'ready'}><Plus size={16} />Add website</button></div>
      {editing && <form className="surface reminder-form" onSubmit={save} autoComplete="off">
        <div className="form-grid">
          <label className="field"><span>Website name <b>*</b></span><input name="website" value={form.website} onChange={update} maxLength={100} placeholder="e.g. USCIS online account" required autoFocus /></label>
          <label className="field">Website address<input name="url" value={form.url} onChange={update} maxLength={300} placeholder="e.g. myaccount.uscis.gov" inputMode="url" /></label>
          <label className="field">Username or email<input name="username" value={form.username} onChange={update} maxLength={200} autoComplete="off" /></label>
          <label className="field"><span>Password{editing === 'new' && <> <b>*</b></>}</span>
            <span className="password-input credential-password-input">
              <input name="password" type={showFormPassword ? 'text' : 'password'} value={form.password} onChange={update} maxLength={500} autoComplete="new-password" required={editing === 'new'} placeholder={editing === 'new' ? '' : 'Leave blank to keep the current password'} />
              <button className="password-toggle" type="button" onClick={() => setShowFormPassword((shown) => !shown)} aria-label={showFormPassword ? 'Hide password' : 'Show password'} aria-pressed={showFormPassword} title={showFormPassword ? 'Hide password' : 'Show password'}>{showFormPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
            <button className="text-button credential-generate" type="button" onClick={() => { setForm((current) => ({ ...current, password: generatePassword() })); setShowFormPassword(true); }}><RefreshCw size={13} />Generate a strong password</button>
          </label>
          <label className="field field-wide">Notes<textarea name="notes" value={form.notes} onChange={update} rows={2} maxLength={1000} placeholder="Security questions, who owns the account, PIN hints…" /></label>
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing === 'new' ? 'Save login' : 'Save changes'}</button></div>
      </form>}
      {rowError && <div className="load-error" role="alert"><span>{rowError}</span><button onClick={() => setRowError('')}>Dismiss <X size={14} /></button></div>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search website, username or notes" aria-label="Search saved logins" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
        </div>
        <div className="table-scroll"><table className="client-table credential-table"><thead><tr><th>Website</th><th>Username</th><th>Password</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {visible.map((record) => {
            const shown = revealed[record.id];
            const busy = busyId === record.id;
            return <tr key={record.id} className="row-static">
              <td><strong>{record.website}</strong>{record.url && <a className="credential-link" href={record.url} target="_blank" rel="noopener noreferrer">{siteHost(record.url) || record.url}</a>}{record.notes && <small className="credential-notes">{record.notes}</small>}</td>
              <td>{record.username ? <span className="credential-value"><span>{record.username}</span><button className="icon-button" onClick={() => copy(record.username, `${record.website} username`)} aria-label={`Copy username for ${record.website}`} title="Copy username"><Copy size={14} /></button></span> : <span className="muted">—</span>}</td>
              <td>{record.hasPassword ? <span className="credential-value"><code className={shown !== undefined ? 'is-shown' : ''}>{shown !== undefined ? shown : '••••••••••'}</code><button className="icon-button" onClick={() => toggleReveal(record)} disabled={busy} aria-label={`${shown !== undefined ? 'Hide' : 'Show'} password for ${record.website}`} title={shown !== undefined ? 'Hide' : `Show for ${REVEAL_SECONDS} seconds`}>{shown !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}</button><button className="icon-button" onClick={() => copyPassword(record)} disabled={busy} aria-label={`Copy password for ${record.website}`} title="Copy password"><Copy size={14} /></button></span> : <span className="muted">—</span>}</td>
              <td>{record.updatedAt ? formatDate(record.updatedAt.slice(0, 10)) : <span className="muted">—</span>}</td>
              <td><span className="credential-actions"><button className="icon-button" onClick={() => startEdit(record)} disabled={busy} aria-label={`Edit login for ${record.website}`} title="Edit"><Pencil size={14} /></button><button className="icon-button button-remove" onClick={() => remove(record)} disabled={busy} aria-label={`Delete login for ${record.website}`} title="Delete"><Trash2 size={14} /></button></span></td>
            </tr>;
          })}
          {!visible.length && <tr><td colSpan="5"><div className="table-empty"><KeyRound size={22} /><strong>{empty[0]}</strong>{empty[1] && <span>{empty[1]}</span>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {records.length} logins</span><span><ShieldCheck size={13} /> Passwords encrypted at rest</span></div>
      </section>
    </>
  );
}

// Drag-and-drop of client rows onto case types in the sidebar.
const CLIENT_DRAG_TYPE = 'application/x-client-ids';

function clientIdsFromDrag(event) {
  try {
    const ids = JSON.parse(event.dataTransfer.getData(CLIENT_DRAG_TYPE) || '[]');
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

const isClientDrag = (event) => Array.from(event.dataTransfer?.types || []).includes(CLIENT_DRAG_TYPE);

// A small "3 clients" label follows the pointer instead of a picture of the whole table row.
function setDragLabel(event, text) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = text;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 14, 14);
  window.setTimeout(() => ghost.remove(), 0);
}

function CaseTypePills({ value }) {
  const types = CASE_TYPES.filter((type) => isCaseTypeSelected(value, type));
  if (!types.length) return <span className="muted">None</span>;
  return <span className="case-pills">{types.map((type) => <span key={type} className="case-pill">{type}</span>)}</span>;
}

function ClientList({ clients, search, onSearch, onSelectClient, onAssignCaseType, view = 'clients' }) {
  const [selected, setSelected] = useState(() => new Set());
  const [assigning, setAssigning] = useState(false);
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

  const selectable = visibleClients.filter((client) => client.id);
  const allSelected = selectable.length > 0 && selectable.every((client) => selected.has(client.id));
  const toggleOne = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((client) => client.id)));

  async function assign(ids, type, add) {
    if (!type || !ids.length) return;
    setAssigning(true);
    try {
      const ok = await onAssignCaseType(ids, type, add);
      if (ok) setSelected(new Set());
    } finally {
      setAssigning(false);
    }
  }

  function startDrag(event, client) {
    // Dragging a ticked row carries every ticked client; otherwise just this one.
    const ids = selected.has(client.id) ? [...selected] : [client.id];
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(CLIENT_DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', ids.length === 1 ? client.name : `${ids.length} clients`);
    setDragLabel(event, ids.length === 1 ? client.name : `${ids.length} clients`);
  }

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">MASTERDATA · {clients.length} RECORDS</span><h1>{title}</h1><p className="page-subtitle">{visibleClients.length} clients shown</p></div></div>
      {selected.size > 0
        ? <div className="selection-bar surface" role="region" aria-label="Selected clients">
          <strong>{selected.size} selected</strong>
          <FilterMenu label="Add selected clients to a case type" value="" onChange={(type) => assign([...selected], type, true)} icon={Plus} options={[{ value: '', label: assigning ? 'Saving…' : 'Add to…' }, ...CASE_TYPES.map((type) => ({ value: type, label: type }))]} />
          {caseType && <button className="button button-secondary button-remove" type="button" disabled={assigning} onClick={() => assign([...selected], caseType, false)}><X size={14} />Remove from {caseType}</button>}
          <button className="text-button" type="button" onClick={() => setSelected(new Set())}>Clear selection</button>
          <span className="selection-hint">or drag them onto a case type in the sidebar</span>
        </div>
        : <p className="drag-hint"><GripVertical size={14} />Tip: drag a client onto a case type in the sidebar, or tick several and drag them together.</p>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, email or ID" aria-label="Search clients" />{search && <button className="clear-search" onClick={() => onSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Meeting frequency" value={frequency} onChange={setFrequency} icon={SlidersHorizontal} options={[{ value: 'All frequencies', label: 'All frequencies' }, ...frequencies.map((item) => ({ value: item, label: item }))]} />
          <FilterMenu label="Payment status" value={payment} onChange={setPayment} icon={CreditCard} options={[{ value: 'All payment statuses', label: 'All payment statuses' }, { value: 'Pending', label: 'Pending' }, { value: 'Up to Date', label: 'Up to Date' }]} />
          <FilterMenu label="Sort clients" value={sortOrder} onChange={setSortOrder} icon={ArrowDownAZ} options={[{ value: 'name', label: 'Name A-Z' }, { value: 'clientId', label: 'CL number' }]} />
        </div>
        <div className="table-scroll"><table className="client-table client-roster-table"><thead><tr><th className="select-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!selectable.length} aria-label="Select all shown clients" /></th><th>Client</th><th>Case type</th><th>Meeting frequency</th><th>Next contact</th><th>Payment</th><th aria-label="Open client" /></tr></thead><tbody>
          {visibleClients.map((client) => <tr key={client.id || client.email} className={selected.has(client.id) ? 'is-selected' : ''} draggable={Boolean(client.id)} onDragStart={(event) => startDrag(event, client)} onClick={() => onSelectClient(client)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && event.target === event.currentTarget && onSelectClient(client)}><td className="select-cell" onClick={(event) => event.stopPropagation()}><GripVertical size={14} className="drag-grip" aria-hidden="true" /><input type="checkbox" checked={selected.has(client.id)} onChange={() => toggleOne(client.id)} disabled={!client.id} aria-label={`Select ${client.name}`} /></td><td><div className="client-name-cell"><span className="client-initials">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.id} <i /> {client.email || 'No email'}</small></span></div></td><td><CaseTypePills value={client.caseType} /></td><td>{client.frequency || <span className="muted">Not set</span>}</td><td><span className={daysUntil(client.nextContactDate) < 0 ? 'text-overdue' : ''}>{formatDate(client.nextContactDate)}</span></td><td><Status value={client.paymentStatus} /></td><td><ArrowRight size={15} className="row-arrow" /></td></tr>)}
          {!visibleClients.length && <tr><td colSpan="7"><div className="table-empty"><Search size={22} /><strong>No matching clients</strong><span>Try another name or filter.</span></div></td></tr>}
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
  const [page, setPageState] = useState(() => pageFromPath(window.location.pathname));
  const [theme, toggleTheme] = useTheme();
  const [clientsOpen, setClientsOpen] = useState(() => {
    try { return localStorage.getItem('nav-clients-open') !== 'false'; } catch { return true; }
  });
  const [dropTarget, setDropTarget] = useState('');
  useEffect(() => {
    try { localStorage.setItem('nav-clients-open', String(clientsOpen)); } catch { /* remembered for this visit only */ }
  }, [clientsOpen]);
  useEffect(() => {
    // A drag cancelled or dropped elsewhere still clears the sidebar highlight.
    const clear = () => setDropTarget('');
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, []);

  // Each tab has its own address, so refresh, bookmarks and Back/Forward all work.
  const setPage = (next) => {
    const path = pathForPage(next);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setPageState(pageFromPath(path));
  };

  useEffect(() => {
    const canonical = pathForPage(pageFromPath(window.location.pathname));
    if (window.location.pathname !== canonical) window.history.replaceState(null, '', canonical);
    const onPopState = () => setPageState(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
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

  // Adds or removes one case type for several clients. The table updates at once;
  // any client the sheet refuses is put back and the error is shown.
  async function assignCaseType(ids, caseType, add) {
    const changing = clients.filter((client) => ids.includes(client.id) && isCaseTypeSelected(client.caseType, caseType) !== add);
    if (!changing.length) {
      setToast(ids.length === 1 ? `Already ${add ? 'in' : 'not in'} ${caseType}` : `All ${ids.length} are already ${add ? 'in' : 'out of'} ${caseType}`);
      return true;
    }
    const nextValue = new Map(changing.map((client) => [client.id, updateCaseTypeValue(client.caseType, caseType, add)]));
    setClients((current) => current.map((client) => nextValue.has(client.id) ? { ...client, caseType: nextValue.get(client.id) } : client));
    const failed = [];
    const saved = [];
    for (const client of changing) {
      try {
        const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...unchangedFields(client), caseType: nextValue.get(client.id) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not update this client.');
        setClients((current) => current.map((item) => item.id === client.id ? result.client : item));
        setLastUpdated(result.modifiedAt);
        saved.push(client.name);
      } catch (error) {
        failed.push(`${client.name}: ${error.message}`);
        setClients((current) => current.map((item) => item.id === client.id ? { ...item, caseType: client.caseType } : item));
      }
    }
    if (saved.length) {
      const who = saved.length === 1 ? saved[0] : `${saved.length} clients`;
      setToast(add ? `Added ${who} to ${caseType}` : `Removed ${who} from ${caseType}`);
    }
    if (failed.length) setLoadError(`Could not update ${failed.length === 1 ? 'a client' : `${failed.length} clients`}. ${failed.join(' · ')}`);
    return !failed.length;
  }

  function dropOnCaseType(event, caseType) {
    event.preventDefault();
    setDropTarget('');
    const ids = clientIdsFromDrag(event);
    if (ids.length) assignCaseType(ids, caseType, true);
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
  const caseCounts = countCaseTypes(clients);
  const inClientsSection = page === 'clients' || (page.startsWith('results:') && page !== 'results:court-dates');
  const extraTab = EXTRA_TABS.find((tab) => tab.page === page);
  const showAddClient = page === 'dashboard' || page === 'clients' || Boolean(resultView);
  const pageTitle = ({ dashboard: 'Overview', clients: 'Clients', payments: 'Payment', 'court-dates': 'Court Date', 'work-permits': 'Work Permit' })[page] || extraTab?.label
    || (resultView === 'court-dates' ? 'Court dates' : resultView.startsWith('case:') ? `${resultView.slice('case:'.length)} clients` : ({ payments: 'Payment list', 'follow-ups': 'Upcoming follow-ups', 'follow-ups-week': 'Follow-ups this week', clients: 'Client roster' })[resultView])
    || 'Overview';
  if (authStatus === 'checking') return <main className="login-screen"><img className="login-mark" src="/logo.png" alt="Loading" width="48" height="48" /></main>;
  if (authStatus !== 'authenticated') return <LoginScreen onAuthenticated={() => setAuthStatus('authenticated')} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setPage('dashboard'); }}><img className="brand-mark" src="/logo.png" alt="" width="36" height="36" /><span className="brand-name">BBeckford Law<span>ADMIN PORTAL</span></span></a>
        <div className="sidebar-section"><span className="nav-caption">WORKSPACE</span><button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => setPage('dashboard')}><LayoutDashboard size={18} /><span>Overview</span></button><div className="nav-group">
          <div className="nav-group-head">
            <button className={`nav-item ${inClientsSection && !clientsOpen ? 'active' : ''} ${inClientsSection ? 'is-current' : ''}`} onClick={() => { setPage('clients'); setClientsOpen(true); }} onDragOver={(event) => { if (isClientDrag(event)) setClientsOpen(true); }}><UsersRound size={18} /><span>Clients</span><span className="nav-count">{clients.length}</span></button>
            <button className="nav-toggle" type="button" onClick={() => setClientsOpen((open) => !open)} aria-expanded={clientsOpen} aria-controls="nav-client-types" aria-label={clientsOpen ? 'Collapse client case types' : 'Expand client case types'} title={clientsOpen ? 'Collapse' : 'Expand'}>{clientsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
          </div>
          {clientsOpen && <div className="nav-children" id="nav-client-types">
            <button className={`nav-child ${page === 'clients' ? 'active' : ''}`} onClick={() => setPage('clients')}><span>All Clients</span><span className="nav-count">{clients.length}</span></button>
            {CASE_TYPES.map((type) => <button
              key={type}
              className={`nav-child ${page === `results:case:${type}` ? 'active' : ''} ${dropTarget === type ? 'is-drop-target' : ''}`}
              onClick={() => { setSearch(''); setPage(`results:case:${type}`); }}
              onDragOver={(event) => { if (!isClientDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (dropTarget !== type) setDropTarget(type); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current === type ? '' : current); }}
              onDrop={(event) => dropOnCaseType(event, type)}
              title={`Show ${type} clients, or drop clients here to add them to ${type}`}
            ><span>{type}</span><span className="nav-count">{caseCounts[type]}</span></button>)}
          </div>}
        </div><button className={`nav-item ${page === 'payments' ? 'active' : ''}`} onClick={() => setPage('payments')}><CreditCard size={18} /><span>Payment</span></button><button className={`nav-item ${page === 'court-dates' || page === 'results:court-dates' ? 'active' : ''}`} onClick={() => setPage('court-dates')}><CalendarDays size={18} /><span>Court Date</span></button><button className={`nav-item ${page === 'work-permits' ? 'active' : ''}`} onClick={() => setPage('work-permits')}><Briefcase size={18} /><span>Work Permit</span></button>{EXTRA_TABS.map(({ page: tabPage, label, icon: Icon }) => <button key={tabPage} className={`nav-item ${page === tabPage ? 'active' : ''}`} onClick={() => setPage(tabPage)}><Icon size={18} /><span>{label}</span></button>)}</div>
        <div className="sidebar-bottom"><div className="workbook-chip"><FileSpreadsheet size={17} /><span><b>MasterData</b><small>{dataSource === 'Google Sheets' ? 'Google Sheets' : 'Excel workbook'}</small></span><span className="live-mark" title="Live data connection" /></div><div className="sidebar-user"><span className="user-avatar">CS</span><span><b>Case services</b><small>{loginRequired ? 'Private workspace' : 'Local workspace'}</small></span><Menu size={17} /></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><b>{pageTitle}</b></div><div className="topbar-actions"><CentralClock /><span className="sync-state"><i className="sync-dot" />{updatedLabel}</span><button className={`icon-button refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={refreshWorkbook} aria-label="Refresh client data" title="Refresh data"><RefreshCw size={17} /></button><ThemeToggle theme={theme} onToggle={toggleTheme} />{loginRequired && <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>}{showAddClient && <button className="button button-primary top-add" onClick={() => setIntakeOpen(true)}><Plus size={16} />Add client</button>}</div></header>
        <div className="page-content">
          {loadError && <div className="load-error" role="alert"><span>{loadError}</span><button onClick={refreshWorkbook}>Retry <RefreshCw size={14} /></button></div>}
          {page === 'dashboard'
            ? <Dashboard clients={clients} courtDates={courtDates} now={new Date()} onShowClients={() => setPage('clients')} onShowResults={showMetricResults} onSelectClient={setSelectedClient} onCompleteFollowUp={completeFollowUp} />
            : page === 'clients'
              ? <ClientList clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} onAssignCaseType={assignCaseType} />
              : page === 'work-permits'
                ? <WorkPermitList clients={clients} onToast={setToast} />
              : page === 'payments'
                ? <PaymentReminders clients={clients} />
              : page === 'court-dates' || resultView === 'court-dates'
                ? <CourtDateList clients={clients} courtDates={courtDates} error={courtDatesError} onSelectClient={setSelectedClient} />
                : resultView
                  ? <ClientList key={resultView} clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} onAssignCaseType={assignCaseType} view={resultView} />
              : page === 'credentials'
                ? <CredentialsPage onToast={setToast} />
              : extraTab
                ? <ComingSoon key={extraTab.page} title={extraTab.label} icon={extraTab.icon} />
              : <Dashboard clients={clients} courtDates={courtDates} now={new Date()} onShowClients={() => setPage('clients')} onShowResults={showMetricResults} onSelectClient={setSelectedClient} onCompleteFollowUp={completeFollowUp} />}
          <footer className="page-footer"><span><i className="sync-dot" /> {dataSource} connection active</span><span>{dataSource === 'Google Sheets' ? 'Sheet checked every 20 seconds' : 'Workbook checked every 20 seconds'}</span></footer>
        </div>
      </main>
      {intakeOpen && <ClientForm onClose={() => setIntakeOpen(false)} onCreated={createdClient} />}
      {selectedClient && <ClientDetails client={selectedClient} courtDates={courtDates} onClose={() => setSelectedClient(null)} onUpdate={updateClient} />}
      {toast && <div className="toast"><span><Check size={15} /></span>{toast}</div>}
    </div>
  );
}
