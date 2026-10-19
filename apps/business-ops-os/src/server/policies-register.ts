/**
 * Policies & compliance register (OPS-066): the company records its OWN
 * policies and compliance obligations. Nothing is researched, generated or
 * pre-filled, and nothing here is legal advice. Text lives in append-only
 * versions; an approved version is never overwritten (a change is a new version
 * that needs approval again). Approval goes through core approvals (policy
 * `ops.policy.approve`, subject = the VERSION); the proposer can never approve.
 *
 * Permissions: read `ops:settings:read`; draft / propose / retire
 * `ops:settings:manage`. Approval is gated behind `ops:settings:manage` plus the
 * no-self-approval rule until a dedicated `ops:policies:approve` permission
 * exists (requested — see docs/parts/operations.md).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  auditEvents,
  opsPolicies,
  opsPolicyVersions,
  staffMembers,
  users,
  type Database,
  type OpsPolicyId,
  type OpsPolicyVersionId,
} from '@elevate/database';
import {
  decideApproval,
  defineApprovalPolicy,
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
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  isSettingKey,
  istToday,
  nextPolicyStatus,
  POLICY_PROBLEM_LABELS,
  policyApprovalProblems,
  policyProposalProblems,
  reviewDueFlag,
  type PolicyStatus,
  type PolicyVersionStatus,
} from '../domain';
import { accessScope, activeStaff, nextCode, notFound, type Actor } from './context';
import { loadSettings } from './settings';
import type {
  createPolicyBody,
  policyDraftBody,
  policyListQuery,
  policyWorkflowBody,
  updatePolicyBody,
} from './work-schemas';

type PolicyRow = typeof opsPolicies.$inferSelect;
type PolicyVersionRow = typeof opsPolicyVersions.$inferSelect;

/** OPS-066: approval of one policy version. The proposer cannot decide their own request. */
export const policyApprovalPolicy = defineApprovalPolicy({
  key: 'ops.policy.approve',
  module: 'ops',
  subjectType: 'policy_version',
  deciderPermission: 'ops:settings:manage',
  requesterPermission: 'ops:settings:manage',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'Approval of a version of a company policy or compliance obligation recorded by Elevate. The proposer cannot approve it.',
});

function assertSettingKeys(keys: readonly string[]) {
  const unknown = keys.filter((k) => !isSettingKey(k));
  if (unknown.length)
    throw new ValidationError(`Unknown setting key(s): ${unknown.join(', ')}.`, {
      details: [
        {
          location: 'body',
          path: ['linkedSettingKeys'],
          message: `Unknown setting key(s): ${unknown.join(', ')}`,
        },
      ],
    });
}

function assertDates(effective: string | null | undefined, review: string | null | undefined) {
  if (effective && review && review < effective)
    throw new ValidationError('The next review date is before the effective date.', {
      details: [{ location: 'body', path: ['nextReviewDate'], message: 'Before effective date' }],
    });
}

async function lockPolicy(tx: Database, id: string): Promise<PolicyRow> {
  const [row] = await tx
    .select()
    .from(opsPolicies)
    .where(eq(opsPolicies.id, id as OpsPolicyId))
    .for('update');
  if (!row) notFound('Policy');
  return row;
}

async function versionOf(tx: Database, id: string | null): Promise<PolicyVersionRow | null> {
  if (!id) return null;
  const [row] = await tx
    .select()
    .from(opsPolicyVersions)
    .where(eq(opsPolicyVersions.id, id as OpsPolicyVersionId));
  return row ?? null;
}

const dedupe = (keys: readonly string[]) => [...new Set(keys.map((k) => k.trim()))];

// --- reads -------------------------------------------------------------------------------------------

export async function listPolicies(
  db: Database,
  actor: Actor,
  query: Partial<z.output<typeof policyListQuery>> = {},
  now = new Date(),
) {
  await accessScope(db, actor, 'ops:settings:read');
  const rows = await db
    .select({ p: opsPolicies, accountableName: staffMembers.fullName })
    .from(opsPolicies)
    .leftJoin(staffMembers, eq(staffMembers.id, opsPolicies.accountableStaffId))
    .orderBy(asc(opsPolicies.code));
  const versions = await db.select().from(opsPolicyVersions);
  const today = istToday(now);
  const dueSoonDays = (await loadSettings(db))['registers.review_due'].value.dueSoonDays;
  const out = rows.map(({ p, accountableName }) => {
    const approved = versions.find((v) => v.id === p.approvedVersionId) ?? null;
    const current = versions.find((v) => v.id === p.currentVersionId) ?? null;
    return {
      ...p,
      accountableName,
      currentVersion: current ? { number: current.versionNumber, status: current.status } : null,
      effectiveDate: approved?.effectiveDate ?? null,
      nextReviewDate: approved?.nextReviewDate ?? null,
      reviewFlag:
        p.status === 'retired'
          ? ('not_set' as const)
          : reviewDueFlag(approved?.nextReviewDate ?? null, today, dueSoonDays),
    };
  });
  return out.filter(
    (p) =>
      (!query.area || p.area === query.area) &&
      (!query.status || p.status === query.status) &&
      (!query.review || p.reviewFlag === query.review),
  );
}

