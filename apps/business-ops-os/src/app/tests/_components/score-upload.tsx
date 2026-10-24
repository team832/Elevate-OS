'use client';

/**
 * Pick a score sheet: a CSV is read here only to match its columns (the server reads and checks
 * every row again); a PDF is read by AI (Gemini or OpenRouter, D-110) on the server, only after the uploader ticks the
 * confirmation each time (owner answer 6). Excel files are refused with how to save them as CSV.
 */
import { useId, useState } from 'react';
import { Alert } from '@elevate/shared-ui';
import { attachmentMime, ATTACHMENT_MAX_BYTES } from '../../../domain/attachments';
import {
  readScoreCsv,
  SCORE_FIELDS,
  suggestScoreMapping,
  type ScoreMapping,
  type ScoreSection,
} from '../../../domain/score-import';
import { ActionForm } from '../../../ui/action-form';
import { readBase64 } from '../../../ui/attachments';

const EXCEL =
  'Excel files are not read. Save the sheet as CSV (File → Save as → CSV) and upload that.';
type Picked = { name: string; mime: string; dataBase64: string; header: string[] | null };

export function ScoreUpload({
  action,
  reviewHref,
  sections,
  ai,
}: {
  action: string;
  /** `{id}` = the new import. */
  reviewHref: string;
  sections: readonly { code: string; name: string }[];
  /** Why AI reading can't be used now (null = ready). */
  ai: string | null;
}) {
  const id = useId();
  const [file, setFile] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ScoreMapping>({});
  const rules = sections as unknown as ScoreSection[];
  const targets = [
    ...Object.entries(SCORE_FIELDS).map(([value, f]) => ({ value, label: f.label })),
    ...sections.map((s) => ({ value: `section:${s.code}`, label: `${s.name} marks` })),
  ];

  async function pick(f: File | undefined) {
    setFile(null);
    setProblem(null);
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return setProblem(EXCEL);
    const mime = attachmentMime(f.name);
    if (!mime || !/\.(csv|pdf)$/i.test(f.name)) return setProblem('Choose a .csv or .pdf file.');
    if (f.size > ATTACHMENT_MAX_BYTES) return setProblem('The file is larger than 8 MB.');
    const csv = mime === 'text/csv' ? readScoreCsv(await f.text()) : null;
    if (csv && !csv.ok) return setProblem(csv.error);
    const header = csv?.ok ? csv.header : null;
    if (header) setMapping(suggestScoreMapping(header, rules).mapping);
    setFile({ name: f.name, mime, dataBase64: await readBase64(f), header });
  }

  const pdf = file && !file.header;
  return (
    <div className="el-stack">
      <div className="el-field">
        <label htmlFor={id}>Score sheet (CSV or PDF)</label>
        <input
          id={id}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          className="el-input"
          aria-describedby={`${id}-hint`}
          onChange={(e) => void pick(e.currentTarget.files?.[0])}
        />
        <p id={`${id}-hint`} className="el-field-hint">
          CSV: one row per student with an admission number, student code or name, and the total or
          each section’s marks; an Attendance column is optional. A blank cell is “not entered”,
          never 0. Excel: save as CSV first. PDF or scan: read by AI, then checked row by row.
        </p>
      </div>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {file?.header ? (
        <fieldset className="el-fieldset">
          <legend>Which column is which</legend>
          <div className="ops-filter-grid">
            {file.header.map((h) => (
              <div className="el-field" key={h}>
                <label htmlFor={`${id}-${h}`}>Column “{h}”</label>
                <select
                  id={`${id}-${h}`}
                  className="el-select"
                  value={mapping[h] ?? ''}
                  onChange={(e) =>
                    setMapping({ ...mapping, [h]: e.currentTarget.value as ScoreMapping[string] })
                  }
                >
                  <option value="">Not imported</option>
                  {targets.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
      {pdf && ai ? (
        <Alert tone="warning">{ai} Save the sheet as CSV and import that instead.</Alert>
      ) : file ? (
        <ActionForm
          key={file.name}
          action={action}
          submitLabel={pdf ? `Send ${file.name} to AI and read it` : `Read ${file.name}`}
          successText="Read. Opening the review…"
          redirectTo={reviewHref}
          extra={{
            source: pdf ? 'pdf_ai' : 'csv',
            name: file.name,
            mime: file.mime,
            dataBase64: file.dataBase64,
            ...(pdf ? {} : { mapping }),
          }}
          fields={
            pdf
              ? [
                  {
                    name: 'confirmSend',
                    label: 'I confirm sending this score sheet to an AI service',
                    type: 'checkbox',
                    required: true,
                    hint: 'Only this file goes to a free AI service (Gemini or OpenRouter): no contact, KYC or parent details. Every row it reads must be checked by a person before marks are saved. Asked every time.',
                  },
                ]
              : []
          }
        />
      ) : null}
    </div>
  );
}
