/**
 * SOP register (OPS-019): versions, checklists and approval through core
 * approvals (policy `ops.sop.approve`, subject = the VERSION). Rules: a named
 * reviewer who is not the owner must recommend the version; the owner cannot
 * approve their own SOP; the requester cannot decide their own request.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  departments,
  opsSopChecklistItems,
  opsSops,
  opsSopVersions,
  staffMembers,
  type Database,
  type OpsSopId,
} from '@elevate/database';
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
  nextSopStatus,
  nextVersionLabel,
  SOP_APPROVAL_PROBLEM_LABELS,
  sopApprovalProblems,
  sopDecisionState,
  sopSubmissionProblems,
  type SopStatus,
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
  return rows.map(({ sop, departmentName }) => {
    const v = versions.find((x) => x.id === sop.currentVersionId);
    return {
      ...sop,
      departmentName,
      ownerName: name(sop.ownerStaffId),
      reviewerName: name(sop.reviewerStaffId),
      decisionState: sopDecisionState(sop.status as SopStatus),
      currentVersion: v ? { label: v.versionLabel, status: v.status } : null,
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