export async function getPolicy(db: Database, actor: Actor, id: string, now = new Date()) {
  await accessScope(db, actor, 'ops:settings:read');
  const [policy] = await db
    .select()
    .from(opsPolicies)
    .where(eq(opsPolicies.id, id as OpsPolicyId));
  if (!policy) notFound('Policy');
  const versions = await db
    .select({ v: opsPolicyVersions, createdByName: users.displayName })
    .from(opsPolicyVersions)
    .innerJoin(users, eq(users.id, opsPolicyVersions.createdBy))
    .where(eq(opsPolicyVersions.policyId, policy.id))
    .orderBy(desc(opsPolicyVersions.versionNumber));
  const people = await db.select({ id: users.id, name: users.displayName }).from(users);
  const who = (u: string | null) => (u ? (people.find((p) => p.id === u)?.name ?? null) : null);
  const [accountable] = policy.accountableStaffId
    ? await db
        .select({ fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, policy.accountableStaffId))
    : [];
  const settings = await loadSettings(db);
  const current = versions.find((x) => x.v.id === policy.currentVersionId)?.v ?? null;
  const approved = versions.find((x) => x.v.id === policy.approvedVersionId)?.v ?? null;
  const approvals = [];
  for (const { v } of versions)
    for (const a of await listApprovalHistory(db, {
      module: 'ops',
      subjectType: 'policy_version',
      subjectId: v.id,
    }))
      approvals.push({ ...a, versionNumber: v.versionNumber, decidedByName: who(a.decidedBy) });
  const today = istToday(now);
  const manage = can(actor, 'ops:settings:manage');
  const approveBlockers =
    current?.status === 'proposed'
      ? policyApprovalProblems({
          versionStatus: 'proposed',
          proposedByUserId: current.proposedBy,
          deciderUserId: actor.id,
        })
      : ['version_not_proposed' as const];
  return {
    policy,
    accountableName: accountable?.fullName ?? null,
    current,
    approved,
    versions: versions.map(({ v, createdByName }) => ({
      ...v,
      createdByName,
      proposedByName: who(v.proposedBy),
      decidedByName: who(v.decidedBy),
    })),
    approvals,
    linkedSettings:
      (approved ?? current)?.linkedSettingKeys.map((k) =>
        isSettingKey(k)
          ? {
              key: k,
              label: settings[k].label,
              decisionState: settings[k].decisionState,
              known: true,
            }
          : { key: k, label: k, decisionState: null, known: false },
      ) ?? [],
    reviewFlag:
      policy.status === 'retired'
        ? ('not_set' as const)
        : reviewDueFlag(
            approved?.nextReviewDate ?? null,
            today,
            settings['registers.review_due'].value.dueSoonDays,
          ),
    canManage: manage && policy.status !== 'retired',
    canApprove: manage && policy.status !== 'retired' && approveBlockers.length === 0,
    approveBlocker: approveBlockers.includes('self_approval')
      ? 'You proposed this version, so another person must approve it.'
      : null,
  };
}

