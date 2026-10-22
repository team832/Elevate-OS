/**
 * Student progress reports (owner brief §10, acceptance 17, 18, 21). Generating builds a SNAPSHOT
 * once (plain JSON: Academic evidence, feedback, fee totals …) and stores it on the export row
 * with the audience, sections, period, template version and source references; every later view
 * and PDF renders that snapshot and never re-reads live data. draft → reviewed (a reviewer who is
 * not the creator) → final; nothing changes after final. Teacher reviews come from Academic OS
 * (submitted, not withdrawn, frozen into the snapshot); results only as Academic publishes them.
 * Guardian/student reports hold only the deterministic constructive summary built from SHAREABLE
 * reviews (strengths / areas / next steps — never internal remarks); raw reviews, guardians, status history and fee totals
 * are internal sections. A reader sees only the sections their permissions allow today. Nothing
 * is emailed; generating, reviewing, finalising and downloading are audited.
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { can } from '@elevate/authorization';
import { opsReportExports, type Database, type OpsReportExportId } from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  InvalidStateTransitionError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../domain';
import { FEE_BALANCE_LABELS } from '../domain/fees';
import {
  constructiveSummary,
  inIstPeriod,
  readableSections,
  REPORT_TEMPLATE_VERSION,
  reportSections,
  reportTransition,
  type ReportAudience,
  type ReportPermissions,
  type ReportSection,
} from '../domain/student-report';
import {
  reviewDate,
  studentReviews,
  visibleReviews,
  type AcademicReview,
} from './academic-reviews';
import { academicEvidence, fetchAcademicReviews } from './academic-summary';
import { accessScope, type Actor } from './context';
import { progressReportPdf } from './pdf/progress-report';
import type { reportBody } from './report-schemas';
import { loadSettings } from './settings';
import { getStudent } from './students';

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const referenceCode = () =>
  `SR-${[...randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;

type Profile = Awaited<ReturnType<typeof getStudent>>;
const statusLabel = (s: string) => ADMISSION_STATUS_LABELS[s as AdmissionStatus] ?? s;

function permissionsOf(actor: Actor, profile: Profile): ReportPermissions {
  return {
    fees: can(actor, 'ops:fees:read'),
    privateData: profile.guardians !== 'hidden',
    // Own-scope readers (counsellors) get only the reviews their scope allows (academic-reviews.ts).
    feedback: can(actor, 'ops:feedback:read'),
  };
}

/**
 * Current submitted Academic reviews about the period, oldest first (withdrawn hidden, reader's
 * scope applied by studentReviews). `null` when Academic could not be read.
 */
async function submittedReviews(
  db: Database,
  actor: Actor,
  studentId: StudentIdentityId,
  from: string,
  to: string,
) {
  const r = await studentReviews(db, actor, studentId);
  if (r.status === 'unavailable') return { source: r, reviews: null };
  const reviews = r.reviews
    .filter((x) => !x.superseded && reviewDate(x) >= from && reviewDate(x) <= to)
    .sort((x, y) => reviewDate(x).localeCompare(reviewDate(y)));
  return { source: r, reviews };
}

