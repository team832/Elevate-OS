/**
 * SOP register (OPS-019): versions, checklists and approval through core
 * approvals (policy `ops.sop.approve`, subject = the VERSION). Rules: a named
 * reviewer who is not the owner must recommend the version; the owner cannot
 * approve their own SOP; the requester cannot decide their own request.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { can, scopeFor } from '@elevate/authorization';
import {
  departments,
  opsIncidents,
  opsSopAckRequirements,
  opsSopAcknowledgements,
  opsSopArchives,
  opsSopChecklistItems,
  opsSops,
  opsSopVersions,
  opsSopVersionSchedules,
  opsTasks,
  staffMembers,
  userRoles,
  users,
  type Database,
  type OpsSopAckRequirementId,
  type OpsSopVersionId,
} from '@elevate/database';
import {
  decideApproval,
  findPendingApproval,
  requestApproval,
  withdrawApproval,
  withTransaction,
} from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { DepartmentId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  ACKNOWLEDGE_PROBLEM_LABELS,
  acknowledgementStatus,
  acknowledgeProblems,
  inAckAudience,
  istToday,
  nextSopStatus,
  nextVersionLabel,
  SOP_APPROVAL_PROBLEM_LABELS,
  SOP_PUBLICATION_LABELS,
  sopApprovalProblems,
  sopDecisionState,
  sopPublicationState,
  reviewDueFlag,
  sopScheduleProblems,
  sopSubmissionProblems,
  type AckAudienceMember,
  type SopStatus,
  type SopVersionStatus,
} from '../domain';
import { sopApprovalPolicy } from './approval-policies';
import {
  accessScope,
  activeStaff,
  nextCode,
  notFound,
  staffIdForUser,
  type Actor,
} from './context';
import {
  auditTrail,
  defined,
  notifyOthers,
  opsAudit,
  rowById,
  staffUserLookup,
  versionApprovals,
} from './ops-common';
import type { createSopBody, sopDraftBody, sopWorkflowBody, updateSopBody } from './schemas';
import { loadSettings } from './settings';
import type { ackRequirementBody, sopScheduleBody } from './work-schemas';

type SopRow = typeof opsSops.$inferSelect;
type VersionRow = typeof opsSopVersions.$inferSelect;

const audit = opsAudit('sop');

export const hashContent = (content: string) =>
  createHash('sha256').update(content, 'utf8').digest('hex');

const getSopRow = (db: Database, id: string, lock = false): Promise<SopRow> =>
  rowById(db, opsSops, id, 'SOP', lock);

async function currentVersion(tx: Database, sop: SopRow): Promise<VersionRow | null> {
  if (!sop.currentVersionId) return null;
  const [v] = await tx
    .select()
    .from(opsSopVersions)
    .where(eq(opsSopVersions.id, sop.currentVersionId));
  return v ?? null;
}

/** Approval rules (A-11) for deciding version `v` of `sop`; `userOf` maps staff to logins. */
export const sopApprovalCheck = (
  sop: SopRow,
  v: VersionRow,
  userOf: (staffId: string | null) => UserId | null,
  deciderUserId: string,
) =>
  sopApprovalProblems({
    versionStatus: v.status as 'in_review',
    ownerStaffId: sop.ownerStaffId,
    ownerUserId: userOf(sop.ownerStaffId),
    reviewerStaffId: sop.reviewerStaffId,
    reviewerUserId: userOf(sop.reviewerStaffId),
    review:
      v.reviewedBy && v.reviewOutcome ? { byUserId: v.reviewedBy, outcome: v.reviewOutcome } : null,
    deciderUserId,
    submittedHash: v.contentHash,
    currentHash: hashContent(v.content),
  });

/** Review-due flag of the approved version in force (schedule date, else the register date). */
const sopReviewDue = (
  sop: SopRow,
  schedule: { nextReviewDate: string | null } | null,
  today: ReturnType<typeof istToday>,
  dueSoonDays: number,
) =>
  sop.approvedVersionId
    ? reviewDueFlag(schedule?.nextReviewDate ?? sop.nextReviewDate, today, dueSoonDays)
    : ('not_set' as const);

const publicationOf = (
  sop: SopRow,
  effectiveDate: string | null,
  archived: boolean,
  today: ReturnType<typeof istToday>,
) =>
  sopPublicationState(
    {
      status: sop.status as SopStatus,
      hasApprovedVersion: Boolean(sop.approvedVersionId),
      effectiveDate,
      archived,
    },
    today,
  );

