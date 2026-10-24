'use client';

/**
 * The score import review (brief §20): each row as read, the proposed student and why, marks,
 * attendance only when the file states it, warnings and blocking problems. A person resolves
 * suggested, ambiguous, unmatched and duplicate rows, ticks each AI-read row after checking it
 * against the sheet, and confirms each change to a verified mark. One "Save" sends it all; the
 * server checks everything again and refuses with the rows still needing a decision.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { StatusBadge } from '@elevate/shared-ui';
import { FormAlert, plainError, submitGate } from '../../../ui/action-form';
import { routerPath } from '../../../ui/format';

export interface ReviewRowView {
  rowId: string;
  rowNumber: number;
  ai: boolean;
  /** The cells as read, "Heading: value" joined. */
  original: string;
  status: 'matched' | 'suggested' | 'ambiguous' | 'unmatched' | 'duplicate';
  proposed: string | null;
  basis: string;
  marks: string;
  attendance: string | null;
  change: 'new' | 'no_change' | 'overwrite' | 'not_entered' | null;
  errors: string[];
  warnings: string[];
  /** Suggested students first, then the rest of the roster. */
  choices: { studentId: string; label: string; suggested: boolean }[];
}

const STATUS: Record<ReviewRowView['status'], [string, 'success' | 'warning' | 'danger']> = {
  matched: ['Matched', 'success'],
  suggested: ['Suggestion only', 'warning'],
  ambiguous: ['Ambiguous', 'danger'],
  unmatched: ['Not on the roster', 'danger'],
  duplicate: ['Duplicate', 'danger'],
};
const CHANGE = {
  new: 'New marks',
  no_change: 'Same as saved',
  overwrite: 'Changes a verified mark',
  not_entered: 'Nothing entered',
} as const;

type ApiError = { code: string; message: string; details?: unknown };
type Issue = { path?: (string | number)[]; message: string };