export async function getPolicyHistory(db: Database, actor: Actor, id: string) {
  await accessScope(db, actor, 'ops:settings:read');
  const rows = await db
    .select({ e: auditEvents, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        eq(auditEvents.entityType, 'policy'),
        eq(auditEvents.entityId, id),
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(500);
  return rows.map(({ e, actorName }) => ({ id: e.id, at: e.at, action: e.action, actorName }));
}

// --- writes ------------------------------------------------------------------------------------------

export async function createPolicy(
  db: Database,
  actor: Actor,
  input: z.output<typeof createPolicyBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  if (input.accountableStaffId)
    await activeStaff(db, input.accountableStaffId, 'accountableStaffId');
  const keys = dedupe(input.linkedSettingKeys);
  assertSettingKeys(keys);
  assertDates(input.effectiveDate, input.nextReviewDate);
  return withTransaction(db, async (tx) => {
    const code = await nextCode(tx, 'policy', 'ops.policies');
    const [policy] = await tx
      .insert(opsPolicies)
      .values({
        code,
        title: input.title,
        area: input.area,
        summary: input.summary ?? null,
        accountableStaffId: (input.accountableStaffId as StaffMemberId | null) ?? null,
        ownerDecisionRef: input.ownerDecisionRef ?? null,
        status: 'draft',
        createdBy: actor.id,
      })
      .returning();
    if (!policy) throw new Error('policy insert returned no row');
    const [version] = await tx
      .insert(opsPolicyVersions)
      .values({
        policyId: policy.id,
        versionNumber: 1,
        status: 'draft',
        requirementText: input.requirementText,
        sourceReference: input.sourceReference ?? null,
        linkedSettingKeys: keys,
        effectiveDate: input.effectiveDate ?? null,
        nextReviewDate: input.nextReviewDate ?? null,
        createdBy: actor.id,
      })
      .returning();
    const [after] = await tx
      .update(opsPolicies)
      .set({ currentVersionId: version?.id ?? null })
      .where(eq(opsPolicies.id, policy.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'policy.created',
      entityType: 'policy',
      entityId: policy.id,
      after: { policy: after, version },
      requestId,
    });
    return after as PolicyRow;
  });
}

/** Edit register details (title, area, summary, accountable, owner decision). Not the text. */
export async function updatePolicy(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof updatePolicyBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  if (input.accountableStaffId)
    await activeStaff(db, input.accountableStaffId, 'accountableStaffId');
  return withTransaction(db, async (tx) => {
    const before = await lockPolicy(tx, id);
    if (before.status === 'retired')
      throw new ConflictError('A retired entry is read-only; record a new entry instead.');
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(opsPolicies)
      .set(patch as Partial<typeof opsPolicies.$inferInsert>)
      .where(eq(opsPolicies.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'policy.updated',
      entityType: 'policy',
      entityId: before.id,
      before,
      after,
      requestId,
    });
    return after as PolicyRow;
  });
}

/**
 * Save the text: edits the current DRAFT version, or starts a new version when
 * the current one is approved / rejected / superseded. Approved text is never
 * overwritten; a proposed version must be withdrawn first.
 */
export async function savePolicyDraft(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof policyDraftBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  const keys = dedupe(input.linkedSettingKeys);
  assertSettingKeys(keys);
  assertDates(input.effectiveDate, input.nextReviewDate);
  return withTransaction(db, async (tx) => {
    const policy = await lockPolicy(tx, id);
    const current = await versionOf(tx, policy.currentVersionId);
    if (current?.status === 'proposed')
      throw new InvalidStateTransitionError(
        'This version is awaiting approval; withdraw it before editing.',
      );
    const next = nextPolicyStatus(policy.status as PolicyStatus, 'save_draft', {
      hasApprovedVersion: Boolean(policy.approvedVersionId),
    });
    if (!next.ok) throw new InvalidStateTransitionError(next.message);
    const values = {
      requirementText: input.requirementText,
      sourceReference: input.sourceReference ?? null,
      linkedSettingKeys: keys,
      effectiveDate: input.effectiveDate ?? null,
      nextReviewDate: input.nextReviewDate ?? null,
      changeNote: input.changeNote ?? null,
    };
    let version: PolicyVersionRow | undefined;
    if (current && current.status === 'draft') {
      [version] = await tx
        .update(opsPolicyVersions)
        .set(values)
        .where(eq(opsPolicyVersions.id, current.id))
        .returning();
    } else {
      const [last] = await tx
        .select({ n: opsPolicyVersions.versionNumber })
        .from(opsPolicyVersions)
        .where(eq(opsPolicyVersions.policyId, policy.id))
        .orderBy(desc(opsPolicyVersions.versionNumber))
        .limit(1);
      [version] = await tx
        .insert(opsPolicyVersions)
        .values({
          ...values,
          policyId: policy.id,
          versionNumber: (last?.n ?? 0) + 1,
          status: 'draft',
          createdBy: actor.id,
        })
        .returning();
    }
    if (!version) throw new Error('policy version write returned no row');
    await tx
      .update(opsPolicies)
      .set({ currentVersionId: version.id, status: next.status })
      .where(eq(opsPolicies.id, policy.id));
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'policy.draft_saved',
      entityType: 'policy',
      entityId: policy.id,
      after: { versionId: version.id, versionNumber: version.versionNumber },
      requestId,
    });
    return version;
  });
}