export async function listSops(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:sops:read');
  const rows = await db
    .select({ sop: opsSops, departmentName: departments.name })
    .from(opsSops)
    .leftJoin(departments, eq(departments.id, opsSops.departmentId))
    .orderBy(asc(opsSops.code));
  const staff = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers);
  const name = (id: string | null) => staff.find((s) => s.id === id)?.fullName ?? null;
  const versionIds = rows
    .map((r) => r.sop.currentVersionId)
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const versions = versionIds.length
    ? await db.select().from(opsSopVersions).where(inArray(opsSopVersions.id, versionIds))
    : [];
  const schedules = await db.select().from(opsSopVersionSchedules);
  const archived = new Set((await db.select().from(opsSopArchives)).map((a) => a.sopId as string));
  const settings = await loadSettings(db);
  const today = istToday(new Date());
  const dueSoonDays = settings['registers.review_due'].value.dueSoonDays;
  return rows.map(({ sop, departmentName }) => {
    const v = versions.find((x) => x.id === sop.currentVersionId);
    const schedule = schedules.find((s) => s.versionId === sop.approvedVersionId) ?? null;
    const effectiveDate = schedule?.effectiveDate ?? null;
    return {
      ...sop,
      departmentName,
      ownerName: name(sop.ownerStaffId),
      reviewerName: name(sop.reviewerStaffId),
      decisionState: sopDecisionState(sop.status as SopStatus),
      currentVersion: v ? { label: v.versionLabel, status: v.status } : null,
      effectiveDate,
      archived: archived.has(sop.id),
      publicationState: publicationOf(sop, effectiveDate, archived.has(sop.id), today),
      reviewDue: sopReviewDue(sop, schedule, today, dueSoonDays),
    };
  });
}

export async function getSop(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:sops:read');
  const sop = await getSopRow(db, id);
  const versions = await db
    .select()
    .from(opsSopVersions)
    .where(eq(opsSopVersions.sopId, sop.id))
    .orderBy(desc(opsSopVersions.versionNumber));
  const current = versions.find((v) => v.id === sop.currentVersionId) ?? null;
  const checklist = current
    ? await db
        .select()
        .from(opsSopChecklistItems)
        .where(eq(opsSopChecklistItems.versionId, current.id))
        .orderBy(asc(opsSopChecklistItems.seq))
    : [];
  const approvals = await versionApprovals(db, 'sop_version', versions, (_, v) => ({
    versionLabel: v.versionLabel,
  }));
  const people = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName, userId: staffMembers.userId })
    .from(staffMembers);
  const person = (sid: string | null) => people.find((p) => p.id === sid) ?? null;
  const userOf = (sid: string | null) => person(sid)?.userId ?? null;
  const [dept] = sop.departmentId
    ? await db.select().from(departments).where(eq(departments.id, sop.departmentId))
    : [];
  const reviewerUserId = userOf(sop.reviewerStaffId);
  return {
    sop,
    decisionState: sopDecisionState(sop.status as SopStatus),
    department: dept ?? null,
    owner: person(sop.ownerStaffId),
    reviewer: person(sop.reviewerStaffId),
    backup: person(sop.backupStaffId),
    versions,
    current,
    checklist,
    approvals,
    approvalBlockersForYou:
      current?.status === 'in_review'
        ? sopApprovalCheck(sop, current, userOf, actor.id).map(
            (p) => SOP_APPROVAL_PROBLEM_LABELS[p],
          )
        : [],
    youAreReviewer: Boolean(reviewerUserId && reviewerUserId === actor.id),
    ...(await sopExtras(db, actor, sop)),
  };
}

function assertPeople(owner: string | null | undefined, reviewer: string | null | undefined) {
  if (owner && reviewer && owner === reviewer)
    throw new ValidationError('The reviewer cannot be the SOP owner.', {
      details: [{ location: 'body', path: ['reviewerStaffId'], message: 'Same as owner' }],
    });
}

