/**
 * Import of the original task tracker's backup file (owner brief 2 §13; field map in
 * docs/task-tracker-source-map.md). Pure. The source is one employee's
 * `Task-EOD-backup-YYYY-MM-DD.json`, written by the tracker's "Backup → Export backup" button.
 * The file is parsed as data (JSON.parse, never executed), validated record by record and mapped
 * onto Elevate fields. D-052: written from the file's shape; no tracker code is reused.
 */
import { z } from 'zod';
import { isIsoDate } from './dates';
import type { TaskBlockKind, TaskPriority, TaskRecurrence, TaskStatus } from './staff-tasks';

export const TRACKER_SOURCE_KIND = 'deskday_backup_json';
/** The largest backup accepted (characters); a year of tasks and reports is well under 1 MB. */
export const MAX_BACKUP_CHARS = 5_000_000;

export const NOT_AN_EXPORT =
  'This is the tracker program, not a data export. Open it in the browser, choose Backup → Export backup, and upload the Task-EOD-backup-….json file it downloads.';

/**
 * Statuses the tracker writes, lower-cased (older versions wrote "Not Started", "In Progress",
 * "On-Hold"). Blocked and On-hold become the blocked flag (R4); the status comes from progress.
 */
const STATUSES: Record<string, TaskStatus | TaskBlockKind> = {
  'not started': 'pending',
  'in progress': 'in_progress',
  done: 'done',
  blocked: 'blocked',
  'on-hold': 'on_hold',
};
const PRIORITIES: Record<string, TaskPriority> = { high: 'high', medium: 'medium', low: 'low' };
const RECURRENCES: Record<string, TaskRecurrence> = {
  '': 'none',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
};

/** Said once per import: the tracker's "today" was the UTC day, not the IST day. */
export const UTC_DAY_NOTE =
  'The tracker took "today" from the UTC clock, so anything it stamped between 00:00 and 05:29 IST carries the previous day. Dates are imported exactly as the file has them.';
export const NO_REASON = 'Not recorded in the old tracker';

const str = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || null);
const legacyTask = z.object({
  id: z.number().int().nonnegative(),
  title: str,
  details: str,
  by: str,
  client: str,
  prio: str,
  deadlineDate: str,
  deadlineTime: str,
  status: str,
  prog: z.number().nullish(),
  reason: str,
  recur: str,
  createdAt: str,
  completedAt: str,
});
const legacyReport = z.object({
  id: z.number().int().nonnegative(),
  reportDate: z.string().refine(isIsoDate, 'not a YYYY-MM-DD date'),
  generatedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not a timestamp'),
  meta: z.record(z.string(), z.unknown()).nullish(),
  data: z.unknown().optional(),
  text: str,
});
const backupShape = z.object({
  profile: z
    .object({ name: str, email: str, empId: str, department: str, designation: str })
    .partial()
    .nullish(),
  tasks: z.array(z.unknown()),
  reports: z.array(z.unknown()).nullish(),
});

export interface TrackerProfile {
  name: string | null;
  email: string | null;
  empId: string | null;
  department: string | null;
  designation: string | null;
}

export interface ImportedTaskValues {
  title: string;
  details: string | null;
  requesterNote: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  progressPercent: number;
  reason: string | null;
  /** The tracker's Blocked / On-hold, kept as the blocked flag with `blockedReason` (R4). */
  blockedKind: TaskBlockKind | null;
  blockedReason: string | null;
  recurrence: TaskRecurrence;
  dueOn: string;
  dueTime: string | null;
  /** Legacy dates (the tracker stores days only, no times). */
  createdOn: string | null;
  completedOn: string | null;
}

export interface ImportedReportValues {
  reportDate: string;
  generatedAt: string;
  text: string | null;
  /** What the tracker saved for the day (its logo image removed; the raw copy keeps it). */
  legacy: { meta: Record<string, unknown>; data: unknown };
}