export async function policyWorkflow(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof policyWorkflowBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  return withTransaction(db, async (tx) => {
    const policy = await lockPolicy(tx, id);
    const version = await versionOf(tx, policy.currentVersionId);
    if (!version) throw new InvalidStateTransitionError('This entry has no version yet.');
    const ctx = { hasApprovedVersion: Boolean(policy.approvedVersionId) };
    const audit = (action: string, after: unknown) =>
      recordAudit(tx, {
        actorUserId: actor.id,
        module: 'ops',
        action,
        entityType: 'policy',
        entityId: policy.id,
        after,
        requestId,
        metadata: { versionId: version.id, versionNumber: version.versionNumber },
      });
    const status = (action: Parameters<typeof nextPolicyStatus>[1]) => {
      const next = nextPolicyStatus(policy.status as PolicyStatus, action, ctx);
      if (!next.ok) throw new InvalidStateTransitionError(next.message);
      return next.status;
    };
    switch (input.action) {
      case 'propose': {
        if (version.status !== 'draft')
          throw new InvalidStateTransitionError('Only a draft version can be proposed.');
        const problems = policyProposalProblems({
          requirementText: version.requirementText,
          accountableStaffId: policy.accountableStaffId,
          effectiveDate: version.effectiveDate,
          nextReviewDate: version.nextReviewDate,
          linkedSettingKeys: version.linkedSettingKeys,
          isSettingKey,
        });
        if (problems.length)
          throw new ValidationError(problems.map((p) => POLICY_PROBLEM_LABELS[p]).join(' '), {
            details: { problems },
          });
        const s = status('propose');
        const approval = await requestApproval(tx, {
          policy: policyApprovalPolicy,
          subjectId: version.id,
          requestedBy: actor,
          comment: input.comment ?? null,
          requestId,
        });
        await tx
          .update(opsPolicyVersions)
          .set({
            status: 'proposed',
            proposedBy: actor.id,
            proposedAt: new Date(),
            approvalId: approval.id,
          })
          .where(eq(opsPolicyVersions.id, version.id));
        await tx.update(opsPolicies).set({ status: s }).where(eq(opsPolicies.id, policy.id));
        await audit('policy.proposed', { approvalId: approval.id });
        return { status: s, approvalId: approval.id };
      }
      case 'approve':
      case 'reject': {
        const pending = await findPendingApproval(tx, policyApprovalPolicy, version.id);
        if (!pending)
          throw new InvalidStateTransitionError('This version has no pending approval request.');
        const problems = policyApprovalProblems({
          versionStatus: version.status as PolicyVersionStatus,
          proposedByUserId: version.proposedBy,
          deciderUserId: actor.id,
        });
        if (problems.includes('self_approval'))
          throw new ForbiddenError('You proposed this version, so another person must decide it.');
        if (problems.length) throw new InvalidStateTransitionError('This version is not proposed.');
        await decideApproval(tx, {
          policy: policyApprovalPolicy,
          approvalId: pending.id,
          decider: actor,
          decision: input.action === 'approve' ? 'approved' : 'rejected',
          comment: input.comment ?? null,
          requestId,
        });
        const now = new Date();
        const s = status(input.action);
        if (input.action === 'approve') {
          if (policy.approvedVersionId)
            await tx
              .update(opsPolicyVersions)
              .set({ status: 'superseded' })
              .where(eq(opsPolicyVersions.id, policy.approvedVersionId));
          await tx
            .update(opsPolicyVersions)
            .set({
              status: 'approved',
              decidedBy: actor.id,
              decidedAt: now,
              decisionNote: input.comment ?? null,
            })
            .where(eq(opsPolicyVersions.id, version.id));
          await tx
            .update(opsPolicies)
            .set({ status: s, approvedVersionId: version.id })
            .where(eq(opsPolicies.id, policy.id));
        } else {
          await tx
            .update(opsPolicyVersions)
            .set({
              status: 'rejected',
              decidedBy: actor.id,
              decidedAt: now,
              decisionNote: input.comment,
            })
            .where(eq(opsPolicyVersions.id, version.id));
          await tx.update(opsPolicies).set({ status: s }).where(eq(opsPolicies.id, policy.id));
        }
        await audit(input.action === 'approve' ? 'policy.approved' : 'policy.rejected', {
          status: s,
        });
        return { status: s };
      }
      case 'withdraw': {
        const pending = await findPendingApproval(tx, policyApprovalPolicy, version.id);
        if (!pending) throw new InvalidStateTransitionError('Nothing is waiting for approval.');
        await withdrawApproval(tx, {
          policy: policyApprovalPolicy,
          approvalId: pending.id,
          actor,
          requestId,
        });
        const s = status('withdraw');
        await tx
          .update(opsPolicyVersions)
          .set({ status: 'draft', proposedBy: null, proposedAt: null, approvalId: null })
          .where(eq(opsPolicyVersions.id, version.id));
        await tx.update(opsPolicies).set({ status: s }).where(eq(opsPolicies.id, policy.id));
        await audit('policy.withdrawn', {});
        return { status: s };
      }
      case 'retire': {
        if (version.status === 'proposed')
          throw new InvalidStateTransitionError('Decide or withdraw the proposed version first.');
        status('retire');
        await tx
          .update(opsPolicies)
          .set({
            status: 'retired',
            retiredAt: new Date(),
            retiredBy: actor.id,
            retiredReason: input.reason,
          })
          .where(eq(opsPolicies.id, policy.id));
        await audit('policy.retired', { reason: input.reason });
        return { status: 'retired' as const };
      }
    }
  });
}