async function validateSopStaff(db: Database, input: z.output<typeof updateSopBody>) {
  for (const f of ['ownerStaffId', 'reviewerStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f] as string, f);
}

export async function createSop(
  db: Database,
  actor: Actor,
  input: z.output<typeof createSopBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  assertPeople(input.ownerStaffId, input.reviewerStaffId);
  await validateSopStaff(db, input);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'sop', 'ops.sops');
    const { content, ...register } = input;
    const [sop] = await tx
      .insert(opsSops)
      .values({
        ...(register as typeof opsSops.$inferInsert),
        code,
        status: 'draft',
        createdBy: actor.id,
      })
      .returning();
    if (!sop) throw new Error('sop insert returned no row');
    const [version] = await tx
      .insert(opsSopVersions)
      .values({
        sopId: sop.id,
        versionNumber: 1,
        versionLabel: '0.1',
        status: 'draft',
        content,
        createdBy: actor.id,
      })
      .returning();
    const [after] = await tx
      .update(opsSops)
      .set({ currentVersionId: version?.id ?? null })
      .where(eq(opsSops.id, sop.id))
      .returning();
    await audit(tx, actor, sop.id, 'sop.created', { after }, requestId);
    return after as SopRow;
  });
}

export async function updateSop(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updateSopBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  await validateSopStaff(db, input);
  return withTransaction(db, async (tx) => {
    const before = await getSopRow(tx, id, true);
    if (before.status === 'retired') throw new ConflictError('A retired SOP cannot be edited.');
    assertPeople(
      'ownerStaffId' in input ? input.ownerStaffId : before.ownerStaffId,
      'reviewerStaffId' in input ? input.reviewerStaffId : before.reviewerStaffId,
    );
    const [after] = await tx
      .update(opsSops)
      .set(defined(input) as Partial<typeof opsSops.$inferInsert>)
      .where(eq(opsSops.id, before.id))
      .returning();
    await audit(tx, actor, before.id, 'sop.updated', { before, after }, requestId);
    return after as SopRow;
  });
}

/** Save draft content: edits the current draft, or starts a new version (never erases an old one). */
export async function saveSopDraft(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof sopDraftBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    const current = await currentVersion(tx, sop);
    const next = nextSopStatus(sop.status as SopStatus, 'start_draft', {
      hasApprovedVersion: Boolean(sop.approvedVersionId),
    });
    if (!next.ok) throw new InvalidStateTransitionError(next.message);
    let version: VersionRow | undefined;
    if (current && current.status === 'draft') {
      [version] = await tx
        .update(opsSopVersions)
        .set({
          content: input.content,
          changeNote: input.changeNote ?? current.changeNote,
          documentRef: input.documentRef ?? current.documentRef,
        })
        .where(eq(opsSopVersions.id, current.id))
        .returning();
    } else {
      const all = await tx
        .select({ n: opsSopVersions.versionNumber, label: opsSopVersions.versionLabel })
        .from(opsSopVersions)
        .where(eq(opsSopVersions.sopId, sop.id));
      [version] = await tx
        .insert(opsSopVersions)
        .values({
          sopId: sop.id,
          versionNumber: Math.max(0, ...all.map((a) => a.n)) + 1,
          versionLabel: nextVersionLabel(
            all.map((a) => a.label),
            Boolean(sop.approvedVersionId),
          ),
          status: 'draft',
          content: input.content,
          changeNote: input.changeNote ?? null,
          documentRef: input.documentRef ?? null,
          createdBy: actor.id,
        })
        .returning();
    }
    if (!version) throw new Error('version write returned no row');
    if (input.checklist) {
      await tx.delete(opsSopChecklistItems).where(eq(opsSopChecklistItems.versionId, version.id));
      for (const [i, item] of input.checklist.entries())
        await tx
          .insert(opsSopChecklistItems)
          .values({ versionId: version.id, seq: i + 1, section: item.section, text: item.text });
    }
    await tx
      .update(opsSops)
      .set({ currentVersionId: version.id, status: next.status })
      .where(eq(opsSops.id, sop.id));
    const after = { versionId: version.id, label: version.versionLabel };
    await audit(tx, actor, sop.id, 'sop.draft_saved', { after }, requestId);
    return version;
  });
}

/** The pending core approval of a version, or INVALID_STATE with `message`. */
async function pendingApprovalOf(tx: Database, versionId: string, message: string) {
  const pending = await findPendingApproval(tx, sopApprovalPolicy, versionId);
  if (!pending) throw new InvalidStateTransitionError(message);
  return pending;
}