export function ImportReview({
  rows,
  action,
  doneHref,
  editable,
}: {
  rows: readonly ReviewRowView[];
  action: string;
  doneHref: string;
  /** false = read-only (no permission, or the import is no longer in review). */
  editable: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [gate] = useState(() => submitGate());
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => alertRef.current?.focus(), [error]);
  const issues: Issue[] = Array.isArray(error?.details) ? error.details : [];
  const rowIssue = (rowId: string) =>
    issues.find((i) => i.path?.[0] === 'rows' && i.path[1] === rowId)?.message;
  const selectId = (rowId: string) => `${formId}-${rowId}`;
  const flagged = (form: FormData, prefix: string) =>
    Object.fromEntries(rows.map((r) => [r.rowId, form.get(`${prefix}.${r.rowId}`) === 'on']));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const reason = String(form.get('reason') ?? '').trim();
    const body = {
      resolutions: Object.fromEntries(
        rows.map((r) => [r.rowId, String(form.get(`resolution.${r.rowId}`) ?? '')]),
      ),
      aiConfirmed: flagged(form, 'ai'),
      overwriteConfirmed: flagged(form, 'overwrite'),
      markScoredPresent: form.get('markScoredPresent') === 'on',
      ...(reason ? { reason } : {}),
    };
    setBusy(true);
    const out = await gate(JSON.stringify(body), async (key) => {
      const res = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      }).catch(() => null);
      const json = (await res?.json().catch(() => ({}))) as { error?: ApiError } | undefined;
      if (res?.ok && !json?.error) return {};
      return {
        error: json?.error
          ? plainError(json.error)
          : { code: 'NETWORK', message: 'Could not reach the server. Try again.' },
      };
    });
    setBusy(false);
    if (!out) return;
    setError(out.error ?? null);
    if (!out.error) router.push(routerPath(doneHref));
  }

  const table = (
    <div className="el-table-wrap">
      <table className="el-table el-table-compact">
        <caption>{rows.length} rows read from the file</caption>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">In the file</th>
            <th scope="col">Student</th>
            <th scope="col">Matched by</th>
            <th scope="col" className="el-num">
              Marks
            </th>
            <th scope="col">Attendance in the file</th>
            <th scope="col">Checks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const problem = rowIssue(r.rowId);
            return (
              <tr key={r.rowId}>
                <td data-label="Row">
                  {r.rowNumber}
                  {r.ai ? (
                    <>
                      {' '}
                      <StatusBadge tone="info">Read by AI</StatusBadge>
                    </>
                  ) : null}
                </td>
                <td data-label="In the file">{r.original}</td>
                <td data-label="Student">
                  <StatusBadge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</StatusBadge>{' '}
                  {r.proposed ?? null}
                  {editable ? (
                    <div className="el-field">
                      <label htmlFor={selectId(r.rowId)} className="el-visually-hidden">
                        Student for row {r.rowNumber}
                      </label>
                      <select
                        id={selectId(r.rowId)}
                        name={`resolution.${r.rowId}`}
                        className="el-select"
                        defaultValue=""
                        aria-invalid={problem ? true : undefined}
                      >
                        <option value="">
                          {r.status === 'matched' ? 'Keep this match' : 'Choose a student'}
                        </option>
                        {r.choices.map((c) => (
                          <option key={c.studentId} value={c.studentId}>
                            {c.suggested ? `Suggested: ${c.label}` : c.label}
                          </option>
                        ))}
                        <option value="skip">Skip this row</option>
                      </select>
                    </div>
                  ) : null}
                  {problem ? <p className="el-field-error">{problem}</p> : null}
                </td>
                <td data-label="Matched by">{r.basis}</td>
                <td data-label="Marks" className="el-num">
                  {r.marks}
                </td>
                <td data-label="Attendance in the file">{r.attendance ?? 'Not stated'}</td>
                <td data-label="Checks">
                  {r.change ? <p>{CHANGE[r.change]}</p> : null}
                  {r.errors.map((m) => (
                    <p key={m} className="el-field-error">
                      {m}
                    </p>
                  ))}
                  {r.warnings.map((m) => (
                    <p key={m} className="el-field-hint">
                      {m}
                    </p>
                  ))}
                  {editable && r.ai ? (
                    <label className="el-checkbox">
                      <input type="checkbox" name={`ai.${r.rowId}`} /> Checked against the sheet
                      <span className="el-visually-hidden"> (row {r.rowNumber})</span>
                    </label>
                  ) : null}
                  {editable && r.change === 'overwrite' ? (
                    <label className="el-checkbox">
                      <input type="checkbox" name={`overwrite.${r.rowId}`} /> Replace the verified
                      mark<span className="el-visually-hidden"> (row {r.rowNumber})</span>
                    </label>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  if (!editable) return table;
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="el-stack" noValidate>
      {table}
      <div className="el-field el-field-wide">
        <label className="el-checkbox">
          <input type="checkbox" name="markScoredPresent" /> Mark scored students present
        </label>
        <p className="el-field-hint">
          Rows with marks but no attendance in the file leave attendance unmarked, and unmarked
          students’ marks stay “imported for review”. Tick this when everyone with marks sat the
          test.
        </p>
      </div>
      <div className="el-field el-field-wide">
        <label htmlFor={`${formId}-reason`}>Reason for changing verified marks</label>
        <textarea id={`${formId}-reason`} name="reason" className="el-textarea" rows={2} />
        <p className="el-field-hint">Needed only when a row replaces a verified mark.</p>
      </div>
      {error ? (
        <FormAlert
          ref={alertRef}
          error={error}
          issues={issues}
          fieldFor={(i) => {
            const r = rows.find((x) => i.path?.[0] === 'rows' && i.path[1] === x.rowId);
            return r
              ? { id: selectId(r.rowId), label: `Row ${r.rowNumber}` }
              : i.path?.[0] === 'reason'
                ? { id: `${formId}-reason`, label: 'Reason' }
                : undefined;
          }}
        />
      ) : null}
      <div className="el-form-actions">
        <button type="submit" className="el-button el-button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save marks to Academic OS'}
        </button>
      </div>
    </form>
  );
}
