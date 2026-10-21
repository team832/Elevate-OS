'use client';

/**
 * "Print admission form": POSTs to the form route (which records the generated form and its
 * SHA-256), saves the returned PDF and refreshes the page so the new status shows.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function FormDownload({ applicationId, label }: { applicationId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/ops/api/v1/applications/${applicationId}/form`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(json.error?.message ?? `The form could not be generated (${res.status}).`);
      setBusy(false);
      return;
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: name ?? 'admission-form.pdf',
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // revoking at once can cancel the download
    setBusy(false);
    router.refresh();
  }
  return (
    <>
      <button
        type="button"
        className="el-button el-button-secondary"
        onClick={download}
        disabled={busy}
      >
        {busy ? 'Generating…' : label}
      </button>
      {error ? (
        <p className="el-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