export async function sopWorkflow(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof sopWorkflowBody>,
  requestId?: string,
) {
  const permission =
    input.action === 'approve' || input.action === 'reject'
      ? 'ops:sops:approve'
      : input.action === 'review'
        ? 'ops:sops:read'
        : 'ops:sops:write';
  await accessScope(db, actor, permission);
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    const version = await currentVersion(tx, sop);
    if (!version)
      throw new InvalidStateTransitionError('This SOP has no version yet; save a draft first.');
    const ctx = { hasApprovedVersion: Boolean(sop.approvedVersionId) };
    const log = (action: string, after: unknown) =>
      audit(tx, actor, sop.id, action, { after, metadata: { versionId: version.id } }, requestId);
    const setVersion = (
      values: Partial<typeof opsSopVersions.$inferInsert>,
      versionId = version.id,
    ) => tx.update(opsSopVersions).set(values).where(eq(opsSopVersions.id, versionId));
    const setSop = (values: Partial<typeof opsSops.$inferInsert>) =>
      tx.update(opsSops).set(values).where(eq(opsSops.id, sop.id));
    switch (input.action) {
      case 'submit': {
        if (version.status !== 'draft')
          throw new InvalidStateTransitionError('Only a draft version can be submitted.');
        const problems = sopSubmissionProblems({
          ownerStaffId: sop.ownerStaffId,
          reviewerStaffId: sop.reviewerStaffId,
          contentLength: version.content.trim().length,
        });
        if (problems.length)
          throw new ValidationError(`Cannot submit: ${problems.join(', ')}.`, {
            details: { problems },
          });
        const next = nextSopStatus(sop.status as SopStatus, 'submit', ctx);
        if (!next.ok) throw new InvalidStateTransitionError(next.message);
        const approval = await requestApproval(tx, {
          policy: sopApprovalPolicy,
          subjectId: version.id,
          requestedBy: actor,
          comment: input.comment ?? null,
          requestId,
        });
        await setVersion({
          status: 'in_review',
          contentHash: hashContent(version.content),
          approvalId: approval.id,
          reviewedBy: null,
          reviewedAt: null,
          reviewOutcome: null,
          reviewNote: null,
        });
        await setSop({ status: next.status });
        await log('sop.submitted', { approvalId: approval.id });
        return { status: next.status, approvalId: approval.id };
      }
      case 'review': {
        if (version.status !== 'in_review')
          throw new InvalidStateTransitionError('Only a version in review can be reviewed.');
        const me = await staffIdForUser(tx, actor.id);
        if (!me || me !== sop.reviewerStaffId)
          throw new ForbiddenError('Only the assigned reviewer can record the review.');
        await setVersion({
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewOutcome: input.outcome,
          reviewNote: input.note ?? null,
        });
        await log('sop.reviewed', { outcome: input.outcome });
        return { status: sop.status, review: input.outcome };
      }
      case 'withdraw': {
        const pending = await pendingApprovalOf(tx, version.id, 'Nothing is waiting for approval.');
        await withdrawApproval(tx, {
          policy: sopApprovalPolicy,
          approvalId: pending.id,
          actor,
          requestId,
        });
        await setVersion({ status: 'draft', contentHash: null });
        const status = sop.approvedVersionId ? 'approved' : 'draft';
        await setSop({ status });
        await log('sop.withdrawn', {});
        return { status };
      }
      case 'approve':
      case 'reject': {
        const approve = input.action === 'approve';
        const pending = await pendingApprovalOf(
          tx,
          version.id,
          'This version has no pending approval request.',
        );
        if (approve) {
          const problems = sopApprovalCheck(sop, version, await staffUserLookup(tx), actor.id);
          if (problems.includes('approver_is_owner'))
            throw new ForbiddenError(SOP_APPROVAL_PROBLEM_LABELS.approver_is_owner);
          if (problems.length)
            throw new InvalidStateTransitionError(
              problems.map((p) => SOP_APPROVAL_PROBLEM_LABELS[p]).join(' '),
              { details: { problems } },
            );
        }
        await decideApproval(tx, {
          policy: sopApprovalPolicy,
          approvalId: pending.id,
          decider: actor,
          decision: approve ? 'approved' : 'rejected',
          comment: input.comment ?? null,
          requestId,
        });
        const next = nextSopStatus(sop.status as SopStatus, input.action, ctx);
        if (!next.ok) throw new InvalidStateTransitionError(next.message);
        if (approve) {
          if (sop.approvedVersionId)
            await setVersion({ status: 'superseded' }, sop.approvedVersionId);
          await setVersion({ status: 'approved', approvedBy: actor.id, approvedAt: new Date() });
          await setSop({ status: 'approved', approvedVersionId: version.id });
        } else {
          await setVersion({ status: 'rejected' });
          await setSop({ status: next.status });
        }
        await log(approve ? 'sop.approved' : 'sop.rejected', { status: next.status });
        return { status: next.status };
      }
      case 'retire': {
        if (version.status === 'in_review')
          throw new InvalidStateTransitionError('Decide or withdraw the version in review first.');
        const next = nextSopStatus(sop.status as SopStatus, 'retire', ctx);
        if (!next.ok) throw new InvalidStateTransitionError(next.message);
        await setSop({ status: 'retired', retiredAt: new Date(), retiredReason: input.reason });
        await log('sop.retired', { reason: input.reason });
        return { status: 'retired' };
      }
    }
  });
}

