'use client';

/** Attendance entry for one session: a status per student, sent as one PUT (audited on the server). */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '@elevate/shared-ui';
import { describeDetails } from './api-form';

const STATUSES = ['present', 'late', 'partial', 'absent', 'excused'] as const;

export interface RosterRow {
  studentId: string;
  code: string;
  fullName: string;
  status: string | null;
  minutesPresent: number | null;
}

export function AttendanceForm({ action, roster, canRecord }: { action: string; roster: readonly RosterRow[]; canRecord: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'error'; message: string; details: string[] } | { kind: 'done'; message: string }>({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const marks = roster
      .map((r) => {
        const status = String(data.get(`status-${r.studentId}`) ?? '');
        const minutes = String(data.get(`minutes-${r.studentId}`) ?? '').trim();
        return status ? { studentId: r.studentId, status, ...(minutes ? { minutesPresent: Number(minutes) } : {}) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (marks.length === 0) {
      setState({ kind: 'error', message: 'Choose a status for at least one student. Students left blank stay "not recorded" (never counted as absent).', details: [] });
      return;
    }
    setState({ kind: 'saving' });
    try {
      const res = await fetch(action, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ marks }) });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; details?: unknown } };
      if (!res.ok || json.error) {
        setState({ kind: 'error', message: json.error?.message ?? `HTTP ${res.status}`, details: describeDetails(json.error?.details) });
        return;
      }
      setState({ kind: 'done', message: `Saved ${marks.length} mark(s).` });
      router.refresh();
    } catch {
      setState({ kind: 'error', message: 'Could not reach Academic OS.', details: [] });
    }
  }

  return (
    <form onSubmit={onSubmit} className="el-stack">
      <div className="el-table-wrap">
        <table className="el-table">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Minutes present (optional)</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.studentId}>
                <td>
                  {r.fullName} <span className="el-field-hint">{r.code}</span>
                </td>
                <td>
                  <select className="el-select" name={`status-${r.studentId}`} defaultValue={r.status ?? ''} disabled={!canRecord} aria-label={`Attendance for ${r.fullName}`}>
                    <option value="">not recorded</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="el-input" type="number" min={0} max={600} name={`minutes-${r.studentId}`} defaultValue={r.minutesPresent ?? ''} disabled={!canRecord} aria-label={`Minutes present for ${r.fullName}`} />
                </td>
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
        <div>
          <Button type="submit" disabled={state.kind === 'saving'}>
            {state.kind === 'saving' ? 'Saving…' : 'Save attendance'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
