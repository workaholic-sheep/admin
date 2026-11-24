import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
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
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GripVertical,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Link2,
  LogOut,
  MapPin,
  Menu,
  MessageSquareText,
  Moon,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UsersRound,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { CASE_TYPES, NEW_CLIENT_TYPE, acceptsExistingClients, countCaseTypes,isCaseTypeSelected, updateCaseTypeValue } from './case-types.js';
import { pageFromPath, pathForPage } from './routes.js';
import { readImageText, scanDocument, warmUpScanner } from './document-scan.js';
import { applyEoirScan, eoirScanFound, parseEoirText } from './eoir-scan.js';
import { SCHEDULE_ADDED_BY, TEAM_MEMBERS } from './team.js';
import { splitName } from './names.js';
import { CASE_STATUSES, caseStatusTone } from './case-status.js';
import { SCHEDULE_MODES, SCHEDULE_STATUSES, timeTo24h } from './schedule.js';
import { centralToDate, formatDuration, issueDuration } from './issues.js';

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
  { page: 'forms', label: 'Forms', icon: ClipboardList },
  { page: 'credentials', label: 'Credentials', icon: KeyRound, built: true },
];

// Pages under the Issues group in the sidebar; each lists one category from the Issues tab.
const ISSUE_TABS = [
  { page: 'issues-tech', label: 'Tech Issues', category: 'Tech' },
  { page: 'issues-other', label: 'Other Issues', category: 'Other' },
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
    <label className="field field-wide">Current address<input name="currentAddress" value={form.currentAddress} onChange={onChange} maxLength={300} placeholder="Only if different from the address above" /></label>
  </>;
}