/** One legacy record: mapped values, or why it cannot be imported as it is. */
export interface MappedRecord<V> {
  legacyId: string;
  title: string;
  /** Stable JSON of the legacy record (its content hash tells changed from unchanged). */
  canonical: string;
  values: V | null;
  /** `unresolved` = needs a person (fix in the tracker and export again); `failed` = unreadable. */
  problem: { outcome: 'unresolved' | 'failed'; message: string } | null;
  notes: string[];
}

export interface TrackerBackup {
  profile: TrackerProfile;
  tasks: MappedRecord<ImportedTaskValues>[];
  reports: MappedRecord<ImportedReportValues>[];
}

/** JSON with sorted keys, so the same record always hashes the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const idOf = (raw: unknown, n: number) => {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : `#${n + 1}`;
};

function mapTask(raw: unknown, n: number): MappedRecord<ImportedTaskValues> {
  const base = { legacyId: idOf(raw, n), canonical: stableJson(raw), notes: [] as string[] };
  const parsed = legacyTask.safeParse(raw);
  if (!parsed.success)
    return {
      ...base,
      title: `Task ${base.legacyId}`,
      values: null,
      problem: { outcome: 'failed', message: 'Unreadable task record (no numeric id).' },
    };
  const t = parsed.data;
  const title = t.title ?? '';
  const unresolved = (message: string) => ({
    ...base,
    title: title || `Task ${base.legacyId}`,
    values: null,
    problem: { outcome: 'unresolved' as const, message },
  });
  const status = STATUSES[(t.status ?? '').toLowerCase()];
  const priority = PRIORITIES[(t.prio ?? '').toLowerCase()];
  const recurrence = RECURRENCES[(t.recur ?? '').toLowerCase()];
  if (!title) return unresolved('The task has no title.');
  if (!status) return unresolved(`Status "${t.status ?? ''}" is not one the tracker uses.`);
  if (!priority) return unresolved(`Priority "${t.prio ?? ''}" is not High, Medium or Low.`);
  if (!recurrence) return unresolved(`Repeat "${t.recur}" is not daily, weekly or monthly.`);
  if (!t.deadlineDate || !isIsoDate(t.deadlineDate))
    return unresolved(
      'No deadline date. Elevate needs a due day: add one in the tracker and export again.',
    );
  if (t.deadlineTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.deadlineTime))
    return unresolved(`Deadline time "${t.deadlineTime}" is not HH:MM.`);
  if (typeof t.prog === 'number' && (t.prog < 0 || t.prog > 100))
    return unresolved(`Progress ${t.prog}% is outside 0–100.`);
  const completedOn = t.completedAt && isIsoDate(t.completedAt) ? t.completedAt : null;
  if (status === 'done' && !completedOn)
    return unresolved('Marked Done without a completion date.');
  const blockedKind = status === 'blocked' || status === 'on_hold' ? status : null;
  if (blockedKind && !t.reason) base.notes.push(`No reason in the tracker: "${NO_REASON}".`);
  const progress = Math.round(t.prog ?? 0);
  const createdOn = t.createdAt && isIsoDate(t.createdAt) ? t.createdAt : null;
  if (!createdOn) base.notes.push('No creation date: received time is the import time.');
  return {
    ...base,
    title,
    problem: null,
    values: {
      title,
      details: t.details,
      requesterNote:
        [t.by && `Given by ${t.by}`, t.client && `Client: ${t.client}`]
          .filter(Boolean)
          .join(' · ') || null,
      priority,
      status: blockedKind ? (progress > 0 ? 'in_progress' : 'pending') : (status as TaskStatus),
      progressPercent: status === 'done' ? 100 : progress,
      reason: status === 'done' || blockedKind ? null : (t.reason ?? null),
      blockedKind,
      blockedReason: blockedKind ? (t.reason ?? NO_REASON) : null,
      recurrence,
      dueOn: t.deadlineDate,
      dueTime: t.deadlineTime,
      createdOn,
      completedOn: status === 'done' ? completedOn : null,
    },
  };
}

function mapReport(raw: unknown, n: number): MappedRecord<ImportedReportValues> {
  const base = { legacyId: idOf(raw, n), canonical: stableJson(raw), notes: [] };
  const parsed = legacyReport.safeParse(raw);
  if (!parsed.success)
    return {
      ...base,
      title: `Report ${base.legacyId}`,
      values: null,
      problem: {
        outcome: 'failed',
        message: 'Unreadable report record (id, report date or time).',
      },
    };
  const { reportDate, generatedAt, meta, data, text } = parsed.data;
  const { logo: _logo, ...keptMeta } = meta ?? {};
  return {
    ...base,
    title: `End-of-day report ${reportDate}`,
    problem: null,
    values: { reportDate, generatedAt, text, legacy: { meta: keptMeta, data } },
  };
}

/** Map an already-parsed backup object (also used to re-read a stored batch). */
export function mapBackup(
  json: unknown,
): { ok: true; backup: TrackerBackup } | { ok: false; error: string } {
  const shape = backupShape.safeParse(json);
  if (!shape.success)
    return {
      ok: false,
      error: 'This JSON file has no "tasks" list, so it is not a tracker backup.',
    };
  const p = shape.data.profile ?? {};
  return {
    ok: true,
    backup: {
      profile: {
        name: p.name ?? null,
        email: p.email?.toLowerCase() ?? null,
        empId: p.empId ?? null,
        department: p.department ?? null,
        designation: p.designation ?? null,
      },
      tasks: shape.data.tasks.map(mapTask),
      reports: (shape.data.reports ?? []).map(mapReport),
    },
  };
}