// --- schedule, publication, archive (OPS-064) ----------------------------------------------------

async function scheduleOf(db: Database, versionId: string | null) {
  if (!versionId) return null;
  const [row] = await db
    .select()
    .from(opsSopVersionSchedules)
    .where(eq(opsSopVersionSchedules.versionId, versionId as OpsSopVersionId));
  return row ?? null;
}

async function archiveOf(db: Database, sopId: SopRow['id']) {
  const [row] = await db.select().from(opsSopArchives).where(eq(opsSopArchives.sopId, sopId));
  return row ?? null;
}

/** Derived fields for the SOP detail: publication, review due, acknowledgements, links, history. */
async function sopExtras(db: Database, actor: Actor, sop: SopRow) {
  const today = istToday(new Date());
  const settings = await loadSettings(db);
  const schedule = await scheduleOf(db, sop.approvedVersionId);
  const archive = await archiveOf(db, sop.id);
  const publicationState = publicationOf(
    sop,
    schedule?.effectiveDate ?? null,
    Boolean(archive),
    today,
  );
  const relatedTasks =
    scopeFor(actor, 'ops:tasks:read') === 'all'
      ? await db
          .select({
            id: opsTasks.id,
            code: opsTasks.code,
            title: opsTasks.title,
            status: opsTasks.status,
            dueDate: opsTasks.dueDate,
          })
          .from(opsTasks)
          .where(eq(opsTasks.sopId, sop.id))
          .orderBy(asc(opsTasks.code))
      : null;
  const relatedIncidents = can(actor, 'ops:incidents:read')
    ? await db
        .select({
          id: opsIncidents.id,
          code: opsIncidents.code,
          title: opsIncidents.title,
          status: opsIncidents.status,
        })
        .from(opsIncidents)
        .where(eq(opsIncidents.sopId, sop.id))
        .orderBy(desc(opsIncidents.occurredAt))
    : null;
  return {
    schedule,
    archive,
    publicationState,
    publicationLabel: SOP_PUBLICATION_LABELS[publicationState],
    reviewDue: sopReviewDue(
      sop,
      schedule,
      today,
      settings['registers.review_due'].value.dueSoonDays,
    ),
    acknowledgements: await acknowledgementSummary(db, sop, canSeeAckNames(actor)),
    myAcknowledgement: await myAckState(db, actor, sop),
    relatedTasks,
    relatedIncidents,
  };
}

export async function setSopSchedule(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof sopScheduleBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    const versionId = input.versionId ?? sop.approvedVersionId;
    if (!versionId)
      throw new InvalidStateTransitionError(
        'This SOP has no approved version, so it cannot have an effective date.',
      );
    const [version] = await tx
      .select()
      .from(opsSopVersions)
      .where(
        and(eq(opsSopVersions.id, versionId as OpsSopVersionId), eq(opsSopVersions.sopId, sop.id)),
      );
    if (!version) notFound('SOP version');
    const problems = sopScheduleProblems({
      sopStatus: sop.status as SopStatus,
      versionStatus: version.status as SopVersionStatus,
      isVersionInForce: version.id === sop.approvedVersionId,
      effectiveDate: input.effectiveDate,
      nextReviewDate: input.nextReviewDate ?? null,
    });
    if (problems.includes('review_before_effective'))
      throw new ValidationError('The next review date is before the effective date.', {
        details: [{ location: 'body', path: ['nextReviewDate'], message: 'Before effective date' }],
      });
    if (problems.length)
      throw new InvalidStateTransitionError(
        'Only the approved version in force of a live SOP can get an effective date.',
        { details: { problems } },
      );
    const before = await scheduleOf(tx, version.id);
    const values = {
      versionId: version.id,
      effectiveDate: input.effectiveDate,
      nextReviewDate: input.nextReviewDate ?? null,
      setBy: actor.id,
    };
    const [after] = before
      ? await tx
          .update(opsSopVersionSchedules)
          .set(values)
          .where(eq(opsSopVersionSchedules.versionId, version.id))
          .returning()
      : await tx.insert(opsSopVersionSchedules).values(values).returning();
    const data = { before, after, metadata: { versionId: version.id } };
    await audit(tx, actor, sop.id, 'sop.schedule_set', data, requestId);
    return after;
  });
}

