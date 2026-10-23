'use client';

/**
 * Pick a feedback CSV; it is read as text in the browser and sent for a preview. The server
 * parses and checks every row again; nothing is imported until HR commits the preview.
 */
import { useId, useState } from 'react';
import { Alert } from '@elevate/shared-ui';
import { MAX_FEEDBACK_CSV_CHARS } from '../../../../domain/feedback-import';
import { ActionForm } from '../../../../ui/action-form';

export function ImportUpload({ api, base }: { api: string; base: string }) {
  const id = useId();
  const [file, setFile] = useState<{ name: string; content: string | null } | null>(null);
  return (
    <>
      <div className="el-field">
        <label htmlFor={id}>Feedback file (CSV)</label>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          className="el-input"
          aria-describedby={`${id}-hint`}
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            setFile(
              f
                ? { name: f.name, content: f.size > MAX_FEEDBACK_CSV_CHARS ? null : await f.text() }
                : null,
            );
          }}
        />
        <p id={`${id}-hint`} className="el-field-hint">
          One row per response, with a heading row. Save a spreadsheet as CSV first. Columns are
          matched to fields by their headings; you can change the matching in the preview.
        </p>
      </div>
      {file?.content === null ? (
        <Alert tone="danger">The file is larger than 2 MB; split it into smaller files.</Alert>
      ) : file ? (
        <ActionForm
          key={file.name}
          action={`${api}/imports`}
          submitLabel="Preview import"
          successText="Preview ready."
          extra={{ name: file.name, content: file.content }}
          redirectTo={`${base}?tab=imports&open={id}`}
        />
      ) : null}
    </>
  );
}
