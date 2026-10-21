/**
 * Student progress reports (owner brief §10, acceptance 17, 18, 21). Generating builds a SNAPSHOT
 * once (plain JSON: Academic evidence, feedback, fee totals …) and stores it on the export row
 * with the audience, sections, period, template version and source references; every later view
 * and PDF renders that snapshot and never re-reads live data. draft → reviewed (a reviewer who is
 * not the creator) → final; nothing changes after final. Guardian/student reports hold only the
 * deterministic constructive summary built from SHAREABLE, SUBMITTED reviews (strengths / areas /
 * next steps — never the raw observation); raw reviews, guardians, status history and fee totals
 * are internal sections. A reader sees only the sections their permissions allow today. Nothing
 * is emailed; generating, reviewing, finalising and downloading are audited.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { z } from 'zod';
import { can } from '@elevate/authorization';
import {
  opsReportExports,
  opsTeacherStudentFeedback as reviews,
  staffMembers,
  type Database,
  type OpsReportExportId,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  InvalidStateTransitionError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { IsoDate, StudentIdentityId } from '@elevate/shared-types';
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
import { academicEvidence } from './academic-summary';
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
    // Assumes no own-scope feedback reader can generate reports (teachers cannot today).
    feedback: can(actor, 'ops:feedback:read'),
  };
}

/** Submitted (final), current reviews observed in the period, oldest first. */
async function submittedReviews(
  db: Database,
  studentId: StudentIdentityId,
  from: string,
  to: string,
) {
  const rows = await db
    .select({ r: reviews, teacherName: staffMembers.fullName })
    .from(reviews)
    .innerJoin(staffMembers, eq(staffMembers.id, reviews.teacherStaffId))
    .where(
      and(
        eq(reviews.studentId, studentId),
        gte(reviews.observedOn, from as IsoDate),
        lte(reviews.observedOn, to as IsoDate),
      ),
    )
    .orderBy(asc(reviews.observedOn), asc(reviews.version));
  const superseded = new Set(rows.map((x) => x.r.supersedesId).filter(Boolean));
  return rows.filter((x) => x.r.status === 'final' && !superseded.has(x.r.id));
}

async function buildSnapshot(
  db: Database,
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
    has('feedback') || has('summary') ? submittedReviews(db, studentId, input.from, input.to) : [],
  ]);
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
    feedback: has('feedback')
      ? submitted.map(({ r, teacherName }) => ({
          id: r.id,
          teacher: teacherName,
          subject: r.subject,
          observedOn: r.observedOn,
          version: r.version,
          visibility: r.visibility,
          observations: r.observations,
          strengths: r.strengths,
          areasToImprove: r.areasToImprove,
          actionPlan: r.actionPlan,
        }))
      : undefined,
    // Only the three shareable fields of shareable reviews; the observation is never read here.
    summary: has('summary')
      ? constructiveSummary({
          attendance: available?.attendance ?? null,
          results: available
            ? available.results.map(({ percent: _p, comparison: _c, rescored: _r, ...r }) => r)
            : null,
          feedback: submitted
            .filter(({ r }) => r.visibility === 'shareable')
            .map(({ r }) => ({
              subject: r.subject,
              strengths: r.strengths,
              areasToImprove: r.areasToImprove,
              actionPlan: r.actionPlan,
            })),
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
    reviewIds: submitted.map(({ r }) => r.id),
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
  const { snapshot, sourceRefs } = await buildSnapshot(db, profile, input, sections);
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
  /** Moves this reader may make now (the status route re-checks them under a row lock). */
  const actions = {
    review: !legacy && reportTransition(row.status, 'reviewed', ctx).ok,
    finalise: !legacy && reportTransition(row.status, 'final', ctx).ok,
  };
  return { export: meta, fields, view, actions, ctx };
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
  const { export: meta, ctx } = await getStudentReport(db, actor, studentId, reference);
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
