/** Imports: uploaded feedback files, their preview (mapping + row outcomes), commit or discard. */
import { can } from '@elevate/authorization';
import { StatusBadge, type Tone } from '@elevate/shared-ui';
import { shapeOf } from '../../../../domain/ai-assist';
import { IMPORT_FIELDS } from '../../../../domain/feedback-import';
import { aiBlocked } from '../../../../server/ai-drafts';
import { listAttachments } from '../../../../server/attachments';
import { feedbackPolicy } from '../../../../server/feedback-refs';
import { importDetail, listImports } from '../../../../server/feedback-import';
import { ActionForm } from '../../../../ui/action-form';
import { AiDraft } from '../../../../ui/ai-draft';
import { AttachmentList } from '../../../../ui/attachments';
import { fmtDateTime } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { listHref, Pager } from '../../../../ui/list-controls';
import { RecordModal } from '../../../../ui/record-modal';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { ImportUpload } from './import-upload';
import { API, BASE, type TabProps } from './shared';

const STATUS: Record<string, [string, Tone]> = {
  preview: ['Preview (not imported)', 'warning'],
  committed: ['Imported', 'success'],
  discarded: ['Discarded', 'neutral'],
};
const OUTCOME: Record<string, [string, Tone]> = {
  valid: ['Valid', 'success'],
  invalid: ['Error', 'danger'],
  unresolved: ['Unresolved', 'warning'],
  duplicate: ['Duplicate', 'neutral'],
};
const page = (v?: string) => Math.max(1, Number(v) || 1);

export async function ImportsTab({ user, params }: TabProps) {
  const result = await load((db) => listImports(db, user, page(params.page)));
  if (!result.ok) return result.view;
  const list = result.data;
  return (
    <>
      {can(user, 'ops:teacher_feedback:import') ? (
        <Segment title="Upload a feedback file">
          <ImportUpload api={API} base={BASE} />
        </Segment>
      ) : null}
      <RecordTable
        rows={list.rows}
        rowKey={(r) => r.id}
        caption={`${list.total} ${list.total === 1 ? 'file' : 'files'}, newest first`}
        rowHref={(r) => listHref(BASE, params, { open: r.id })}
        empty="No feedback files uploaded yet."
        columns={[
          { key: 'name', header: 'File', render: (r) => r.originalName },
          {
            key: 'at',
            header: 'Uploaded',
            render: (r) => `${fmtDateTime(r.createdAt)}${r.byName ? ` by ${r.byName}` : ''}`,
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <StatusBadge tone={STATUS[r.status]![1]}>{STATUS[r.status]![0]}</StatusBadge>
            ),
          },
          { key: 'rows', header: 'Rows', numeric: true, render: (r) => r.rowsTotal },
          { key: 'valid', header: 'Valid', numeric: true, render: (r) => r.rowsValid },
          { key: 'bad', header: 'Not importable', numeric: true, render: (r) => r.rowsInvalid },
          { key: 'dup', header: 'Duplicates', numeric: true, render: (r) => r.rowsDuplicate },
        ]}
      />
      <Pager
        basePath={BASE}
        params={params}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {params.open ? <ImportModal user={user} params={params} id={params.open} /> : null}
    </>
  );
}

