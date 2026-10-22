/**
 * EOD exports (owner brief 2 §11–12): PDF and CSV of a submitted version (or the draft, with a
 * banner) and the plain-text summary behind "Copy summary". Same read rules as the screen;
 * every download is audited. Nothing is sent anywhere: no external provider is configured.
 */
import { toCsv } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import { eodPlainText, fmtMinutes, isEodFacts, type EodFacts } from '../domain/eod';
import { TASK_STATUS_LABELS } from '../domain/staff-tasks';
import { fmtDate, fmtDateTime } from '../ui/format';
import { notFound, type Actor } from './context';
import { audit, getReport, type EodReportView } from './eod-reports';
import { createPdf } from './pdf/document';

export const EOD_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  revision_requested: 'Revision requested',
  acknowledged: 'Acknowledged',
} as const;

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
    },
  });
}

/** The version to export: `n`, else the latest submitted one, else the draft. */
function pick(r: EodReportView, n?: number) {
  const v = n ? r.versions.find((x) => x.version === n) : r.current;
  if (n && !v) notFound('Report version');
  return {
    facts: (v?.snapshot ?? r.snapshot) as EodFacts,
    narrative: v?.narrative ?? { summary: r.summary, nextDayPlan: r.nextDayPlan, notes: r.notes },
    version: v?.version ?? null,
    recipient: v?.recipientName ?? null,
    submittedAt: v?.submittedAt ?? null,
  };
}

const when = (iso: string) => fmtDateTime(iso).replace(/^\d+ \w+ \d+, /, '');