/** Archive a retired SOP (flag row; the SOP and its versions are unchanged and stay readable). */
export async function archiveSop(
  db: Database,
  actor: Actor,
  id: string,
  input: { reason: string },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    if (sop.status !== 'retired')
      throw new InvalidStateTransitionError('Retire the SOP before archiving it.');
    if (await archiveOf(tx, sop.id)) throw new ConflictError('This SOP is already archived.');
    const [row] = await tx
      .insert(opsSopArchives)
      .values({ sopId: sop.id, reason: input.reason.trim(), archivedBy: actor.id })
      .returning();
    await audit(tx, actor, sop.id, 'sop.archived', { after: row }, requestId);
    return row;
  });
}

// --- required acknowledgements (OPS-065) ---------------------------------------------------------

type RequirementRow = typeof opsSopAckRequirements.$inferSelect;

/** Who sees named outstanding lists: SOP writers and dashboard readers. Others see counts. */
const canSeeAckNames = (actor: Actor) =>
  can(actor, 'ops:sops:write') || can(actor, 'ops:dashboard:read');

/** Audience of a requirement: active staff of a department, or active users holding a role. */
async function ackAudience(db: Database, req: RequirementRow): Promise<AckAudienceMember[]> {
  if (req.audienceType === 'department' && req.departmentId) {
    const rows = await db
      .select({ id: staffMembers.id, userId: staffMembers.userId, name: staffMembers.fullName })
      .from(staffMembers)
      .where(
        and(eq(staffMembers.departmentId, req.departmentId), eq(staffMembers.status, 'active')),
      );
    return rows.map((r) => ({ staffId: r.id, userId: r.userId, name: r.name }));
  }
  if (req.audienceType === 'role' && req.role) {
    const rows = await db
      .select({ userId: users.id, displayName: users.displayName })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.role, req.role as never), eq(users.status, 'active')));
    const staff = rows.length
      ? await db
          .select({ id: staffMembers.id, userId: staffMembers.userId, name: staffMembers.fullName })
          .from(staffMembers)
          .where(
            inArray(
              staffMembers.userId,
              rows.map((r) => r.userId),
            ),
          )
      : [];
    return rows.map((r) => {
      const s = staff.find((x) => x.userId === r.userId);
      return { staffId: s?.id ?? null, userId: r.userId, name: s?.name ?? r.displayName };
    });
  }
  return [];
}

async function activeRequirements(db: Database, versionId: string | null) {
  if (!versionId) return [];
  return db
    .select({ req: opsSopAckRequirements, departmentName: departments.name })
    .from(opsSopAckRequirements)
    .leftJoin(departments, eq(departments.id, opsSopAckRequirements.departmentId))
    .where(
      and(
        eq(opsSopAckRequirements.versionId, versionId as OpsSopVersionId),
        isNull(opsSopAckRequirements.withdrawnAt),
      ),
    )
    .orderBy(asc(opsSopAckRequirements.createdAt));
}

/** Counts of an acknowledgement split (people without a login are never "required"). */
const ackCounts = (split: ReturnType<typeof acknowledgementStatus>) => ({
  required: split.acknowledged.length + split.outstanding.length,
  acknowledged: split.acknowledged.length,
  outstanding: split.outstanding.length,
  noLogin: split.noLogin.length,
});

/**
 * Acknowledgement status of the approved version in force. A person in several
 * requirements of the same version is counted once (`totals`).
 */