async function ImportModal({ user, params, id }: TabProps & { id: string }) {
  const result = await load(async (db) => ({
    d: await importDetail(db, user, id),
    files: await listAttachments(db, user, 'feedback_import', id),
    categories: (await feedbackPolicy(db)).categories,
    ai: await aiBlocked(db, user, 'csvMapping'),
  }));
  if (!result.ok) return result.view;
  const { d, files, categories, ai } = result.data;
  const editable = d.status === 'preview' && can(user, 'ops:teacher_feedback:import');
  const targets = [
    ...Object.entries(IMPORT_FIELDS).map(([value, label]) => ({ value, label })),
    ...categories.map((c) => ({ value: `category:${c.code}`, label: `Rating: ${c.label}` })),
  ];
  const label = (field: string) => targets.find((t) => t.value === field)?.label ?? 'Not imported';
  const cell = (raw: unknown, field: string) => {
    const col = d.columns.find((c) => d.mapping[c] === field);
    return (col && (raw as Record<string, string>)[col]) || '—';
  };
  const [statusText, tone] = STATUS[d.status]!;
  return (
    <RecordModal
      id="import-modal"
      title={d.originalName}
      meta={<StatusBadge tone={tone}>{statusText}</StatusBadge>}
      closeHref={listHref(BASE, params, { open: undefined })}
      returnId={d.id}
      tabs={[
        {
          key: 'rows',
          label: 'Rows',
          count: d.rowsTotal,
          content: (
            <>
              <DetailTable
                caption="Row counts"
                rows={[
                  { label: 'Rows in the file', value: d.rowsTotal },
                  {
                    label: d.status === 'committed' ? 'Imported' : 'Valid (will be imported)',
                    value: d.rowsValid,
                  },
                  { label: 'Errors or unresolved (not imported)', value: d.rowsInvalid },
                  { label: 'Duplicates (not imported)', value: d.rowsDuplicate },
                  d.committedAt && { label: 'Imported at', value: fmtDateTime(d.committedAt) },
                ]}
              />
              <RecordTable
                rows={d.rows}
                rowKey={(r) => r.id}
                caption={
                  d.rowsTotal > d.rows.length
                    ? `First ${d.rows.length} of ${d.rowsTotal} rows, problems first`
                    : `${d.rowsTotal} rows, problems first`
                }
                columns={[
                  { key: 'n', header: 'Row', numeric: true, render: (r) => r.rowNumber },
                  { key: 'teacher', header: 'Teacher', render: (r) => cell(r.raw, 'teacher') },
                  { key: 'batch', header: 'Batch', render: (r) => cell(r.raw, 'batch') },
                  {
                    key: 'outcome',
                    header: 'Outcome',
                    render: (r) => (
                      <StatusBadge tone={OUTCOME[r.outcome]![1]}>
                        {OUTCOME[r.outcome]![0]}
                      </StatusBadge>
                    ),
                  },
                  {
                    key: 'messages',
                    header: 'What to fix',
                    render: (r) => (r.messages.length ? r.messages.join(' ') : 'Nothing'),
                  },
                ]}
              />
              {editable ? (
                <div className="el-inline-form">
                  <ActionForm
                    action={`${API}/imports/${d.id}/commit`}
                    submitLabel={`Import ${d.rowsValid} valid ${d.rowsValid === 1 ? 'row' : 'rows'}`}
                    successText="Imported."
                    fields={[
                      {
                        name: 'anonymous',
                        label: 'These responses were collected anonymously (no names asked)',
                        type: 'checkbox',
                      },
                      {
                        name: 'approve',
                        label: 'Approve them now (I checked them in this preview)',
                        type: 'checkbox',
                      },
                    ]}
                  />
                  <ActionForm
                    action={`${API}/imports/${d.id}/discard`}
                    submitLabel="Discard this preview"
                    variant="secondary"
                    successText="Discarded."
                  />
                </div>
              ) : null}
            </>
          ),
        },
        {
          key: 'mapping',
          label: 'Column matching',
          content: editable ? (
            <AiDraft
              api="/ops/api/v1/ai/csv-mapping"
              buttonLabel="Suggest matching with AI"
              blocked={ai}
              body={{
                kind: 'feedback',
                headers: d.columns,
                // Only the shape of each value ("date", "short text") is sent, never the value.
                samples: d.rows
                  .slice(0, 3)
                  .map((r) =>
                    d.columns.map((c) => shapeOf((r.raw as Record<string, string>)[c] ?? '')),
                  ),
              }}
            >
              <ActionForm
                action={`${API}/imports/${d.id}`}
                method="PATCH"
                submitLabel="Preview again with this matching"
                extra={{ columns: d.columns }}
                fields={d.columns.map((c, i) => ({
                  name: `fields.${i}`,
                  label: `Column “${c}”`,
                  type: 'select' as const,
                  options: targets,
                  defaultValue: d.mapping[c] || undefined,
                }))}
              />
            </AiDraft>
          ) : (
            <DetailTable
              caption="Column matching"
              rows={d.columns.map((c) => ({ label: c, value: label(d.mapping[c] ?? '') }))}
            />
          ),
        },
        {
          key: 'file',
          label: 'Original file',
          count: files.length,
          content: (
            <AttachmentList
              rows={files}
              apiBase="/ops/api/v1"
              empty="The original file was not stored (file storage is not set up)."
            />
          ),
        },
      ]}
    />
  );
}
