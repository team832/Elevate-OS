/** HR attendance: the "Import punches" tab (upload → row preview → commit; recent imports). */
import { StatusBadge } from '@elevate/shared-ui';
import type {
  getPunchImport,
  ImportRow,
  listPunchImports,
} from '../../../../server/attendance-import';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDateTime } from '../../../../ui/format';
import { RecordTable } from '../../../../ui/record-table';
import { Segment } from '../../../../ui/sections';
import { API, BASE } from './days';
import { PunchFileUpload } from './import-upload';

type Import = Awaited<ReturnType<typeof listPunchImports>>[number];
const OUTCOME = {
  valid: ['success', 'Will be added'],
  duplicate: ['neutral', 'Already recorded, skipped'],
  invalid: ['danger', 'Cannot be read'],
} as const;

export function ImportTab({
  imports,
  preview,
  ai,
}: {
  imports: Import[];
  preview: Awaited<ReturnType<typeof getPunchImport>> | null;
  /** Why AI column matching can't be used now (null = ready). */
  ai?: string | null;
}) {
  const rows = (preview?.rows ?? []) as ImportRow[];
  return (
    <>
      <Segment
        title="Import punches from a file"
        description="For check-ins and check-outs exported from another system. Nothing is stored until you commit the preview. No device is connected to Elevate OS."
      >
        <PunchFileUpload
          api={`${API}/imports`}
          previewHref={`${BASE}?tab=import&import={id}`}
          ai={ai}
        />
      </Segment>
      {preview ? (
        <Segment
          title={preview.sourceLabel}
          meta={
            <StatusBadge tone={preview.status === 'committed' ? 'success' : 'info'}>
              {preview.status === 'committed' ? 'Committed' : 'Preview'}
            </StatusBadge>
          }
          description={`${preview.rowsTotal} rows: ${preview.rowsValid} to add, ${preview.rowsDuplicate} already recorded, ${preview.rowsInvalid} cannot be read.`}
          actions={
            preview.status === 'preview' && preview.rowsValid > 0 ? (
              <ActionForm
                action={`${API}/imports/${preview.id}`}
                submitLabel={`Add ${preview.rowsValid} punches`}
                successText="Punches added."
              />
            ) : null
          }
          flush
        >
          <RecordTable<ImportRow>
            rows={rows}
            rowKey={(r) => String(r.line)}
            caption={`Rows of ${preview.sourceLabel}`}
            empty="The file has a header row but no punches."
            columns={[
              { key: 'line', header: 'Line', numeric: true, render: (r) => r.line },
              {
                key: 'staff',
                header: 'Staff',
                render: (r) =>
                  r.staffName ? `${r.staffName} (${r.staffCode})` : r.staffCode || '—',
              },
              { key: 'at', header: 'Time', render: (r) => (r.at ? fmtDateTime(r.at) : '—') },
              {
                key: 'dir',
                header: 'Direction',
                render: (r) =>
                  r.direction === 'in' ? 'Check-in' : r.direction === 'out' ? 'Check-out' : '—',
              },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (r) => (
                  <>
                    <StatusBadge tone={OUTCOME[r.outcome][0]}>{OUTCOME[r.outcome][1]}</StatusBadge>
                    {r.errors.length ? (
                      <p className="el-field-hint">{r.errors.join('. ')}</p>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </Segment>
      ) : null}
      <RecordTable<Import>
        rows={imports}
        rowKey={(i) => i.id}
        caption="Recent imports (last 10)"
        empty="No files imported yet."
        rowHref={(i) => `${BASE}?tab=import&import=${i.id}`}
        columns={[
          { key: 'source', header: 'File', render: (i) => i.sourceLabel },
          { key: 'when', header: 'Uploaded', render: (i) => fmtDateTime(i.createdAt) },
          {
            key: 'status',
            header: 'Status',
            render: (i) =>
              i.committedAt ? `Committed ${fmtDateTime(i.committedAt)}` : 'Preview only',
          },
          {
            key: 'added',
            header: 'Added',
            numeric: true,
            render: (i) => (i.committedAt ? i.rowsValid : '—'),
          },
          {
            key: 'skipped',
            header: 'Skipped',
            numeric: true,
            render: (i) => i.rowsDuplicate + i.rowsInvalid,
          },
        ]}
      />
    </>
  );
}
