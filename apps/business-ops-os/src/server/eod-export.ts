/**
 * Work-report wording shared by the screens, the PDF and the CSV (owner brief 2 §11–12; brief
 * 23 Oct 2026 §13–14): fact sections, figures with their definitions, and the plain-text summary
 * behind "Copy summary". Same read rules as the screen; every download is audited. Nothing is
 * sent anywhere: no external provider is configured.
 */
import { toCsv } from '@elevate/server-kit';
import type { Database } from '@elevate/database';
import type { AttendanceSummary } from '../domain/attendance';
import { eodPlainText, fmtMinutes, isEodFacts, type EodFacts } from '../domain/eod';
import { deadlineText, TASK_STATUS_LABELS } from '../domain/staff-tasks';
import {
  METRIC_DEFINITIONS,
  NARRATIVE_FIELDS,
  REPORT_STATUS_LABELS,
  type Outcome,
} from '../domain/work-report';
import { fmtDate, fmtDateTime } from '../ui/format';
import { notFound, type Actor } from './context';
import { audit, getReport, type EodReportView } from './eod-reports';
import { createPdf } from './pdf/document';

export const EOD_STATUS_LABELS = REPORT_STATUS_LABELS;
const OUTCOMES: Record<Outcome, string> = {
  on_time: 'On time',
  late: 'Late',
  not_submitted: 'Not submitted',
};

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

const when = (iso: string, f: EodFacts) =>
  f.reportDate === (f.periodEnd ?? f.reportDate)
    ? fmtDateTime(iso).replace(/^\d+ \w+ \d+, /, '')
    : fmtDateTime(iso);
const metric = (v: number | null | undefined) =>
  v === null || v === undefined ? 'Not recorded' : String(v);

