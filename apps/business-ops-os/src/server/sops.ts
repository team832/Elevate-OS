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
  auditEvents,
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
  type OpsSopId,
  type OpsSopVersionId,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import {
  decideApproval,
  findPendingApproval,
  listApprovalHistory,
  recordAudit,
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
import type { DepartmentId, StaffMemberId, UserId } from '@elevate/shared-types';
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
import type { createSopBody, sopDraftBody, sopWorkflowBody, updateSopBody } from './schemas';
import { loadSettings } from './settings';
import type { ackRequirementBody, sopScheduleBody } from './work-schemas';

type SopRow = typeof opsSops.$inferSelect;
type VersionRow = typeof opsSopVersions.$inferSelect;

export const hashContent = (content: string) =>
  createHash('sha256').update(content, 'utf8').digest('hex');

async function lockSop(tx: Database, id: string): Promise<SopRow> {
  const [row] = await tx
    .select()
    .from(opsSops)
    .where(eq(opsSops.id, id as OpsSopId))
    .for('update');
  if (!row) notFound('SOP');
  return row;
}

async function currentVersion(tx: Database, sop: SopRow): Promise<VersionRow | null> {
  if (!sop.currentVersionId) return null;
  const [v] = await tx
    .select()
    .from(opsSopVersions)
    .where(eq(opsSopVersions.id, sop.currentVersionId));
  return v ?? null;
}

async function userOfStaff(db: Database, staffId: string | null): Promise<UserId | null> {
  if (!staffId) return null;
  const [s] = await db
    .select({ userId: staffMembers.userId })
    .from(staffMembers)
    .where(eq(staffMembers.id, staffId as StaffMemberId));
  return s?.userId ?? null;
}

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
    return {
      ...sop,
      departmentName,
      ownerName: name(sop.ownerStaffId),
      reviewerName: name(sop.reviewerStaffId),
      decisionState: sopDecisionState(sop.status as SopStatus),
      currentVersion: v ? { label: v.versionLabel, status: v.status } : null,
      effectiveDate: schedule?.effectiveDate ?? null,
      archived: archived.has(sop.id),
      publicationState: sopPublicationState(
        {
          status: sop.status as SopStatus,
          hasApprovedVersion: Boolean(sop.approvedVersionId),
          effectiveDate: schedule?.effectiveDate ?? null,
          archived: archived.has(sop.id),
        },
        today,
      ),
      reviewDue: sop.approvedVersionId
        ? reviewDueFlag(schedule?.nextReviewDate ?? sop.nextReviewDate, today, dueSoonDays)
        : ('not_set' as const),
    };
  });
}

export async function getSop(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:sops:read');
  const [sop] = await db
    .select()
    .from(opsSops)
    .where(eq(opsSops.id, id as OpsSopId));
  if (!sop) notFound('SOP');
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
  const approvals = [];
  for (const v of versions) {
    for (const a of await listApprovalHistory(db, {
      module: 'ops',
      subjectType: 'sop_version',
      subjectId: v.id,
    })) {
      approvals.push({ ...a, versionLabel: v.versionLabel });
    }
  }
  const people = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName, userId: staffMembers.userId })
    .from(staffMembers);
  const person = (sid: string | null) => people.find((p) => p.id === sid) ?? null;
  const [dept] = sop.departmentId
    ? await db.select().from(departments).where(eq(departments.id, sop.departmentId))
    : [];
  const ownerUserId = person(sop.ownerStaffId)?.userId ?? null;
  const reviewerUserId = person(sop.reviewerStaffId)?.userId ?? null;
  const approvalBlockers =
    current && current.status === 'in_review'
      ? sopApprovalProblems({
          versionStatus: 'in_review',
          ownerStaffId: sop.ownerStaffId,
          ownerUserId,
          reviewerStaffId: sop.reviewerStaffId,
          reviewerUserId,
          review:
            current.reviewedBy && current.reviewOutcome
              ? { byUserId: current.reviewedBy, outcome: current.reviewOutcome }
              : null,
          deciderUserId: actor.id,
          submittedHash: current.contentHash,
          currentHash: hashContent(current.content),
        }).map((p) => SOP_APPROVAL_PROBLEM_LABELS[p])
      : [];
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
    approvalBlockersForYou: approvalBlockers,
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