/** Parse the uploaded file text. The tracker HTML itself is refused: it holds no records. */
export function parseTrackerBackup(
  text: string,
): { ok: true; backup: TrackerBackup; json: unknown } | { ok: false; error: string } {
  text = text.replace(/^\uFEFF/, ''); // a byte-order mark some editors add
  // Any markup (HTML, a comment, an XML header) is the program or a page, never the export.
  if (/^\s*</.test(text)) return { ok: false, error: NOT_AN_EXPORT };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a tracker backup: it is not JSON.' };
  }
  const mapped = mapBackup(json);
  return mapped.ok ? { ...mapped, json } : mapped;
}

/** The export date from the file name (the tracker names it by its UTC day), or null. */
export const exportDateFromName = (filename: string) =>
  /Task-EOD-backup-(\d{4}-\d{2}-\d{2})\.json$/i.exec(filename)?.[1] ?? null;

export interface StaffOption {
  id: string;
  label: string;
  email: string | null;
  staffCode: string | null;
}

/** Staff whose email or staff code equals the file's profile exactly (never by name). */
export const suggestStaff = (profile: TrackerProfile, staff: readonly StaffOption[]) =>
  staff.filter(
    (s) =>
      (profile.email && s.email?.toLowerCase() === profile.email) ||
      (profile.empId && s.staffCode === profile.empId),
  );

const DIFF_LABELS = {
  title: 'Title',
  details: 'Details',
  status: 'Status',
  priority: 'Priority',
  dueOn: 'Due day',
  dueTime: 'Due time',
  progressPercent: 'Progress',
  reason: 'Reason',
  blockedKind: 'Blocked or on hold',
  blockedReason: 'Blocker',
} as const;

/** Fields where the tracker's newer copy differs from the task in Elevate (Elevate keeps its value). */
export function taskDifferences(
  incoming: ImportedTaskValues,
  current: Record<keyof typeof DIFF_LABELS, unknown>,
): string[] {
  // Postgres returns times as HH:MM:SS; the tracker writes HH:MM.
  const now = { ...current, dueTime: (current.dueTime as string | null)?.slice(0, 5) ?? null };
  return (Object.keys(DIFF_LABELS) as (keyof typeof DIFF_LABELS)[])
    .filter((k) => (incoming[k] ?? null) !== (now[k] ?? null))
    .map((k) => DIFF_LABELS[k]);
}
