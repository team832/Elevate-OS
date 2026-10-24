/**
 * AI help on reports and the student page (owner request 24 Oct 2026, D-111), built on ask() in
 * ./ai-drafts: the AI gets the facts a report already uses, redacted (no names, contacts,
 * admission numbers or codes), and missing data goes out as "not available", never 0. The
 * progress and teacher report drafts fill the "Overall comment" a person edits and saves when
 * generating the report (the PDF prints the saved text); the student summary is shown, never
 * saved. Teachers' review text is untrusted: it goes inside <data> and is redacted as feedback.
 */
import { can } from '@elevate/authorization';
import { OPS_REPORT_AUDIENCES, type Database } from '@elevate/database';
import { isoDateSchema, ValidationError } from '@elevate/shared-contracts';
import { z } from 'zod';
import { redact, type DraftItem } from '../domain/ai-assist';
import { INSTALMENT_STATUS_LABELS } from '../domain/fee-plans';
import { formatPaise } from '../domain/fees';
import { attendanceRateText, REPORT_KIND_LABELS, toneOf } from '../domain/student-report';
import { fmtDate, fmtDateTime, humanise } from '../ui/format';
import { reviewDate, studentReviews } from './academic-reviews';
import { academicEvidence } from './academic-summary';
import { ask, data, knownNames, obj, SAFETY, str, text } from './ai-drafts';
import { accessScope, assertScope, type Actor } from './context';
import { studentFeePlans } from './fee-agreements';
import { buildSnapshot } from './student-report-snapshot';
import { getStudent } from './students';
import { snapshotFor, buildSnapshot as teacherSnapshot } from './teacher-report';

const period = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((b) => b.from <= b.to, { error: 'The start must be on or before the end', path: ['to'] });
export const studentReportDraftBody = z
  .object({ studentId: z.uuid(), audience: z.enum(OPS_REPORT_AUDIENCES) })
  .and(period);
export const teacherReportDraftBody = z.object({ staffId: z.uuid() }).and(period);

const RULES =
  'Use only the facts given: never invent marks, percentages, amounts, counts, dates, ranks or remarks. When a fact says "not available", "not recorded", "not included" or "source unavailable", say so plainly and never treat it as zero. Never name or guess anyone.';
const bullets = (lines: readonly string[]) => lines.map((l) => `- ${l}`).join('\n');
const periodText = (p: { from: string; to: string }) => `${fmtDate(p.from)} to ${fmtDate(p.to)}`;
const one = (name: string, label: string) => ({
  schema: obj({ [name]: str }),
  out: z.object({ [name]: text(2000) }),
  items: (o: Record<string, string>): DraftItem[] => [{ name, label, value: o[name]! }],
});
const COMMENT = one('comment', 'Overall comment');

/** Overall comment of a student progress report, from the summary its snapshot would hold. */
export async function draftStudentReportComment(
  db: Database,
  actor: Actor,
  input: z.output<typeof studentReportDraftBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:student_reports:generate');
  const profile = await getStudent(db, actor, input.studentId);
  if (!profile.identity)
    throw new ValidationError(
      'This student has no canonical record yet, so no report can be made.',
    );
  const { snapshot } = await buildSnapshot(
    db,
    actor,
    profile,
    { ...input, acknowledgement: false },
    ['summary'],
  );
  const s = snapshot.summary!;
  const names = await knownNames(db);
  const notes = [
    ['Strengths', s.strengths],
    ['To work on', s.areas],
    ['Next steps', s.nextSteps],
  ] as const;
  const out = await ask(
    db,
    actor,
    'reportDraft',
    {
      name: 'progress_report_comment',
      instructions: `Draft the "Overall comment" of a coaching institute's ${REPORT_KIND_LABELS[input.audience]} about one student: one paragraph of 3 to 5 plain sentences. ${toneOf(input.audience) === 'affirmative' ? 'The family reads it: lead with the measured positives and describe gaps as things to work on, warmly but without hiding them.' : 'Staff read it: keep it neutral and plain.'} Call the person "the student". ${RULES} ${SAFETY}`,
      input: `Period: ${periodText(input)}\nWhat the records show:\n${redact(bullets(s.evidence), names, 'facts')}\n\nFrom the teachers' shareable notes:\n${data(notes.map(([t, l]) => `${t}:\n${redact(bullets(l), names)}`).join('\n'))}`,
      schema: COMMENT.schema,
    },
    COMMENT.out,
    requestId,
  );
  return COMMENT.items(out);
}

/** Overall comment of a teacher report, from the snapshot it would store (as this reader sees it). */
export async function draftTeacherReportComment(
  db: Database,
  actor: Actor,
  { staffId, ...p }: z.output<typeof teacherReportDraftBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:teacher_reports:generate');
  assertScope(access, [staffId], 'teacher reports');
  const { snapshot } = await teacherSnapshot(db, actor, staffId, p);
  const s = await snapshotFor(db, actor, staffId, snapshot);
  const f = s.feedback;
  const facts = [
    `Period: ${periodText(p)}`,
    `Subjects: ${s.teacher.subjects.join(', ') || 'none recorded'}`,
    `What the records show:\n${bullets(s.summary)}`,
    `Where to work on:\n${bullets(s.workOn)}`,
    f
      ? `Moderated student and guardian feedback in the period: ${f.approved} approved${f.scope === 'all moderated states' ? `, ${f.rejected} rejected, ${f.hidden} hidden` : ''}.`
      : 'Feedback about the teacher: not included.',
  ].join('\n');
  const out = await ask(
    db,
    actor,
    'reportDraft',
    {
      name: 'teacher_report_comment',
      instructions: `Draft the "Overall comment" of an internal teacher report for a business-operations meeting at a coaching institute: one paragraph of 3 to 5 plain, neutral sentences on class delivery, pending work, reviews written, feedback counts and tasks. Judge nothing the counts do not show. Call the person "the teacher". ${RULES} ${SAFETY}`,
      input: data(redact(facts, await knownNames(db), 'facts')),
      schema: COMMENT.schema,
    },
    COMMENT.out,
    requestId,
  );
  return COMMENT.items(out);
}

