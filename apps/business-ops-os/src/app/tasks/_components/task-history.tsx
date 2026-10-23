/**
 * The end-to-end report (recorded, elapsed and waiting time; PDF/CSV) and the dated history of a
 * task (brief 2 §12B), newest first with who did what.
 */
import { ButtonLink } from '@elevate/shared-ui';
import { TASK_STATUS_LABELS } from '../../../domain/staff-tasks';
import { EVENT_LABELS, eventDetail, fmtDuration } from '../../../domain/task-report';
import type { TaskDetail } from '../../../server/task-detail';
import { fmtDateTime } from '../../../ui/format';
import { DetailTable, Segment, Timeline } from '../../../ui/sections';
import { taskPaths } from './task-common';

const statusOf = (s: keyof typeof TASK_STATUS_LABELS) => TASK_STATUS_LABELS[s];

export function TaskReport({ d, base }: { d: TaskDetail; base: string }) {
  const href = (f: string) => `${taskPaths(base).api}/${d.id}/report?format=${f}`;
  return (
    <Segment
      title="End-to-end report"
      actions={
        <>
          <ButtonLink href={href('pdf')}>Download PDF</ButtonLink>{' '}
          <ButtonLink href={href('csv')}>Download CSV</ButtonLink>
        </>
      }
    >
      <DetailTable
        rows={[
          {
            label: 'Recorded work time',
            value: `${fmtDuration(d.time.recordedMinutes)} (sum of work updates, self-reported)`,
          },
          {
            label: 'Elapsed time',
            value: `${fmtDuration(d.time.elapsedMinutes)} since received (not effort)`,
          },
          {
            label: 'Waiting time',
            value: `${fmtDuration(d.time.waitingMinutes)} blocked, on hold or in review`,
          },
          ...d.time.waits.map((w, i) => ({
            label: i ? '' : 'Waiting intervals',
            value: `${statusOf(w.status)}: ${fmtDateTime(w.from)} – ${fmtDateTime(w.to)}${w.reason ? ` · ${w.reason}` : ''}`,
          })),
        ]}
      />
    </Segment>
  );
}

export function TaskHistory({ d }: { d: TaskDetail }) {
  return (
    <Segment title="History" description="Every change, newest first, with who made it.">
      <Timeline
        label="Task history"
        items={[...d.events].reverse().map((e) => ({
          key: e.id,
          when: fmtDateTime(e.occurredAt),
          title: `${EVENT_LABELS[e.kind]} · ${e.actorName}`,
          detail: eventDetail(e) || undefined,
        }))}
      />
    </Segment>
  );
}