export interface FactRow {
  taskId: string;
  /** Task, when / status, detail. */
  cells: [string, string, string];
}
/** The fact sections, shared by the screen, the PDF and the CSV. */
export function factSections(f: EodFacts): { title: string; rows: FactRow[] }[] {
  const row = (taskId: string, ...cells: FactRow['cells']): FactRow => ({ taskId, cells });
  const events = (items: EodFacts['received']) =>
    items.map((i) => row(i.taskId, i.title, when(i.at), i.detail ?? ''));
  return [
    { title: 'Tasks received or assigned', rows: events(f.received) },
    { title: 'Acknowledged', rows: events(f.acknowledged) },
    { title: 'Completed', rows: events(f.completed) },
    {
      title: 'Work performed',
      rows: f.work.map((w) =>
        row(
          w.taskId,
          w.title,
          fmtMinutes(w.minutes),
          [
            w.workPerformed,
            w.result && `Result: ${w.result}`,
            w.nextStep && `Next: ${w.nextStep}`,
            w.enteredOn && `Entered ${fmtDate(w.enteredOn)}`,
            w.overlaps && 'Overlaps another entry',
            w.sameActivity && 'Same activity as an Academic class (class time not added)',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    },
    { title: 'Blocked or blockers', rows: events(f.blocked) },
    { title: 'Decisions or help requested', rows: events(f.decisions) },
    {
      title: 'Open at cut-off',
      rows: f.backlog.map((b) =>
        row(
          b.taskId,
          b.title,
          `${TASK_STATUS_LABELS[b.status]}${b.overdue ? ' (overdue)' : ''}${b.closedLater ? ', closed later' : ''}`,
          [`Due ${fmtDate(b.dueOn)}${b.dueTime ? ` ${b.dueTime.slice(0, 5)}` : ''}`, b.reason]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    },
  ];
}

const academicLine = (f: EodFacts) =>
  f.academic.status === 'available'
    ? `Academic OS, checked ${fmtDateTime(f.academic.checkedAt)}`
    : `Academic OS unavailable (${f.academic.reason})`;

async function exported(
  db: Database,
  actor: Actor,
  r: EodReportView,
  format: string,
  version: number | null,
) {
  await audit(db, actor, r.id, 'eod_report.exported', { metadata: { format, version } });
}

/** The report (a version, or the draft) as an A4 PDF. */
export async function eodReportPdf(db: Database, actor: Actor, id: string, n?: number) {
  const r = await getReport(db, actor, id);
  const v = pick(r, n);
  const f = v.facts;
  const pdf = await createPdf({
    title: 'End-of-day report',
    reference: `${r.staffName} · ${fmtDate(r.reportDate)}${v.version ? ` · v${v.version}` : ''}`,
    templateVersion: 'eod-report v2',
  });
  if (!v.version) pdf.banner('Draft — not submitted');
  if (r.isSample) pdf.banner('Sample data — fictional staff', 'neutral');
  pdf.keyValues([
    ['Staff member', r.staffName],
    ['Department', r.department ?? 'Not set'],
    ['Reporting manager', r.managerName ?? 'Not set'],
    ['Report day', `${fmtDate(r.reportDate)}, 00:00–24:00 IST`],
    ['Version', v.version ? `${v.version} of ${r.versions.length}` : 'Draft'],
    ['Status', EOD_STATUS_LABELS[r.status]],
    ['Submitted', v.submittedAt ? fmtDateTime(v.submittedAt) : null],
    ['Sent to', v.recipient],
    ['Facts as of', isEodFacts(f) ? fmtDateTime(f.asOf) : null],
    [
      'Sources',
      isEodFacts(f)
        ? `Task events and work updates in Business Ops; ${academicLine(f)}; HR attendance unavailable`
        : r.imported
          ? 'Imported from the old task tracker; not sent through Elevate OS'
          : 'Task status at submission (earlier report format)',
    ],
  ]);
  for (const [title, text] of [
    ['Summary', v.narrative.summary],
    ['Plan for the next day', v.narrative.nextDayPlan],
    ['Notes', v.narrative.notes],
  ] as const) {
    pdf.heading(title);
    pdf.paragraph(text ?? 'Not written.', { muted: !text });
  }
  if (isEodFacts(f)) {
    if (f.noActivity) pdf.banner('No task activity recorded on this day.', 'neutral');
    const columns = [
      { header: 'Task', width: 0.32 },
      { header: 'When / status', width: 0.2 },
      { header: 'Detail', width: 0.48 },
    ];
    for (const s of factSections(f)) {
      pdf.heading(`${s.title} (${s.rows.length})`);
      if (s.rows.length)
        pdf.table(
          columns,
          s.rows.map((r) => r.cells),
        );
      else pdf.paragraph('None recorded.', { muted: true });
    }
    pdf.heading('Recorded time');
    pdf.paragraph(
      `${fmtMinutes(f.duration.minutes)}. ${f.duration.definition}${f.duration.overlaps ? ' Some entries overlap.' : ''}`,
    );
    pdf.heading('Academic work');
    const a = f.academic;
    if (a.status === 'available')
      pdf.keyValues([
        ['Classes planned', a.planned],
        ['Classes delivered', a.delivered],
        ['Cancelled', a.cancelled],
        ['Substituted', a.substituted],
        ['Teaching logs pending', a.logsPending],
        ['Marking pending', a.markingPending],
        ['Reviews submitted', a.reviewsSubmitted],
      ]);
    else
      pdf.paragraph(`Academic OS unavailable: ${a.reason}. Checked ${fmtDateTime(a.checkedAt)}.`);
    pdf.heading('HR attendance');
    pdf.paragraph(
      'HR attendance unavailable: no HR attendance source is connected. This is not a record of absence.',
    );
  }
  await exported(db, actor, r, 'pdf', v.version);
  return {
    bytes: await pdf.finish(),
    filename: `eod-report-${r.reportDate}-${v.version ? `v${v.version}` : 'draft'}-${r.id.slice(0, 8)}.pdf`,
  };
}

/** The report's facts as CSV rows (section, task, when/status, detail). */
export async function eodReportCsv(db: Database, actor: Actor, id: string, n?: number) {
  const r = await getReport(db, actor, id);
  const v = pick(r, n);
  if (!isEodFacts(v.facts)) notFound('Report facts in the current format');
  await exported(db, actor, r, 'csv', v.version);
  const rows = factSections(v.facts).flatMap((s) => s.rows.map((r) => [s.title, ...r.cells]));
  return {
    csv: toCsv(
      ['Section', 'Task', 'When / status', 'Detail'],
      [
        [
          'Report',
          r.staffName,
          fmtDate(r.reportDate),
          v.version ? `Version ${v.version}` : 'Draft',
        ],
        ['Department', r.department ?? 'Not set', 'Manager', r.managerName ?? 'Not set'],
        ...rows,
        ['Recorded time', '', fmtMinutes(v.facts.duration.minutes), v.facts.duration.definition],
        ['Academic work', '', '', academicLine(v.facts)],
        ['HR attendance', '', '', 'HR attendance unavailable'],
      ],
    ),
    filename: `eod-report-${r.reportDate}-${v.version ? `v${v.version}` : 'draft'}.csv`,
  };
}

/** Plain text for "Copy summary" (built from the version; nothing is sent). */
export function eodSummaryText(r: EodReportView) {
  const v = pick(r);
  return isEodFacts(v.facts)
    ? eodPlainText(v.facts, v.narrative, {
        staffName: r.staffName,
        version: v.version,
        recipient: v.recipient,
      })
    : null;
}
