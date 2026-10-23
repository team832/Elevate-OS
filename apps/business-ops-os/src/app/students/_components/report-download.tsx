'use client';

/**
 * One-click student report: makes a draft report of the chosen kind for the period (the same
 * POST as the report screen, so it is stored and audited) and saves its PDF.
 */
import { useState } from 'react';
import { refusal, savePdf } from '../../../ui/pdf-download';

const KINDS = [
  ['internal', 'Internal report (PDF)'],
  ['guardian', 'PTM report (PDF)'],
] as const;

export function ReportDownload({
  studentId,
  from,
  to,
}: {
  studentId: string;
  from: string;
  to: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function download(audience: string) {
    setBusy(audience);
    setError(null);
    const base = `/ops/api/v1/students/${studentId}/report`;
    const made = await fetch(base, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience, from, to }),
    });
    const res = made.ok
      ? await fetch(
          `${base}/${((await made.json()) as { data: { referenceCode: string } }).data.referenceCode}/pdf`,
          { credentials: 'same-origin' },
        )
      : made;
    if (res.ok) await savePdf(res, 'student-report.pdf');
    else setError(await refusal(res, 'The report could not be made'));
    setBusy(null);
  }
  return (
    <span className="el-inline-form" role="group" aria-label="Download student report">
      {KINDS.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          className="el-button el-button-secondary"
          onClick={() => download(kind)}
          disabled={busy !== null}
        >
          {busy === kind ? 'Making the PDF…' : label}
        </button>
      ))}
      {error ? (
        <p className="el-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </span>
  );
}
