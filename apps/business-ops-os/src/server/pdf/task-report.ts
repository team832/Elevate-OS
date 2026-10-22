/**
 * End-to-end task report download (brief 2 §12B): PDF (A4, branding, IST, page numbers, source
 * and version line; long text wraps across pages) or CSV (`toCsv`: escaping and formula
 * neutralisation). Same read rules as the task page; every download is audited.
 */
import { toCsv } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import { TASK_STATUS_LABELS } from '../../domain/staff-tasks';
import { chronology, fmtDuration } from '../../domain/task-report';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import type { Actor } from '../context';
import { taskDetail, type TaskDetail } from '../task-detail';
import { taskAudit } from '../task-store';
import { createPdf } from './document';

const CSV_HEADER = ['When (IST)', 'Type', 'What', 'Who', 'Detail', 'Work date', 'Minutes'];

/** Owner changes in order: who held the task, from when. */
const handoffs = (d: TaskDetail) =>
  d.events
    .filter((e) => ['created', 'imported', 'reassigned'].includes(e.kind))
    .map((e) => [fmtDateTime(e.occurredAt), e.fromStaffName, e.toStaffName, e.actorName, e.reason]);

function summary(d: TaskDetail): [string, string | null][] {
  return [
    ['Task', d.title],
    ['Status', TASK_STATUS_LABELS[d.status]],
    ['Owner', d.staffName],
    ['Requested by', d.requesterName ?? d.requesterNote ?? d.assignedByName],
    ['Source', humanise(d.source)],
    ['Department', d.departmentName],
    ['Review step', d.reviewRequired ? `Yes — ${d.reviewerName ?? 'an operations manager'}` : 'No'],
    ['Acceptance criteria', d.acceptanceCriteria],
    ['Received', fmtDateTime(d.receivedAt)],
    ['Planned start', d.plannedStartOn ? fmtDate(d.plannedStartOn) : null],
    ['Due', `${fmtDate(d.dueOn)}${d.dueTime ? `, ${d.dueTime.slice(0, 5)} IST` : ''}`],
    ['Acknowledged', d.acknowledgedAt ? fmtDateTime(d.acknowledgedAt) : 'Not acknowledged'],
    ['Completed', d.completedAt ? fmtDateTime(d.completedAt) : null],
    [
      'Waits on',
      d.waitsOn.map((t) => `${t.title} (${TASK_STATUS_LABELS[t.status]})`).join('; ') || 'Nothing',
    ],
    ['Recorded work time', `${fmtDuration(d.time.recordedMinutes)} (sum of work updates)`],
    [
      'Elapsed time',
      `${fmtDuration(d.time.elapsedMinutes)} (received to ${d.completedAt ? 'closed' : 'now'}; not effort)`,
    ],
    ['Waiting time', `${fmtDuration(d.time.waitingMinutes)} (blocked, on hold or in review)`],
  ];
}

export async function taskReportFile(
  db: Database,
  actor: Actor,
  id: string,
  format: 'pdf' | 'csv',
  requestId?: string,
) {
  const d = await taskDetail(db, actor, id);
  const metadata = { format, version: d.version };
  await taskAudit(db, actor, d.id, 'staff_task.report_exported', { metadata }, requestId);
  const rows = chronology(d.events, d.updates);
  const name = `task-report-${d.id.slice(0, 8)}-v${d.version}`;
  if (format === 'csv')
    return {
      body: toCsv(
        CSV_HEADER,
        rows.map((r) => [
          fmtDateTime(r.at),
          r.type,
          r.what,
          r.who,
          r.detail,
          r.workDate,
          r.minutes,
        ]),
      ),
      filename: `${name}.csv`,
    };
  const pdf = await createPdf({
    title: 'End-to-end task report',
    reference: `Task ${d.id.slice(0, 8)} · version ${d.version}`,
    templateVersion: 'task-report v1 · source: Business Ops task history',
  });
  if (d.isSample) pdf.banner('SAMPLE DATA — fictional record');
  pdf.keyValues(summary(d));
  pdf.heading('Requirement');
  pdf.paragraph(d.details ?? 'No details recorded.', { muted: !d.details });
  pdf.heading('Owners and handoffs');
  pdf.table(
    [
      { header: 'When', width: 0.2 },
      { header: 'From', width: 0.17 },
      { header: 'To', width: 0.17 },
      { header: 'By', width: 0.17 },
      { header: 'Reason', width: 0.29 },
    ],
    handoffs(d),
  );
  pdf.heading('Waiting intervals');
  if (d.time.waits.length)
    pdf.table(
      [
        { header: 'Status', width: 0.16 },
        { header: 'From', width: 0.22 },
        { header: 'To', width: 0.22 },
        { header: 'Reason', width: 0.4 },
      ],
      d.time.waits.map((w) => [
        TASK_STATUS_LABELS[w.status],
        fmtDateTime(w.from),
        fmtDateTime(w.to),
        w.reason,
      ]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.keep(140); // heading, table header and the first entries stay together
  pdf.heading('Chronology');
  pdf.table(
    [
      { header: 'When', width: 0.19 },
      { header: 'What', width: 0.18 },
      { header: 'Who', width: 0.15 },
      { header: 'Detail', width: 0.4 },
      { header: 'Min', width: 0.08, align: 'right' },
    ],
    rows.map((r) => [
      fmtDateTime(r.at),
      r.what,
      r.who,
      r.workDate ? `Work date ${fmtDate(r.workDate)} · ${r.detail}` : r.detail,
      r.minutes,
    ]),
  );
  return { body: await pdf.finish(), filename: `${name}.pdf` };
}