export interface FactRow {
  taskId: string;
  /** Task, when / status, detail. */
  cells: [string, string, string];
}
/** The fact sections, shared by the screen, the PDF and the CSV. */
export function factSections(f: EodFacts): { title: string; rows: FactRow[] }[] {
  const row = (taskId: string, ...cells: FactRow['cells']): FactRow => ({ taskId, cells });
  const events = (items: EodFacts['received']) =>
    items.map((i) => row(i.taskId, i.title, when(i.at, f), i.detail ?? ''));
  const t = f.timeliness;
  return [
    { title: 'Tasks received or assigned', rows: events(f.received) },
    { title: 'Acknowledged', rows: events(f.acknowledged) },
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
    ...(f.submitted ? [{ title: 'Submitted for review', rows: events(f.submitted) }] : []),
    { title: 'Approved or done', rows: events(f.completed) },
    { title: 'Blocked or blockers', rows: events(f.blocked) },
    { title: 'Decisions or help requested', rows: events(f.decisions) },
    {
      title: 'Open at cut-off',
      rows: f.backlog.map((b) =>
        row(
          b.taskId,
          b.title,
          `${TASK_STATUS_LABELS[b.status] ?? b.status}${b.blocked ? ', blocked' : ''}${b.overdue ? ' (overdue)' : ''}${b.closedLater ? ', closed later' : ''}`,
          [`Due ${fmtDate(b.dueOn)}${b.dueTime ? ` ${b.dueTime.slice(0, 5)}` : ''}`, b.reason]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    },
    ...(t
      ? [
          {
            title: 'Due in the period',
            rows: t.rows.map((x) =>
              row(
                x.taskId,
                x.title,
                OUTCOMES[x.outcome],
                `Deadline ${deadlineText(x.dueOn, x.dueTime)}${x.submittedAt ? ` · first submitted ${fmtDateTime(x.submittedAt)}` : ''}${x.delivered ? ' · approved or done' : ''}`,
              ),
            ),
          },
          {
            title: 'Left out of the on-time rate',
            rows: t.excluded.map((x) => row(x.taskId, x.title, x.why, '')),
          },
          {
            title: 'Deadline changes',
            rows: t.revisions.map((x) =>
              row(x.taskId, x.title, `${x.from} → ${x.to}`, x.reason ?? 'No reason recorded'),
            ),
          },
        ]
      : []),
  ];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Headline figures with their definitions (brief §14); missing is never 0. */
export function periodFigures(f: EodFacts): { label: string; value: string; definition: string }[] {
  const t = f.timeliness;
  const r = f.turnaround;
  if (!t || !r) return [];
  return [
    {
      label: 'Planned vs delivered',
      value: t.eligible ? `${t.delivered} of ${t.eligible} delivered` : 'Nothing was due',
      definition: METRIC_DEFINITIONS.planned,
    },
    {
      label: 'Submitted',
      value: metric(f.counts.submitted),
      definition: METRIC_DEFINITIONS.submitted,
    },
    {
      label: 'Approved or done',
      value: String(f.counts.completed),
      definition: METRIC_DEFINITIONS.approved,
    },
    {
      label: 'On-time submission rate',
      value:
        t.rate === null
          ? 'Nothing was due'
          : `${pct(t.rate)}: ${t.onTime} of ${t.eligible} on time, ${t.late} late, ${t.notSubmitted} not submitted`,
      definition: METRIC_DEFINITIONS.onTime,
    },
    {
      label: 'Open at cut-off',
      value: `${f.counts.backlog} (${f.counts.overdue} overdue)`,
      definition: METRIC_DEFINITIONS.outstanding,
    },
    {
      label: 'Reviewer turnaround',
      value:
        r.medianHours === null
          ? r.waiting
            ? `${r.waiting} waiting for a decision`
            : 'No submissions in the period'
          : `Median ${r.medianHours} h over ${r.decided} decision${r.decided === 1 ? '' : 's'}; ${r.waiting} waiting`,
      definition: METRIC_DEFINITIONS.turnaround,
    },
  ];
}

/** One day's HR attendance in words; unmarked is "Not recorded", never absent. */
const dayAttendance = (a: AttendanceSummary) =>
  a.present
    ? 'Present'
    : a.halfDays
      ? 'Half day'
      : a.leave
        ? 'On leave'
        : a.holidays
          ? 'Holiday'
          : a.confirmedAbsences
            ? 'Absent (confirmed by HR)'
            : a.unmarked
              ? 'Not recorded'
              : a.noSchedule
                ? 'No work schedule known'
                : 'Weekly off';

/** Academic, marketing, attendance and development context (sources named; never invented). */
export function contextRows(f: EodFacts): [string, string][] {
  const a = f.academic;
  const extra =
    a.status === 'available' && 'assessmentsPrepared' in a
      ? ` · assessments prepared ${metric(a.assessmentsPrepared)} · assessments marked ${metric(a.assessmentsMarked)}`
      : '';
  const topics =
    a.status === 'available' && a.topicsCovered
      ? a.topicsCovered.length
        ? a.topicsCovered
            .map((t) => `${t.batchCode} ${t.subjectName}: ${t.chapterTitle} (${t.classes})`)
            .join('; ')
        : 'None recorded'
      : null;
  const att = f.attendance;
  const period = (f.periodKind ?? 'day') !== 'day';
  return [
    ['Recorded time', `${fmtMinutes(f.duration.minutes)}. ${f.duration.definition}`],
    [
      'Academic work',
      a.status === 'available'
        ? `${metric(a.delivered)} of ${metric(a.planned)} scheduled classes delivered · ${metric(a.cancelled)} cancelled · ${metric(a.substituted)} substituted · teaching logs pending ${metric(a.logsPending)} · marking pending ${metric(a.markingPending)} · reviews submitted ${metric(a.reviewsSubmitted)}${extra} (Academic OS, checked ${fmtDateTime(a.checkedAt)})`
        : `Source unavailable: Academic OS (${a.reason})`,
    ],
    ...(topics !== null
      ? ([['Topics covered (from teaching logs)', topics]] as [string, string][])
      : []),
    ...(period
      ? ([
          [
            'Marketing work',
            'Approved marketing deliverables are listed under "Approved or done". Campaign results are not part of this report: only verified results count, and none are linked to work reports. Anything in the employee’s own words is self-reported.',
          ],
        ] as [string, string][])
      : []),
    ...(att
      ? ([
          [
            'Attendance',
            att.status !== 'available'
              ? `Source unavailable: ${att.reason}.`
              : period
                ? `${att.scheduledWorkdays === null ? 'No work schedule' : `${att.scheduledWorkdays} scheduled workdays`} · ${att.present} present · ${att.halfDays} half days · ${att.leave} on leave · ${att.holidays} holidays · ${att.confirmedAbsences} confirmed absences · ${att.unmarked} not marked${att.noSchedule ? ` · ${att.noSchedule} with no work schedule` : ''}. ${METRIC_DEFINITIONS.attendance}`
                : `${dayAttendance(att)} (HR attendance; separate from classes delivered and task time).`,
          ],
        ] as [string, string][])
      : []),
    ...(f.development !== undefined
      ? ([
          [
            'Development actions',
            f.development?.length
              ? f.development
                  .map(
                    (d) => `${d.action} (${d.status}${d.dueOn ? `, due ${fmtDate(d.dueOn)}` : ''})`,
                  )
                  .join('; ')
              : 'None recorded',
          ],
        ] as [string, string][])
      : []),
    ['Facts as of', fmtDateTime(f.asOf)],
  ];
}

async function exported(
  db: Database,
  actor: Actor,
  r: EodReportView,
  format: string,
  version: number | null,
) {
  await audit(db, actor, r.id, 'eod_report.exported', { metadata: { format, version } });
}

const fileName = (r: EodReportView, version: number | null, ext: string) =>
  `${r.period.kind === 'day' ? 'eod' : r.period.kind === 'week' ? 'weekly' : 'monthly'}-report-${r.period.start}-${version ? `v${version}` : 'draft'}-${r.id.slice(0, 8)}.${ext}`;

/** The report (a version, or the draft) as an A4 PDF. */
export async function eodReportPdf(db: Database, actor: Actor, id: string, n?: number) {
  const r = await getReport(db, actor, id);
  const v = pick(r, n);
  const f = v.facts;
  const pdf = await createPdf({
    title: r.kindLabel,
    reference: `${r.staffName} · ${r.periodLabel}${v.version ? ` · v${v.version}` : ''}`,
    templateVersion: 'work-report v3',
  });
  if (!v.version) pdf.banner('Draft — not submitted');
  if (r.isSample) pdf.banner('Sample data — fictional staff', 'neutral');
  pdf.keyValues([
    ['Staff member', r.staffName],
    ['Department', r.department ?? 'Not set'],
    ['Reporting manager', r.managerName ?? 'Not set'],
    ['Period', `${r.periodLabel} (IST)`],
    ['Version', v.version ? `${v.version} of ${r.versions.length}` : 'Draft'],
    ['Status', EOD_STATUS_LABELS[r.status]],
    ['Submitted', v.submittedAt ? fmtDateTime(v.submittedAt) : null],
    ['Sent to', v.recipient],
    [
      'Sources',
      isEodFacts(f)
        ? 'Task events and work updates in Business Ops; Academic OS; HR attendance (monthly)'
        : r.imported
          ? 'Imported from the old task tracker; not sent through Elevate OS'
          : 'Task status at submission (earlier report format)',
    ],
  ]);
  for (const field of NARRATIVE_FIELDS[r.period.kind]) {
    const text = v.narrative[field.key];
    pdf.heading(`${field.label} (written by the employee)`);
    pdf.paragraph(text ?? 'Not written.', { muted: !text });
  }
  if (isEodFacts(f)) {
    if (f.noActivity) pdf.banner('No task activity recorded in this period.', 'neutral');
    const figures = periodFigures(f);
    if (figures.length) {
      pdf.heading('Figures');
      pdf.keyValues(figures.map((x) => [x.label, x.value]));
    }
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
          s.rows.map((x) => x.cells),
        );
      else pdf.paragraph('None recorded.', { muted: true });
    }
    pdf.heading('Context');
    pdf.keyValues(contextRows(f));
    if (figures.length) {
      pdf.heading('How the figures are counted');
      pdf.keyValues(figures.map((x) => [x.label, x.definition]));
    }
  }
  await exported(db, actor, r, 'pdf', v.version);
  return { bytes: await pdf.finish(), filename: fileName(r, v.version, 'pdf') };
}

/** The report's facts as CSV rows (section, task, when/status, detail). */
export async function eodReportCsv(db: Database, actor: Actor, id: string, n?: number) {
  const r = await getReport(db, actor, id);
  const v = pick(r, n);
  if (!isEodFacts(v.facts)) notFound('Report facts in the current format');
  await exported(db, actor, r, 'csv', v.version);
  const f = v.facts;
  return {
    csv: toCsv(
      ['Section', 'Task', 'When / status', 'Detail'],
      [
        [r.kindLabel, r.staffName, r.periodLabel, v.version ? `Version ${v.version}` : 'Draft'],
        ['Department', r.department ?? 'Not set', 'Manager', r.managerName ?? 'Not set'],
        ...periodFigures(f).map((x) => ['Figure', x.label, x.value, x.definition]),
        ...factSections(f).flatMap((s) => s.rows.map((x) => [s.title, ...x.cells])),
        ...contextRows(f).map(([label, text]) => [label, '', '', text]),
      ],
    ),
    filename: fileName(r, v.version, 'csv'),
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
        period: r.periodLabel,
      })
    : null;
}