/** Internal evidence fields: only in internal views, never in family outputs (acceptance 15). */
const internalRemarks = (r: AcademicReview) =>
  [
    ['Attendance and engagement', r.attendanceEvidence],
    ['Homework and practice', r.homeworkEvidence],
    ['Academic concerns', r.academicConcerns],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || null;

async function buildSnapshot(
  db: Database,
  actor: Actor,
  profile: Profile,
  input: z.output<typeof reportBody>,
  sections: ReportSection[],
) {
  const has = (s: ReportSection) => sections.includes(s);
  const period = { from: input.from, to: input.to };
  const studentId = profile.identity!.id as StudentIdentityId;
  const [academic, submitted] = await Promise.all([
    has('results') || has('attendance') || has('summary')
      ? academicEvidence(db, profile.academic.studentId, period)
      : null,
    // Needs ops:feedback:read; the reader's scope is applied again in studentReviews.
    (has('feedback') || has('summary')) && can(actor, 'ops:feedback:read')
      ? submittedReviews(db, actor, studentId, input.from, input.to)
      : null,
  ]);
  const reviews = submitted?.reviews ?? [];
  const available = academic?.status === 'available' ? academic : null;
  const snapshot = {
    template: REPORT_TEMPLATE_VERSION,
    audience: input.audience,
    sections,
    period,
    acknowledgement: input.acknowledgement,
    student: {
      name: profile.person.fullName,
      admissionNumber: profile.admission.admissionNumber,
      isSample: profile.identity!.isSample,
    },
    programmes: profile.cases.map((c) => ({
      programme: c.programme?.name ?? 'Not recorded',
      batch: c.enrolledBatchId
        ? (available?.enrolments.find((e) => e.programmeCode === c.programme?.code)?.batchName ??
          'Assigned in Academic OS')
        : c.intendedBatchId
          ? 'Requested from Academic OS'
          : 'To be assigned',
      status: c.statusLabel,
    })),
    academic,
    history:
      has('overview') && !['guardian', 'student'].includes(input.audience)
        ? {
            changes: profile.history
              .filter((h) => inIstPeriod(h.at, input.from, input.to))
              .map((h) => ({
                at: new Date(h.at).toISOString(),
                status: statusLabel(h.toStatus),
                reason: h.reason,
              })),
            exits: profile.exitRecords
              .filter((x) => inIstPeriod(x.recordedAt, input.from, input.to))
              .map((x) => ({
                status: statusLabel(x.exitStatus),
                date: x.exitDate,
                reason: x.reason,
              })),
          }
        : undefined,
    /** Where the reviews came from (Academic OS) and when; `unavailable` is never "no reviews". */
    reviewsSource: submitted
      ? {
          status: submitted.source.status,
          checkedAt: submitted.source.checkedAt,
          ...(submitted.source.status === 'unavailable' ? { reason: submitted.source.reason } : {}),
        }
      : undefined,
    feedback: has('feedback')
      ? reviews.map((r) => ({
          id: r.reviewKey,
          teacher: r.authorName,
          subject: r.subjectName ?? 'Subject not recorded',
          observedOn: reviewDate(r),
          version: r.version,
          visibility: r.visibility,
          observations: internalRemarks(r),
          strengths: r.strengths,
          areasToImprove: r.areasForSupport,
          actionPlan: r.suggestedAction,
        }))
      : undefined,
    // Only the three shareable fields of shareable reviews; internal remarks are never read here.
    summary: has('summary')
      ? constructiveSummary({
          attendance: available?.attendance ?? null,
          results: available
            ? available.results.map(({ percent: _p, comparison: _c, rescored: _r, ...r }) => r)
            : null,
          feedback: submitted?.reviews
            ? submitted.reviews
                .filter((r) => r.visibility === 'shareable')
                .map((r) => ({
                  subject: r.subjectName ?? 'Subject not recorded',
                  strengths: r.strengths,
                  areasToImprove: r.areasForSupport,
                  actionPlan: r.suggestedAction,
                }))
            : null,
        })
      : undefined,
    guardians:
      has('guardians') && profile.guardians !== 'hidden'
        ? profile.guardians
            .filter((g) => !g.archivedAt)
            .map((g) => ({
              name: g.fullName,
              relationship: g.relationship,
              consent: g.consentStatus,
            }))
        : undefined,
    // Totals only (a statement): no payment rows, methods or receipts.
    fees:
      has('fees') && profile.fees
        ? {
            duePaise: profile.fees.duePaise,
            netReceivedPaise: profile.fees.netReceivedPaise,
            balancePaise: profile.fees.balancePaise,
            balance: FEE_BALANCE_LABELS[profile.fees.balanceState],
            disclaimer: profile.fees.disclaimer,
          }
        : undefined,
  };
  const sourceRefs = {
    academicStudentId: profile.academic.studentId,
    academic: academic
      ? {
          status: academic.status,
          checkedAt: 'checkedAt' in academic ? academic.checkedAt : null,
          assessmentIds: available?.results.map((r) => r.assessmentId) ?? [],
        }
      : null,
    reviews: reviews.map((r) => ({ reviewKey: r.reviewKey, version: r.version })),
    admissionIds: profile.cases.map((c) => c.id),
  };
  return { snapshot, sourceRefs };
}
export type ReportSnapshot = Awaited<ReturnType<typeof buildSnapshot>>['snapshot'];

/** POST /students/{id}/report — builds the draft snapshot, writes the export row + audit row. */
export async function generateStudentReport(
  db: Database,
  actor: Actor,
  studentId: string,
  input: z.output<typeof reportBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:student_reports:generate');
  const profile = await getStudent(db, actor, studentId);
  if (!profile.identity)
    throw new ValidationError(
      'This student has no canonical record yet, so no report can be made.',
    );
  const { enabled } = (await loadSettings(db))['reports.audiences'].value;
  if (!enabled.includes(input.audience))
    throw new ValidationError('This report audience is not enabled (setting reports.audiences).', {
      details: [{ location: 'body', path: ['audience'], message: 'Not enabled' }],
    });
  const sections = reportSections(
    input.audience as ReportAudience,
    permissionsOf(actor, profile),
    input.sections,
  );
  const { snapshot, sourceRefs } = await buildSnapshot(db, actor, profile, input, sections);
  const identityId = profile.identity.id;
  const period = { from: input.from, to: input.to };
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsReportExports)
      .values({
        studentId: identityId,
        requestedBy: actor.id,
        periodFrom: input.from,
        periodTo: input.to,
        fieldsIncluded: sections,
        referenceCode: referenceCode(),
        audience: input.audience,
        status: 'draft',
        snapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
        templateVersion: REPORT_TEMPLATE_VERSION,
        sourceRefs,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'student.report_generated',
      entityType: 'student',
      entityId: identityId,
      after: {
        referenceCode: row!.referenceCode,
        period,
        audience: input.audience,
        fieldsIncluded: sections,
      },
      requestId,
    });
    return {
      id: row!.id,
      referenceCode: row!.referenceCode,
      studentId: identityId,
      audience: input.audience,
      status: row!.status,
      fields: sections,
      period,
    };
  });
}

