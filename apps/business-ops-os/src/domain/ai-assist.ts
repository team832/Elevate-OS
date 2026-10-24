/**
 * AI draft helpers (owner request 23 Oct 2026) — the pure parts: what may leave Elevate OS.
 * Feedback text is redacted before it is sent (names, contacts, codes, long numbers); CSV cells
 * are never sent, only their shape. Conservative on purpose: a few ordinary words may be
 * masked, a name should not get through.
 */

export const AI_FEATURES = [
  'feedbackSummary',
  'reportDraft',
  'taskBrief',
  'csvMapping',
  'scoreSheet',
  /** The AI summary on the student page (D-111); progress and teacher report comments use reportDraft. */
  'studentSummary',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** One suggested value: `name` is the form field it fills; `shown` is how it reads, if not `value`. */
export interface DraftItem {
  name: string;
  label: string;
  value: string;
  shown?: string;
}

export const AI_NOT_SET_UP = 'AI drafting is not set up.';
export const AI_FAILED = "AI drafting didn't respond. Try again or write it yourself.";
export const AI_DRAFT_LABEL = 'AI draft — check before saving';
export const AI_SUMMARY_LABEL = 'AI summary — check before relying on it';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(?:\(\+?|\+)?\d[\d\s().-]{7,}\d/g;
const DATE =
  /(?<![\d-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))(?![\d-])/g;

/** Runs `mask` with dates (2026-09-16, 16-09-2026) set aside, so they are never masked. */
function keepDates(text: string, mask: (t: string) => string) {
  const dates: string[] = [];
  return mask(text.replace(DATE, (d) => `§${'x'.repeat(dates.push(d))}§`)).replace(
    /§(x+)§/g,
    (_, x: string) => dates[x.length - 1]!,
  );
}

/** Phone numbers: 10+ digits, any +91 form. */
const maskPhones = (t: string) =>
  t.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));

/** Emails and phone numbers masked (free text the person typed). */
export const redactContacts = (text: string) =>
  keepDates(text.replace(EMAIL, '[email]'), maskPhones);

/** Role, subject and placeholder words that are never treated as part of a name. */
const NOT_NAMES = new Set(
  (
    'sample demo test student students parent parents guardian teacher teachers faculty tutor ' +
    'mentor sir madam maam miss staff manager coordinator counsellor counselor director auditor ' +
    'operations admissions marketing contributor employee hr admin head principal class batch ' +
    'maths math mathematics physics chemistry biology science english hindi economics accounting ' +
    'accountancy accounts business studies commerce quant quantitative aptitude reasoning logical ' +
    'legal verbal current affairs general knowledge gk history geography political polity civics ' +
    'computer online offline'
  ).split(' '),
);

/**
 * Known people reduced to their name words, ready for `redact`: sample people ("Sample …") are
 * left out, and so are role, subject and catalogue words (`catalogue`: programme names and codes),
 * so "Sample Maths Teacher" masks nothing and "the teacher explains" stays readable.
 */