const SUMMARY = one('summary', 'Summary');

/**
 * One-paragraph picture of a student from linked records the reader may already see: admission
 * status and programmes, fee agreements (ops:fees:read), Academic attendance and recent results,
 * shareable teacher reviews (ops:feedback:read). Each source the reader cannot see or that could
 * not be read says so. Never saved.
 */
export async function summariseStudent(
  db: Database,
  actor: Actor,
  studentId: string,
  requestId?: string,
) {
  const d = await getStudent(db, actor, studentId);
  const id = d.identity?.id;
  const [academic, fees, reviews, names] = await Promise.all([
    academicEvidence(db, d.academic.studentId),
    id && can(actor, 'ops:fees:read') ? studentFeePlans(db, actor, id) : null,
    id && can(actor, 'ops:feedback:read') ? studentReviews(db, actor, id) : null,
    knownNames(db),
  ]);
  const a = d.admission;
  const facts = [
    `Admission status: ${a.statusLabel} (${a.stateLabel}); admission date ${a.admissionDate ? fmtDate(a.admissionDate) : 'not recorded'}.`,
    `Programmes: ${d.cases.map((c) => `${c.programme?.name ?? 'Programme not recorded'} (${c.statusLabel})`).join('; ')}.`,
    `Open follow-ups: ${d.followUps.length}.`,
    ...(!fees
      ? [`Fees: not included (${id ? 'no fee permission' : 'no student record yet'}).`]
      : !fees.plans.length
        ? ['Fees: no fee agreement recorded.']
        : fees.plans.map(({ plan, totals, instalments, status, nextDue }) => {
            const n = (s: string) => instalments.filter((i) => i.status === s);
            const overdue = n('overdue');
            return `Fee agreement (${plan.status}): ${INSTALMENT_STATUS_LABELS[status]}; tuition ${formatPaise(totals.totalPaise)}, paid (net, as recorded) ${formatPaise(totals.netPaidPaise)}, outstanding ${formatPaise(totals.outstandingPaise)}; instalments: ${n('paid').length} paid, ${n('unpaid').length + n('part_paid').length} due, ${overdue.length} overdue${overdue.length ? ` (${formatPaise(overdue.reduce((t, i) => t + i.remainingPaise, 0))} overdue)` : ''}; next due ${nextDue ? `${fmtDate(nextDue.instalment.dueDate)}, ${formatPaise(nextDue.remainingPaise)}` : 'none'}.`;
          })),
    ...(academic.status === 'not_enrolled'
      ? ['Academic OS: not enrolled yet; attendance and results not available.']
      : academic.status === 'unavailable'
        ? [
            `Academic OS: source unavailable (checked ${fmtDateTime(academic.checkedAt)}); attendance and results not available.`,
          ]
        : [
            academic.attendance.recorded
              ? `Attendance rate: ${attendanceRateText(academic.attendance)}; ${academic.attendance.attended} of ${academic.attendance.recorded} recorded classes attended.`
              : 'Attendance: no classes recorded.',
            `Recent results:\n${
              bullets(
                [...academic.results]
                  .sort((x, y) => (y.heldOn ?? '').localeCompare(x.heldOn ?? ''))
                  .slice(0, 5)
                  .map(
                    (r) =>
                      `${r.subject ?? 'Subject not recorded'} ${humanise(r.examType)} on ${r.heldOn ? fmtDate(r.heldOn) : 'date not recorded'}: ${r.score === null ? 'absent (not counted as zero)' : `${r.score} of ${r.maxScore} (${r.percent}%)`}`,
                  ),
              ) || 'none recorded'
            }`,
            ...academic.trends.map((t) => `Trend, ${t.label}: ${t.text}.`),
          ]),
  ].join('\n');
  const shareable =
    reviews?.status === 'available'
      ? reviews.reviews
          .filter((r) => r.visibility === 'shareable' && !r.superseded)
          .sort((x, y) => reviewDate(y).localeCompare(reviewDate(x)))
          .slice(0, 3)
      : [];
  const reviewText = !reviews
    ? 'Teacher reviews: not included (no feedback permission or no student record).'
    : reviews.status === 'unavailable'
      ? 'Teacher reviews: source unavailable (Academic OS).'
      : `Latest shareable teacher reviews:\n${data(
          redact(
            bullets(
              shareable.map(
                (r) =>
                  `${r.subjectName ?? 'Subject not recorded'}: strengths: ${r.strengths ?? 'none recorded'}; to work on: ${r.areasForSupport ?? 'none recorded'}; next step: ${r.suggestedAction ?? 'none recorded'}`,
              ),
            ) || 'None.',
            names,
          ),
        )}`;
  const out = await ask(
    db,
    actor,
    'studentSummary',
    {
      name: 'student_summary',
      instructions: `Write one paragraph of 4 to 6 plain, neutral sentences that gives a coaching institute's staff member a picture of one student: admission status, fees, attendance, recent results and teachers' notes, in that order. Call the person "the student". ${RULES} ${SAFETY}`,
      input: `${redact(facts, names, 'facts')}\n${reviewText}`,
      schema: SUMMARY.schema,
    },
    SUMMARY.out,
    requestId,
  );
  return SUMMARY.items(out);
}