async function acknowledgementSummary(db: Database, sop: SopRow, withNames: boolean) {
  const versionId = sop.approvedVersionId;
  const requirements = await activeRequirements(db, versionId);
  const acked = new Set(
    versionId
      ? (
          await db
            .select({ userId: opsSopAcknowledgements.userId })
            .from(opsSopAcknowledgements)
            .where(eq(opsSopAcknowledgements.versionId, versionId))
        ).map((r) => r.userId as string)
      : [],
  );
  const everyone = new Map<string, AckAudienceMember>();
  const perRequirement = [];
  for (const { req, departmentName } of requirements) {
    const audience = await ackAudience(db, req);
    for (const m of audience) everyone.set(m.userId ?? `staff:${m.staffId}`, m);
    const split = acknowledgementStatus(audience, acked);
    perRequirement.push({
      id: req.id,
      audienceType: req.audienceType,
      audienceLabel:
        req.audienceType === 'department' ? (departmentName ?? 'Department') : req.role,
      departmentId: req.departmentId,
      role: req.role,
      dueDate: req.dueDate,
      note: req.note,
      createdAt: req.createdAt,
      counts: ackCounts(split),
      outstanding: withNames ? split.outstanding.map((m) => m.name) : null,
      noLogin: withNames ? split.noLogin.map((m) => m.name) : null,
    });
  }
  return {
    versionId,
    requirements: perRequirement,
    totals: ackCounts(acknowledgementStatus([...everyone.values()], acked)),
  };
}

/** Is the actor in the audience of the version in force, and have they acknowledged it? */
async function myAckState(db: Database, actor: Actor, sop: SopRow) {
  const versionId = sop.approvedVersionId;
  const requirements = await activeRequirements(db, versionId);
  const [staff] = await db
    .select({ departmentId: staffMembers.departmentId })
    .from(staffMembers)
    .where(eq(staffMembers.userId, actor.id));
  const person = {
    departmentId: (staff?.departmentId as string | null) ?? null,
    roles: actor.roles,
  };
  const inAudience = requirements.some(({ req }) =>
    inAckAudience({ ...req, audienceType: req.audienceType as 'department' | 'role' }, person),
  );
  const [mine] = versionId
    ? await db
        .select()
        .from(opsSopAcknowledgements)
        .where(
          and(
            eq(opsSopAcknowledgements.versionId, versionId),
            eq(opsSopAcknowledgements.userId, actor.id),
          ),
        )
    : [];
  const problems = acknowledgeProblems({
    versionInForce: Boolean(versionId) && sop.status !== 'retired',
    inAudience,
    alreadyAcknowledged: Boolean(mine),
    // Without `ops:sops:acknowledge` (e.g. the read-only auditor) nobody writes acknowledgements.
    readOnly: !can(actor, 'ops:sops:acknowledge'),
  });
  return {
    required: inAudience,
    acknowledgedAt: mine?.acknowledgedAt ?? null,
    canAcknowledge: problems.length === 0,
    problems: problems.map((p) => ACKNOWLEDGE_PROBLEM_LABELS[p]),
  };
}

export async function createAckRequirement(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof ackRequirementBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    if (!sop.approvedVersionId || sop.status === 'retired')
      throw new InvalidStateTransitionError(
        'Only the approved version in force of a live SOP can require acknowledgement.',
      );
    if (input.audienceType === 'department') {
      const [dept] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, input.departmentId as DepartmentId));
      if (!dept)
        throw new ValidationError('Unknown department.', {
          details: [{ location: 'body', path: ['departmentId'], message: 'Unknown department' }],
        });
    }
    const [row] = await tx
      .insert(opsSopAckRequirements)
      .values({
        versionId: sop.approvedVersionId,
        audienceType: input.audienceType,
        departmentId:
          input.audienceType === 'department' ? (input.departmentId as DepartmentId) : null,
        role: input.audienceType === 'role' ? (input.role ?? null) : null,
        dueDate: input.dueDate ?? null,
        note: input.note ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('requirement insert returned no row');
    const data = { after: row, metadata: { versionId: sop.approvedVersionId } };
    await audit(tx, actor, sop.id, 'sop.acknowledgement_required', data, requestId);
    await notifyOthers(
      tx,
      actor,
      (await ackAudience(tx, row)).map((m) => m.userId).filter((u): u is UserId => Boolean(u)),
      {
        kind: 'sop.acknowledgement_required',
        title: `Please read and acknowledge ${sop.code}: ${sop.title}`,
        body: row.dueDate ? `Acknowledge by ${row.dueDate}.` : undefined,
        link: `/ops/sops/${sop.id}`,
        entityType: 'sop',
        entityId: sop.id,
      },
    );
    return row;
  });
}

