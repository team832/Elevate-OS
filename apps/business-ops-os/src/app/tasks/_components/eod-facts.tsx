import { Alert, StatusBadge } from '@elevate/shared-ui';
import { fmtMinutes, isEodFacts, isImportedReport, type EodFacts } from '../../../domain/eod';
import { factSections } from '../../../server/eod-export';
import type { EodReportView } from '../../../server/eod-reports';
import { REVIEW_LABELS } from '../../../server/eod-review';
import { fmtDateTime } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment, Timeline } from '../../../ui/sections';

const metric = (v: number | null) => (v === null ? 'Not recorded' : String(v));

/**
 * The facts of an EOD (draft or submitted version): built from task events and updates, not
 * editable here — corrections go to the task or to Academic OS. Rows open the task.
 */
export function EodFactsView({ f, base, level = 2 }: { f: EodFacts; base: string; level?: 2 | 3 }) {
  if (isImportedReport(f))
    return (
      <Alert tone="info" title="Imported — not sent">
        This report was imported from the old task tracker. It was never sent through Elevate OS and
        its contents are kept as recorded there; download the PDF to read it.
      </Alert>
    );
  if (!isEodFacts(f))
    return (
      <Alert tone="info" title="Earlier report format">
        This report was saved before reports were built from task history. Download the PDF to see
        what was sent.
      </Alert>
    );
  const a = f.academic;
  return (
    <div className="el-stack">
      {f.noActivity ? (
        <Alert tone="info" title="No task activity recorded">
          No task events or work updates are dated on this day. Log work on a task to add it.
        </Alert>
      ) : null}
      {f.work.some((w) => w.enteredOn) || f.duration.overlaps ? (
        <Alert tone="warning" title="Check these entries">
          {f.work.some((w) => w.enteredOn) ? 'Some work was entered on a later day. ' : ''}
          {f.duration.overlaps ? 'Some timed entries overlap each other.' : ''}
        </Alert>
      ) : null}
      {factSections(f).map((s) => (
        <Segment key={s.title} title={`${s.title} (${s.rows.length})`} level={level} flush>
          <RecordTable
            rows={s.rows}
            rowKey={(r) => `${r.taskId}-${r.cells.join('|')}`}
            rowHref={(r) => `${base}/tasks/${r.taskId}`}
            linkColumn="task"
            empty="None recorded on this day."
            columns={[
              { key: 'task', header: 'Task', render: (r) => r.cells[0] },
              { key: 'when', header: 'When / status', render: (r) => r.cells[1] },
              { key: 'detail', header: 'Detail', render: (r) => r.cells[2] },
            ]}
          />
        </Segment>
      ))}
      <Segment title="Time, Academic work and attendance" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Recorded time',
              value: (
                <>
                  {fmtMinutes(f.duration.minutes)}
                  <details className="el-explain">
                    <summary>How this is counted</summary>
                    {f.duration.definition}
                    {f.duration.sameActivity
                      ? ` ${f.duration.sameActivity} entr${f.duration.sameActivity === 1 ? 'y is' : 'ies are'} the same activity as an Academic class and counted once.`
                      : ''}
                  </details>
                </>
              ),
            },
            {
              label: 'Academic work',
              value:
                a.status === 'available' ? (
                  `${metric(a.delivered)} of ${metric(a.planned)} planned classes delivered · ${metric(a.cancelled)} cancelled · ${metric(a.substituted)} substituted · teaching logs pending ${metric(a.logsPending)} · marking pending ${metric(a.markingPending)} · reviews submitted ${metric(a.reviewsSubmitted)} (checked ${fmtDateTime(a.checkedAt)})`
                ) : (
                  <StatusBadge tone="warning">Academic OS unavailable</StatusBadge>
                ),
            },
            {
              label: 'HR attendance',
              value: (
                <>
                  <StatusBadge tone="neutral">HR attendance unavailable</StatusBadge> No HR source
                  is connected; this is not a record of absence.
                </>
              ),
            },
            { label: 'Facts as of', value: fmtDateTime(f.asOf) },
          ]}
        />
      </Segment>
    </div>
  );
}

/** Submitted versions and the manager's responses, newest first. */
export function EodHistory({
  r,
  base,
  level = 2,
}: {
  r: EodReportView;
  base: string;
  level?: 2 | 3;
}) {
  const items = [
    ...r.versions.map((v) => ({
      key: v.id,
      at: v.submittedAt,
      when: fmtDateTime(v.submittedAt),
      title: `Version ${v.version} submitted${v.recipientName ? ` to ${v.recipientName}` : ''}`,
      detail: v.revisionOfVersionId ? `Revision of version ${v.version - 1}` : undefined,
    })),
    ...r.trail.map((t) => ({
      key: t.id,
      at: t.createdAt,
      when: fmtDateTime(t.createdAt),
      title: `${REVIEW_LABELS[t.kind]}${t.actorName ? ` by ${t.actorName}` : ''}`,
      detail:
        t.text ??
        (t.taskId ? <a href={`${base}/tasks/${t.taskId}`}>Open the follow-up task</a> : undefined),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <Segment title="Versions and responses" level={level}>
      {items.length ? (
        <Timeline label="Versions and responses" items={items} />
      ) : (
        <p>Not submitted yet.</p>
      )}
    </Segment>
  );
}
