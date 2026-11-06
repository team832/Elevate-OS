'use client';

/**
 * Homework marking grid (F4-05): one-tap status pills and a remark per student, sent as one PUT
 * of the rows that changed. A student left on "not marked yet" is not sent and stays unmarked
 * (never "not submitted"). A saved mark can be changed, not cleared.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '@elevate/shared-ui';
import { HOMEWORK_STATUSES, HOMEWORK_STATUS_LABELS } from '../domain/homework';
import { ErrorAlert, send, type ErrorView } from './api-form';

export interface MarkRow {
  studentId: string;
  code: string;
  fullName: string;
  isSample: boolean;
  status: string | null;
  remark: string | null;
}

type State = { kind: 'idle' | 'saving' } | { kind: 'error'; error: ErrorView } | { kind: 'done'; message: string };

export function HomeworkMarks({ action, rows, canMark }: { action: string; rows: readonly MarkRow[]; canMark: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const marks = rows.flatMap((r) => {
      const status = String(data.get(`status-${r.studentId}`) ?? '');
      const remark = String(data.get(`remark-${r.studentId}`) ?? '').trim();
      return status && (status !== r.status || remark !== (r.remark ?? '')) ? [{ studentId: r.studentId, status, ...(remark ? { remark } : {}) }] : [];
    });
    if (!marks.length) return setState({ kind: 'error', error: { message: 'Nothing changed. Choose a status for a student first; students left on "not marked yet" stay unmarked.', details: [] } });
    setState({ kind: 'saving' });
    const result = await send(action, 'PUT', { marks }).catch(() => null);
    if (!result) return setState({ kind: 'error', error: { message: 'Could not reach Academic OS. Your marks were not saved; try again.', details: [] } });
    if (!result.ok) return setState({ kind: 'error', error: result.error });
    setState({ kind: 'done', message: `Saved ${(result.data as { saved: number }).saved} mark(s).` });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="el-stack">
      <div className="el-table-wrap">
        <table className="el-table el-table-compact">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Remark (optional)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.studentId}-${r.status ?? ''}-${r.remark ?? ''}`}>
                <td data-label="Student">
                  {r.fullName} <span className="el-field-hint">{r.code}</span> {r.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
                </td>
                <td data-label="Status" className="acd-marks-cell">
                  <fieldset className="acd-marks">
                    <legend className="el-visually-hidden">Homework status for {r.fullName}</legend>
                    {[...(r.status ? [] : [['', 'not marked yet']]), ...HOMEWORK_STATUSES.map((s) => [s, HOMEWORK_STATUS_LABELS[s].toLowerCase()])].map(([value, word]) => (
                      <label key={value}>
                        <input type="radio" name={`status-${r.studentId}`} value={value} defaultChecked={(r.status ?? '') === value} disabled={!canMark} />
                        <span>{word}</span>
                      </label>
                    ))}
                  </fieldset>
                </td>
                <td data-label="Remark">
                  <input className="el-input" name={`remark-${r.studentId}`} maxLength={500} defaultValue={r.remark ?? ''} disabled={!canMark} aria-label={`Remark for ${r.fullName}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.kind === 'error' ? <ErrorAlert error={state.error} /> : null}
      {state.kind === 'done' ? <Alert tone="success">{state.message}</Alert> : null}
      {canMark ? (
        <div className="acd-sticky-actions el-glass">
          <Button type="submit" disabled={state.kind === 'saving'}>
            {state.kind === 'saving' ? 'Saving…' : 'Save marks'}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
