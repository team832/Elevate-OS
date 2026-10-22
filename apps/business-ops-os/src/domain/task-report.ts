/**
 * End-to-end task report wording (brief 2 §12B): one chronology of dated events and work
 * updates, in words. Pure; shared by the task page, the PDF and the CSV.
 */
import { TASK_STATUS_LABELS, type TaskEventKind, type TaskStatus } from './staff-tasks';
import { minutesOf, type WorkEntry } from './task-lifecycle';

export const EVENT_LABELS: Record<TaskEventKind, string> = {
  created: 'Task logged',
  assigned: 'Assigned',
  reassigned: 'Handed over',
  acknowledged: 'Acknowledged',
  clarification_requested: 'Clarification requested',
  status_changed: 'Status changed',
  submitted_for_review: 'Submitted for review',
  review_approved: 'Review approved — closed',
  changes_requested: 'Changes requested',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
  due_changed: 'Due date changed',
  priority_changed: 'Priority changed',
  comment: 'Details changed',
  imported: 'Imported from the old tracker',
  dependency_added: 'Dependency added',
  edited: 'Details changed',
};

/** "2 days 3 h", "1 h 45 min", "20 min"; null = "Not recorded". Elapsed days are not effort hours. */
export function fmtDuration(minutes: number | null): string {
  if (minutes === null) return 'Not recorded';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d && `${d} day${d === 1 ? '' : 's'}`, h && `${h} h`, !d && m && `${m} min`];
  return parts.filter(Boolean).join(' ') || '0 min';
}

const status = (s: TaskStatus | null) => (s ? TASK_STATUS_LABELS[s] : null);
const dueText = (day: string | undefined, time: string | null | undefined) =>
  `${day ?? '—'}${time ? ` ${time.slice(0, 5)} IST` : ''}`;

export interface ReportEvent {
  kind: TaskEventKind;
  occurredAt: Date;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  fromStaffName: string | null;
  toStaffName: string | null;
  actorName: string;
  reason: string | null;
  data: Record<string, unknown> | null;
}
export interface ReportUpdate extends WorkEntry {
  recordedAt: Date;
  authorName: string;
  workPerformed: string;
  result: string | null;
  evidence: string | null;
  remainingWork: string | null;
  blocker: string | null;
  nextStep: string | null;
  correctionReason: string | null;
  /** Replaced by a later correction: shown, but its minutes no longer count. */
  corrected?: boolean;
}

/** Plain-words detail of one event. */
export function eventDetail(e: ReportEvent): string {
  const d = (e.data ?? {}) as Record<string, never>;
  const bits = [
    e.kind === 'reassigned' && `${e.fromStaffName ?? 'Unknown'} to ${e.toStaffName ?? 'Unknown'}`,
    (e.kind === 'created' || e.kind === 'imported') && e.toStaffName && `Owner ${e.toStaffName}`,
    e.toStatus && e.kind !== 'created' && `${status(e.fromStatus) ?? '—'} to ${status(e.toStatus)}`,
    e.kind === 'due_changed' &&
      `${dueText(d.fromDueOn, d.fromDueTime)} to ${dueText(d.toDueOn, d.toDueTime)}`,
    e.kind === 'priority_changed' && `${d.from} to ${d.to}`,
    Array.isArray(d.edited) && `Changed: ${(d.edited as string[]).join(', ')}`,
    e.reason && `Reason: ${e.reason}`,
  ];
  return bits.filter(Boolean).join(' · ');
}

export function updateDetail(u: ReportUpdate): string {
  return [
    u.workPerformed,
    u.result && `Result: ${u.result}`,
    u.remainingWork && `Remaining: ${u.remainingWork}`,
    u.blocker && `Blocker: ${u.blocker}`,
    u.nextStep && `Next: ${u.nextStep}`,
    u.evidence && `Evidence: ${u.evidence}`,
    u.correctsUpdateId && `Correction — ${u.correctionReason}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface ChronologyRow {
  at: Date;
  type: 'event' | 'update';
  what: string;
  who: string;
  detail: string;
  workDate: string | null;
  minutes: number | null;
}

/** Events and work updates in one list, oldest first (updates by their recorded time). */
export function chronology(
  events: readonly ReportEvent[],
  updates: readonly ReportUpdate[],
): ChronologyRow[] {
  return [
    ...events.map((e) => ({
      at: e.occurredAt,
      type: 'event' as const,
      what: EVENT_LABELS[e.kind],
      who: e.actorName,
      detail: eventDetail(e),
      workDate: null,
      minutes: null,
    })),
    ...updates.map((u) => ({
      at: u.recordedAt,
      type: 'update' as const,
      what: `${u.correctsUpdateId ? 'Work update corrected' : 'Work update'}${u.corrected ? ' (superseded)' : ''}`,
      who: u.authorName,
      detail: updateDetail(u),
      workDate: u.occurredOn,
      minutes: u.corrected ? null : minutesOf(u),
    })),
  ].sort((a, b) => +a.at - +b.at);
}
