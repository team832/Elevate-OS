/**
 * Dependencies and work time (brief 2 §6, §12; R4). Pure. Algorithms: A-TSK-6 dependency cycles,
 * A-TSK-7 work entries and time. Re-exported from task-lifecycle.ts.
 */
import { istToday } from './dates';
import type { TaskEventKind, TaskEventStatus } from './staff-tasks';

/** A-TSK-6: would "taskId waits on dependsOn" close a loop? `edges` are [task, dependsOn]. */
export function createsCycle(
  edges: readonly (readonly [string, string])[],
  taskId: string,
  dependsOn: string,
): boolean {
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === taskId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [a, b] of edges) if (a === node) stack.push(b);
  }
  return false;
}

export const isOpenStatus = (s: TaskEventStatus) => s !== 'done' && s !== 'cancelled';

export interface WorkEntry {
  id: string;
  occurredOn: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMinutes: number | null;
  correctsUpdateId: string | null;
}

/** A-TSK-7: entries that still count (a corrected entry is replaced by its correction). */
export const currentEntries = <T extends WorkEntry>(entries: readonly T[]): T[] => {
  const corrected = new Set(entries.map((e) => e.correctsUpdateId).filter(Boolean));
  return entries.filter((e) => !corrected.has(e.id));
};

/** Recorded minutes: the stated duration, else the start/stop interval; null when neither. */
export const minutesOf = (e: WorkEntry): number | null =>
  e.durationMinutes ??
  (e.startedAt && e.endedAt ? Math.round((+e.endedAt - +e.startedAt) / 60000) : null);

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const clock = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Warnings for a new entry: overlaps with the author's same-day entries, midnight crossing. Never corrected. */
export function overlapWarnings(entry: WorkEntry, sameDay: readonly WorkEntry[]): string[] {
  const out: string[] = [];
  const { startedAt: s, endedAt: e } = entry;
  if (s && e) {
    for (const o of currentEntries(sameDay))
      if (o.id !== entry.id && o.startedAt && o.endedAt && s < o.endedAt && o.startedAt < e)
        out.push(
          `Overlaps another entry on this day (${clock.format(o.startedAt)}–${clock.format(o.endedAt)} IST).`,
        );
    if (istToday(s) !== istToday(e))
      out.push(`Crosses midnight IST; counted on the work date ${day(entry.occurredOn)}.`);
  }
  return out;
}

const WAITING: readonly TaskEventStatus[] = ['blocked', 'on_hold', 'in_review'];

/** A task event as far as time is concerned (status steps, and the blocked flag since R4). */
export interface StatusPoint {
  occurredAt: Date;
  toStatus: TaskEventStatus | null;
  reason: string | null;
  kind?: TaskEventKind;
  data?: Record<string, unknown> | null;
}

/**
 * Elapsed time (received → closed, or now), waiting intervals (blocked, on hold, in review) from
 * the dated status events, and recorded work time (sum of current entries; null = none recorded).
 * Elapsed days are not effort hours.
 */
export function taskTimeSummary(
  events: readonly StatusPoint[],
  entries: readonly WorkEntry[],
  receivedAt: Date,
  now: Date,
) {
  const steps = events.filter((e) => e.toStatus).sort((a, b) => +a.occurredAt - +b.occurredAt);
  const last = steps.at(-1);
  const end = last && !isOpenStatus(last.toStatus!) ? last.occurredAt : now;
  const waits = steps
    .map((s, i) => ({
      status: s.toStatus!,
      from: s.occurredAt,
      to: steps[i + 1]?.occurredAt ?? end,
      reason: s.reason,
    }))
    .filter((w) => WAITING.includes(w.status));
  // Blocked / on hold since R4: a flag from `blocked_set` to the next `blocked_cleared` (or the end).
  const flags = events.filter((e) => e.kind === 'blocked_set' || e.kind === 'blocked_cleared');
  flags.sort((a, b) => +a.occurredAt - +b.occurredAt);
  flags.forEach((f, i) => {
    if (f.kind !== 'blocked_set') return;
    const kind = f.data?.kind === 'on_hold' ? 'on_hold' : 'blocked';
    const to = flags.slice(i + 1).find((x) => x.kind === 'blocked_cleared')?.occurredAt ?? end;
    waits.push({ status: kind, from: f.occurredAt, to, reason: f.reason });
  });
  waits.sort((a, b) => +a.from - +b.from);
  const minutes = currentEntries(entries)
    .map(minutesOf)
    .filter((m): m is number => m !== null);
  const span = (a: Date, b: Date) => Math.max(0, Math.round((+b - +a) / 60000));
  return {
    elapsedMinutes: span(receivedAt, end),
    waitingMinutes: waits.reduce((n, w) => n + span(w.from, w.to), 0),
    recordedMinutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) : null,
    waits,
  };
}
