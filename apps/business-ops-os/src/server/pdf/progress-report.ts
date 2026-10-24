/**
 * Student report PDF (owner brief §10; two kinds, D-078): A4 via the shared toolkit, rendered only
 * from the stored, permission-cut snapshot. Marks print as bars (percent of maximum, raw score
 * beside; "Absent" never 0) with the cohort comparison in words; attendance is the contract's
 * rate. Internal kind: KYC (only when the snapshot holds it), every review field, neutral
 * summary. PTM kind: as little as possible — overview, bars, one attendance sentence, the
 * shareable strengths / where to work on / next steps, affirmative summary.
 * `progress-report/1` snapshots keep their table layout.
 */
import { DOCUMENT_STATE_LABELS } from '../../domain/admission-form';
import { formatPaise } from '../../domain/fees';
import {
  attendanceRateText,
  REPORT_HEADINGS,
  REPORT_KIND_LABELS,
  type ReportTone,
} from '../../domain/student-report';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import type { ReportSnapshot } from '../student-report';
import { createPdf, type PdfBuilder } from './document';

type Feedback = NonNullable<ReportSnapshot['feedback']>[number] & {
  /** progress-report/1 stored the three internal fields joined in one line. */
  observations?: string | null;
};
type Results = Extract<ReportSnapshot['academic'], { status: 'available' }>['results'];

const list = (pdf: PdfBuilder, title: string, items: readonly string[]) => {
  pdf.heading(title);
  for (const item of items) pdf.paragraph(`• ${item}`);
};

const barsOf = (pdf: PdfBuilder, rows: Results) =>
  pdf.bars(
    rows.map((r) => ({
      label: `${r.code} · ${r.subject ?? 'Subject not recorded'}`,
      value: r.percent,
      text: `${r.percent}% (${r.score}/${r.maxScore})`,
      note:
        r.score === null
          ? `${fmtDate(r.heldOn)} · Absent — not counted as zero`
          : `${fmtDate(r.heldOn)} · ${r.comparison}${r.rescored ? ` · re-scored v${r.resultVersion}` : ''}`,
    })),
    { max: 100, missingText: 'Absent' },
  );

/** One bars block, or one per exam type when there are more than 8 assessments. */
function marks(pdf: PdfBuilder, results: Results) {
  if (results.length <= 8) {
    pdf.heading('Marks');
    barsOf(pdf, results);
    return;
  }
  for (const type of new Set(results.map((r) => r.examType))) {
    pdf.heading(`Marks — ${humanise(type)}`);
    barsOf(
      pdf,
      results.filter((r) => r.examType === type),
    );
  }
}

function kyc(pdf: PdfBuilder, k: NonNullable<ReportSnapshot['kyc']>) {
  pdf.heading('KYC and student details (private — internal use only)');
  pdf.keyValues([
    ['Date of birth', k.dateOfBirth ? `${fmtDate(k.dateOfBirth)} (age ${k.age})` : null],
    ['Class / board', [k.class && humanise(k.class), k.board].filter(Boolean).join(' · ') || null],
    ['School', k.school],
    ['City', k.city],
  ]);
  if (!k.guardians.length) pdf.paragraph('No guardians recorded.');
  else
    pdf.table(
      [
        { header: 'Guardian', width: 0.28 },
        { header: 'Relationship', width: 0.16 },
        { header: 'Phone', width: 0.18 },
        { header: 'Email', width: 0.24 },
        { header: 'Consent', width: 0.14 },
      ],
      k.guardians.map((g) => [
        g.name,
        humanise(g.relationship),
        g.phone,
        g.email,
        humanise(g.consent),
      ]),
    );
  pdf.table(
    [
      { header: 'Document', width: 0.6 },
      { header: 'State', width: 0.4 },
    ],
    k.documents.map((d) => [d.label, DOCUMENT_STATE_LABELS[d.state]]),
  );
}

