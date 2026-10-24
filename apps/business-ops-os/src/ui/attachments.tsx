'use client';

/**
 * Files on a record (R6): a list with download links and an upload control. Rows come from
 * `listAttachments` on the server; `apiBase` is the browser path of the workspace's API
 * (`/ops/api/v1`, `/academic/api/v1`, `/marketing/api/v1`), so the request stays on the
 * caller's own workspace (D-072). The server re-checks every request.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, type ChangeEvent } from 'react';
import { Alert, Button, DataTable, Field, fieldDescribedBy } from '@elevate/shared-ui';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMITS_TEXT,
  ATTACHMENT_MAX_BYTES,
  attachmentMime,
} from '../domain/attachments';
import { fmtDateTime } from './format';

export interface AttachmentItem {
  id: string;
  name: string;
  sizeBytes: number;
  uploaderName: string | null;
  createdAt: Date | string;
  canDelete: boolean;
}

const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** The server's message, or a plain one when the request never got an answer. */
async function failure(res: Response | null): Promise<string> {
  if (!res) return 'The request did not finish. Check your connection and try again.';
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; details?: { message?: string }[] };
  } | null;
  return (
    body?.error?.details?.[0]?.message ??
    body?.error?.message ??
    'That did not work. Try again in a moment.'
  );
}

export function AttachmentList({
  rows,
  apiBase,
  empty = 'No files yet.',
}: {
  rows: readonly AttachmentItem[];
  apiBase: string;
  empty?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function remove(row: AttachmentItem) {
    if (!window.confirm(`Remove ${row.name}? It will no longer be listed here.`)) return;
    const res = await fetch(`${apiBase}/attachments/${row.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (res?.ok) router.refresh();
    else setError(await failure(res));
  }
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable
        compact
        rows={rows}
        rowKey={(r) => r.id}
        empty={<p className="el-field-hint">{empty}</p>}
        columns={[
          {
            key: 'name',
            header: 'File',
            render: (r) => (
              <a href={`${apiBase}/attachments/${r.id}`} download>
                {r.name}
              </a>
            ),
          },
          { key: 'size', header: 'Size', numeric: true, render: (r) => fmtSize(r.sizeBytes) },
          { key: 'by', header: 'Added by', render: (r) => r.uploaderName ?? 'Not recorded' },
          { key: 'at', header: 'Added', render: (r) => fmtDateTime(r.createdAt) },
          {
            key: 'actions',
            header: <span className="el-visually-hidden">Actions</span>,
            render: (r) =>
              r.canDelete ? (
                <Button variant="secondary" onClick={() => void remove(r)}>
                  Remove<span className="el-visually-hidden"> {r.name}</span>
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}

export const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function AttachmentUpload({
  apiBase,
  ownerKind,
  ownerId,
  purpose,
  label = 'Add a file',
  accept = ATTACHMENT_ACCEPT,
  hint = ATTACHMENT_LIMITS_TEXT,
}: {
  apiBase: string;
  ownerKind: string;
  ownerId: string;
  purpose: string;
  label?: string;
  /** Narrower file types for this record (the server checks them again). */
  accept?: string;
  hint?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError(undefined);
    setDone(null);
    const mime = attachmentMime(file.name);
    if (!mime) return setError(`This type of file cannot be uploaded. ${ATTACHMENT_LIMITS_TEXT}`);
    if (file.size > ATTACHMENT_MAX_BYTES) return setError('The file is larger than 8 MB.');
    setBusy(true);
    const res = await readBase64(file)
      .then((dataBase64) =>
        fetch(`${apiBase}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ownerKind, ownerId, purpose, name: file.name, mime, dataBase64 }),
        }),
      )
      .catch(() => null);
    setBusy(false);
    input.value = '';
    if (!res?.ok) return setError(await failure(res));
    setDone(res.status === 200 ? `${file.name} is already attached.` : `${file.name} added.`);
    router.refresh();
  }

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={busy}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        onChange={(e) => void upload(e)}
      />
      <p className="el-field-hint" role="status" aria-live="polite">
        {busy ? 'Uploading…' : done}
      </p>
    </Field>
  );
}
