/**
 * Teacher reports (owner brief 22 Oct 2026): an internal folio of one teacher for BDM meetings
 * and analysis. Generating builds a SNAPSHOT once — profile and subjects (teachers.ts), Academic
 * delivery for the period (fetchTeacherActivity), reviews written and moderated feedback counts
 * (only with ops:feedback:read), tasks and EOD coverage (the task period report, only with
 * ops:tasks:read) — stores it with its SHA-256 on `ops.teacher_report_exports`, and every later
 * download renders that snapshot unchanged. No draft/review workflow; generating and downloading
 * are audited. No contact details, no review text, no private notes.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import {
  opsTeacherReportExports,
  users,
  type Database,
  type OpsTeacherReportExportId,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { NotFoundError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { daysBetween, type IsoDate } from '../domain/dates';
import {
  deliveryFacts,
  TEACHER_REPORT_TEMPLATE_VERSION,
  teacherSummary,
  workOn,
  type Figure,
  type ReviewFacts,
} from '../domain/teacher-report';
import { fmtDateTime } from '../ui/format';
import { reviewDate } from './academic-reviews';
import { fetchTeacherActivity } from './academic-summary';
import { accessScope, assertScope, staffIdForUser, type Actor } from './context';
import { isConflicted } from './feedback-access';
import { teacherReportPdf as renderPdf } from './pdf/teacher-report';
import { MAX_PERIOD_DAYS, PERIOD_DEFINITIONS, periodReport } from './task-period-report';
import { getTeacherProfile } from './teachers';

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const referenceCode = () =>
  `TR-${[...randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
const WORK_DEFINITIONS = PERIOD_DEFINITIONS.filter(([k]) =>
  [
    'Assigned during period',
    'Completed during period',
    'Open at cut-off',
    'Overdue at cut-off',
    'EOD coverage',
  ].includes(k),
);

type Period = { from: IsoDate; to: IsoDate };
/** The overall comment a person wrote (or edited from an AI draft, D-111) when generating. */
type Input = Period & { comment?: string | null };
const inPeriod = (day: string, p: Period) => day >= p.from && day <= p.to;

export async function buildSnapshot(
  db: Database,
  actor: Actor,
  staffId: string,
  { comment, ...period }: Input,
) {
  const t = await getTeacherProfile(db, actor, staffId);
  const activity = await fetchTeacherActivity(t.staff.id, period);
  const delivery = activity.status === 'available' ? deliveryFacts(activity.data) : null;
  const unavailableAt = activity.status === 'unavailable' ? fmtDateTime(activity.fetchedAt) : null;

  const authored = t.reviewsAuthored;
  const reviewRows =
    authored?.status === 'available'
      ? authored.reviews.filter((r) => !r.superseded && inPeriod(reviewDate(r), period))
      : null;
  const reviews: ReviewFacts | null = reviewRows
    ? {
        shareable: reviewRows.filter((r) => r.visibility === 'shareable').length,
        internal: reviewRows.filter((r) => r.visibility === 'internal').length,
        latest: reviewRows.map(reviewDate).sort().at(-1) ?? null,
      }
    : null;
  const moderated = t.feedbackAbout?.rows.filter(
    (f) => f.moderationStatus !== 'pending' && inPeriod(f.feedbackOn, period),
  );

  const readsTasks = can(actor, 'ops:tasks:read');
  const shortEnough = daysBetween(period.from, period.to) < MAX_PERIOD_DAYS;
  const report =
    readsTasks && shortEnough
      ? await periodReport(db, actor, { ...period, staffId: t.staff.id })
      : null;
  const person = report?.people[0] ?? null;

  const snapshot = {
    template: TEACHER_REPORT_TEMPLATE_VERSION,
    kind: 'internal' as const,
    period,
    teacher: {
      name: t.displayName,
      staffCode: t.profile?.staffCode ?? null,
      subjects: t.subjects.map((s) => s.subject),
      verification:
        t.profile?.verificationStatus === 'confirmed' ? 'Confirmed by the owner' : 'Unverified',
      roleNote: t.profile?.roleNote ?? null,
      department: t.department,
      status: t.staff.status,
      isSample: t.profile?.isSample ?? false,
    },
    academic:
      activity.status === 'available'
        ? {
            status: 'available' as const,
            checkedAt: activity.fetchedAt,
            assignments: activity.data.assignments,
            delivery: delivery!,
          }
        : {
            status: 'unavailable' as const,
            reason: activity.reason,
            checkedAt: activity.fetchedAt,
          },
    reviews,
    reviewsNote: !authored
      ? 'Not included (no feedback permission).'
      : authored.status === 'unavailable'
        ? `Academic OS unavailable at ${fmtDateTime(authored.checkedAt)}; reviews not available.`
        : 'Current submitted reviews dated in the period; the review text stays with the student.',
    feedback: moderated
      ? {
          approved: moderated.filter((f) => f.moderationStatus === 'approved').length,
          rejected: moderated.filter((f) => f.moderationStatus === 'rejected').length,
          hidden: moderated.filter((f) => f.moderationStatus === 'hidden').length,
          scope: can(actor, 'ops:teacher_feedback:manage')
            ? 'all moderated states'
            : 'approved only',
        }
      : null,
    work: person
      ? { status: 'available' as const, cutOff: report!.asOf, ...person }
      : {
          status: 'not_included' as const,
          reason: !readsTasks
            ? 'no task permission'
            : !shortEnough
              ? `task and EOD figures cover periods of at most ${MAX_PERIOD_DAYS} days`
              : 'this teacher is outside your task scope',
        },
    workOn: workOn(delivery, person),
    summary: teacherSummary({ delivery, unavailableAt, reviews, work: person }),
    // Optional in the type: snapshots stored before teacher-report/2 have none.
    ...(comment ? { comment } : {}),
    definitions: [
      ...(delivery
        ? [...delivery.classes, delivery.deliveredShare, ...delivery.pending].map(
            (f: Figure) => [f.label, f.definition] as const,
          )
        : []),
      ...(person ? WORK_DEFINITIONS : []),
    ],
  };
  const sourceRefs = {
    academic: { status: activity.status, checkedAt: activity.fetchedAt },
    reviews: (reviewRows ?? []).map((r) => ({ reviewKey: r.reviewKey, version: r.version })),
    taskReport: report ? { cutOff: report.asOf } : null,
  };
  return { snapshot, sourceRefs };
}
export type TeacherReportSnapshot = Awaited<ReturnType<typeof buildSnapshot>>['snapshot'];