export async function progressReportPdf(
  s: ReportSnapshot,
  meta: { referenceCode: string; status: string; templateVersion: string | null },
) {
  const legacy = s.template === 'progress-report/1';
  const tone: ReportTone = legacy ? 'neutral' : s.tone;
  const ptm = tone === 'affirmative';
  const h = REPORT_HEADINGS[tone];
  const has = (x: (typeof s.sections)[number]) => s.sections.includes(x);
  const pdf = await createPdf({
    title: REPORT_KIND_LABELS[s.audience],
    reference: meta.referenceCode,
    templateVersion: `Template ${meta.templateVersion ?? s.template}`,
  });
  if (meta.status !== 'final')
    pdf.banner(
      `${meta.status === 'draft' ? 'Draft' : 'Reviewed, not final'} — not for sharing until it is final`,
    );
  if (s.student.isSample) pdf.banner('Sample data — fictional student', 'neutral');
  const period = `${fmtDate(s.period.from)} to ${fmtDate(s.period.to)}`;
  if (ptm)
    pdf.keyValues([
      ['Student', s.student.name],
      [
        'Programme',
        s.programmes.map((p) => `${p.programme} · ${p.batch}`).join('; ') || 'Not recorded',
      ],
      ['Period', period],
      ['Counsellor', s.student.counsellor ?? 'Not assigned'],
    ]);
  else {
    pdf.keyValues([
      ['Student', s.student.name],
      ['Admission number', s.student.admissionNumber ?? 'Not assigned'],
      ['Period', period],
      ['Report', `${meta.referenceCode} · ${meta.status}`],
      ...(s.audience === 'internal' && !has('kyc')
        ? [['KYC', 'Not included — the author may not read private details'] as [string, string]]
        : []),
    ]);
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
  }
  if (s.kyc) kyc(pdf, s.kyc);

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
      if (has('results')) {
        if (!a.results.length) {
          pdf.heading('Marks');
          pdf.paragraph('No assessment results in this period.');
        } else if (legacy) {
          pdf.heading('Marks');
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
        } else marks(pdf, a.results);
        // The PTM summary already carries the trend sentences.
        if (!ptm)
          list(
            pdf,
            'Trend (scored results of the same subject and exam type, as percentages)',
            a.trends.length
              ? a.trends.map((t) => `${t.label}: ${t.text}`)
              : ['Insufficient data: no results.'],
          );
      }
      if (has('attendance')) {
        const t = a.attendance;
        pdf.heading('Attendance');
        const counts: [string, string | number][] = [
          ['Present / late / partial', `${t.present} / ${t.late} / ${t.partial}`],
          ['Absent / excused', `${t.absent} / ${t.excused}`],
          ['Held, not recorded', t.notRecorded],
        ];
        if (ptm)
          pdf.paragraph(
            t.recorded
              ? `Attended ${t.attended} of ${t.recorded} recorded classes; attendance rate ${attendanceRateText(t)}.`
              : 'No classes recorded in this period.',
          );
        else if (legacy) pdf.keyValues([['Attendance rate', attendanceRateText(t)], ...counts]);
        else {
          pdf.bars(
            [
              {
                label: 'Attendance rate',
                value: t.ratePercent,
                text: `${t.ratePercent}%`,
                note: t.definition ?? undefined,
              },
            ],
            { max: 100 },
          );
          pdf.keyValues(counts);
        }
      }
      const teachers = a.enrolments.flatMap((e) => e.teachers);
      if (teachers.length && !ptm) {
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

  if (s.feedback) {
    pdf.heading(
      ptm ? 'Teachers’ reviews' : 'Teacher reviews (internal — never shared with families)',
    );
    if (s.reviewsSource?.status === 'unavailable')
      pdf.paragraph(
        `Source unavailable — Academic OS could not be reached (checked ${s.reviewsSource.checkedAt}).`,
      );
    else if (!s.feedback.length) pdf.paragraph('No submitted reviews in this period.');
    for (const f of s.feedback as Feedback[]) {
      const who = ptm
        ? `${f.teacher} · ${f.subject}`
        : legacy
          ? `${f.teacher} · ${f.subject} · ${f.observedOn} · v${f.version}`
          : `${f.teacher} · ${f.subject} · ${fmtDate(f.observedOn)} · ${humanise(f.type)} · v${f.version} · ${f.visibility}`;
      const internal: [string, string | null | undefined][] = legacy
        ? [['Internal remarks', f.observations]]
        : [
            ['Attendance and engagement', f.attendanceEvidence],
            ['Homework and practice', f.homeworkEvidence],
            ['Academic concerns', f.academicConcerns],
          ];
      pdf.keyValues([
        ['Teacher / subject', who],
        ...(ptm ? [] : internal),
        [h.strengths, f.strengths],
        [h.reviewAreas, f.areasToImprove],
        [h.reviewNext, f.actionPlan],
      ]);
    }
  }

  if (s.summary) {
    list(pdf, 'What the records show', s.summary.evidence);
    list(pdf, h.strengths, s.summary.strengths);
    list(pdf, h.areas, s.summary.areas);
    list(pdf, h.nextSteps, s.summary.nextSteps);
  }
  if (s.comment) {
    pdf.heading('Overall comment');
    pdf.paragraph(s.comment);
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
