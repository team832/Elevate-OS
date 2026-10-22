'use client';

/**
 * Attendance entry for one class: a status per placed student and per demo attendee, sent as one
 * PUT (audited on the server). Blank = "not recorded" (never present or absent). Changing a saved
 * mark needs a reason. "Mark all remaining present" is a separate, explicit button that only fills
 * blanks; it is disabled while the form has unsaved choices so none are lost. Rows are keyed on
 * their saved value, so a refresh after saving shows the server's marks. Rows become labelled
 * cards on phones; the action bar stays at the bottom of the screen.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, StatusBadge } from '@elevate/shared-ui';
import { describeDetails } from './api-form';

const STATUSES = ['present', 'late', 'partial', 'absent', 'excused'] as const;
const DEMO_STATUSES = ['present', 'late', 'absent', 'excused'] as const;

export interface RosterRow {
  studentId: string;
  code: string;
  fullName: string;
  status: string | null;
  minutesPresent: number | null;
  onPlacement: boolean;
  isSample: boolean;
  reviewHref: string | null;
}

export interface DemoRow {
  attendeeId: string;
  displayName: string;
  dayNumber: number;
  status: string;
  isSample: boolean;
  reviewHref: string | null;
}

type State = { kind: 'idle' | 'saving' } | { kind: 'error'; message: string; details: string[] } | { kind: 'done'; message: string };

async function send(url: string, method: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string; details: string[] }> {
  try {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { message?: string; details?: unknown } };
    if (!res.ok || json.error) return { ok: false, message: json.error?.message ?? `HTTP ${res.status}`, details: describeDetails(json.error?.details) };
    return { ok: true, data: json.data ?? {} };
  } catch {
    return { ok: false, message: 'Could not reach Academic OS. Your marks were not saved; try again.', details: [] };
  }
}

export function AttendanceForm({ action, bulkAction, roster, demos, canRecord }: { action: string; bulkAction: string; roster: readonly RosterRow[]; demos: readonly DemoRow[]; canRecord: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [dirty, setDirty] = useState(false);

  /** Choices that differ from the saved marks. */
  function pending(form: HTMLFormElement) {
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const marks = roster.flatMap((r) => {
      const status = value(`status-${r.studentId}`);
      const minutes = value(`minutes-${r.studentId}`);
      if (!status || (status === r.status && (minutes === '' ? null : Number(minutes)) === r.minutesPresent)) return [];
      return [{ studentId: r.studentId, status, ...(minutes ? { minutesPresent: Number(minutes) } : {}) }];
    });
    const demoMarks = demos.flatMap((d) => {
      const status = value(`demo-${d.attendeeId}`);
      return status && status !== d.status ? [{ attendeeId: d.attendeeId, status }] : [];
    });
    return { marks, demoMarks, reason: value('reason') };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { marks, demoMarks, reason } = pending(event.currentTarget);
    if (marks.length + demoMarks.length === 0) {
      setState({ kind: 'error', message: 'Nothing changed. Choose a status for a student first; students left blank stay "not recorded".', details: [] });
      return;
    }
    setState({ kind: 'saving' });
    const result = await send(action, 'PUT', { marks, demoMarks, ...(reason ? { reason } : {}) });
    if (!result.ok) return setState({ kind: 'error', message: result.message, details: result.details });
    setDirty(false);
    setState({ kind: 'done', message: `Saved ${marks.length + demoMarks.length} mark(s).` });
    router.refresh();
  }

  async function markRemaining() {
    setState({ kind: 'saving' });
    const result = await send(bulkAction, 'POST', {});
    if (!result.ok) return setState({ kind: 'error', message: result.message, details: result.details });
    setState({ kind: 'done', message: `Marked ${String(result.data.marked)} remaining student(s) present. Saved marks were not changed.` });
    router.refresh();
  }

  const select = (name: string, label: string, current: string | null, options: readonly string[]) => (
    <select className="el-select" name={name} defaultValue={current ?? ''} disabled={!canRecord} aria-label={label}>
      <option value="">not recorded</option>
      {options.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={onSubmit} onChange={(e) => { const p = pending(e.currentTarget); setDirty(p.marks.length + p.demoMarks.length > 0); }} className="el-stack">
      <div className="el-table-wrap">
        <table className="el-table el-table-compact">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Minutes present (optional)</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={`${r.studentId}-${r.status ?? ''}-${r.minutesPresent ?? ''}`}>
                <td data-label="Student">
                  {r.fullName} <span className="el-field-hint">{r.code}</span> {r.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}{' '}
                  {r.onPlacement ? null : <StatusBadge tone="neutral">No longer in this batch</StatusBadge>}
                </td>
                <td data-label="Status">{select(`status-${r.studentId}`, `Attendance for ${r.fullName}`, r.status, STATUSES)}</td>
                <td data-label="Minutes present">
                  <input className="el-input" type="number" min={0} max={600} name={`minutes-${r.studentId}`} defaultValue={r.minutesPresent ?? ''} disabled={!canRecord} aria-label={`Minutes present for ${r.fullName}`} />
                </td>
                <td data-label="Review">{r.reviewHref ? <a href={r.reviewHref}>Write review<span className="el-visually-hidden"> for {r.fullName}</span></a> : null}</td>
              </tr>
            ))}
            {demos.map((d) => (
              <tr key={`${d.attendeeId}-${d.status}`}>
                <td data-label="Student">
                  {d.displayName} <StatusBadge tone="info">Demo · Day {d.dayNumber}</StatusBadge> {d.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
                </td>
                <td data-label="Status">{select(`demo-${d.attendeeId}`, `Demo attendance for ${d.displayName}`, d.status === 'not_recorded' ? null : d.status, DEMO_STATUSES)}</td>
                <td data-label="Minutes present">—</td>
                <td data-label="Review">{d.reviewHref ? <a href={d.reviewHref}>Write review<span className="el-visually-hidden"> for {d.displayName}</span></a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.kind === 'error' ? (
        <Alert tone="danger" title={state.message}>
          {state.details.length ? <ul>{state.details.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
        </Alert>
      ) : null}
      {state.kind === 'done' ? <Alert tone="success">{state.message}</Alert> : null}
      {canRecord ? (
        <div className="acd-sticky-actions">
          <label className="el-field">
            Reason for changing a saved mark
            <input className="el-input" name="reason" maxLength={500} placeholder="e.g. Medical note received" />
          </label>
          <Button type="submit" disabled={state.kind === 'saving'}>
            {state.kind === 'saving' ? 'Saving…' : 'Save attendance'}
          </Button>
          <Button type="button" variant="secondary" disabled={state.kind === 'saving' || dirty} onClick={markRemaining} aria-describedby="bulk-hint">
            Mark all remaining present
          </Button>
          <span id="bulk-hint" className="el-field-hint">{dirty ? 'Save your changes first; the bulk action only fills blank rows.' : 'Fills only students still not recorded.'}</span>
        </div>
      ) : null}
    </form>
  );
}
