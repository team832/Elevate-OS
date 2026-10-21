'use client';

/**
 * "Confirm admission": the approver re-enters their own password (checked on the server, never
 * kept). One request at a time; the field is cleared after a failure.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

export function ConfirmAdmissionForm({
  applicationId,
  version,
  cancelHref,
}: {
  applicationId: string;
  version: number;
  cancelHref: string;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; missing?: string[] } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    const res = await fetch(`/ops/api/v1/applications/${applicationId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, applicationVersion: version }),
      credentials: 'same-origin',
    }).catch(() => null);
    form.reset();
    if (!res) {
      setError({ message: 'No connection to the server. Nothing was confirmed; try again.' });
      setBusy(false);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { admissionId: string };
      error?: { message: string; details?: { missing?: string[] } };
    };
    if (!res.ok || !json.data) {
      const wait = res.headers.get('retry-after');
      setError({
        message:
          (json.error?.message ?? `Not confirmed (${res.status}).`) +
          (wait ? ` Try again in ${Math.ceil(Number(wait) / 60)} minute(s).` : ''),
        missing: json.error?.details?.missing,
      });
      setBusy(false);
      return;
    }
    router.push(`/admissions/${json.data.admissionId}`);
  }
  return (
    <form onSubmit={submit} className="el-stack" noValidate>
      <div className="el-field">
        <label htmlFor={`${id}-password`}>Your account password *</label>
        <input
          id={`${id}-password`}
          name="password"
          type="password"
          className="el-input"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="el-field-hint">
          Checked on the server against your own account and never stored. You confirm version{' '}
          {version}.
        </p>
      </div>
      {error ? (
        <div className="el-alert el-tone-danger" role="alert">
          <p className="el-alert-title">{error.message}</p>
          {error.missing?.length ? (
            <ul>
              {error.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="ops-form-footer">
        <a href={cancelHref}>Cancel</a>
        <button type="submit" className="el-button el-button-primary" disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm admission and assign number'}
        </button>
      </div>
    </form>
  );
}
