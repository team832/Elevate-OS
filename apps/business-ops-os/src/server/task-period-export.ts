/** Downloads of the team / period report (CSV, PDF): same scope as the report, and audited. */
import type { Database } from '@elevate/database';
import { recordAudit, toCsv } from '@elevate/server-kit';
import { fmtDate, fmtDateTime } from '../ui/format';
import type { Actor } from './context';
import { createPdf } from './pdf/document';
import { PERIOD_DEFINITIONS, periodReport, type PeriodReport } from './task-period-report';

const filterLine = (r: PeriodReport, q: { staffId?: string; departmentId?: string }) =>
  `${fmtDate(r.window.from)} – ${fmtDate(r.window.to)} · cut-off ${fmtDateTime(r.asOf)}${q.staffId ? ' · one person' : ''}${q.departmentId ? ' · one department' : ''}`;

const PEOPLE_HEADER = [
  'Person',
  'Department',
  'Assigned',
  'Submitted',
  'Completed',
  'Open at cut-off',
  'Overdue at cut-off',
  'Blocked',
  'On time / due',
  'EOD expected workdays',
  'EOD submitted',
  'EOD reviewed',
  'EOD missing',
];
const personRow = (p: PeriodReport['people'][number]) => [
  p.name,
  p.department,
  p.assigned,
  p.submitted,
  p.completed,
  p.open,
  p.overdue,
  p.blocked,
  `${p.onTime.onTime} / ${p.onTime.eligible}`,
  p.eod.days,
  p.eod.submitted,
  p.eod.acknowledged,
  p.eod.missing,
];

async function exported(db: Database, actor: Actor, format: string, q: object) {
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'task_report.exported',
    entityType: 'task_report',
    entityId: null,
    metadata: { format, ...q },
  });
}

export async function periodReportCsv(
  db: Database,
  actor: Actor,
  q: Parameters<typeof periodReport>[2],
) {
  const r = await periodReport(db, actor, q);
  await exported(db, actor, 'csv', q);
  const blank = PEOPLE_HEADER.map(() => '');
  return {
    csv: toCsv(PEOPLE_HEADER, [
      ...r.people.map(personRow),
      blank,
      ['Blocked task', 'Owner', 'Blocked since', 'Age (days)', 'Reason'],
      ...r.blockers.map((b) => [
        b.title,
        b.owner,
        b.since ? fmtDateTime(b.since) : '',
        b.ageDays,
        b.reason,
      ]),
      blank,
      ['Unresolved decision', 'Owner', 'What', 'Since', 'Detail'],
      ...r.decisions.map((d) => [
        d.title,
        d.owner,
        d.what,
        d.since ? fmtDateTime(d.since) : '',
        d.detail,
      ]),
      blank,
      ['EOD revision requested', 'Report day', 'Since'],
      ...r.revisions.map((x) => [x.name, x.reportDate, fmtDateTime(x.since)]),
    ]),
    filename: `task-report-${q.from}-to-${q.to}.csv`,
  };
}

export async function periodReportPdf(
  db: Database,
  actor: Actor,
  q: Parameters<typeof periodReport>[2],
) {
  const r = await periodReport(db, actor, q);
  const pdf = await createPdf({
    title: 'Task and EOD report',
    reference: filterLine(r, q),
    templateVersion: 'task-period-report v1',
  });
  pdf.keyValues([
    ['Period', `${fmtDate(r.window.from)} – ${fmtDate(r.window.to)} (IST)`],
    ['Cut-off', fmtDateTime(r.asOf)],
    ['People', r.people.length],
    [
      'Source',
      'Task events and work updates; work reports in Business Ops; expected report days from HR attendance.',
    ],
  ]);
  pdf.heading('By person');
  pdf.table(
    PEOPLE_HEADER.filter((h) => h !== 'Department').map((header, i) => ({
      header,
      width: i === 0 ? 0.28 : 0.72 / (PEOPLE_HEADER.length - 2),
      align: i ? ('right' as const) : undefined,
    })),
    r.people.map((p) => personRow(p).filter((_, i) => i !== 1)),
  );
  pdf.heading(`Blocked at cut-off (${r.blockers.length})`);
  if (r.blockers.length)
    pdf.table(
      [
        { header: 'Task', width: 0.35 },
        { header: 'Owner', width: 0.2 },
        { header: 'Age (days)', width: 0.12, align: 'right' },
        { header: 'Reason', width: 0.33 },
      ],
      r.blockers.map((b) => [b.title, b.owner, b.ageDays, b.reason]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading(`Unresolved decisions (${r.decisions.length})`);
  if (r.decisions.length)
    pdf.table(
      [
        { header: 'Task', width: 0.35 },
        { header: 'Owner', width: 0.2 },
        { header: 'What', width: 0.2 },
        { header: 'Detail', width: 0.25 },
      ],
      r.decisions.map((d) => [d.title, d.owner, d.what, d.detail]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading(`EOD revisions requested (${r.revisions.length})`);
  if (r.revisions.length)
    pdf.table(
      [
        { header: 'Person', width: 0.5 },
        { header: 'Report day', width: 0.5 },
      ],
      r.revisions.map((x) => [x.name, fmtDate(x.reportDate)]),
    );
  else pdf.paragraph('None.', { muted: true });
  pdf.heading('How these are counted');
  pdf.keyValues(PERIOD_DEFINITIONS.map(([k, v]) => [k, v]));
  await exported(db, actor, 'pdf', q);
  return { bytes: await pdf.finish(), filename: `task-report-${q.from}-to-${q.to}.pdf` };
}