export async function withdrawAckRequirement(
  db: Database,
  actor: Actor,
  id: string,
  requirementId: string,
  input: { reason: string },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    const [req] = await tx
      .select({ r: opsSopAckRequirements })
      .from(opsSopAckRequirements)
      .innerJoin(opsSopVersions, eq(opsSopVersions.id, opsSopAckRequirements.versionId))
      .where(
        and(
          eq(opsSopAckRequirements.id, requirementId as OpsSopAckRequirementId),
          eq(opsSopVersions.sopId, sop.id),
        ),
      );
    if (!req) notFound('Acknowledgement requirement');
    if (req.r.withdrawnAt) throw new ConflictError('This requirement is already withdrawn.');
    const [after] = await tx
      .update(opsSopAckRequirements)
      .set({ withdrawnAt: new Date(), withdrawnBy: actor.id, withdrawnReason: input.reason.trim() })
      .where(eq(opsSopAckRequirements.id, req.r.id))
      .returning();
    const action = 'sop.acknowledgement_requirement_withdrawn';
    await audit(tx, actor, sop.id, action, { before: req.r, after }, requestId);
    return after;
  });
}

/** The signed-in person acknowledges the approved version in force (append-only, once). */
export async function acknowledgeSop(
  db: Database,
  actor: Actor,
  id: string,
  input: { note?: string | null },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:acknowledge');
  return withTransaction(db, async (tx) => {
    const sop = await getSopRow(tx, id, true);
    const state = await myAckState(tx, actor, sop);
    if (!state.canAcknowledge) {
      const Err = state.acknowledgedAt ? ConflictError : ForbiddenError;
      throw new Err(state.problems.join(' ') || 'You cannot acknowledge this SOP.');
    }
    const [row] = await tx
      .insert(opsSopAcknowledgements)
      .values({
        versionId: sop.approvedVersionId as OpsSopVersionId,
        userId: actor.id,
        staffId: await staffIdForUser(tx, actor.id),
        note: input.note ?? null,
      })
      .returning();
    const data = { after: row, metadata: { versionId: sop.approvedVersionId } };
    await audit(tx, actor, sop.id, 'sop.acknowledged', data, requestId);
    return row;
  });
}

/** Outstanding-acknowledgement report for one SOP (names only for writers / dashboard readers). */
export async function sopAcknowledgementReport(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:sops:read');
  return acknowledgementSummary(db, await getSopRow(db, id), canSeeAckNames(actor));
}

/** Organisation-wide acknowledgement totals over all live SOPs (no permission check: dashboards). */
export async function acknowledgementTotals(db: Database) {
  const sops = await db
    .select()
    .from(opsSops)
    .where(and(isNotNull(opsSops.approvedVersionId), ne(opsSops.status, 'retired')));
  const bySop = [];
  const totals = { required: 0, acknowledged: 0, outstanding: 0, noLogin: 0 };
  for (const sop of sops) {
    const s = await acknowledgementSummary(db, sop, false);
    if (!s.requirements.length) continue;
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += s.totals[k];
    const due = s.requirements
      .map((r) => r.dueDate)
      .filter((d): d is string => Boolean(d))
      .sort()[0];
    bySop.push({ id: sop.id, code: sop.code, title: sop.title, dueDate: due ?? null, ...s.totals });
  }
  return { totals, bySop };
}

/** Organisation-wide outstanding report (SOP readers; named lists are not included here). */
export async function listOutstandingAcknowledgements(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:sops:read');
  return acknowledgementTotals(db);
}

// --- change history ------------------------------------------------------------------------------

const SOP_HISTORY_LABELS: Record<string, string> = {
  'sop.created': 'SOP created (draft 0.1)',
  'sop.updated': 'Register details edited',
  'sop.draft_saved': 'Draft saved',
  'sop.submitted': 'Submitted for approval',
  'sop.reviewed': 'Reviewer recorded a review',
  'sop.withdrawn': 'Submission withdrawn',
  'sop.approved': 'Version approved',
  'sop.rejected': 'Version rejected',
  'sop.retired': 'SOP retired',
  'sop.schedule_set': 'Effective / next review date set',
  'sop.archived': 'SOP archived',
  'sop.acknowledgement_required': 'Acknowledgement required from an audience',
  'sop.acknowledgement_requirement_withdrawn': 'Acknowledgement requirement withdrawn',
  'sop.acknowledged': 'Acknowledged by a staff member',
};

/** Change history of an SOP from the audit log, newest first. */
export async function getSopHistory(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:sops:read');
  const sop = await getSopRow(db, id);
  const rows = await auditTrail(db, 'sop', sop.id, 500);
  return rows.map(({ e, actorName }) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    label: SOP_HISTORY_LABELS[e.action] ?? e.action,
    actorName,
  }));
}