export function namesToMask(names: readonly string[], catalogue: readonly string[] = []) {
  const stop = new Set([
    ...NOT_NAMES,
    ...catalogue.flatMap((c) => c.toLowerCase().split(/[^\p{L}]+/u)),
  ]);
  return names
    .filter((n) => !/\bsample\b/i.test(n))
    .map((n) =>
      n
        .split(/[\s.]+/)
        .filter((p) => /^\p{L}+$/u.test(p) && !stop.has(p.toLowerCase()))
        .join(' '),
    )
    .filter(Boolean);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One regex for several patterns (already escaped), longest first. */
const anyOf = (words: readonly string[], flags: string) =>
  words.length
    ? new RegExp(
        `\\b(?:${[...new Set(words)].sort((a, b) => b.length - a.length).join('|')})\\b`,
        flags,
      )
    : null;

/** Masks known names: full names and parts of 5+ letters in any case; shorter parts (a 2-letter one only as a first name) only when capitalised. */
function maskNames(t: string, names: readonly string[]) {
  const words = names.map((n) => n.split(' '));
  const full = anyOf(
    words.filter((w) => w.length > 1).map((w) => w.map(escape).join('\\s+')),
    'gi',
  );
  const long = anyOf(
    words
      .flat()
      .filter((p) => p.length >= 5)
      .map(escape),
    'gi',
  );
  const short = anyOf(
    words.flatMap((w) =>
      w
        .filter((p, i) => p.length <= 4 && (p.length >= 3 || (i === 0 && p.length === 2)))
        .map((p) => escape(p[0]!.toUpperCase() + p.slice(1).toLowerCase())),
    ),
    'g',
  );
  for (const re of [full, long, short]) if (re) t = t.replace(re, '[name]');
  return t;
}

/**
 * Text made safe to send. Always: emails; phones; codes mixing letters and digits (SAMPLE-ADM-1,
 * EL/2026/014, IPMATC12APR27, EE2026001 — not ordinals like 12th); roll/admission numbers
 * ("roll 42"); known names (see `namesToMask`); a title followed by a name; a Hindi word before
 * सर/मैम/जी. `feedback` mode also masks numbers of 3+ digits (bare admission numbers) and runs of
 * two or more capitalised words (most full names). `facts` mode keeps counts ("graded 120 papers")
 * and capitalised titles. Dates always stay. Residual risk: an unknown name in lower case gets through.
 */
export function redact(
  text: string,
  knownNames: readonly string[] = [],
  mode: 'feedback' | 'facts' = 'feedback',
) {
  let t = keepDates(text.replace(EMAIL, '[email]'), (s) => {
    const masked = maskPhones(
      s.replace(/\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*\b/g, (m) =>
        m.length >= 3 && /\d/.test(m) && /[A-Za-z]/.test(m) && !/^\d+(st|nd|rd|th)$/i.test(m)
          ? '[code]'
          : m,
      ),
    ).replace(
      /\b(roll|adm(?:ission)?|reg(?:istration)?|enrol(?:ment)?|sr)\.?\s*(?:no\.?|number|#)?\s*[:#-]?\s*\d+\b/gi,
      '$1 [number]',
    );
    return mode === 'feedback' ? masked.replace(/\b\d{3,}\b/g, '[number]') : masked;
  }).replace(
    /\p{Script=Devanagari}+(?=\s*(?:सर|मैम|मैडम|जी)(?!\p{Script=Devanagari}))/gu,
    '[name]',
  );
  t = maskNames(t, knownNames).replace(/\b(Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+/g, '$1 [name]');
  return mode === 'feedback' ? t.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, '[name]') : t;
}

/** What a CSV cell looks like, never what it says. */
export const VALUE_SHAPES = [
  'empty',
  'date',
  'date and time',
  'time',
  'small whole number (1-10)',
  'number',
  'email',
  'phone',
  'code (letters and digits)',
  'yes/no or in/out word',
  'short text',
  'long text',
] as const;
export type ValueShape = (typeof VALUE_SHAPES)[number];

export function shapeOf(raw: string): ValueShape {
  const v = raw.trim();
  if (!v) return 'empty';
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(v) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4} \d/.test(v))
    return 'date and time';
  if (/^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(v)) return 'date';
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i.test(v)) return 'time';
  if (/^([1-9]|10)$/.test(v)) return 'small whole number (1-10)';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v.length >= 10 ? 'phone' : 'number';
  if (new RegExp(`^${EMAIL.source}$`).test(v)) return 'email';
  if (/^\+?[\d\s().-]{8,}$/.test(v)) return 'phone';
  if (/^(yes|no|y|n|in|out|true|false)$/i.test(v)) return 'yes/no or in/out word';
  if (/^[A-Za-z0-9]+([-/_][A-Za-z0-9]+)*$/.test(v) && /\d/.test(v))
    return 'code (letters and digits)';
  return v.length > 40 ? 'long text' : 'short text';
}

/** The punch file's columns (domain/attendance.ts parsePunchCsv reads these headings). */
export const PUNCH_COLUMNS = { staffCode: 'Staff code', at: 'Date-time', direction: 'Direction' };

/** Headings of the cells read from a score sheet PDF (a section's is `Section <code>`). */
export const SHEET_COLUMNS = {
  admission_number: 'Admission number',
  student_code: 'Student code',
  name: 'Name',
  total: 'Total',
  attendance: 'Attendance',
} as const;