export async function createSop(
  db: Database,
  actor: Actor,
  input: z.output<typeof createSopBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:sops:write');
  assertPeople(input.ownerStaffId, input.reviewerStaffId);
  for (const f of ['ownerStaffId', 'reviewerStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f] as string, f);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'sop', 'ops.sops');
    const [sop] = await tx
      .insert(opsSops)
      .values({
        code,
        title: input.title,
        process: input.process ?? null,
        departmentId: (input.departmentId as DepartmentId | null) ?? null,
        ownerStaffId: (input.ownerStaffId as StaffMemberId | null) ?? null,
        reviewerStaffId: (input.reviewerStaffId as StaffMemberId | null) ?? null,
        backupStaffId: (input.backupStaffId as StaffMemberId | null) ?? null,
        ownerRole: input.ownerRole ?? null,
        riskLevel: input.riskLevel ?? null,
        priority: input.priority ?? null,
        nextReviewDate: input.nextReviewDate ?? null,
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
        content: input.content,
        createdBy: actor.id,
      })
      .returning();
    const [after] = await tx
      .update(opsSops)
      .set({ currentVersionId: version?.id ?? null })
      .where(eq(opsSops.id, sop.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.created',
      entityType: 'sop',
      entityId: sop.id,
      after,
      requestId,
    });
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
  for (const f of ['ownerStaffId', 'reviewerStaffId', 'backupStaffId'] as const)
    if (input[f]) await activeStaff(db, input[f] as string, f);
  return withTransaction(db, async (tx) => {
    const before = await lockSop(tx, id);
    if (before.status === 'retired') throw new ConflictError('A retired SOP cannot be edited.');
    assertPeople(
      'ownerStaffId' in input ? input.ownerStaffId : before.ownerStaffId,
      'reviewerStaffId' in input ? input.reviewerStaffId : before.reviewerStaffId,
    );
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(opsSops)
      .set(patch)
      .where(eq(opsSops.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.updated',
      entityType: 'sop',
      entityId: before.id,
      before,
      after,
      requestId,
    });
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
    const sop = await lockSop(tx, id);
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
      let seq = 0;
      for (const item of input.checklist) {
        seq += 1;
        await tx
          .insert(opsSopChecklistItems)
          .values({ versionId: version.id, seq, section: item.section, text: item.text });
      }
    }
    await tx
      .update(opsSops)
      .set({ currentVersionId: version.id, status: next.status })
      .where(eq(opsSops.id, sop.id));
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.draft_saved',
      entityType: 'sop',
      entityId: sop.id,
      after: { versionId: version.id, label: version.versionLabel },
      requestId,
    });
    return version;
  });
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
    const sop = await lockSop(tx, id);
    const version = await currentVersion(tx, sop);
    if (!version)
      throw new InvalidStateTransitionError('This SOP has no version yet; save a draft first.');
    const ctx = { hasApprovedVersion: Boolean(sop.approvedVersionId) };
    const audit = (action: string, after: unknown) =>
      recordAudit(tx, {
        actorUserId: actor.id,
        module: 'ops',
        action,
        entityType: 'sop',
        entityId: sop.id,
        after,
        requestId,
        metadata: { versionId: version.id },
      });
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
        await tx
          .update(opsSopVersions)
          .set({
            status: 'in_review',
            contentHash: hashContent(version.content),
            approvalId: approval.id,
            reviewedBy: null,
            reviewedAt: null,
            reviewOutcome: null,
            reviewNote: null,
          })
          .where(eq(opsSopVersions.id, version.id));
        await tx.update(opsSops).set({ status: next.status }).where(eq(opsSops.id, sop.id));
        await audit('sop.submitted', { approvalId: approval.id });
        return { status: next.status, approvalId: approval.id };
      }
      case 'review': {
        if (version.status !== 'in_review')
          throw new InvalidStateTransitionError('Only a version in review can be reviewed.');
        const me = await staffIdForUser(tx, actor.id);
        if (!me || me !== sop.reviewerStaffId)
          throw new ForbiddenError('Only the assigned reviewer can record the review.');
        await tx
          .update(opsSopVersions)
          .set({
            reviewedBy: actor.id,
            reviewedAt: new Date(),
            reviewOutcome: input.outcome,
            reviewNote: input.note ?? null,
          })
          .where(eq(opsSopVersions.id, version.id));
        await audit('sop.reviewed', { outcome: input.outcome });
        return { status: sop.status, review: input.outcome };
      }
      case 'withdraw': {
        const pending = await findPendingApproval(tx, sopApprovalPolicy, version.id);
        if (!pending) throw new InvalidStateTransitionError('Nothing is waiting for approval.');
        await withdrawApproval(tx, {
          policy: sopApprovalPolicy,
          approvalId: pending.id,
          actor,
          requestId,
        });
        await tx
          .update(opsSopVersions)
          .set({ status: 'draft', contentHash: null })
          .where(eq(opsSopVersions.id, version.id));
        const status = sop.approvedVersionId ? 'approved' : 'draft';
        await tx.update(opsSops).set({ status }).where(eq(opsSops.id, sop.id));
        await audit('sop.withdrawn', {});
        return { status };
      }
      case 'approve':
      case 'reject': {
        const pending = await findPendingApproval(tx, sopApprovalPolicy, version.id);
        if (!pending)
          throw new InvalidStateTransitionError('This version has no pending approval request.');
        if (input.action === 'approve') {
          const problems = sopApprovalProblems({
            versionStatus: version.status as 'in_review',
            ownerStaffId: sop.ownerStaffId,
            ownerUserId: await userOfStaff(tx, sop.ownerStaffId),
            reviewerStaffId: sop.reviewerStaffId,
            reviewerUserId: await userOfStaff(tx, sop.reviewerStaffId),
            review:
              version.reviewedBy && version.reviewOutcome
                ? { byUserId: version.reviewedBy, outcome: version.reviewOutcome }
                : null,
            deciderUserId: actor.id,
            submittedHash: version.contentHash,
            currentHash: hashContent(version.content),
          });
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
          decision: input.action === 'approve' ? 'approved' : 'rejected',
          comment: input.comment ?? null,
          requestId,
        });
        const next = nextSopStatus(sop.status as SopStatus, input.action, ctx);
        if (!next.ok) throw new InvalidStateTransitionError(next.message);
        if (input.action === 'approve') {
          if (sop.approvedVersionId)
            await tx
              .update(opsSopVersions)
              .set({ status: 'superseded' })
              .where(eq(opsSopVersions.id, sop.approvedVersionId));
          await tx
            .update(opsSopVersions)
            .set({ status: 'approved', approvedBy: actor.id, approvedAt: new Date() })
            .where(eq(opsSopVersions.id, version.id));
          await tx
            .update(opsSops)
            .set({ status: 'approved', approvedVersionId: version.id })
            .where(eq(opsSops.id, sop.id));
        } else {
          await tx
            .update(opsSopVersions)
            .set({ status: 'rejected' })
            .where(eq(opsSopVersions.id, version.id));
          await tx.update(opsSops).set({ status: next.status }).where(eq(opsSops.id, sop.id));
        }
        await audit(input.action === 'approve' ? 'sop.approved' : 'sop.rejected', {
          status: next.status,
        });
        return { status: next.status };
      }
      case 'retire': {
        if (version.status === 'in_review')
          throw new InvalidStateTransitionError('Decide or withdraw the version in review first.');
        const next = nextSopStatus(sop.status as SopStatus, 'retire', ctx);
        if (!next.ok) throw new InvalidStateTransitionError(next.message);
        await tx
          .update(opsSops)
          .set({ status: 'retired', retiredAt: new Date(), retiredReason: input.reason })
          .where(and(eq(opsSops.id, sop.id)));
        await audit('sop.retired', { reason: input.reason });
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

async function archiveOf(db: Database, sopId: string) {
  const [row] = await db
    .select()
    .from(opsSopArchives)
    .where(eq(opsSopArchives.sopId, sopId as OpsSopId));
  return row ?? null;
}

/** Derived fields for the SOP detail: publication, review due, acknowledgements, links, history. */
async function sopExtras(db: Database, actor: Actor, sop: SopRow) {
  const today = istToday(new Date());
  const settings = await loadSettings(db);
  const schedule = await scheduleOf(db, sop.approvedVersionId);
  const archive = await archiveOf(db, sop.id);
  const publicationState = sopPublicationState(
    {
      status: sop.status as SopStatus,
      hasApprovedVersion: Boolean(sop.approvedVersionId),
      effectiveDate: schedule?.effectiveDate ?? null,
      archived: Boolean(archive),
    },
    today,
  );
  const acknowledgements = await acknowledgementSummary(db, sop, canSeeAckNames(actor));
  const me = await myAckState(db, actor, sop);
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
    reviewDue: sop.approvedVersionId
      ? reviewDueFlag(
          schedule?.nextReviewDate ?? sop.nextReviewDate,
          today,
          settings['registers.review_due'].value.dueSoonDays,
        )
      : ('not_set' as const),
    acknowledgements,
    myAcknowledgement: me,
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
    const sop = await lockSop(tx, id);
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.schedule_set',
      entityType: 'sop',
      entityId: sop.id,
      before,
      after,
      requestId,
      metadata: { versionId: version.id },
    });
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
    const sop = await lockSop(tx, id);
    if (sop.status !== 'retired')
      throw new InvalidStateTransitionError('Retire the SOP before archiving it.');
    if (await archiveOf(tx, sop.id)) throw new ConflictError('This SOP is already archived.');
    const [row] = await tx
      .insert(opsSopArchives)
      .values({ sopId: sop.id, reason: input.reason.trim(), archivedBy: actor.id })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.archived',
      entityType: 'sop',
      entityId: sop.id,
      after: row,
      requestId,
    });
    return row;
  });
}