/**
 * R16: has a teacher withdrawn a review this report was built from? `null` = Academic could not
 * be asked. Reports without Academic reviews never ask.
 */
async function withdrawnSource(row: typeof opsReportExports.$inferSelect) {
  const refs = (row.sourceRefs as { reviews?: { reviewKey: string }[] } | null)?.reviews ?? [];
  if (!refs.length) return false;
  const r = await fetchAcademicReviews({ coreStudentId: row.studentId });
  if (r.status === 'unavailable') return null;
  const live = new Set(visibleReviews(r.data.reviews).map((x) => x.reviewKey));
  return refs.some((x) => !live.has(x.reviewKey));
}

const SOURCE_NOTICES = {
  withdrawn: 'A source review was withdrawn — generate the report again.',
  unchecked:
    'Academic OS could not be reached to re-check the source reviews; try again before finalising or printing.',
  withdrawnAfterFinal: 'A source review was withdrawn after this report was finalised.',
};

const findRow = (db: Database, identityId: string, reference: string) =>
  db
    .select()
    .from(opsReportExports)
    .where(
      and(
        /^SR-/.test(reference)
          ? eq(opsReportExports.referenceCode, reference)
          : eq(opsReportExports.id, reference as OpsReportExportId),
        eq(opsReportExports.studentId, identityId as StudentIdentityId),
      ),
    );

/**
 * The report behind a reference code (or export id), cut to the sections the reader may see now.
 * The stored snapshot is never returned whole: only `view` leaves this function.
 */