/** POST /teachers/{id}/report — builds and stores the snapshot (reference, SHA-256, audit row). */
export async function generateTeacherReport(
  db: Database,
  actor: Actor,
  staffId: string,
  input: Input,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:teacher_reports:generate');
  assertScope(access, [staffId], 'teacher reports');
  const { snapshot, sourceRefs } = await buildSnapshot(db, actor, staffId, input);
  const period = snapshot.period;
  const json = JSON.stringify(snapshot);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsTeacherReportExports)
      .values({
        staffId: staffId as StaffMemberId,
        referenceCode: referenceCode(),
        periodFrom: period.from,
        periodTo: period.to,
        templateVersion: TEACHER_REPORT_TEMPLATE_VERSION,
        snapshot: JSON.parse(json) as Record<string, unknown>,
        snapshotSha256: createHash('sha256').update(json).digest('hex'),
        sourceRefs,
        generatedBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'teacher.report_generated',
      entityType: 'teacher',
      entityId: staffId,
      after: { referenceCode: row!.referenceCode, period, kind: row!.kind },
      requestId,
    });
    const { snapshot: _s, sourceRefs: _r, ...meta } = row!;
    return meta;
  });
}

/** GET /teachers/{id}/report — stored reports of one teacher, newest first (no snapshots). */
export async function listTeacherReports(db: Database, actor: Actor, staffId: string) {
  const access = await accessScope(db, actor, 'ops:teacher_reports:generate');
  assertScope(access, [staffId], 'teacher reports');
  const e = opsTeacherReportExports;
  return db
    .select({
      id: e.id,
      referenceCode: e.referenceCode,
      kind: e.kind,
      periodFrom: e.periodFrom,
      periodTo: e.periodTo,
      templateVersion: e.templateVersion,
      createdAt: e.createdAt,
      generatedBy: users.displayName,
    })
    .from(e)
    .leftJoin(users, eq(users.id, e.generatedBy))
    .where(eq(e.staffId, staffId as StaffMemberId))
    .orderBy(desc(e.createdAt));
}

/**
 * The stored snapshot as this reader may see it now: feedback counts only for all-scope readers
 * of raw feedback who do not teach and are not that teacher (round 8).
 */
export async function snapshotFor(
  db: Database,
  actor: Actor,
  staffId: string,
  snapshot: TeacherReportSnapshot,
) {
  const sees =
    scopeFor(actor, 'ops:teacher_feedback:read') === 'all' &&
    !(await isConflicted(db, actor)) &&
    (await staffIdForUser(db, actor.id)) !== staffId;
  return sees ? snapshot : { ...snapshot, feedback: null };
}

/** GET /teachers/{id}/report/{ref}/pdf — the stored snapshot as a PDF; audited. */
export async function teacherReportPdf(
  db: Database,
  actor: Actor,
  staffId: string,
  reference: string,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:teacher_reports:generate');
  assertScope(access, [staffId], 'teacher reports');
  const e = opsTeacherReportExports;
  const [row] = await db
    .select()
    .from(e)
    .where(
      and(
        eq(e.staffId, staffId as StaffMemberId),
        /^TR-/.test(reference)
          ? eq(e.referenceCode, reference)
          : eq(e.id, reference as OpsTeacherReportExportId),
      ),
    );
  if (!row) throw new NotFoundError('Report reference not found for this teacher.');
  const pdf = await renderPdf(
    await snapshotFor(db, actor, staffId, row.snapshot as TeacherReportSnapshot),
    row,
  );
  await recordAudit(db, {
    actorUserId: actor.id,
    module: 'ops',
    action: 'teacher.report_downloaded',
    entityType: 'teacher_report',
    entityId: row.id,
    after: { referenceCode: row.referenceCode, kind: row.kind },
    requestId,
  });
  return { bytes: pdf.bytes, filename: `teacher-report-${row.referenceCode}.pdf` };
}