// --- required acknowledgements (OPS-065) ---------------------------------------------------------

type RequirementRow = typeof opsSopAckRequirements.$inferSelect;

/** Who sees named outstanding lists: SOP writers and dashboard readers. Others see counts. */
const canSeeAckNames = (actor: Actor) =>
  can(actor, 'ops:sops:write') || can(actor, 'ops:dashboard:read');

/** Read-only principals (only the auditor role) never write acknowledgements. */
const isReadOnly = (actor: Actor) =>
  actor.roles.length > 0 && actor.roles.every((r) => r === 'auditor');

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

async function acknowledgedUsers(db: Database, versionId: string | null) {
  if (!versionId) return new Set<string>();
  const rows = await db
    .select({ userId: opsSopAcknowledgements.userId })
    .from(opsSopAcknowledgements)
    .where(eq(opsSopAcknowledgements.versionId, versionId as OpsSopVersionId));
  return new Set(rows.map((r) => r.userId as string));
}

/**
 * Acknowledgement status of the approved version in force. A person in several
 * requirements of the same version is counted once (`totals`).
 */
async function acknowledgementSummary(db: Database, sop: SopRow, withNames: boolean) {
  const versionId = sop.approvedVersionId;
  const requirements = await activeRequirements(db, versionId);
  const acked = await acknowledgedUsers(db, versionId);
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
      counts: {
        required: split.acknowledged.length + split.outstanding.length,
        acknowledged: split.acknowledged.length,
        outstanding: split.outstanding.length,
        noLogin: split.noLogin.length,
      },
      outstanding: withNames ? split.outstanding.map((m) => m.name) : null,
      noLogin: withNames ? split.noLogin.map((m) => m.name) : null,
    });
  }
  const total = acknowledgementStatus([...everyone.values()], acked);
  return {
    versionId,
    requirements: perRequirement,
    totals: {
      required: total.acknowledged.length + total.outstanding.length,
      acknowledged: total.acknowledged.length,
      outstanding: total.outstanding.length,
      noLogin: total.noLogin.length,
    },
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
    inAckAudience(
      {
        id: req.id,
        audienceType: req.audienceType as 'department' | 'role',
        departmentId: req.departmentId,
        role: req.role,
      },
      person,
    ),
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
    readOnly: isReadOnly(actor),
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
    const sop = await lockSop(tx, id);
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.acknowledgement_required',
      entityType: 'sop',
      entityId: sop.id,
      after: row,
      requestId,
      metadata: { versionId: sop.approvedVersionId },
    });
    const audience = (await ackAudience(tx, row))
      .map((m) => m.userId)
      .filter((u): u is UserId => Boolean(u) && u !== actor.id);
    if (audience.length)
      await notify(tx, {
        userIds: [...new Set(audience)],
        module: 'ops',
        kind: 'sop.acknowledgement_required',
        title: `Please read and acknowledge ${sop.code}: ${sop.title}`,
        body: row.dueDate ? `Acknowledge by ${row.dueDate}.` : undefined,
        link: `/ops/sops/${sop.id}`,
        entityType: 'sop',
        entityId: sop.id,
      });
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
    const sop = await lockSop(tx, id);
    const [req] = await tx
      .select()
      .from(opsSopAckRequirements)
      .innerJoin(opsSopVersions, eq(opsSopVersions.id, opsSopAckRequirements.versionId))
      .where(
        and(
          eq(opsSopAckRequirements.id, requirementId as OpsSopAckRequirementId),
          eq(opsSopVersions.sopId, sop.id),
        ),
      );
    if (!req) notFound('Acknowledgement requirement');
    if (req.sop_ack_requirements.withdrawnAt)
      throw new ConflictError('This requirement is already withdrawn.');
    const [after] = await tx
      .update(opsSopAckRequirements)
      .set({ withdrawnAt: new Date(), withdrawnBy: actor.id, withdrawnReason: input.reason.trim() })
      .where(eq(opsSopAckRequirements.id, req.sop_ack_requirements.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.acknowledgement_requirement_withdrawn',
      entityType: 'sop',
      entityId: sop.id,
      before: req.sop_ack_requirements,
      after,
      requestId,
    });
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
  await accessScope(db, actor, 'ops:sops:read');
  return withTransaction(db, async (tx) => {
    const sop = await lockSop(tx, id);
    const state = await myAckState(tx, actor, sop);
    if (!state.canAcknowledge) {
      const Err = state.acknowledgedAt ? ConflictError : ForbiddenError;
      throw new Err(state.problems.join(' ') || 'You cannot acknowledge this SOP.');
    }
    const staffId = await staffIdForUser(tx, actor.id);
    const [row] = await tx
      .insert(opsSopAcknowledgements)
      .values({
        versionId: sop.approvedVersionId as OpsSopVersionId,
        userId: actor.id,
        staffId,
        note: input.note ?? null,
      })
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'sop.acknowledged',
      entityType: 'sop',
      entityId: sop.id,
      after: row,
      requestId,
      metadata: { versionId: sop.approvedVersionId },
    });
    return row;
  });
}

/** Outstanding-acknowledgement report for one SOP (names only for writers / dashboard readers). */
export async function sopAcknowledgementReport(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:sops:read');
  const [sop] = await db
    .select()
    .from(opsSops)
    .where(eq(opsSops.id, id as OpsSopId));
  if (!sop) notFound('SOP');
  return acknowledgementSummary(db, sop, canSeeAckNames(actor));
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
    totals.required += s.totals.required;
    totals.acknowledged += s.totals.acknowledged;
    totals.outstanding += s.totals.outstanding;
    totals.noLogin += s.totals.noLogin;
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
  const [sop] = await db
    .select({ id: opsSops.id })
    .from(opsSops)
    .where(eq(opsSops.id, id as OpsSopId));
  if (!sop) notFound('SOP');
  const rows = await db
    .select({ e: auditEvents, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        eq(auditEvents.entityType, 'sop'),
        eq(auditEvents.entityId, sop.id),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(500);
  return rows.map(({ e, actorName }) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    label: SOP_HISTORY_LABELS[e.action] ?? e.action,
    actorName,
  }));
}