export async function getStudentReport(
  db: Database,
  actor: Actor,
  studentId: string,
  reference: string,
) {
  await accessScope(db, actor, 'ops:student_reports:generate');
  const profile = await getStudent(db, actor, studentId);
  const [row] = profile.identity ? await findRow(db, profile.identity.id, reference) : [];
  if (!row) throw new NotFoundError('Report reference not found for this student.');
  const { snapshot, sourceRefs: _refs, fieldsIncluded: _all, ...meta } = row;
  const fields = readableSections(
    row.fieldsIncluded as ReportSection[],
    permissionsOf(actor, profile),
  );
  const legacy = !snapshot || 'legacy' in snapshot;
  const s = snapshot as ReportSnapshot;
  const view = legacy
    ? null
    : {
        ...s,
        sections: fields,
        feedback: fields.includes('feedback') ? s.feedback : undefined,
        guardians: fields.includes('guardians') ? s.guardians : undefined,
        fees: fields.includes('fees') ? s.fees : undefined,
      };
  const { reviewBeforeFinal } = (await loadSettings(db))['reports.audiences'].value;
  const ctx = {
    isCreator: row.requestedBy === actor.id,
    canReview: can(actor, 'ops:student_reports:review'),
    reviewBeforeFinal,
  };
  const withdrawn = legacy ? false : await withdrawnSource(row);
  const final = row.status === 'final';
  /** R16: a non-final report whose sources changed (or cannot be checked) is blocked. */
  const blocked = !final && withdrawn !== false;
  const notice = final
    ? withdrawn
      ? SOURCE_NOTICES.withdrawnAfterFinal
      : null
    : withdrawn
      ? SOURCE_NOTICES.withdrawn
      : withdrawn === null
        ? SOURCE_NOTICES.unchecked
        : null;
  /** Moves this reader may make now (the status route re-checks them under a row lock). */
  const actions = {
    review: !legacy && !blocked && reportTransition(row.status, 'reviewed', ctx).ok,
    finalise: !legacy && !blocked && reportTransition(row.status, 'final', ctx).ok,
  };
  return { export: meta, fields, view, actions, ctx, blocked, notice };
}

const MOVE_ERRORS = {
  illegal: () => new InvalidStateTransitionError('A final report cannot change.'),
  needs_reviewer: () =>
    new ForbiddenError('Reviewing and finalising need ops:student_reports:review.'),
  own_report: () =>
    new ForbiddenError('A report must be reviewed by someone other than its author.'),
  review_first: () =>
    new InvalidStateTransitionError('This report must be reviewed before it is final.'),
};

/** POST /students/{id}/report/{ref}/status — draft → reviewed → final (row locked, audited). */
export async function setStudentReportStatus(
  db: Database,
  actor: Actor,
  studentId: string,
  reference: string,
  to: 'reviewed' | 'final',
  requestId?: string,
) {
  const {
    export: meta,
    ctx,
    blocked,
    notice,
  } = await getStudentReport(db, actor, studentId, reference);
  if (blocked) throw new InvalidStateTransitionError(notice!);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(opsReportExports)
      .where(eq(opsReportExports.id, meta.id))
      .for('update');
    if (!row!.snapshot || 'legacy' in row!.snapshot)
      throw new InvalidStateTransitionError('A report made before snapshots cannot change.');
    const move = reportTransition(row!.status, to, ctx);
    if (!move.ok) throw MOVE_ERRORS[move.reason]();
    const now = new Date();
    const [after] = await tx
      .update(opsReportExports)
      .set(
        to === 'reviewed'
          ? { status: to, reviewedBy: actor.id, reviewedAt: now }
          : { status: to, finalisedBy: actor.id, finalisedAt: now },
      )
      .where(eq(opsReportExports.id, row!.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: to === 'reviewed' ? 'student.report_reviewed' : 'student.report_finalised',
      entityType: 'student_report',
      entityId: row!.id,
      before: { status: row!.status },
      after: { status: to, referenceCode: row!.referenceCode },
      requestId,
    });
    const { snapshot: _s, ...rest } = after!;
    return rest;
  });
}

/** GET /students/{id}/report/{ref}/pdf — the PDF of the (permission-cut) snapshot; audited. */
export async function studentReportPdf(
  db: Database,
  actor: Actor,
  studentId: string,
  reference: string,
  requestId?: string,
) {
  const r = await getStudentReport(db, actor, studentId, reference);
  if (!r.view)
    throw new ValidationError(
      'This report was made before report snapshots existed, so it has no stored content to print.',
    );
  if (r.blocked) throw new InvalidStateTransitionError(r.notice!);
  const pdf = await progressReportPdf(r.view, r.export);
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'student.report_downloaded',
    entityType: 'student_report',
    entityId: r.export.id,
    after: { referenceCode: r.export.referenceCode, audience: r.export.audience, fields: r.fields },
    requestId,
  });
  return { bytes: pdf.bytes, filename: `student-report-${r.export.referenceCode}.pdf` };
}
