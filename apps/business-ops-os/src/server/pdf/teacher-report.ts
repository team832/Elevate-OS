/**
 * Teacher report PDF (owner brief 22 Oct 2026): A4 via the shared toolkit, rendered only from the
 * stored snapshot. Counts print as horizontal bars with the value beside; a count Academic did
 * not report prints in words (never 0). Two pages for a typical teacher.
 */
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import type { TeacherReportSnapshot } from '../teacher-report';
import { createPdf, type PdfBuilder } from './document';

const list = (pdf: PdfBuilder, title: string, items: readonly string[]) => {
  pdf.heading(title);
  for (const item of items) pdf.paragraph(`• ${item}`);
};

export async function teacherReportPdf(
  s: TeacherReportSnapshot,
  meta: { referenceCode: string; templateVersion: string; createdAt?: Date },
) {
  const pdf = await createPdf({
    title: 'Teacher report (internal)',
    reference: meta.referenceCode,
    templateVersion: `Template ${meta.templateVersion}`,
    generatedAt: meta.createdAt,
  });
  if (s.teacher.isSample) pdf.banner('Sample data — fictional teacher', 'neutral');
  pdf.keyValues([
    ['Teacher', s.teacher.name],
    ['Staff reference', s.teacher.staffCode ?? 'Not assigned'],
    ['Subjects', s.teacher.subjects.join(', ') || 'None recorded'],
    ['Name verification', s.teacher.verification],
    ['Other role', s.teacher.roleNote ?? 'None recorded'],
    ['Period', `${fmtDate(s.period.from)} to ${fmtDate(s.period.to)}`],
  ]);

  const a = s.academic;
  const unavailable = (at: string) =>
    pdf.paragraph(`Academic OS unavailable at ${fmtDateTime(at)}; delivery figures not available.`);
  pdf.heading('Current assignments (Academic OS)');
  if (a.status === 'unavailable') unavailable(a.checkedAt);
  else if (!a.assignments.length) pdf.paragraph('No assignment in Academic OS.');
  else
    pdf.table(
      [
        { header: 'Batch', width: 0.3 },
        { header: 'Subject', width: 0.3 },
        { header: 'Role', width: 0.2 },
        { header: 'Since', width: 0.2 },
      ],
      a.assignments.map((x) => [
        x.batchCode,
        x.subjectName,
        humanise(x.role),
        fmtDate(x.startDate),
      ]),
    );

  pdf.heading('Class delivery in the period');
  if (a.status === 'unavailable') unavailable(a.checkedAt);
  else {
    const d = a.delivery;
    pdf.bars(d.classes, { missingText: 'Not reported' });
    pdf.bars([d.deliveredShare], { max: 100, missingText: 'Not computable' });
    pdf.bars(d.pending, { missingText: 'Not reported' });
  }

  pdf.heading('Student reviews written');
  pdf.paragraph(s.reviewsNote, { muted: true });
  if (s.reviews)
    pdf.keyValues([
      ['Submitted in the period', s.reviews.shareable + s.reviews.internal],
      ['Shareable / internal', `${s.reviews.shareable} / ${s.reviews.internal}`],
      ['Latest', fmtDate(s.reviews.latest)],
    ]);

  pdf.heading('Feedback about the teacher (moderated)');
  if (!s.feedback) pdf.paragraph('Not included (no feedback permission).');
  else {
    pdf.paragraph(`Student and guardian feedback dated in the period; ${s.feedback.scope}.`, {
      muted: true,
    });
    pdf.keyValues(
      s.feedback.scope === 'all moderated states'
        ? [
            [
              'Approved / rejected / hidden',
              `${s.feedback.approved} / ${s.feedback.rejected} / ${s.feedback.hidden}`,
            ],
          ]
        : [['Approved', s.feedback.approved]],
    );
  }

  pdf.heading('Tasks and EOD reports (Business Ops)');
  const w = s.work;
  if (w.status === 'not_included') pdf.paragraph(`Not included: ${w.reason}.`);
  else {
    pdf.bars([
      { label: 'Tasks assigned in the period', value: w.assigned },
      { label: 'Completed in the period', value: w.completed },
      { label: 'Open at cut-off', value: w.open },
      { label: 'Overdue at cut-off', value: w.overdue },
    ]);
    pdf.bars(
      [
        {
          label: 'EOD reports submitted',
          value: w.eod.submitted,
          text:
            w.eod.days === null
              ? `${w.eod.submitted} (expected days not known)`
              : `${w.eod.submitted} of ${w.eod.days} days`,
        },
      ],
      { max: w.eod.days ?? w.eod.submitted },
    );
    pdf.paragraph(`Cut-off ${fmtDateTime(w.cutOff)}. HR attendance unavailable (no HR module).`, {
      muted: true,
    });
  }

  list(pdf, 'Where to work on', s.workOn);
  list(pdf, 'What the records show', s.summary);
  if (s.comment) {
    pdf.heading('Overall comment');
    pdf.paragraph(s.comment);
  }
  pdf.heading('How these figures are counted');
  for (const [k, v] of s.definitions) pdf.paragraph(`${k}: ${v}`, { muted: true });
  const bytes = await pdf.finish();
  return { bytes, lines: pdf.lines, unsupportedCharacters: pdf.unsupportedCharacters };
}
