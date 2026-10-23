import { Alert } from '@elevate/shared-ui';
import { isEodFacts, isImportedReport, type EodFacts } from '../../../../domain/eod';
import { contextRows, factSections, periodFigures } from '../../../../server/eod-export';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';

const ONLY_WHEN_ANY = ['Left out of the on-time rate', 'Deadline changes'];

/**
 * The facts of any work report (draft or submitted version): headline figures, each with how it
 * is counted, the dated task sections (rows open the task) and the Academic, marketing,
 * attendance and development context. Built from records, never edited here.
 */
export function WorkReportFacts({
  f,
  base,
  level = 2,
}: {
  f: EodFacts;
  base: string;
  level?: 2 | 3;
}) {
  if (isImportedReport(f))
    return (
      <Alert tone="info" title="Imported — not sent">
        This report was imported from the old task tracker and never sent through Elevate OS.
        Download the PDF to read it.
      </Alert>
    );
  if (!isEodFacts(f))
    return (
      <Alert tone="info" title="Earlier report format">
        This report was saved before reports were built from task history. Download the PDF to see
        what was sent.
      </Alert>
    );
  const figures = periodFigures(f);
  return (
    <div className="el-stack">
      {f.noActivity ? (
        <Alert tone="info" title="No task activity recorded">
          No task events or work updates are dated in this period. Log work on a task to add it.
        </Alert>
      ) : null}
      {figures.length ? (
        <Segment title="Figures" level={level} flush>
          <DetailTable
            rows={figures.map((x) => ({
              label: x.label,
              value: (
                <>
                  {x.value}
                  <details className="el-explain">
                    <summary>How this is counted</summary>
                    {x.definition}
                  </details>
                </>
              ),
            }))}
          />
        </Segment>
      ) : null}
      {factSections(f)
        .filter((s) => s.rows.length || !ONLY_WHEN_ANY.includes(s.title))
        .map((s) => (
          <Segment key={s.title} title={`${s.title} (${s.rows.length})`} level={level} flush>
            <RecordTable
              rows={s.rows}
              rowKey={(r) => `${r.taskId}-${r.cells.join('|')}`}
              rowHref={(r) => `${base}/tasks/${r.taskId}`}
              linkColumn="task"
              empty="None recorded in this period."
              columns={[
                { key: 'task', header: 'Task', render: (r) => r.cells[0] },
                { key: 'when', header: 'When / status', render: (r) => r.cells[1] },
                { key: 'detail', header: 'Detail', render: (r) => r.cells[2] },
              ]}
            />
          </Segment>
        ))}
      <Segment title="Context" level={level} flush>
        <DetailTable rows={contextRows(f).map(([label, value]) => ({ label, value }))} />
      </Segment>
    </div>
  );
}
