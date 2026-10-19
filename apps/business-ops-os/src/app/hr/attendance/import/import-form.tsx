'use client';

/**
 * CSV import: paste or choose a file, check it (preview with per-row errors),
 * then import the valid rows. The server re-validates on import; the same
 * file is never imported twice.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ChangeEvent } from 'react';

type Row = { row: number; employeeCode: string; ok: boolean; errors: string[] };
type Result = {
  mode: 'preview' | 'commit';
  alreadyImported: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Row[];
  batch: { id: string; createdSessions: number } | null;
};

export function ImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
  }

  async function send(commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/ops/api/v1/hr/attendance-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ csv, fileName, commit }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: Result;
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status}).`);
        setResult(null);
      } else {
        setResult(json.data);
        if (commit) startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="el-stack">
      <div className="el-field">
        <label htmlFor="csv-file">CSV file</label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="el-input"
        />
      </div>
      <div className="el-field">
        <label htmlFor="csv-text">Or paste the CSV</label>
        <textarea
          id="csv-text"
          className="el-textarea"
          rows={8}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
          }}
        />
        <p className="el-field-hint">
          Columns: employee_code, date, clock_in, clock_out, and optionally break_minutes, timezone,
          note. clock_out is HH:MM on the same date, or YYYY-MM-DD HH:MM for a session that ends the
          next day.
        </p>
      </div>
      <div className="el-inline-form">
        <button
          type="button"
          className="el-button el-button-secondary"
          disabled={!csv || busy}
          onClick={() => send(false)}
        >
          {busy ? 'Checking…' : 'Check file'}
        </button>
        <button
          type="button"
          className="el-button el-button-primary"
          disabled={
            !result ||
            result.mode !== 'preview' ||
            result.validRows === 0 ||
            result.alreadyImported ||
            busy
          }
          onClick={() => send(true)}
        >
          {result && result.mode === 'preview' && result.validRows > 0
            ? `Import ${result.validRows} valid row(s)`
            : 'Import valid rows'}
        </button>
      </div>
      {error ? (
        <div className="el-alert el-tone-danger" role="alert">
          <p className="el-alert-title">{error}</p>
        </div>
      ) : null}
      {result?.alreadyImported ? (
        <div className="el-alert el-tone-info" role="status">
          <p className="el-alert-title">
            This exact file was already imported. Nothing new was created.
          </p>
        </div>
      ) : null}
      {result && result.mode === 'commit' && !result.alreadyImported ? (
        <div className="el-alert el-tone-success" role="status">
          <p className="el-alert-title">
            Imported {result.batch?.createdSessions ?? 0} session(s). {result.invalidRows} row(s)
            were skipped.
          </p>
        </div>
      ) : null}
      {result && result.rows.length ? (
        <div className="el-table-wrap">
          <table className="el-table">
            <caption>
              {result.totalRows} row(s): {result.validRows} valid, {result.invalidRows} with errors
            </caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Employee code</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row}>
                  <td className="el-num">{r.row}</td>
                  <td>{r.employeeCode || '—'}</td>
                  <td>{r.ok ? 'Valid' : r.errors.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