// MasterData stores the name in three columns, so the forms ask for each part.
function NameFields({ form, onChange, scanned = () => undefined, autoFocus = false }) {
  return <>
    <label className="field"><span>First name <b>*</b></span><input autoFocus={autoFocus} className={scanned('firstName')} name="firstName" value={form.firstName} onChange={onChange} required maxLength={60} /></label>
    <label className="field">Middle name<input className={scanned('middleName')} name="middleName" value={form.middleName} onChange={onChange} maxLength={60} /></label>
    <label className="field">Last name<input className={scanned('lastName')} name="lastName" value={form.lastName} onChange={onChange} maxLength={60} /></label>
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

// Combines two OCR readings of an EOIR screenshot, keeping the first value found for each field.
function mergeEoirScans(scans) {
  const [first, ...rest] = scans;
  const fields = { ...first.fields };
  for (const scan of rest) {
    for (const [key, value] of Object.entries(scan.fields)) if ((fields[key] === '' || fields[key] === null) && value !== '' && value !== null) fields[key] = value;
  }
  const events = scans.map((scan) => scan.events).sort((left, right) => right.length - left.length)[0];
  return { fields, events };
}

// Reads an EOIR "Asylum EAD Clock Information" screenshot: paste it (Ctrl+V) anywhere on the
// Work Permit page, drop it here, or upload it. It is read on this computer and never uploaded.
function EoirScanner({ onScanned }) {
  const inputRef = useRef(null);
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [rawText, setRawText] = useState('');
  const busy = useRef(false);

  useEffect(() => warmUpScanner(), []);

  async function read(file) {
    if (!file || busy.current) return;
    busy.current = true;
    setState('scanning');
    setMessage('');
    setRawText('');
    setProgress({ value: 0, label: 'Preparing image' });
    try {
      const texts = await readImageText(file, {
        onProgress: (value, label) => setProgress({ value, label }),
        isComplete: (text) => {
          const { fields } = parseEoirText(text);
          return Boolean(fields.aNumber && fields.name && fields.filingDate && fields.asOf && fields.clockDays !== null);
        },
      });
      setRawText(texts.join('\n\n----- second reading -----\n\n'));
      const scan = mergeEoirScans(texts.map(parseEoirText));
      if (!eoirScanFound(scan)) {
        setState('empty');
        setMessage('This doesn’t look like the EOIR Asylum EAD Clock screen. Capture the whole window, including the A-Number, Name and Init Asylum Rec’d Date.');
        return;
      }
      setState('done');
      setMessage(onScanned(scan));
    } catch (scanError) {
      setState('error');
      setMessage(scanError.message || 'This screenshot could not be read.');
    } finally {
      busy.current = false;
    }
  }

  // Ctrl+V of a screenshot anywhere on the page; text pastes into fields are left alone.
  useEffect(() => {
    const onPaste = (event) => {
      const item = [...(event.clipboardData?.items || [])].find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
      if (!item) return;
      event.preventDefault();
      read(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const scanning = state === 'scanning';
  const percent = Math.round(progress.value * 100);
  return (
    <div
      className={`document-scan eoir-scan is-${state}${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); read(event.dataTransfer.files?.[0]); }}
    >
      <span className="document-scan-icon"><ScanText size={20} /></span>
      <div className="document-scan-body" aria-live="polite">
        <strong>{scanning ? `${progress.label}… ${percent}%` : 'Add or update from an EOIR screenshot'}</strong>
        {scanning
          ? <span className="clock-bar"><i style={{ width: `${percent}%` }} /></span>
          : <span>{message || <>Paste a screenshot of the <b>EOIR Asylum EAD Clock Information</b> window with <kbd>Ctrl</kbd>+<kbd>V</kbd>, drop it here, or upload it. It is read on this computer and never uploaded.</>}</span>}
        {!scanning && rawText && <details className="document-scan-text"><summary>Show text read</summary><pre>{rawText}</pre></details>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => { read(event.target.files?.[0]); event.target.value = ''; }} />
      <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={scanning}>
        {scanning ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{state === 'idle' ? 'Upload' : 'Scan another'}
      </button>
    </div>
  );
}

function applyScan(current, result) {
  const next = { ...current };
  const filled = [];
  // A scanned ID gives one full name; split it into the three name fields for staff to check.
  if (result.fields.name) {
    const parts = splitName(result.fields.name);
    [['firstName', parts.first], ['middleName', parts.middle], ['lastName', parts.last]].forEach(([key, value]) => {
      next[key] = value;
      if (value) filled.push({ key, label: 'name' });
    });
  }
  const labels = { email: 'email', phone: 'phone', dateOfBirth: 'date of birth', gender: 'gender', address: 'address' };
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

// The full client intake, or (potential) a short form for a prospective client that goes
// straight into Onboarding.
function ClientForm({ onClose, onCreated, potential = false }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    caseType: NEW_CLIENT_TYPE,
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
    currentAddress: '',
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
    if (filled.length) parts.push(`filled ${[...new Set(filled.map((field) => field.label))].join(', ')}`);
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
        body: JSON.stringify(potential ? { ...form, caseType: NEW_CLIENT_TYPE } : form),
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
            <span className="eyebrow">{potential ? 'ONBOARDING' : 'NEW RECORD'}</span>
            <h2 id="intake-title">{potential ? 'Potential client' : 'Client intake'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close intake"><X size={18} /></button>
        </div>
        {potential ? <form onSubmit={submit} className="intake-form">
          <div className="form-section-title"><span>01</span><h3>Contact</h3></div>
          <div className="form-grid">
            <NameFields form={form} onChange={update} scanned={scanned} autoFocus />
            <label className="field">Email<input name="email" type="email" value={form.email} onChange={update} maxLength={180} placeholder="name@example.com" /></label>
            <label className="field">Phone<input name="phone" value={form.phone} onChange={update} maxLength={40} placeholder="Phone number" /></label>
            <label className="field">Translator needed<select name="translator" value={form.translator} onChange={update}><option>No</option><option>Yes</option></select><ChevronDown size={15} /></label>
          </div>
          <div className="form-section-title"><span>02</span><h3>Follow-up</h3></div>
          <div className="form-grid">
            <label className="field">Date contacted<input type="date" name="lastContactDate" value={form.lastContactDate} onChange={update} /></label>
            <label className="field">Next contact<input type="date" name="nextContactDate" value={form.nextContactDate} onChange={update} /></label>
            <label className="field field-wide">Notes<textarea name="notes" value={form.notes} onChange={update} rows={4} maxLength={2000} placeholder="What they need, how they found us, consultation details…" /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-footer"><span>Saved to MasterData and added to Onboarding</span><button className="button button-primary" type="submit" disabled={saving}><UserPlus size={16} />{saving ? 'Saving…' : 'Add potential client'}</button></div>
        </form>
        : <form onSubmit={submit} className="intake-form">
          <DocumentScanner onScanned={fillFromScan} />
          <div className="form-section-title"><span>01</span><h3>Client details</h3></div>
          <div className="form-grid">
            <NameFields form={form} onChange={update} scanned={scanned} autoFocus />
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
        </form>}
      </section>
    </div>
  );
}

function editValues(client) {
  return {
    firstName: client.firstName || '',
    middleName: client.middleName || '',
    lastName: client.lastName || '',
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
    currentAddress: client.currentAddress || '',
  };
}

function ClientDetails({ client, courtDates, onClose, onUpdate, onDelete, onSetTeamMember, onSetCaseStatus, onNoteAdded }) {
  const clientCaseTypes = CASE_TYPES.filter((type) => isCaseTypeSelected(client.caseType, type));
  const [notes, setNotes] = useState([]);
  const [notesState, setNotesState] = useState('loading');
  const hasCases = clientCaseTypes.length > 0;
  useEffect(() => {
    if (!hasCases || !client.id) return undefined;
    let active = true;
    setNotesState('loading');
    fetch(`/api/case-notes?clientId=${encodeURIComponent(client.id)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load notes.');
        if (active) { setNotes(result.notes || []); setNotesState('ready'); }
      })
      .catch((error) => { if (active) setNotesState(error.message); });
    return () => { active = false; };
  }, [client.id, hasCases]);
  const addNote = (note) => {
    setNotes((current) => [note, ...current]);
    onNoteAdded(note);
  };
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deletedBy, setDeletedBy] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const nameConfirmed = confirmName.trim().toLowerCase().replace(/\s+/g, ' ') === client.name.trim().toLowerCase().replace(/\s+/g, ' ');

  async function confirmDelete(event) {
    event.preventDefault();
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await onDelete(client, { confirmName, deletedBy });
    } catch (deleteFailure) {
      setDeleteError(deleteFailure.message);
      setDeleteBusy(false);
    }
  }
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
    .filter((event) => (event.clientId && client.id ? event.clientId === client.id : normalizeClientName(event.clientName) === normalizeClientName(client.name)))
    .sort((left, right) => left.date.localeCompare(right.date));
  const courtDateGroups = COURT_SOURCES
    .map((item) => ({ ...item, events: clientCourtDates.filter((event) => (event.source || 'tracker') === item.value) }))
    .filter((group) => group.events.length);
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="drawer detail-drawer" role="dialog" aria-modal="true" aria-labelledby="client-name">
        <div className="drawer-header">
          <div><span className="eyebrow">CLIENT RECORD · {client.id || 'NO ID'}</span><h2 id="client-name">{client.name}</h2></div>
          <div className="detail-actions">
            {editing ? <><button className="button button-secondary" type="button" onClick={cancel} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" form="edit-client-form" disabled={saving}><Check size={15} />{saving ? 'Saving…' : 'Save'}</button></> : <><button className="button button-secondary" type="button" onClick={() => { setDeleting(false); setEditing(true); }}><Pencil size={15} />Edit</button><button className="button button-secondary button-remove" type="button" onClick={() => { setDeleteError(''); setDeleting((open) => !open); }} aria-expanded={deleting} disabled={!client.id}><Trash2 size={15} />Delete</button></>}
            <button className="icon-button" onClick={onClose} aria-label="Close client details"><X size={18} /></button>
          </div>
        </div>
        {deleting && !editing && <form className="delete-panel" onSubmit={confirmDelete}>
          <strong>Delete {client.name}?</strong>
          <p>This removes their row from MasterData and Client_Info, and from every case tab with its status and team member. Case notes and schedule appointments stay as history. The deletion is logged with your name and the time (Central). It can't be undone in the app.</p>
          <label className="field">Type <b className="delete-name">{client.name}</b> to confirm<input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" autoFocus aria-label="Type the client's name to confirm" /></label>
          <label className="field">Deleted by<select value={deletedBy} onChange={(event) => setDeletedBy(event.target.value)} required><option value="" disabled>Choose…</option>{SCHEDULE_ADDED_BY.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} /></label>
          {deleteError && <div className="form-error" role="alert">{deleteError}</div>}
          <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setDeleting(false)} disabled={deleteBusy}>Cancel</button><button className="button button-danger" type="submit" disabled={!nameConfirmed || !deletedBy || deleteBusy}><Trash2 size={15} />{deleteBusy ? 'Deleting…' : 'Delete permanently'}</button></div>
        </form>}
        {editing ? <form id="edit-client-form" className="edit-client-form" onSubmit={save}>
          <div className="detail-status"><span className="eyebrow">EDIT CLIENT · {client.id}</span></div>
          <div className="form-grid detail-edit-grid">
            <NameFields form={form} onChange={update} />
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
            <div className="detail-wide"><dt>Current address</dt><dd>{client.currentAddress || '—'}</dd></div>
            <div><dt>Translator needed</dt><dd>{client.translator || '—'}</dd></div>
            <div><dt>Date onboarded</dt><dd>{formatDate(client.onboardingDate)}</dd></div>
            <div><dt>Date of interview</dt><dd>{formatDate(client.interviewDate)}</dd></div>
            <div><dt>Date contacted</dt><dd>{formatDate(client.lastContactDate)}</dd></div>
            <div><dt>Outcome</dt><dd>{client.outcome || '—'}</dd></div>
            <div><dt>Next date of contact</dt><dd>{formatDate(client.nextContactDate)}</dd></div>
            <div><dt>Last date with attorney</dt><dd>{formatDate(client.lastAttorneyDate)}</dd></div>
            <div><dt>Payment status</dt><dd>{client.paymentStatus || '—'}</dd></div>
          </dl>
          <section className="detail-cases">
            <div className="detail-court-heading"><h3>Cases &amp; team</h3><span>{clientCaseTypes.length}</span></div>
            {clientCaseTypes.length
              ? <ul className="detail-case-list">{clientCaseTypes.map((type) => <li key={type}><div className="detail-case-head"><span className="case-pill">{type}</span><span className="detail-case-controls"><CaseStatusSelect value={client.caseStatus?.[type] || 'Not Started'} onChange={(status) => onSetCaseStatus(client, type, status)} label={`Status of the ${type} case`} /><TeamSelect value={client.caseTeam?.[type] || ''} onChange={(member) => onSetTeamMember(client, type, member)} label={`Team member for the ${type} case`} /></span></div>{notesState !== 'loading' && notesState !== 'ready' && <p className="form-error">{notesState}</p>}<CaseNotes key={`${client.id}-${type}`} client={client} caseType={type} notes={notes.filter((note) => note.caseType === type)} loading={notesState === 'loading'} onAdded={addNote} /></li>)}</ul>
              : <p className="court-date-empty">Not in any case type yet. Drag this client onto a case type in the sidebar, or tick one under Edit.</p>}
          </section>
          <section className="detail-court-dates">
            <div className="detail-court-heading"><h3>Court dates</h3><span>{clientCourtDates.length}</span></div>
            {courtDateGroups.length ? courtDateGroups.map((group) => <div className="court-date-group" key={group.value}><h4>{group.label}</h4><div className="court-date-list">{group.events.map((event) => <article className="court-date-item" key={event.id}>
              <div className="court-date-main"><CalendarDays size={16} /><div><strong>{formatDate(event.date)}</strong><span>{event.time || 'Time not listed'}{event.mode ? ` · ${event.mode}` : ''}{event.status ? ` · ${event.status}` : ''}</span></div></div>
              {event.address && <p>{event.address}</p>}
              {(event.judge || event.country || event.alienNumber) && <small>{[event.judge && `Judge ${event.judge}`, event.country, event.alienNumber && `A# ${event.alienNumber}`].filter(Boolean).join(' · ')}</small>}
              {event.note && <small>{event.note}</small>}
              {event.additionalNote && <small>{event.additionalNote}</small>}
            </article>)}</div></div>) : <p className="court-date-empty">No court dates on file.</p>}
          </section>
          <section className="detail-notes"><h3>Notes</h3><p>{client.notes || 'No notes recorded.'}</p></section>
        </>}
      </section>
    </div>
  );
}

function Dashboard({ clients, courtDates, onShowClients, onShowResults, onShowSchedule, onSelectClient, onCompleteFollowUp, now }) {
  const today = centralDateKey(now);
  const [appointments, setAppointments] = useState([]);
  useEffect(() => {
    let active = true;
    fetch('/api/schedule')
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((result) => { if (active) setAppointments(result.entries || []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  // Next appointment still to come today or later (Central Time), skipping done and cancelled ones.
  const nowTime = centralNowTime();
  const upcomingAppointments = appointments
    .filter((entry) => entry.status === 'Scheduled' && (entry.date > today || (entry.date === today && (timeTo24h(entry.time) || '23:59') >= nowTime)))
    .sort((left, right) => `${left.date} ${timeTo24h(left.time)}`.localeCompare(`${right.date} ${timeTo24h(right.time)}`));
  const nextAppointment = upcomingAppointments[0] || null;
  const dueClients = useMemo(() => clients
    .map((client) => ({ ...client, dueIn: daysUntil(client.nextContactDate, today) }))
    .filter((client) => client.dueIn !== null && client.dueIn >= 0)
    .sort((left, right) => left.dueIn - right.dueIn), [clients, today]);
  const dueSoon = dueClients.filter((client) => client.dueIn <= 7).length;
  const pendingPayments = clients.filter((client) => client.paymentStatus.toLowerCase() === 'pending').length;
  const caseTypeCounts = countCaseTypes(clients);
  const rosterNames = new Set(clients.map((client) => normalizeClientName(client.name)));
  const rosterIds = new Set(clients.map((client) => client.id).filter(Boolean));
  // Only the new Court_Dates list; the old tracker no longer drives the Overview.
  const nextCourtDate = courtDates
    .filter((event) => event.source === 'court-dates')
    .filter((event) => (rosterIds.has(event.clientId) || rosterNames.has(normalizeClientName(event.clientName))) && !['done', 'cancelled'].includes(String(event.status || '').toLowerCase()))
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
        <Metric label="Schedules" value={nextAppointment ? `${nextAppointment.date === today ? 'Today' : formatDate(nextAppointment.date, { month: 'short', day: 'numeric' })} · ${nextAppointment.time}` : '—'} note={nextAppointment ? [nextAppointment.mode, nextAppointment.purpose, nextAppointment.clientName].filter(Boolean).join(' · ') + (upcomingAppointments.length > 1 ? ` (+${upcomingAppointments.length - 1} more)` : '') : 'No upcoming appointments'} tone="blue" icon={CalendarClock} featured onClick={onShowSchedule} />
        <Metric label="Next court date" value={nextCourtDate ? formatDate(nextCourtDate.date, { month: 'short', day: 'numeric' }) : '—'} note={nextCourtDate ? (clients.find((client) => nextCourtDate.clientId && client.id === nextCourtDate.clientId)?.name || nextCourtDate.clientName) : 'No upcoming court date'} tone="green" icon={CalendarDays} featured onClick={() => onShowResults('court-dates')} />
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

// New court dates come from the Court_Dates tab and may name the client by Id; old tracker rows only by name.
function courtDateClient(event, clientsById, clientsByName) {
  return (event.clientId && clientsById.get(event.clientId)) || clientsByName.get(normalizeClientName(event.clientName));
}

const COURT_SOURCES = [
  { value: 'court-dates', label: 'New court dates', foot: 'Synced from the Court_Dates tab', empty: 'Add rows to the Court_Dates tab in Clients_Additional_Info.' },
  { value: 'tracker', label: 'Old tracker', foot: 'Synced from the old court tracker', empty: 'The old court date list is empty or not connected.' },
];

const COURT_MODES = ['Online', 'In Person'];

const COURT_DATE_STATUSES = ['Scheduled', 'Rescheduled', 'Done', 'Cancelled'];

// Pop-up after dropping a client on New court dates: set the date and details, saved to Court_Dates.
// With `existing` (a Court_Dates row) it edits that row instead.
function CourtDatePopup({ client, existing = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => (existing
    ? { date: existing.date, time: timeTo24h(existing.time), mode: COURT_MODES.includes(existing.mode) ? existing.mode : '', address: existing.address || '', status: existing.status || 'Scheduled', note: existing.note || '' }
    : { date: '', time: '', mode: '', address: '', status: 'Scheduled', note: '' }));
  const statuses = COURT_DATE_STATUSES.includes(form.status) ? COURT_DATE_STATUSES : [...COURT_DATE_STATUSES, form.status];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = existing
        ? await fetch(`/api/court-dates/${encodeURIComponent(existing.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, expected: courtDateExpected(existing) }) })
        : await fetch('/api/court-dates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, clientId: client.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save the court date.');
      onSaved(result.courtDate);
    } catch (saveError) {
      setError(saveError.message);
      setSaving(false);
    }
  }

  return (
    <div className="overlay is-centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="drawer note-popup court-date-popup" role="dialog" aria-modal="true" aria-labelledby="court-date-popup-title">
        <div className="drawer-header">
          <div><span className="eyebrow">{existing ? 'EDIT COURT DATE' : 'NEW COURT DATE'}{client.id ? ` · ${client.id}` : ''}</span><h2 id="court-date-popup-title">{client.name}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close"><X size={17} /></button>
        </div>
        <form className="note-popup-body" onSubmit={save}>
          <div className="form-grid">
            <label className="field">Court date<input type="date" name="date" value={form.date} onChange={update} onClick={openPicker} required autoFocus /></label>
            <label className="field">Time<input type="time" name="time" value={form.time} onChange={update} onClick={openPicker} step={60} /></label>
            <fieldset className="case-type-picker field-wide"><legend>Online or in person</legend><div className="case-type-options">{COURT_MODES.map((mode) => <label key={mode} className={`case-type-option ${form.mode === mode ? 'selected' : ''}`}><input type="radio" name="mode" value={mode} checked={form.mode === mode} onChange={update} required />{mode}</label>)}</div></fieldset>
            <label className="field field-wide">{form.mode === 'Online' ? 'Online link' : 'Court address'}<input name="address" value={form.address} onChange={update} maxLength={500} placeholder={form.mode === 'Online' ? 'https://…' : 'Courthouse or address'} /></label>
            <label className="field field-wide">Status<select name="status" value={form.status} onChange={update}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
            <label className="field field-wide">Notes<textarea name="note" value={form.note} onChange={update} maxLength={1000} rows={3} /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />{saving ? 'Saving…' : existing ? 'Save changes' : 'Save court date'}</button></div>
        </form>
      </section>
    </div>
  );
}

// What an edit or delete expects the Court_Dates row to still hold.
const courtDateExpected = (event) => ({ clientId: event.clientId || '', clientName: event.clientName || '', date: event.date });

function CourtDateList({ clients, courtDates, error = {}, onSelectClient, onCourtDateSaved, onCourtDateDeleted }) {
  const [source, setSource] = useState('court-dates');
  const [when, setWhen] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [settingFor, setSettingFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [rowError, setRowError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  async function remove(event) {
    const name = event.client?.name || event.clientName;
    if (!window.confirm(`Delete the court date for ${name} on ${formatDate(event.date)}? This removes the row from the Court_Dates tab.`)) return;
    setRowError('');
    setDeletingId(event.id);
    try {
      const response = await fetch(`/api/court-dates/${encodeURIComponent(event.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: courtDateExpected(event) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not delete this court date.');
      await onCourtDateDeleted(result.courtDate);
    } catch (deleteError) {
      setRowError(deleteError.message);
    } finally {
      setDeletingId('');
    }
  }
  useEffect(() => {
    const clear = () => setDropActive(false);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  const takesDrops = source === 'court-dates';
  function dropClient(event) {
    event.preventDefault();
    setDropActive(false);
    const client = clients.find((item) => item.id === clientIdsFromDrag(event)[0]);
    if (client) setSettingFor(client);
  }
  const today = centralDateKey();
  const clientsByName = new Map(clients.map((client) => [normalizeClientName(client.name), client]));
  const clientsById = new Map(clients.filter((client) => client.id).map((client) => [client.id, client]));
  const sourceInfo = COURT_SOURCES.find((item) => item.value === source);
  const sourceError = source === 'tracker' ? error.tracker : error.new;
  const countFor = (value) => courtDates.filter((event) => (event.source || 'tracker') === value).length;
  const events = courtDates
    .filter((event) => (event.source || 'tracker') === source)
    .map((event) => ({ ...event, client: courtDateClient(event, clientsById, clientsByName), dueIn: daysUntil(event.date, today) }))
    .map((event) => ({ ...event, isUpcoming: event.dueIn !== null && event.dueIn >= 0 && String(event.status || '').toLowerCase() !== 'done' }));
  const upcomingCount = events.filter((event) => event.isUpcoming).length;
  const query = search.trim().toLowerCase();
  const visible = events
    .filter((event) => when === 'all' || (when === 'upcoming' ? event.isUpcoming : !event.isUpcoming))
    .filter((event) => !query || [event.clientName, event.address, event.judge, event.alienNumber].some((value) => String(value || '').toLowerCase().includes(query)))
    .sort((left, right) => when === 'upcoming' ? left.date.localeCompare(right.date) : right.date.localeCompare(left.date));
  const open = (event) => event.client && onSelectClient(event.client);
  const empty = sourceError
    ? ['Could not load court dates', sourceError]
    : !events.length
      ? ['No court dates found', sourceInfo.empty]
      : ['No matching court dates', when === 'upcoming' ? 'Try “Past” or “All dates”.' : 'Try a different search.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">COURT CALENDAR · {upcomingCount} UPCOMING · {events.length} TOTAL</span><h1>Court dates</h1><p className="page-subtitle">{visible.length} court dates shown</p></div></div>
      <p className="drag-hint"><GripVertical size={14} />{takesDrops ? 'Drag a client from the All clients list on the right into this list, then set the court date.' : 'The old tracker is read-only here. Add new court dates under New court dates.'}</p>
      <div className={takesDrops ? 'case-layout' : undefined}>
      <section
        className={`surface roster-surface ${dropActive ? 'is-drop-active' : ''}`}
        onDragOver={takesDrops ? (event) => { if (!isClientDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (!dropActive) setDropActive(true); } : undefined}
        onDragLeave={takesDrops ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); } : undefined}
        onDrop={takesDrops ? dropClient : undefined}
      >
        {dropActive && <div className="drop-banner" aria-hidden="true"><Plus size={16} />Drop to set a court date</div>}
        <div className="court-source-tabs" role="tablist" aria-label="Court date list">
          {COURT_SOURCES.map((item) => <button key={item.value} type="button" role="tab" aria-selected={source === item.value} className={source === item.value ? 'active' : ''} onClick={() => setSource(item.value)}>{item.label}<span>{countFor(item.value)}</span></button>)}
        </div>
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={takesDrops ? 'Search name, location or link' : 'Search name, location, judge or A-number'} aria-label="Search court dates" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={when} onChange={setWhen} icon={CalendarDays} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past or done' }, { value: 'all', label: 'All dates' }]} />
        </div>
        {rowError && takesDrops && <div className="form-error court-row-error" role="alert">{rowError}</div>}
        <div className="table-scroll"><table className="client-table court-results-table"><thead><tr><th>Client</th><th>Court date</th><th>Time</th>{takesDrops ? <><th>Mode</th><th>Location / link</th></> : <><th>Location</th><th>Judge</th></>}<th>Status</th>{takesDrops && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>
          {visible.map((event) => <tr key={event.id} className={event.client ? '' : 'row-static'} onClick={() => open(event)} tabIndex={event.client ? 0 : undefined} onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && open(event)}><td><strong>{event.client?.name || event.clientName}</strong><small>{event.client ? event.client.id : 'Not matched to a client record'}</small></td><td>{formatDate(event.date)}{event.rescheduleDate && <small>Rescheduled</small>}</td><td>{event.time || '—'}</td>{takesDrops ? <><td>{event.mode ? <span className={`court-mode is-${event.mode === 'Online' ? 'online' : 'person'}`}>{event.mode}</span> : '—'}</td><td className="court-location" title={event.address || undefined}>{/^https?:\/\//i.test(event.address || '') ? <a href={event.address} target="_blank" rel="noreferrer" onClick={(clickEvent) => clickEvent.stopPropagation()}>Open link</a> : event.address || '—'}</td></> :<><td>{event.address || '—'}</td><td>{event.judge || '—'}</td></>}<td>{event.status || '—'}</td>{takesDrops && <td className="court-row-actions" onClick={(clickEvent) => clickEvent.stopPropagation()} onKeyDown={(keyEvent) => keyEvent.stopPropagation()}><div><button className="icon-button" type="button" onClick={() => { setRowError(''); setEditing(event); }} aria-label={`Edit court date for ${event.client?.name || event.clientName}`} title="Edit"><Pencil size={14} /></button><button className="icon-button button-remove" type="button" onClick={() => remove(event)} disabled={deletingId === event.id} aria-label={`Delete court date for ${event.client?.name || event.clientName}`} title="Delete">{deletingId === event.id ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}</button></div></td>}</tr>)}
          {!visible.length && <tr><td colSpan={takesDrops ? 7 : 6}><div className="table-empty"><CalendarDays size={22} /><strong>{empty[0]}</strong><span>{empty[1]}</span></div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {events.length} court dates</span><span><i className="sync-dot" /> {sourceInfo.foot}</span></div>
      </section>
      {takesDrops && <ClientPicker clients={clients} target="New court dates" countLabel="clients" emptyLabel="No clients yet." addLabel="Set court date" onAdd={(client) => setSettingFor(client)} />}
      </div>
      {settingFor && <CourtDatePopup key={settingFor.id} client={settingFor} onClose={() => setSettingFor(null)} onSaved={(courtDate) => { setSettingFor(null); onCourtDateSaved(courtDate, 'added'); }} />}
      {editing && <CourtDatePopup key={editing.id} client={{ id: editing.client?.id || editing.clientId, name: editing.client?.name || editing.clientName }} existing={editing} onClose={() => setEditing(null)} onSaved={(courtDate) => { setEditing(null); onCourtDateSaved(courtDate, 'updated'); }} />}
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

function NameSuggest({ value, clients, onChange, onPick, required = true, autoFocus = true, className }) {
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
        className={className} name="name" value={value} maxLength={200} placeholder="Start typing a client name" required={required} autoFocus={autoFocus} autoComplete="off"
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

const emptyPermitForm = {
  name: '', note: '', section: 'Regular', filingDate: '', pausedDays: 0, aNumber: '', decision: 'Pending', approvedDate: '', expiryDate: '',
  // Same fields as the EOIR "Asylum EAD Clock Information" screen.
  ntaDate: '', eoirAsOf: '', eoirClockStatus: '', eoirClockDays: '', asylumType: '', asylumDecision: '', appealFiledDate: '', dhsDaysAtReferral: '', dhsStatusAtReferral: '', eoirEvents: [],
};
const EOIR_FIELD_LABELS = {
  name: 'Name', aNumber: 'A-Number', filingDate: "Init Asylum Rec'd Date", ntaDate: 'NTA Date', eoirAsOf: 'As of', eoirClockStatus: 'EAD clock',
  eoirClockDays: 'clock days', asylumType: 'Asylum Type', asylumDecision: 'Asylum Decision', appealFiledDate: 'Date Appeal Filed',
  dhsDaysAtReferral: 'DHS Days At Referral', dhsStatusAtReferral: 'DHS Status At Referral', eoirEvents: 'events', pausedDays: 'days paused',
};
const emptyEoirEvent = { event: '', date: '', city: '', decision: '', action: '', elapsed: '', cumulative: '' };

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
  const [scanNotice, setScanNotice] = useState(null);
  const [scannedKeys, setScannedKeys] = useState(() => new Set());
  const formRef = useRef(null);

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
    setScanNotice(null); setScannedKeys(new Set());
  }

  const formFor = (record) => ({
    ...emptyPermitForm,
    ...Object.fromEntries(Object.keys(emptyPermitForm).map((key) => [key, record[key] ?? emptyPermitForm[key]])),
    section: record.section || 'Regular',
  });

  function startEdit(record) {
    setEditing(record.id);
    setForm(formFor(record));
    setFormError('');
    setScanNotice(null); setScannedKeys(new Set());
  }

  // An EOIR screenshot updates the record with the same A-Number (or, failing that, the same name);
  // otherwise it starts a new one. Nothing is saved until staff check the form and press Save.
  function fromEoir(scan) {
    const digits = (value) => String(value || '').replace(/\D/g, '').replace(/^0+/, '');
    const nameKey = (value) => String(value || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const match = (scan.fields.aNumber && records.find((record) => digits(record.aNumber) && digits(record.aNumber) === digits(scan.fields.aNumber)))
      || (scan.fields.name && records.find((record) => nameKey(record.name) === nameKey(scan.fields.name)))
      || null;
    const { next, keys, clockStopped } = applyEoirScan(match ? formFor(match) : emptyPermitForm, scan);
    setEditing(match ? match.id : 'new');
    setForm(next);
    setFormError('');
    setScannedKeys(new Set(keys));
    setScanNotice({ match, filled: keys.map((key) => EOIR_FIELD_LABELS[key] || key), clockStopped: clockStopped && match?.clockStatus !== 'Paused', clockDays: scan.fields.clockDays, asOf: scan.fields.asOf });
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return match ? `Matched ${match.name} (${match.id}). Check the form below and press Save changes.` : 'New client. Check the form below and press Add client.';
  }

  // Editing a highlighted (scanned) box removes its highlight.
  const unmark = (key) => setScannedKeys((current) => {
    if (!current.has(key)) return current;
    const next = new Set(current);
    next.delete(key);
    return next;
  });
  const scannedClass = (key) => (scannedKeys.has(key) ? 'is-scanned' : undefined);

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    unmark(name);
  }

  function updateEvent(index, key, value) {
    setForm((current) => ({ ...current, eoirEvents: current.eoirEvents.map((item, position) => (position === index ? { ...item, [key]: value } : item)) }));
    unmark('eoirEvents');
  }

  function changeEvents(change) {
    setForm((current) => ({ ...current, eoirEvents: change(current.eoirEvents) }));
    unmark('eoirEvents');
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
      setScanNotice(null); setScannedKeys(new Set());
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
      <EoirScanner onScanned={fromEoir} />
      {shared && <div className="surface share-panel" role="status">
        <div><strong>{shared.copied ? 'Link copied' : 'Copy this link'} for {shared.name}</strong><span>Anyone with this link can see this client's 150-day progress. Internal notes stay hidden.</span></div>
        <input readOnly value={shared.url} onFocus={(event) => event.target.select()} aria-label={`Tracking link for ${shared.name}`} />
        <button className="icon-button" onClick={() => setShared(null)} aria-label="Close"><X size={15} /></button>
      </div>}
      {editing && <form className="surface reminder-form" onSubmit={save} ref={formRef}>
        {scanNotice && <div className="scan-notice" role="status">
          <strong>{scanNotice.match ? `Updating ${scanNotice.match.name} (${scanNotice.match.id}) from the EOIR screenshot` : 'New client from the EOIR screenshot'}</strong>
          <span>Filled: {scanNotice.filled.join(', ')}.{scanNotice.clockDays !== null && scanNotice.asOf ? ` Days paused is set so the clock shows ${scanNotice.clockDays} days on ${formatDate(scanNotice.asOf)}, matching EOIR.` : ''} Check everything, then save.</span>
          {scanNotice.clockStopped && <span className="scan-warning">EOIR shows the clock <b>stopped</b>. After saving, press <b>Pause</b> on this record so the app stops counting too.</span>}
        </div>}
        {/* Laid out like the EOIR "Asylum EAD Clock Information" screen: left and right columns as on EOIR. */}
        <div className="form-grid">
          <div className="form-section-title field-wide"><span>01</span><h3>Removal</h3></div>
          <label className="field">A-Number<input className={scannedClass('aNumber')} name="aNumber" value={form.aNumber} onChange={update} maxLength={14} inputMode="numeric" placeholder="e.g. 245-943-700" /><span className="field-hint">Staff only — never shown on the client's link.</span></label>
          <label className="field">NTA Date<input className={scannedClass('ntaDate')} type="date" name="ntaDate" value={form.ntaDate} onChange={update} onClick={openPicker} /></label>
          <label className="field">Name<NameSuggest className={scannedClass('name')} value={form.name} clients={clients} onChange={(name) => { setForm((current) => ({ ...current, name })); unmark('name'); }} onPick={(client) => { setForm((current) => ({ ...current, name: client.name })); unmark('name'); }} />
            {duplicate && <span className="field-hint">Already in work permits as {duplicate.id}.</span>}</label>
          <label className="field">As of<input className={scannedClass('eoirAsOf')} type="date" name="eoirAsOf" value={form.eoirAsOf} onChange={update} onClick={openPicker} /><span className="field-hint">The date EOIR's numbers were shown.</span></label>
          <div className="field eoir-clock-field">
            <span>EAD Clock (EOIR)</span>
            <div className="eoir-clock-inputs">
              <select className={scannedClass('eoirClockStatus')} name="eoirClockStatus" value={form.eoirClockStatus} onChange={update} aria-label="EOIR clock running or stopped"><option value="">Not set</option><option>Running</option><option>Stopped</option></select>
              <input className={scannedClass('eoirClockDays')} type="number" name="eoirClockDays" min="0" max="99999" value={form.eoirClockDays} onChange={update} aria-label="EOIR clock days elapsed" placeholder="Days" />
              <span className="eoir-clock-unit">days elapsed</span>
            </div>
          </div>
          <label className="field">Asylum Type<input className={scannedClass('asylumType')} name="asylumType" value={form.asylumType} onChange={update} maxLength={60} list="asylum-types" placeholder="Affirmative or Defensive" /><datalist id="asylum-types"><option value="Affirmative" /><option value="Defensive" /></datalist></label>
          <label className="field">Init Asylum Rec'd Date — starts the EAD clock<input className={scannedClass('filingDate')} type="date" name="filingDate" value={form.filingDate} onChange={update} onClick={openPicker} /></label>
          <label className="field">Asylum Decision<input className={scannedClass('asylumDecision')} name="asylumDecision" value={form.asylumDecision} onChange={update} maxLength={120} /></label>
          <label className="field">Date Appeal Filed<input className={scannedClass('appealFiledDate')} type="date" name="appealFiledDate" value={form.appealFiledDate} onChange={update} onClick={openPicker} /></label>
          <label className="field">DHS Days At Referral<input className={scannedClass('dhsDaysAtReferral')} type="number" name="dhsDaysAtReferral" min="0" max="99999" value={form.dhsDaysAtReferral} onChange={update} placeholder="Days elapsed" /></label>
          <label className="field field-wide">DHS Status At Referral<input className={scannedClass('dhsStatusAtReferral')} name="dhsStatusAtReferral" value={form.dhsStatusAtReferral} onChange={update} maxLength={200} /></label>

          <div className="form-section-title field-wide"><span>02</span><h3>Event Dates &amp; Decisions/Adjournments</h3></div>
          <div className={`field-wide eoir-events ${scannedKeys.has('eoirEvents') ? 'is-scanned' : ''}`}>
            <div className="table-scroll"><table className="eoir-events-table">
              <thead><tr><th>Events</th><th>Date</th><th>Base City</th><th>Decision/Adjournment</th><th>Clock Action</th><th>Elapsed Days</th><th>Cumulative</th><th><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {form.eoirEvents.map((item, index) => <tr key={index}>
                  <td><input value={item.event} onChange={(event) => updateEvent(index, 'event', event.target.value)} maxLength={40} aria-label={`Event ${index + 1}`} placeholder="Hearing" /></td>
                  <td><input type="date" value={item.date} onChange={(event) => updateEvent(index, 'date', event.target.value)} onClick={openPicker} aria-label={`Event ${index + 1} date`} /></td>
                  <td><input value={item.city} onChange={(event) => updateEvent(index, 'city', event.target.value)} maxLength={40} aria-label={`Event ${index + 1} base city`} placeholder="CHI" /></td>
                  <td><input value={item.decision} onChange={(event) => updateEvent(index, 'decision', event.target.value)} maxLength={200} aria-label={`Event ${index + 1} decision or adjournment`} /></td>
                  <td><input value={item.action} onChange={(event) => updateEvent(index, 'action', event.target.value)} maxLength={40} list="clock-actions" aria-label={`Event ${index + 1} clock action`} placeholder="Run" /></td>
                  <td><input type="number" min="0" value={item.elapsed} onChange={(event) => updateEvent(index, 'elapsed', event.target.value)} aria-label={`Event ${index + 1} elapsed days`} /></td>
                  <td><input type="number" min="0" value={item.cumulative} onChange={(event) => updateEvent(index, 'cumulative', event.target.value)} aria-label={`Event ${index + 1} cumulative days`} /></td>
                  <td><button className="icon-button button-remove" type="button" onClick={() => changeEvents((events) => events.filter((_item, position) => position !== index))} aria-label={`Remove event ${index + 1}`} title="Remove"><X size={14} /></button></td>
                </tr>)}
                {!form.eoirEvents.length && <tr><td colSpan="8" className="eoir-events-empty">No events yet. Paste an EOIR screenshot, or add them by hand.</td></tr>}
              </tbody>
            </table></div>
            <datalist id="clock-actions"><option value="Run" /><option value="Stop" /><option value="Start" /></datalist>
            <button className="text-button" type="button" onClick={() => changeEvents((events) => [...events, { ...emptyEoirEvent }])}><Plus size={14} />Add event</button>
          </div>

          <div className="form-section-title field-wide"><span>03</span><h3>Work permit tracking</h3></div>
          <label className="field">Days paused so far<input className={scannedClass('pausedDays')} type="number" name="pausedDays" min="0" max="3650" step="1" value={form.pausedDays} onChange={update} /><span className="field-hint">Applicant-caused delays don't count toward 150/180 days. Set automatically from an EOIR screenshot.</span></label>
          <label className="field">Section<select name="section" value={form.section} onChange={update}><option>Regular</option><option>Pending</option></select><ChevronDown size={15} /></label>
          <label className="field field-wide">Internal note (never shown to the client)<textarea name="note" value={form.note} onChange={update} rows={3} maxLength={2000} /></label>
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => { setEditing(null); setScanNotice(null); setScannedKeys(new Set()); }}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing === 'new' ? 'Add client' : 'Save changes'}</button></div>
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
                  {(record.eoirClockDays || record.asylumType) && <small className="permit-meta eoir-meta">EOIR{record.eoirClockDays && <>: clock {record.eoirClockStatus === 'Stopped' ? 'stopped' : 'running'}, {record.eoirClockDays} days</>}{record.eoirAsOf && <> as of {formatDate(record.eoirAsOf)}</>}{record.asylumType && <> · {record.asylumType}</>}{record.asylumDecision && <> · {record.asylumDecision}</>}</small>}
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

const emptyAppointment = { date: '', time: '', mode: 'Zoom', location: '', purpose: '', clientId: '', clientName: '', caseType: '', caseOther: '', addedBy: '', status: 'Scheduled' };
const MODE_TONES = { Zoom: 'zoom', 'In Person': 'person', 'Phone Call': 'phone' };

function centralNowTime() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CENTRAL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function dayLabel(date, today) {
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === today) return 'Today';
  if (date === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

// Opens the browser's date/time picker when the box is clicked anywhere, not only on its icon.
function openPicker(event) {
  try { event.currentTarget.showPicker?.(); } catch { /* picker already open or not supported */ }
}

const isWebLink = (value) => /^https?:\/\//i.test(String(value || '').trim());

// Attorney appointments, saved in the Schedule_Tracker tab. Dates and times are Central Time.
function SchedulePage({ clients, onSelectClient, onToast }) {
  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyAppointment);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState('');
  const [show, setShow] = useState('upcoming');
  const [modeFilter, setModeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const today = centralDateKey();

  useEffect(() => {
    let active = true;
    fetch('/api/schedule')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the schedule.');
        if (active) { setEntries(result.entries || []); setLoadState('ready'); }
      })
      .catch((error) => { if (active) { setLoadError(error.message); setLoadState('error'); } });
    return () => { active = false; };
  }, []);

  const pickedClient = clients.find((client) => client.id === form.clientId);
  // Every case type is offered; the picked client's own cases are listed first.
  const clientCases = pickedClient ? CASE_TYPES.filter((type) => isCaseTypeSelected(pickedClient.caseType, type)) : [];
  const otherCases = CASE_TYPES.filter((type) => !clientCases.includes(type));

  function startEdit(entry) {
    setEditing(entry ? entry.id : 'new');
    let author = '';
    try { author = localStorage.getItem('note-author') || ''; } catch { /* no saved choice */ }
    setForm(entry
      ? { ...emptyAppointment, ...entry, time: timeTo24h(entry.time), ...(entry.caseType && !CASE_TYPES.includes(entry.caseType) ? { caseType: 'Other', caseOther: entry.caseType } : {}) }
      : { ...emptyAppointment, date: today, addedBy: SCHEDULE_ADDED_BY.includes(author) ? author : '' });
    setFormError('');
  }

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function send(id, values) {
    const isNew = id === 'new';
    const response = await fetch(isNew ? '/api/schedule' : `/api/schedule/${encodeURIComponent(id)}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save this appointment.');
    setEntries((current) => isNew ? [...current, result.entry] : current.map((item) => item.id === id ? result.entry : item));
    return result.entry;
  }

  async function save(event) {
    event.preventDefault();
    if (form.clientName.trim() && !form.clientId) {
      setFormError('Pick the client from the suggestions, or clear the client box.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      // "Other" saves the reason typed in its place.
      const { caseOther, ...values } = form;
      const entry = await send(editing, { ...values, caseType: form.caseType === 'Other' ? caseOther.trim() : form.caseType });
      try { localStorage.setItem('note-author', form.addedBy); } catch { /* remembered for this visit only */ }
      onToast(`${editing === 'new' ? 'Scheduled' : 'Updated'}: ${entry.purpose}, ${formatDate(entry.date)} ${entry.time} CT`);
      setEditing(null);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(entry, status) {
    setRowError('');
    try {
      await send(entry.id, { ...entry, time: timeTo24h(entry.time), status });
      onToast(`${entry.purpose}: ${status}`);
    } catch (error) {
      setRowError(error.message);
    }
  }

  async function remove(entry) {
    if (!window.confirm(`Delete "${entry.purpose}" on ${formatDate(entry.date)} at ${entry.time} CT?`)) return;
    setRowError('');
    try {
      const response = await fetch(`/api/schedule/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete this appointment.');
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      onToast('Appointment deleted');
    } catch (error) {
      setRowError(error.message);
    }
  }

  const sortKey = (entry) => `${entry.date} ${timeTo24h(entry.time) || '99:99'}`;
  const query = search.trim().toLowerCase();
  const upcomingCount = entries.filter((entry) => entry.date >= today && entry.status === 'Scheduled').length;
  const visible = entries
    .filter((entry) => show === 'all' || (show === 'today' ? entry.date === today : show === 'past' ? entry.date < today : entry.date >= today))
    .filter((entry) => modeFilter === 'all' || entry.mode === modeFilter)
    .filter((entry) => !query || [entry.purpose, entry.clientName, entry.location, entry.addedBy, entry.caseType].some((value) => String(value || '').toLowerCase().includes(query)))
    .sort((left, right) => (show === 'past' ? sortKey(right).localeCompare(sortKey(left)) : sortKey(left).localeCompare(sortKey(right))));
  const days = [];
  for (const entry of visible) {
    if (days.at(-1)?.date !== entry.date) days.push({ date: entry.date, entries: [] });
    days.at(-1).entries.push(entry);
  }
  const nowTime = centralNowTime();
  const empty = loadState === 'loading' ? ['Loading the schedule…', '']
    : loadState === 'error' ? ['Could not load the schedule', loadError]
      : !entries.length ? ['Nothing scheduled yet', 'Use “Add appointment” to put the first one on the attorney’s schedule.']
        : ['Nothing to show', show === 'upcoming' ? 'No upcoming appointments match. Try “All” or another filter.' : 'Try a different filter or search.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">ATTORNEY SCHEDULE · {upcomingCount} UPCOMING · CENTRAL TIME</span><h1>Schedule</h1><p className="page-subtitle">Appointments for the attorney, with how each one will happen.</p></div><button className="button button-primary" onClick={() => startEdit(null)} disabled={loadState !== 'ready'}><Plus size={16} />Add appointment</button></div>
      {editing && <form className="surface reminder-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field">Date<input type="date" name="date" value={form.date} onChange={update} onClick={openPicker} required autoFocus /></label>
          <label className="field">Time (Central)<input type="time" name="time" value={form.time} onChange={update} onClick={openPicker} required step={60} /></label>
          <fieldset className="case-type-picker field-wide"><legend>Mode of communication</legend><div className="case-type-options">{SCHEDULE_MODES.map((mode) => <label key={mode} className={`case-type-option ${form.mode === mode ? 'selected' : ''}`}><input type="radio" name="mode" value={mode} checked={form.mode === mode} onChange={update} />{mode}</label>)}</div></fieldset>
          <label className="field field-wide">{form.mode === 'Zoom' ? 'Zoom link' : form.mode === 'In Person' ? 'Location' : 'Phone number'}<input name="location" value={form.location} onChange={update} maxLength={500} placeholder={form.mode === 'Zoom' ? 'https://zoom.us/j/…' : form.mode === 'In Person' ? 'Office, courthouse or address' : 'Number to call'} /></label>
          <label className="field field-wide">Purpose<b>*</b><input name="purpose" value={form.purpose} onChange={update} maxLength={300} required placeholder="e.g. VAWA intake consultation" /></label>
          <label className="field">Client (optional)<NameSuggest required={false} autoFocus={false} value={form.clientName} clients={clients} onChange={(name) => setForm((current) => ({ ...current, clientName: name, clientId: '', caseType: '' }))} onPick={(client) => setForm((current) => ({ ...current, clientName: client.name, clientId: client.id, caseType: '' }))} /></label>
          <label className="field">Case (optional)<select name="caseType" value={form.caseType} onChange={update}><option value="">None</option>{clientCases.length > 0 && <optgroup label={`${pickedClient.name}'s cases`}>{clientCases.map((type) => <option key={type}>{type}</option>)}</optgroup>}<optgroup label={clientCases.length ? 'All case types' : 'Case types'}>{otherCases.map((type) => <option key={type}>{type}</option>)}<option value="Other">Other</option></optgroup></select><ChevronDown size={15} /></label>
          {form.caseType === 'Other' && <label className="field">Other reason<b>*</b><input name="caseOther" value={form.caseOther} onChange={update} maxLength={100} required autoFocus placeholder="e.g. Bond hearing, FOIA request" /></label>}
          <label className="field">Added by<select name="addedBy" value={form.addedBy} onChange={update} required><option value="" disabled>Choose…</option>{SCHEDULE_ADDED_BY.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} /></label>
          {editing !== 'new' && <label className="field">Status<select name="status" value={form.status} onChange={update}>{SCHEDULE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><ChevronDown size={15} /></label>}
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing === 'new' ? 'Add to schedule' : 'Save changes'}</button></div>
      </form>}
      {rowError && <div className="load-error" role="alert"><span>{rowError}</span><button onClick={() => setRowError('')}>Dismiss <X size={14} /></button></div>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search purpose, client, place or team member" aria-label="Search the schedule" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={show} onChange={setShow} icon={CalendarDays} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'today', label: 'Today' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }]} />
          <FilterMenu label="Mode" value={modeFilter} onChange={setModeFilter} icon={SlidersHorizontal} options={[{ value: 'all', label: 'All modes' }, ...SCHEDULE_MODES.map((mode) => ({ value: mode, label: mode }))]} />
        </div>
        {days.length ? days.map((day) => <div key={day.date} className={`schedule-day ${day.date === today ? 'is-today' : ''}`}>
          <h3>{dayLabel(day.date, today)}{['Today', 'Tomorrow'].includes(dayLabel(day.date, today)) && <small>{formatDate(day.date)}</small>}</h3>
          <ul className="schedule-list">
            {day.entries.map((entry) => {
              const client = clients.find((item) => item.id === entry.clientId);
              const passed = entry.date < today || (entry.date === today && (timeTo24h(entry.time) || '99:99') < nowTime);
              return <li key={entry.id} className={`schedule-item status-${entry.status.toLowerCase()} ${passed && entry.status === 'Scheduled' ? 'is-passed' : ''}`}>
                <time className="schedule-time">{entry.time}<small>CT</small></time>
                <span className={`mode-badge mode-${MODE_TONES[entry.mode] || 'other'}`}>{entry.mode === 'Zoom' ? <Video size={13} /> : entry.mode === 'In Person' ? <MapPin size={13} /> : <Phone size={13} />}{entry.mode || 'Not set'}</span>
                <div className="schedule-main">
                  <strong>{entry.purpose}</strong>
                  <small>
                    {entry.clientName && (client ? <button className="link-button" type="button" onClick={() => onSelectClient(client)}>{entry.clientName}</button> : <span>{entry.clientName}</span>)}
                    {entry.caseType && <span className="case-pill">{entry.caseType}</span>}
                    {entry.location && (isWebLink(entry.location) ? <a href={entry.location} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />Join</a> : <span className="schedule-place">{entry.location}</span>)}
                  </small>
                </div>
                <span className="schedule-by">by {entry.addedBy || '—'}</span>
                <select className={`schedule-status status-${entry.status.toLowerCase()}`} value={entry.status} onChange={(event) => setStatus(entry, event.target.value)} aria-label={`Status of ${entry.purpose}`}>{SCHEDULE_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
                <span className="credential-actions"><button className="icon-button" onClick={() => startEdit(entry)} aria-label={`Edit ${entry.purpose}`} title="Edit"><Pencil size={14} /></button><button className="icon-button button-remove" onClick={() => remove(entry)} aria-label={`Delete ${entry.purpose}`} title="Delete"><Trash2 size={14} /></button></span>
              </li>;
            })}
          </ul>
        </div>) : <div className="table-empty"><CalendarClock size={22} /><strong>{empty[0]}</strong>{empty[1] && <span>{empty[1]}</span>}</div>}
        <div className="table-foot"><span>Showing {visible.length} of {entries.length} appointments</span><span><i className="sync-dot" /> Saved to Schedule_Tracker · times in Central</span></div>
      </section>
    </>
  );
}

// Team issue log for one category (Tech or Other), saved in the Issues tab. Times are Central.
function IssuesPage({ category, onToast }) {
  const [issues, setIssues] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', reportedBy: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [rowError, setRowError] = useState('');
  const [solving, setSolving] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [show, setShow] = useState('open');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    fetch('/api/issues')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load issues.');
        if (active) { setIssues(result.issues || []); setLoadState('ready'); }
      })
      .catch((error) => { if (active) { setLoadError(error.message); setLoadState('error'); } });
    return () => { active = false; };
  }, []);
  // Keeps the "Open 3h 20m" times current.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const savedAuthor = () => { try { return localStorage.getItem('note-author') || ''; } catch { return ''; } };
  const rememberAuthor = (name) => { try { localStorage.setItem('note-author', name); } catch { /* remembered for this visit only */ } };
  const replace = (issue) => setIssues((current) => current.map((item) => item.id === issue.id ? issue : item));
  const updateForm = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  function startAdd() {
    const author = savedAuthor();
    setForm({ title: '', details: '', reportedBy: SCHEDULE_ADDED_BY.includes(author) ? author : '' });
    setFormError('');
    setAdding(true);
  }

  async function post(url, body, fallback) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || fallback);
    return result.issue;
  }

  async function add(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const issue = await post('/api/issues', { ...form, category }, 'Could not save this issue.');
      rememberAuthor(form.reportedBy);
      setIssues((current) => [...current, issue]);
      setShow((current) => current === 'solved' ? 'open' : current);
      onToast(`Issue logged: ${issue.title}`);
      setAdding(false);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function reopen(issue) {
    if (!window.confirm(`Reopen "${issue.title}"? Its solved time and resolution are cleared, and the time open counts again from when it was first reported.`)) return;
    setRowError('');
    setBusyId(issue.id);
    try {
      replace(await post(`/api/issues/${encodeURIComponent(issue.id)}/reopen`, {}, 'Could not reopen this issue.'));
      onToast(`Reopened: ${issue.title}`);
    } catch (error) {
      setRowError(error.message);
    } finally {
      setBusyId('');
    }
  }

  async function remove(issue) {
    if (!window.confirm(`Delete "${issue.title}"? This removes it from the Issues tab.`)) return;
    setRowError('');
    setBusyId(issue.id);
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issue.id)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not delete this issue.');
      setIssues((current) => current.filter((item) => item.id !== issue.id));
      onToast('Issue deleted');
    } catch (error) {
      setRowError(error.message);
    } finally {
      setBusyId('');
    }
  }

  const mine = issues.filter((issue) => issue.category === category);
  const openCount = mine.filter((issue) => issue.status === 'Open').length;
  const solved = mine.filter((issue) => issue.status === 'Solved');
  const solvedDurations = solved.map((issue) => issueDuration(issue)).filter(Number.isFinite);
  const averageFix = solvedDurations.length ? formatDuration(solvedDurations.reduce((sum, value) => sum + value, 0) / solvedDurations.length) : '';
  const query = search.trim().toLowerCase();
  const timeOf = (value) => centralToDate(value)?.getTime() || 0;
  const visible = mine
    .filter((issue) => show === 'all' || (show === 'open' ? issue.status === 'Open' : issue.status === 'Solved'))
    .filter((issue) => !query || [issue.title, issue.details, issue.reportedBy, issue.solvedBy, issue.resolution, issue.id].some((value) => String(value || '').toLowerCase().includes(query)))
    // Open first with the longest-waiting on top; then solved, most recently solved first.
    .sort((left, right) => (left.status !== right.status
      ? (left.status === 'Open' ? -1 : 1)
      : left.status === 'Open' ? timeOf(left.reportedAt) - timeOf(right.reportedAt) : timeOf(right.solvedAt) - timeOf(left.solvedAt)));
  const label = category === 'Tech' ? 'tech issue' : 'issue';
  const empty = loadState === 'loading' ? ['Loading issues…', '']
    : loadState === 'error' ? ['Could not load issues', loadError]
      : !mine.length ? [`No ${label}s logged yet`, `Use “Report ${label}” when something needs fixing.`]
        : show === 'open' && !query ? ['Nothing open', 'Every issue here has been solved.'] : ['Nothing to show', 'Try a different filter or search.'];

  return (
    <>
      <div className="welcome-row roster-heading"><div><span className="eyebrow">ISSUES · {openCount} OPEN{averageFix && ` · AVERAGE FIX ${averageFix.toUpperCase()}`} · CENTRAL TIME</span><h1>{category === 'Tech' ? 'Tech Issues' : 'Other Issues'}</h1><p className="page-subtitle">{category === 'Tech' ? 'Computer, software, login and equipment problems.' : 'Anything else the team needs sorted out.'} Each issue shows how long it has been open.</p></div><button className="button button-primary" onClick={startAdd} disabled={loadState !== 'ready'}><Plus size={16} />Report {label}</button></div>
      {adding && <form className="surface reminder-form" onSubmit={add}>
        <div className="form-grid">
          <label className="field field-wide">What’s the issue?<b>*</b><input name="title" value={form.title} onChange={updateForm} maxLength={200} required autoFocus placeholder={category === 'Tech' ? 'e.g. Front office printer won’t scan' : 'e.g. Running low on client folders'} /></label>
          <label className="field field-wide">Details (optional)<textarea name="details" value={form.details} onChange={updateForm} maxLength={2000} rows={3} placeholder="What happened, any error message, who it affects" /></label>
          <label className="field">Reported by<select name="reportedBy" value={form.reportedBy} onChange={updateForm} required><option value="" disabled>Choose…</option>{SCHEDULE_ADDED_BY.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} /></label>
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setAdding(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : `Log ${label}`}</button></div>
      </form>}
      {rowError && <div className="load-error" role="alert"><span>{rowError}</span><button onClick={() => setRowError('')}>Dismiss <X size={14} /></button></div>}
      <section className="surface roster-surface">
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issues, people or how they were solved" aria-label="Search issues" />{search && <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <FilterMenu label="Show" value={show} onChange={setShow} icon={SlidersHorizontal} options={[{ value: 'open', label: `Open (${openCount})` }, { value: 'solved', label: `Solved (${solved.length})` }, { value: 'all', label: 'All' }]} />
        </div>
        <div className="table-scroll"><table className="client-table issue-table"><thead><tr><th>Issue</th><th>Reported</th><th>Status</th><th>How long</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {visible.map((issue) => {
            const isOpen = issue.status === 'Open';
            const duration = formatDuration(issueDuration(issue, now)) || issue.timeOpen || '—';
            return <tr key={issue.id} className={`row-static ${isOpen ? '' : 'is-solved'}`}>
              <td className="issue-main"><strong>{issue.title}</strong>{issue.details && <small className="issue-details">{issue.details}</small>}{!isOpen && issue.resolution && <small className="issue-resolution"><Check size={12} />{issue.resolution}</small>}</td>
              <td><span className="issue-who">{issue.reportedBy || '—'}</span><small>{formatNoteTime(issue.reportedAt)}</small></td>
              <td><span className={`status ${isOpen ? 'status-caution' : 'status-positive'}`}><i />{issue.status}</span>{!isOpen && <small>by {issue.solvedBy || '—'} · {formatNoteTime(issue.solvedAt)}</small>}</td>
              <td><span className={`issue-duration ${isOpen ? 'is-open' : ''}`}><Clock3 size={13} />{isOpen ? `Open ${duration}` : `Lasted ${duration}`}</span></td>
              <td className="issue-actions"><div>
                {isOpen
                  ? <button className="button button-secondary issue-solve" type="button" onClick={() => setSolving(issue)} disabled={busyId === issue.id}><Check size={14} />Mark solved</button>
                  : <button className="icon-button" type="button" onClick={() => reopen(issue)} disabled={busyId === issue.id} aria-label={`Reopen ${issue.title}`} title="Reopen"><RotateCcw size={14} /></button>}
                <button className="icon-button button-remove" type="button" onClick={() => remove(issue)} disabled={busyId === issue.id} aria-label={`Delete ${issue.title}`} title="Delete">{busyId === issue.id ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}</button>
              </div></td>
            </tr>;
          })}
          {!visible.length && <tr><td colSpan="5"><div className="table-empty">{category === 'Tech' ? <Wrench size={22} /> : <AlertCircle size={22} />}<strong>{empty[0]}</strong>{empty[1] && <span>{empty[1]}</span>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visible.length} of {mine.length} issues</span><span><i className="sync-dot" /> Saved to the Issues tab · times in Central</span></div>
      </section>
      {solving && <SolveIssuePopup issue={solving} defaultSolver={savedAuthor()} onClose={() => setSolving(null)} onSolve={async (values) => {
        const issue = await post(`/api/issues/${encodeURIComponent(solving.id)}/solve`, values, 'Could not mark this issue solved.');
        rememberAuthor(values.solvedBy);
        replace(issue);
        setSolving(null);
        onToast(`Solved: ${issue.title}${issue.timeOpen ? ` · open ${issue.timeOpen}` : ''}`);
      }} />}
    </>
  );
}

function SolveIssuePopup({ issue, defaultSolver, onClose, onSolve }) {
  const [solvedBy, setSolvedBy] = useState(SCHEDULE_ADDED_BY.includes(defaultSolver) ? defaultSolver : '');
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSolve({ solvedBy, resolution });
    } catch (solveError) {
      setError(solveError.message);
      setSaving(false);
    }
  }

  return (
    <div className="overlay is-centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="drawer note-popup" role="dialog" aria-modal="true" aria-labelledby="solve-issue-title">
        <div className="drawer-header">
          <div><span className="eyebrow">MARK SOLVED · {issue.id} · OPEN {(formatDuration(issueDuration(issue)) || '—').toUpperCase()}</span><h2 id="solve-issue-title">{issue.title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close"><X size={17} /></button>
        </div>
        <form className="note-popup-body" onSubmit={submit}>
          <div className="form-grid">
            <label className="field field-wide">Solved by<select value={solvedBy} onChange={(event) => setSolvedBy(event.target.value)} required autoFocus><option value="" disabled>Choose…</option>{SCHEDULE_ADDED_BY.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} /></label>
            <label className="field field-wide">How was it solved? (optional)<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={1000} rows={3} placeholder="e.g. Restarted the router, replaced the toner" /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />{saving ? 'Saving…' : 'Mark solved'}</button></div>
        </form>
      </section>
    </div>
  );
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

function CaseTypePills({ value, team = {}, status = {} }) {
  const types = CASE_TYPES.filter((type) => isCaseTypeSelected(value, type));
  if (!types.length) return <span className="muted">None</span>;
  return <span className="case-pills">{types.map((type) => <span key={type} className={`case-pill tone-${caseStatusTone(status[type])}`} title={`${type}: ${status[type] || 'Not Started'}${team[type] ? `, handled by ${team[type]}` : ', no team member yet'}`}>{type}{team[type] && <b> · {team[type]}</b>}</span>)}</span>;
}

// "2026-11-19 2:05 PM" (stored in Central Time) → "Nov 19, 2026 · 2:05 PM CT".
function formatNoteTime(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  return match ? `${formatDate(match[1])} · ${match[2]} CT` : value || '';
}

const NOTES_SHOWN = 3;

function NoteSummary({ entry }) {
  if (!entry) return <span className="muted">No notes</span>;
  return <span className="note-summary" title={`Latest by ${entry.latest.teamMember}: ${entry.latest.text}`}><MessageSquareText size={14} aria-hidden="true" /><b>{entry.count}</b><small>{formatNoteTime(entry.latest.createdAt).split(' · ')[0]}</small></span>;
}

// The note log for one client's case, newest first, with a box to add another.
function CaseNotes({ client, caseType, notes, loading, onAdded, expanded = false }) {
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(() => {
    let remembered = '';
    try { remembered = localStorage.getItem('note-author') || ''; } catch { /* no saved choice */ }
    return client.caseTeam?.[caseType] || (TEAM_MEMBERS.includes(remembered) ? remembered : '');
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(expanded);
  const shown = showAll ? notes : notes.slice(0, NOTES_SHOWN);

  async function add(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/case-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id, caseType, teamMember: author, text }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this note.');
      try { localStorage.setItem('note-author', author); } catch { /* remembered for this visit only */ }
      setText('');
      onAdded(result.note);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="case-notes">
      <form className="case-note-form" onSubmit={add}>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={2000} placeholder={`Add a note to the ${caseType} case…`} aria-label={`New note for the ${caseType} case`} required />
        <div className="case-note-actions">
          <label className="case-note-author">By<select value={author} onChange={(event) => setAuthor(event.target.value)} required aria-label="Who is writing this note"><option value="" disabled>Choose…</option>{TEAM_MEMBERS.map((name) => <option key={name}>{name}</option>)}</select></label>
          <button className="button button-primary" type="submit" disabled={saving || !text.trim() || !author}><Plus size={14} />{saving ? 'Saving…' : 'Add note'}</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
      {loading ? <p className="case-note-empty">Loading notes…</p>
        : !notes.length ? <p className="case-note-empty">No notes yet.</p>
          : <ol className="case-note-list">
            {shown.map((note) => <li key={note.id}>
              <div className="case-note-meta"><b>{note.teamMember || 'Unknown'}</b><time>{formatNoteTime(note.createdAt)}</time></div>
              <p>{note.text}</p>
            </li>)}
          </ol>}
      {notes.length > NOTES_SHOWN && <button className="text-button" type="button" onClick={() => setShowAll((all) => !all)}>{showAll ? 'Show fewer' : `Show all ${notes.length} notes`}</button>}
    </div>
  );
}

// Popup from a case page's Notes column: past notes plus a box to add one. The server stamps each
// note with the Central Time date and time it was saved.
function CaseNotesPopup({ client, caseType, notes, loading, onAdded, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="overlay is-centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="drawer note-popup" role="dialog" aria-modal="true" aria-labelledby="note-popup-title">
        <div className="drawer-header">
          <div>
            <span className="eyebrow">{caseType} NOTES</span>
            <h2 id="note-popup-title">{client.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close notes"><X size={17} /></button>
        </div>
        <div className="note-popup-body">
          <CaseNotes key={client.id} client={client} caseType={caseType} notes={notes} loading={loading} onAdded={onAdded} expanded />
          <p className="field-hint">Date and time (Central Time) are added automatically when you save.</p>
        </div>
      </section>
    </div>
  );
}

// Red / yellow / green status for one client's case.
function CaseStatusSelect({ value = 'Not Started', onChange, label }) {
  const options = CASE_STATUSES.includes(value) ? CASE_STATUSES : [...CASE_STATUSES, value];
  return <span className={`case-status-select tone-${caseStatusTone(value)}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <i aria-hidden="true" />
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      {options.map((status) => <option key={status} value={status}>{status}</option>)}
    </select>
    <ChevronDown size={13} aria-hidden="true" />
  </span>;
}

// Picks who handles one client's case. Keeps showing a name typed straight into the sheet even if it isn't on the team list.
function TeamSelect({ value = '', onChange, label, disabled = false }) {
  const names = value && !TEAM_MEMBERS.includes(value) ? [...TEAM_MEMBERS, value] : TEAM_MEMBERS;
  return <span className={`team-select ${value ? '' : 'is-empty'}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <UserRound size={14} aria-hidden="true" />
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} disabled={disabled}>
      <option value="">Unassigned</option>
      {names.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <ChevronDown size={13} aria-hidden="true" />
  </span>;
}

const PICKER_LIMIT = 200;

// Right-hand panel on a case page: every client not yet in this case, ready to drag into the list.
function CaseClientPicker({ clients, caseType, onAdd }) {
  return <ClientPicker
    clients={clients.filter((client) => !isCaseTypeSelected(client.caseType, caseType))}
    target={caseType}
    countLabel={`not in ${caseType}`}
    emptyLabel={`Every client is already in ${caseType}.`}
    onAdd={(client) => onAdd([client.id])}
  />;
}

// Draggable list of clients; dropping one on the target (or pressing +) calls onAdd(client).
function ClientPicker({ clients, target, countLabel, emptyLabel, onAdd, addLabel = `Add to ${target}` }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const text = query.trim().toLowerCase();
  const caseType = target;
  const available = clients
    .filter((client) => client.id)
    .filter((client) => !text || [client.name, client.id, client.email].some((value) => String(value || '').toLowerCase().includes(text)))
    .sort((left, right) => left.name.localeCompare(right.name));
  const shown = available.slice(0, PICKER_LIMIT);

  function startDrag(event, client) {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(CLIENT_DRAG_TYPE, JSON.stringify([client.id]));
    event.dataTransfer.setData('text/plain', client.name);
    setDragLabel(event, client.name);
  }

  async function add(client) {
    setAdding(client.id);
    try { await onAdd(client); } finally { setAdding(''); }
  }

  return (
    <aside className="surface case-picker" aria-label={`Clients to add to ${caseType}`}>
      <div className="case-picker-head">
        <div><h2>All clients</h2><span>{available.length} {countLabel}</span></div>
      </div>
      <label className="search-box case-picker-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID or email" aria-label="Search all clients" />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}</label>
      <p className="case-picker-hint"><GripVertical size={13} />Drag a client into the {caseType} list, or press +.</p>
      <ul className="case-picker-list">
        {shown.map((client) => <li key={client.id} draggable onDragStart={(event) => startDrag(event, client)} title={`Drag ${client.name} into ${caseType}`}>
          <GripVertical size={14} className="drag-grip" aria-hidden="true" />
          <span className="client-initials">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
          <span className="case-picker-name"><strong>{client.name}</strong><small>{client.id}{client.caseType ? ` · ${client.caseType}` : ''}</small></span>
          <button className="icon-button" type="button" onClick={() => add(client)} disabled={adding === client.id} aria-label={`${addLabel}: ${client.name}`} title={addLabel}>{adding === client.id ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}</button>
        </li>)}
        {!shown.length && <li className="case-picker-empty">{text ? 'No matching clients.' : emptyLabel}</li>}
      </ul>
      {available.length > PICKER_LIMIT && <p className="case-picker-more">Showing the first {PICKER_LIMIT} of {available.length}. Search to find others.</p>}
    </aside>
  );
}

function ClientList({ clients, search, onSearch, onSelectClient, onAssignCaseType, onDeleteClients, onSetTeamMember, onSetCaseStatus, notesVersion = 0, view = 'clients' }) {
  // MasterData columns can come and go; only show the ones that have data for someone.
  const hasFrequency = clients.some((client) => client.frequency);
  const hasNextContact = clients.some((client) => client.nextContactDate);
  const hasPayment = clients.some((client) => client.paymentStatus);
  const [statusFilter, setStatusFilter] = useState('all');
  const [caseNoteList, setCaseNoteList] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesClient, setNotesClient] = useState(null);
  const noteCaseType = view.startsWith('case:') ? view.slice('case:'.length) : '';
  // Every note on this case page (newest first); the Notes column and the notes popup read from it.
  useEffect(() => {
    if (!noteCaseType) return undefined;
    let active = true;
    setNotesLoading(true);
    fetch(`/api/case-notes?caseType=${encodeURIComponent(noteCaseType)}`)
      .then((response) => (response.ok ? response.json() : { notes: [] }))
      .then((result) => { if (active) setCaseNoteList(result.notes || []); })
      .catch(() => {})
      .finally(() => { if (active) setNotesLoading(false); });
    return () => { active = false; };
  }, [noteCaseType, notesVersion]);
  // Note count and latest note per client, for the Notes column.
  const noteSummary = useMemo(() => {
    const summary = new Map();
    for (const note of caseNoteList) {
      const entry = summary.get(note.clientId) || { count: 0, latest: note };
      entry.count += 1;
      summary.set(note.clientId, entry);
    }
    return summary;
  }, [caseNoteList]);
  const [selected, setSelected] = useState(() => new Set());
  const [assigning, setAssigning] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState('');
  const [bulkDeletedBy, setBulkDeletedBy] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const selectedNames = clients.filter((client) => selected.has(client.id)).map((client) => client.name);

  async function confirmBulkDelete(event) {
    event.preventDefault();
    setBulkBusy(true);
    setBulkError('');
    try {
      const { deleted, failed } = await onDeleteClients([...selected], bulkDeletedBy);
      const gone = new Set(deleted.map((client) => client.id));
      setSelected((current) => new Set([...current].filter((id) => !gone.has(id))));
      if (failed.length) setBulkError(`Not deleted: ${failed.map((item) => `${item.name} (${item.error})`).join('; ')}`);
      else { setBulkDeleting(false); setBulkConfirm(''); }
    } catch (error) {
      setBulkError(error.message);
    } finally {
      setBulkBusy(false);
    }
  }
  const [frequency, setFrequency] = useState('All frequencies');
  const [payment, setPayment] = useState('All payment statuses');
  const [sortOrder, setSortOrder] = useState('name');
  const [teamFilter, setTeamFilter] = useState('all');
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const clear = () => setDropActive(false);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);
  const today = centralDateKey();
  const caseType = view.startsWith('case:') ? view.slice('case:'.length) : '';
  const takesDrops = Boolean(caseType) && acceptsExistingClients(caseType);
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
    const handler = caseType ? client.caseTeam?.[caseType] || '' : '';
    const matchesTeam = !caseType || teamFilter === 'all' || (teamFilter === 'none' ? !handler : handler === teamFilter);
    const matchesStatus = !caseType || statusFilter === 'all' || (client.caseStatus?.[caseType] || 'Not Started') === statusFilter;
    return matchesTeam && matchesStatus && matchesQuery && matchesFrequency && matchesPayment && matchesCaseType && matchesFollowUps && matchesWeek && matchesPayments;
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

  // Drops from the All clients panel. Rows dragged within this list are already in the case, so they're ignored.
  function dropIntoCase(event) {
    event.preventDefault();
    setDropActive(false);
    const inCase = new Set(clients.filter((client) => isCaseTypeSelected(client.caseType, caseType)).map((client) => client.id));
    const ids = clientIdsFromDrag(event).filter((id) => !inCase.has(id));
    if (ids.length) assign(ids, caseType, true);
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
          <FilterMenu label="Add selected clients to a case type" value="" onChange={(type) => assign([...selected], type, true)} icon={Plus} options={[{ value: '', label: assigning ? 'Saving…' : 'Add to…' }, ...CASE_TYPES.filter(acceptsExistingClients).map((type) => ({ value: type, label: type }))]} />
          {caseType && <button className="button button-secondary button-remove" type="button" disabled={assigning} onClick={() => assign([...selected], caseType, false)}><X size={14} />Remove from {caseType}</button>}
          <button className="button button-secondary button-remove" type="button" onClick={() => { setBulkError(''); setBulkDeleting((open) => !open); }} aria-expanded={bulkDeleting}><Trash2 size={14} />Delete {selected.size === 1 ? 'client' : `${selected.size} clients`}</button>
          <button className="text-button" type="button" onClick={() => { setSelected(new Set()); setBulkDeleting(false); }}>Clear selection</button>
          <span className="selection-hint">or drag them onto a case type in the sidebar</span>
          {bulkDeleting && <form className="delete-panel bulk-delete-panel" onSubmit={confirmBulkDelete}>
            <strong>Delete {selected.size === 1 ? '1 client' : `${selected.size} clients`}?</strong>
            <p className="bulk-delete-names">{selectedNames.slice(0, 12).join(', ')}{selectedNames.length > 12 ? `, and ${selectedNames.length - 12} more` : ''}</p>
            <p>Each one is removed from MasterData, Client_Info and every case tab (with status and team member). Case notes and schedule appointments stay as history. Every deletion is logged with your name and the time (Central). This can’t be undone in the app.</p>
            <div className="bulk-delete-fields">
              <label className="field">Type <b className="delete-name">DELETE</b> to confirm<input value={bulkConfirm} onChange={(event) => setBulkConfirm(event.target.value)} autoComplete="off" autoFocus /></label>
              <label className="field">Deleted by<select value={bulkDeletedBy} onChange={(event) => setBulkDeletedBy(event.target.value)} required><option value="" disabled>Choose…</option>{SCHEDULE_ADDED_BY.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={15} /></label>
            </div>
            {bulkError && <div className="form-error" role="alert">{bulkError}</div>}
            <div className="reminder-actions"><button className="button button-secondary" type="button" onClick={() => setBulkDeleting(false)} disabled={bulkBusy}>Cancel</button><button className="button button-danger" type="submit" disabled={bulkConfirm.trim() !== 'DELETE' || !bulkDeletedBy || bulkBusy}><Trash2 size={15} />{bulkBusy ? `Deleting ${selected.size}…` : 'Delete permanently'}</button></div>
          </form>}
        </div>
        : <p className="drag-hint"><GripVertical size={14} />{!caseType ? 'Tip: drag a client onto a case type in the sidebar, or tick several and drag them together.' : takesDrops ? `Drag clients from the All clients list on the right into this list to add them to ${caseType}.` : 'Use Add potential client (top right) for a new prospect. Clients added with Onboarding ticked also appear here.'}</p>}
      <div className={takesDrops ? 'case-layout' : undefined}>
      <section
        className={`surface roster-surface ${dropActive ? 'is-drop-active' : ''}`}
        onDragOver={takesDrops ? (event) => { if (!isClientDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (!dropActive) setDropActive(true); } : undefined}
        onDragLeave={takesDrops ? (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); } : undefined}
        onDrop={takesDrops ? dropIntoCase : undefined}
      >
        {dropActive && <div className="drop-banner" aria-hidden="true"><Plus size={16} />Drop to add to {caseType}</div>}
        <div className="roster-toolbar">
          <label className="search-box"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, email or ID" aria-label="Search clients" />{search && <button className="clear-search" onClick={() => onSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          {hasFrequency && <FilterMenu label="Meeting frequency" value={frequency} onChange={setFrequency} icon={SlidersHorizontal} options={[{ value: 'All frequencies', label: 'All frequencies' }, ...frequencies.map((item) => ({ value: item, label: item }))]} />}
          {hasPayment && <FilterMenu label="Payment status" value={payment} onChange={setPayment} icon={CreditCard} options={[{ value: 'All payment statuses', label: 'All payment statuses' }, { value: 'Pending', label: 'Pending' }, { value: 'Up to Date', label: 'Up to Date' }]} />}
          {caseType && <FilterMenu label="Status" value={statusFilter} onChange={setStatusFilter} icon={Check} options={[{ value: 'all', label: 'All statuses' }, ...CASE_STATUSES.map((status) => ({ value: status, label: status }))]} />}
          {caseType && <FilterMenu label="Team member" value={teamFilter} onChange={setTeamFilter} icon={UserRound} options={[{ value: 'all', label: 'All team members' }, ...TEAM_MEMBERS.map((name) => ({ value: name, label: name })), { value: 'none', label: 'Unassigned' }]} />}
          <FilterMenu label="Sort clients" value={sortOrder} onChange={setSortOrder} icon={ArrowDownAZ} options={[{ value: 'name', label: 'Name A-Z' }, { value: 'clientId', label: 'CL number' }]} />
        </div>
        <div className="table-scroll"><table className="client-table client-roster-table"><thead><tr><th className="select-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!selectable.length} aria-label="Select all shown clients" /></th><th>Client</th>{caseType ? <><th>Status</th><th>Team member</th><th>Notes</th></> : <th>Case type</th>}{hasFrequency && <th>Meeting frequency</th>}{hasNextContact && <th>Next contact</th>}{hasPayment && <th>Payment</th>}<th aria-label="Open client" /></tr></thead><tbody>
          {visibleClients.map((client) => <tr key={client.id || client.email} className={selected.has(client.id) ? 'is-selected' : ''} draggable={Boolean(client.id)} onDragStart={(event) => startDrag(event, client)} onClick={() => onSelectClient(client)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && event.target === event.currentTarget && onSelectClient(client)}><td className="select-cell" onClick={(event) => event.stopPropagation()}><GripVertical size={14} className="drag-grip" aria-hidden="true" /><input type="checkbox" checked={selected.has(client.id)} onChange={() => toggleOne(client.id)} disabled={!client.id} aria-label={`Select ${client.name}`} /></td><td><div className="client-name-cell"><span className="client-initials">{client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.id} <i /> {client.email || 'No email'}</small></span></div></td>{caseType ? <><td><CaseStatusSelect value={client.caseStatus?.[caseType] || 'Not Started'} onChange={(status) => onSetCaseStatus(client, caseType, status)} label={`Status of ${client.name}'s ${caseType} case`} /></td><td><TeamSelect value={client.caseTeam?.[caseType] || ''} onChange={(member) => onSetTeamMember(client, caseType, member)} label={`Team member for ${client.name}'s ${caseType} case`} /></td><td onClick={(event) => event.stopPropagation()}><button className="note-cell-button" type="button" onClick={() => setNotesClient(client)} disabled={!client.id} aria-label={`Notes for ${client.name}'s ${caseType} case`} title="View or add notes"><NoteSummary entry={noteSummary.get(client.id)} /></button></td></> : <td><CaseTypePills value={client.caseType} team={client.caseTeam} status={client.caseStatus} /></td>}{hasFrequency && <td>{client.frequency || <span className="muted">Not set</span>}</td>}{hasNextContact && <td><span className={daysUntil(client.nextContactDate) < 0 ? 'text-overdue' : ''}>{formatDate(client.nextContactDate)}</span></td>}{hasPayment && <td><Status value={client.paymentStatus} /></td>}<td><ArrowRight size={15} className="row-arrow" /></td></tr>)}
          {!visibleClients.length && <tr><td colSpan={3 + (caseType ? 3 : 1) + [hasFrequency, hasNextContact, hasPayment].filter(Boolean).length}><div className="table-empty">{caseType && !clients.some((client) => isCaseTypeSelected(client.caseType, caseType)) ? <><GripVertical size={22} /><strong>No clients in {caseType} yet</strong><span>{takesDrops ? 'Drag clients here from the All clients list on the right.' : 'Click Add potential client to add the first one.'}</span></> : <><Search size={22} /><strong>No matching clients</strong><span>Try another name or filter.</span></>}</div></td></tr>}
        </tbody></table></div>
        <div className="table-foot"><span>Showing {visibleClients.length} of {clients.length}</span><span><i className="sync-dot" /> Synced from MasterData</span></div>
      </section>
      {notesClient && caseType && <CaseNotesPopup
        client={notesClient}
        caseType={caseType}
        notes={caseNoteList.filter((note) => note.clientId === notesClient.id)}
        loading={notesLoading}
        onAdded={(note) => setCaseNoteList((current) => [note, ...current])}
        onClose={() => setNotesClient(null)}
      />}
      {takesDrops && <CaseClientPicker clients={clients} caseType={caseType} onAdd={(ids) => assign(ids, caseType, true)} />}
      </div>
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
  const [notesVersion, setNotesVersion] = useState(0);
  useEffect(() => {
    try { localStorage.setItem('nav-clients-open', String(clientsOpen)); } catch { /* remembered for this visit only */ }
  }, [clientsOpen]);
  const [issuesOpen, setIssuesOpen] = useState(() => {
    try { return localStorage.getItem('nav-issues-open') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nav-issues-open', String(issuesOpen)); } catch { /* remembered for this visit only */ }
  }, [issuesOpen]);
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
  const [courtDatesError, setCourtDatesError] = useState({ tracker: '', new: '' });
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  // '' (closed), 'client' (full intake) or 'potential' (short Onboarding form).
  const [intakeOpen, setIntakeOpen] = useState('');
  const [loadError, setLoadError] = useState('');
  const [caseError, setCaseError] = useState('');
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
          setCourtDatesError({ tracker: result.trackerError || '', new: result.newError || '' });
        }
      } catch (error) {
        const message = error.message || 'Could not load court dates.';
        if (active) setCourtDatesError({ tracker: message, new: message });
      }
    };
    const load = async () => {
      try {
        const response = await fetch('/api/clients');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the client data.');
        if (active) {
          setClients(result.clients);
          setCaseError(result.caseError || '');
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

  async function reloadCourtDates() {
    try {
      const response = await fetch('/api/court-dates');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setCourtDates(result.courtDates || []);
      setCourtDatesError({ tracker: result.trackerError || '', new: result.newError || '' });
    } catch { /* the regular refresh will try again */ }
  }

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
        setCourtDatesError({ tracker: courtResult.trackerError || '', new: courtResult.newError || '' });
      } else {
        const message = courtResult.error || 'Could not load court dates.';
        setCourtDatesError({ tracker: message, new: message });
      }
      setClients(result.clients);
      setCaseError(result.caseError || '');
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
    if (result.caseError) setCaseError(result.caseError);
    return result.client;
  }

  // Adds or removes one case type for several clients. The table updates at once and is
  // put back if the Clients_Additional_Info spreadsheet can't be updated.
  async function assignCaseType(ids, caseType, add) {
    const changing = clients.filter((client) => ids.includes(client.id) && isCaseTypeSelected(client.caseType, caseType) !== add);
    if (!changing.length) {
      setToast(ids.length === 1 ? `Already ${add ? 'in' : 'not in'} ${caseType}` : `All ${ids.length} are already ${add ? 'in' : 'out of'} ${caseType}`);
      return true;
    }
    const nextValue = new Map(changing.map((client) => [client.id, updateCaseTypeValue(client.caseType, caseType, add)]));
    setClients((current) => current.map((client) => nextValue.has(client.id) ? { ...client, caseType: nextValue.get(client.id) } : client));
    // One request for the whole drop; it only touches the case tab in Clients_Additional_Info.
    try {
      const response = await fetch('/api/case-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseType, add, clientIds: changing.map((client) => client.id) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update case types.');
      const confirmed = new Map(result.clients.map((client) => [client.id, client]));
      setClients((current) => current.map((client) => confirmed.has(client.id) ? { ...client, caseType: confirmed.get(client.id).caseType, caseTeam: confirmed.get(client.id).caseTeam, caseStatus: confirmed.get(client.id).caseStatus } : client));
      const who = changing.length === 1 ? changing[0].name : `${changing.length} clients`;
      setToast(add ? `Added ${who} to ${caseType}` : `Removed ${who} from ${caseType}`);
      return true;
    } catch (error) {
      const original = new Map(changing.map((client) => [client.id, client.caseType]));
      setClients((current) => current.map((client) => original.has(client.id) ? { ...client, caseType: original.get(client.id) } : client));
      setCaseError(error.message);
      return false;
    }
  }

  // Saves who handles one client's case (detail 'team') or how far along it is ('status').
  // Shown at once; put back if the sheet can't be saved.
  async function setCaseDetail(client, caseType, detail, value) {
    const field = detail === 'status' ? 'caseStatus' : 'caseTeam';
    const previous = client[field]?.[caseType] || '';
    if (previous === value) return;
    const apply = (next) => {
      const patch = (item) => item.id === client.id ? { ...item, [field]: { ...item[field], [caseType]: next } } : item;
      setClients((current) => current.map(patch));
      setSelectedClient((current) => current && patch(current));
    };
    apply(value);
    try {
      const response = await fetch(`/api/case-assignments/${detail}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseType, clientId: client.id, [detail === 'status' ? 'status' : 'teamMember']: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save this change.');
      if (detail === 'status') setToast(`${client.name}'s ${caseType} case: ${value}`);
      else setToast(value ? `${value} now handles ${client.name}'s ${caseType} case` : `${client.name}'s ${caseType} case is unassigned`);
    } catch (error) {
      apply(previous);
      setCaseError(error.message);
    }
  }
  function noteAdded(note) {
    setNotesVersion((version) => version + 1);
    setToast(`Note added to ${note.clientName}'s ${note.caseType} case`);
  }
  const setTeamMember = (client, caseType, member) => setCaseDetail(client, caseType, 'team', member);
  const setCaseStatus = (client, caseType, status) => setCaseDetail(client, caseType, 'status', status);

  function dropOnCaseType(event, caseType) {
    event.preventDefault();
    setDropTarget('');
    const ids = clientIdsFromDrag(event);
    if (ids.length) assignCaseType(ids, caseType, true);
  }

  async function deleteClient(client, { confirmName, deletedBy }) {
    const response = await fetch(`/api/clients/${encodeURIComponent(client.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName, deletedBy }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete this client.');
    setClients((current) => current.filter((item) => item.id !== client.id));
    setSelectedClient(null);
    setToast(`Deleted: ${client.name}`);
    if (result.warning) setCaseError(result.warning);
  }

  // Bulk delete from the client list; returns which were deleted and which failed.
  async function bulkDeleteClients(clientIds, deletedBy) {
    const response = await fetch('/api/clients/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientIds, deletedBy, confirm: 'DELETE' }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete these clients.');
    const gone = new Set(result.deleted.map((client) => client.id));
    setClients((current) => current.filter((client) => !gone.has(client.id)));
    setSelectedClient((current) => (current && gone.has(current.id) ? null : current));
    if (result.deleted.length) setToast(result.deleted.length === 1 ? `Deleted: ${result.deleted[0].name}` : `Deleted ${result.deleted.length} clients`);
    if (result.warnings?.length) setCaseError(result.warnings.join(' '));
    return result;
  }

  function createdClient(result) {
    setClients((current) => [...current, result.client].sort((left, right) => left.name.localeCompare(right.name)));
    setLastUpdated(result.modifiedAt);
    setDataSource(result.source || dataSource);
    const potential = intakeOpen === 'potential';
    setIntakeOpen('');
    // A potential client stays on the Onboarding page, where they now appear.
    setPage(potential ? `results:case:${NEW_CLIENT_TYPE}` : 'clients');
    setSearch(result.client.name);
    setToast(`${potential ? 'Potential client added' : 'Submitted'}: ${result.client.name}`);
    if (result.caseError) setCaseError(result.caseError);
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
  // Clicking Clients opens its case-type list and shows All Clients; clicking again folds the list away.
  const toggleClients = () => {
    if (clientsOpen) return setClientsOpen(false);
    setClientsOpen(true);
    setPage('clients');
  };
  const inClientsSection = page === 'clients' || (page.startsWith('results:') && page !== 'results:court-dates');
  // Clicking Issues opens its list and shows Tech Issues; clicking again folds the list away.
  const toggleIssues = () => {
    if (issuesOpen) return setIssuesOpen(false);
    setIssuesOpen(true);
    setPage(ISSUE_TABS[0].page);
  };
  const issueTab = ISSUE_TABS.find((tab) => tab.page === page);
  const extraTab = EXTRA_TABS.find((tab) => tab.page === page);
  // The full intake is offered only on the Overview and All Clients pages.
  const showAddClient = page === 'dashboard' || page === 'clients';
  const onOnboardingPage = resultView === `case:${NEW_CLIENT_TYPE}`;
  const pageTitle = ({ dashboard: 'Overview', clients: 'Clients', payments: 'Payment', 'court-dates': 'Court Date', 'work-permits': 'Work Permit', schedule: 'Schedule' })[page] || extraTab?.label || issueTab?.label
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
            <button className={`nav-item ${inClientsSection && !clientsOpen ? 'active' : ''} ${inClientsSection ? 'is-current' : ''}`} onClick={toggleClients} aria-expanded={clientsOpen} aria-controls="nav-client-types" onDragOver={(event) => { if (isClientDrag(event)) setClientsOpen(true); }}><UsersRound size={18} /><span>Clients</span><span className="nav-count">{clients.length}</span></button>
          </div>
          {clientsOpen && <div className="nav-children" id="nav-client-types">
            <button className={`nav-child ${page === 'clients' ? 'active' : ''}`} onClick={() => setPage('clients')}><span>All Clients</span><span className="nav-count">{clients.length}</span></button>
            {CASE_TYPES.map((type) => <button
              key={type}
              className={`nav-child ${page === `results:case:${type}` ? 'active' : ''} ${dropTarget === type ? 'is-drop-target' : ''}`}
              onClick={() => { setSearch(''); setPage(`results:case:${type}`); }}
              onDragOver={(event) => { if (!acceptsExistingClients(type) || !isClientDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; if (dropTarget !== type) setDropTarget(type); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current === type ? '' : current); }}
              onDrop={(event) => dropOnCaseType(event, type)}
              title={acceptsExistingClients(type) ? `Show ${type} clients, or drop clients here to add them to ${type}` : `Show ${type} clients (new clients only)`}
            ><span>{type}</span><span className="nav-count">{caseCounts[type]}</span></button>)}
          </div>}
        </div><button className={`nav-item ${page === 'schedule' ? 'active' : ''}`} onClick={() => setPage('schedule')}><CalendarClock size={18} /><span>Schedule</span></button><button className={`nav-item ${page === 'payments' ? 'active' : ''}`} onClick={() => setPage('payments')}><CreditCard size={18} /><span>Payment</span></button><button className={`nav-item ${page === 'court-dates' || page === 'results:court-dates' ? 'active' : ''}`} onClick={() => setPage('court-dates')}><CalendarDays size={18} /><span>Court Date</span></button><button className={`nav-item ${page === 'work-permits' ? 'active' : ''}`} onClick={() => setPage('work-permits')}><Briefcase size={18} /><span>Work Permit</span></button>{EXTRA_TABS.map(({ page: tabPage, label, icon: Icon }) => <button key={tabPage} className={`nav-item ${page === tabPage ? 'active' : ''}`} onClick={() => setPage(tabPage)}><Icon size={18} /><span>{label}</span></button>)}<div className="nav-group">
          <div className="nav-group-head">
            <button className={`nav-item ${issueTab && !issuesOpen ? 'active' : ''} ${issueTab ? 'is-current' : ''}`} onClick={toggleIssues} aria-expanded={issuesOpen} aria-controls="nav-issue-types"><AlertCircle size={18} /><span>Issues</span></button>
          </div>
          {issuesOpen && <div className="nav-children" id="nav-issue-types">
            {ISSUE_TABS.map(({ page: tabPage, label }) => <button key={tabPage} className={`nav-child ${page === tabPage ? 'active' : ''}`} onClick={() => setPage(tabPage)}><span>{label}</span></button>)}
          </div>}
        </div></div>
        <div className="sidebar-bottom"><div className="workbook-chip"><FileSpreadsheet size={17} /><span><b>MasterData</b><small>{dataSource === 'Google Sheets' ? 'Google Sheets' : 'Excel workbook'}</small></span><span className="live-mark" title="Live data connection" /></div><div className="sidebar-user"><span className="user-avatar">CS</span><span><b>Case services</b><small>{loginRequired ? 'Private workspace' : 'Local workspace'}</small></span><Menu size={17} /></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><b>{pageTitle}</b></div><div className="topbar-actions"><CentralClock /><span className="sync-state"><i className="sync-dot" />{updatedLabel}</span><button className={`icon-button refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={refreshWorkbook} aria-label="Refresh client data" title="Refresh data"><RefreshCw size={17} /></button><ThemeToggle theme={theme} onToggle={toggleTheme} />{loginRequired && <button className="icon-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>}{onOnboardingPage
                ? <button className="button button-primary top-add" onClick={() => setIntakeOpen('potential')}><UserPlus size={16} />Add potential client</button>
                : showAddClient && <button className="button button-primary top-add" onClick={() => setIntakeOpen('client')}><Plus size={16} />Add client</button>}</div></header>
        <div className="page-content">
          {loadError && <div className="load-error" role="alert"><span>{loadError}</span><button onClick={refreshWorkbook}>Retry <RefreshCw size={14} /></button></div>}
          {caseError && <div className="load-error" role="alert"><span>{caseError}</span><button onClick={() => setCaseError('')}>Dismiss <X size={14} /></button></div>}
          {page === 'dashboard'
            ? <Dashboard clients={clients} courtDates={courtDates} now={new Date()} onShowClients={() => setPage('clients')} onShowResults={showMetricResults} onShowSchedule={() => setPage('schedule')} onSelectClient={setSelectedClient} onCompleteFollowUp={completeFollowUp} />
            : page === 'clients'
              ? <ClientList clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} onAssignCaseType={assignCaseType} onDeleteClients={bulkDeleteClients} onSetTeamMember={setTeamMember} onSetCaseStatus={setCaseStatus} />
              : page === 'work-permits'
                ? <WorkPermitList clients={clients} onToast={setToast} />
              : page === 'payments'
                ? <PaymentReminders clients={clients} />
              : page === 'court-dates' || resultView === 'court-dates'
                ? <CourtDateList clients={clients} courtDates={courtDates} error={courtDatesError} onSelectClient={setSelectedClient} onCourtDateSaved={(courtDate, verb) => { setCourtDates((current) => [courtDate, ...current.filter((item) => item.id !== courtDate.id)]); setToast(`Court date ${verb} for ${courtDate.clientName}`); }} onCourtDateDeleted={async (courtDate) => { setCourtDates((current) => current.filter((item) => item.id !== courtDate.id)); setToast(`Court date deleted for ${courtDate.clientName}`); await reloadCourtDates(); }} />
                : resultView
                  ? <ClientList key={resultView} clients={clients} search={search} onSearch={setSearch} onSelectClient={setSelectedClient} onAssignCaseType={assignCaseType} onDeleteClients={bulkDeleteClients} onSetTeamMember={setTeamMember} onSetCaseStatus={setCaseStatus} notesVersion={notesVersion} view={resultView} />
              : page === 'schedule'
                ? <SchedulePage clients={clients} onSelectClient={setSelectedClient} onToast={setToast} />
              : page === 'credentials'
                ? <CredentialsPage onToast={setToast} />
              : issueTab
                ? <IssuesPage key={issueTab.page} category={issueTab.category} onToast={setToast} />
              : extraTab
                ? <ComingSoon key={extraTab.page} title={extraTab.label} icon={extraTab.icon} />
              : <Dashboard clients={clients} courtDates={courtDates} now={new Date()} onShowClients={() => setPage('clients')} onShowResults={showMetricResults} onShowSchedule={() => setPage('schedule')} onSelectClient={setSelectedClient} onCompleteFollowUp={completeFollowUp} />}
          <footer className="page-footer"><span><i className="sync-dot" /> {dataSource} connection active</span><span>{dataSource === 'Google Sheets' ? 'Sheet checked every 20 seconds' : 'Workbook checked every 20 seconds'}</span></footer>
        </div>
      </main>
      {intakeOpen && <ClientForm key={intakeOpen} potential={intakeOpen === 'potential'} onClose={() => setIntakeOpen('')} onCreated={createdClient} />}
      {selectedClient && <ClientDetails client={selectedClient} courtDates={courtDates} onClose={() => setSelectedClient(null)} onUpdate={updateClient} onDelete={deleteClient} onSetTeamMember={setTeamMember} onSetCaseStatus={setCaseStatus} onNoteAdded={noteAdded} />}
      {toast && <div className="toast"><span><Check size={15} /></span>{toast}</div>}
    </div>
  );
}
