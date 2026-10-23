'use client';

/**
 * Pick a punch CSV and ask the server for a preview. The file is read as text in the browser and
 * sent as data; the server parses and checks every row again. When the headings are not the
 * expected ones, AI can suggest which column is which (only headings and value shapes are sent);
 * using the suggestion renames the headings, and the preview shows the result before anything is added.
 */
import { useId, useState } from 'react';
import { Alert } from '@elevate/shared-ui';
import { PUNCH_COLUMNS, shapeOf } from '../../../../domain/ai-assist';
import { MAX_PUNCH_CSV_CHARS } from '../../../../domain/attendance';
import { parseCsv } from '../../../../domain/feedback-import';
import { ActionForm } from '../../../../ui/action-form';
import { AiDraft } from '../../../../ui/ai-draft';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const quote = (s: string) => (/[",]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function PunchFileUpload({
  api,
  previewHref,
  ai,
}: {
  api: string;
  previewHref: string;
  /** Why AI column matching can't be used now (null = ready). */
  ai?: string | null;
}) {
  const id = useId();
  const [file, setFile] = useState<{ name: string; content: string | null } | null>(null);
  const [matched, setMatched] = useState('');
  const [head, ...samples] = file?.content
    ? parseCsv(file.content.split(/\r?\n/, 4).join('\n'))
    : [];
  const unmatched =
    head && Object.values(PUNCH_COLUMNS).some((c) => !head.map(norm).includes(norm(c)));
  return (
    <>
      <div className="el-field">
        <label htmlFor={id}>Punch file (CSV)</label>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          className="el-input"
          aria-describedby={`${id}-hint`}
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            setMatched('');
            setFile(
              f
                ? { name: f.name, content: f.size > MAX_PUNCH_CSV_CHARS ? null : await f.text() }
                : null,
            );
          }}
        />
        <p id={`${id}-hint`} className="el-field-hint">
          First row: Staff code, Date-time, Direction. One punch per row, e.g. DEMO-T01, 2026-10-19
          09:02, in. Times are IST. Staff codes are the Employee IDs in the staff profiles.
        </p>
      </div>
      {file?.content === null ? (
        <Alert tone="danger">
          The file is larger than 2 MB. Split it by month and import each part.
        </Alert>
      ) : file ? (
        <>
          {unmatched ? (
            <AiDraft
              api="/ops/api/v1/ai/csv-mapping"
              buttonLabel="Suggest column matching with AI"
              blocked={ai}
              body={{
                kind: 'attendance',
                headers: head,
                // Only the shape of each value ("date and time", "code") is sent, never the value.
                samples: samples.map((r) => head.map((_, i) => shapeOf(r[i] ?? ''))),
              }}
              onUse={(items) => {
                const to = new Map(items.map((i) => [Number(i.name.split('.')[1]), i.value]));
                const line = head
                  .map((h, i) => quote(PUNCH_COLUMNS[to.get(i) as keyof typeof PUNCH_COLUMNS] ?? h))
                  .join(',');
                setFile({ ...file, content: file.content!.replace(/^[^\r\n]*/, line) });
                setMatched(items.map((i) => `${i.label} → ${i.shown}`).join('; '));
              }}
            />
          ) : null}
          {matched ? (
            <p className="el-field-hint" role="status">
              Matched {matched}. Check the preview before adding any punches.
            </p>
          ) : null}
          <ActionForm
            key={file.name}
            action={api}
            submitLabel={`Preview ${file.name}`}
            successText="Preview ready."
            extra={{ filename: file.name, content: file.content }}
            redirectTo={previewHref}
          />
        </>
      ) : null}
    </>
  );
}
