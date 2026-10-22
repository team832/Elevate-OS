/**
 * Student progress report PDF (owner brief §10): A4 via the shared toolkit (branding, page
 * numbers), rendered only from the stored, permission-cut snapshot. Marks print as recorded
 * (raw score / max beside the percentage, "Absent" never 0) with cohort name and number scored.
 */
import { formatPaise } from '../../domain/fees';
import { NEXT_STEP_LABEL } from '../../domain/student-report';
import { fmtDate, fmtDateTime } from '../../ui/format';
import type { ReportSnapshot } from '../student-report';
import { createPdf, type PdfBuilder } from './document';

const AUDIENCE_TITLES = {
  internal: 'Student progress report (internal)',
  admin_dossier: 'Student dossier (administration)',
  guardian: 'Student progress report for parents and guardians',
  student: 'Student progress report',
} as const;

const list = (pdf: PdfBuilder, title: string, items: readonly string[]) => {
  pdf.heading(title);
  for (const item of items) pdf.paragraph(`• ${item}`);
};

export async function progressReportPdf(
  s: ReportSnapshot,
  meta: { referenceCode: string; status: string; templateVersion: string | null },
) {
  const pdf = await createPdf({
    title: AUDIENCE_TITLES[s.audience],
    reference: meta.referenceCode,
    templateVersion: `Template ${meta.templateVersion ?? s.template}`,
  });
  if (meta.status !== 'final')
    pdf.banner(
      `${meta.status === 'draft' ? 'Draft' : 'Reviewed, not final'} — not for sharing until it is final`,
    );
  if (s.student.isSample) pdf.banner('Sample data — fictional student', 'neutral');
  pdf.keyValues([
    ['Student', s.student.name],
    ['Admission number', s.student.admissionNumber ?? 'Not assigned'],
    ['Period', `${fmtDate(s.period.from)} to ${fmtDate(s.period.to)}`],
    ['Report', `${meta.referenceCode} · ${meta.status}`],
  ]);
  const has = (x: (typeof s.sections)[number]) => s.sections.includes(x);

  if (has('programmes') || has('overview')) {
    pdf.heading('Programmes and batches');
    pdf.table(
      [
        { header: 'Programme', width: 0.45 },
        { header: 'Batch', width: 0.3 },
        { header: 'Status', width: 0.25 },
      ],
      s.programmes.map((p) => [p.programme, p.batch, p.status]),
    );
  }

  const a = s.academic;
  if (a && (has('attendance') || has('results'))) {
    if (a.status !== 'available') {
      pdf.heading('Attendance and results');
      pdf.paragraph(
        a.status === 'unavailable'
          ? `Source unavailable (checked ${fmtDateTime(a.checkedAt)}): Academic OS could not be read. Nothing is shown rather than zeros.`
          : 'Not enrolled in Academic OS yet: no attendance or results to show.',
      );
    } else {
      if (has('attendance')) {
        const t = a.attendance;
        pdf.heading('Attendance');
        pdf.keyValues([
          [
            'Classes attended',
            t.ratePercent === null
              ? 'No classes recorded in this period'
              : `${t.attended} of ${t.recorded - t.excused} recorded (${t.ratePercent}%)`,
          ],
          ['Present / late / partial', `${t.present} / ${t.late} / ${t.partial}`],
          ['Absent / excused', `${t.absent} / ${t.excused}`],
          ['Held, not recorded', t.notRecorded],
        ]);
      }
      if (has('results')) {
        pdf.heading('Marks');
        if (!a.results.length) pdf.paragraph('No assessment results in this period.');
        else
          pdf.table(
            [
              { header: 'Date', width: 0.14 },
              { header: 'Assessment', width: 0.22 },
              { header: 'Subject', width: 0.14 },
              { header: 'Score', width: 0.16, align: 'right' },
              { header: 'Compared with (same assessment)', width: 0.34 },
            ],
            a.results.map((r) => [
              fmtDate(r.heldOn),
              `${r.code}${r.rescored ? ` (re-scored v${r.resultVersion})` : ''}`,
              r.subject,
              r.score === null ? 'Absent' : `${r.score} / ${r.maxScore} (${r.percent}%)`,
              r.comparison,
            ]),
          );
        list(
          pdf,
          'Trend (scored results of the same subject and exam type, as percentages)',
          a.trends.length
            ? a.trends.map((t) => `${t.label}: ${t.text}`)
            : ['Insufficient data: no results.'],
        );
      }
      const teachers = a.enrolments.flatMap((e) => e.teachers);
      if (teachers.length) {
        pdf.heading('Teachers in the period');
        pdf.table(
          [
            { header: 'Subject', width: 0.4 },
            { header: 'Teacher', width: 0.6 },
          ],
          teachers.map((t) => [t.subject, t.name]),
        );
      }
    }
  }

  if (s.summary) {
    list(pdf, 'What the records show', s.summary.evidence);
    list(pdf, 'Strengths', s.summary.strengths);
    list(pdf, 'Areas for improvement', s.summary.areas);
    list(pdf, `${NEXT_STEP_LABEL}`, s.summary.nextSteps);
  }

  if (s.feedback) {
    pdf.heading('Teacher reviews (internal — never shared with families)');
    if (s.reviewsSource?.status === 'unavailable')
      pdf.paragraph(
        `Source unavailable — Academic OS could not be reached (checked ${s.reviewsSource.checkedAt}).`,
      );
    else if (!s.feedback.length) pdf.paragraph('No submitted reviews in this period.');
    for (const f of s.feedback) {
      pdf.keyValues([
        ['Teacher / subject', `${f.teacher} · ${f.subject} · ${f.observedOn} · v${f.version}`],
        ['Internal remarks', f.observations],
        ['Strengths', f.strengths],
        ['Areas needing support', f.areasToImprove],
        ['Suggested next step', f.actionPlan],
      ]);
    }
  }

  if (s.history) {
    pdf.heading('Status changes in the period');
    pdf.table(
      [
        { header: 'When', width: 0.3 },
        { header: 'Status', width: 0.3 },
        { header: 'Reason', width: 0.4 },
      ],
      s.history.changes.map((h) => [fmtDateTime(h.at), h.status, h.reason]),
    );
    if (s.history.exits.length) {
      pdf.heading('Exit records');
      pdf.table(
        [
          { header: 'Exit', width: 0.3 },
          { header: 'Date', width: 0.3 },
          { header: 'Reason', width: 0.4 },
        ],
        s.history.exits.map((x) => [x.status, fmtDate(x.date), x.reason]),
      );
    }
  }
  if (s.guardians) {
    pdf.heading('Guardians');
    pdf.table(
      [
        { header: 'Name', width: 0.5 },
        { header: 'Relationship', width: 0.25 },
        { header: 'Consent', width: 0.25 },
      ],
      s.guardians.map((g) => [g.name, g.relationship, g.consent]),
    );
  }
  if (s.fees) {
    pdf.heading('Fee statement');
    pdf.keyValues([
      ['Amount due', formatPaise(s.fees.duePaise)],
      ['Received (net)', formatPaise(s.fees.netReceivedPaise)],
      ['Balance', `${formatPaise(s.fees.balancePaise)} (${s.fees.balance})`],
    ]);
    pdf.paragraph(s.fees.disclaimer, { muted: true });
  }

  pdf.heading('Review');
  pdf.signatures([{ label: 'Teacher / counsellor' }, { label: 'Reviewed by' }]);
  if (s.acknowledgement) {
    pdf.heading('Acknowledgement');
    pdf.paragraph('I have read this report.', { muted: true });
    pdf.signatures([{ label: s.audience === 'student' ? 'Student' : 'Parent / guardian' }]);
  }
  const bytes = await pdf.finish();
  return { bytes, lines: pdf.lines, unsupportedCharacters: pdf.unsupportedCharacters };
}
