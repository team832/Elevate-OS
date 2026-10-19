/**
 * Approvals inbox (OPS-068): everything waiting for the signed-in user's
 * decision that they are permitted to make, from pluggable sources.
 *
 * Rules every source must keep:
 * - list only items this actor may decide (permission AND record-level rules);
 * - never list the actor's own request (no self-approval) — the inbox also
 *   drops any item whose `requestedByUserId` is the actor, as a second guard;
 * - link to the record where the decision is taken (the inbox decides nothing).
 * A source that throws is shown as "unavailable" (never as 0 items).
 *
 * HR sources (leave, attendance corrections, requisitions, offers, lifecycle
 * cases, compensation drafts, document deletions) live in `./hr/approval-sources`.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import {
  approvals,
  opsAdmissions,
  opsLeads,
  opsPolicies,
  opsPolicyVersions,
  opsSops,
  opsSopVersions,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { UserId } from '@elevate/shared-types';
import { SOP_APPROVAL_PROBLEM_LABELS, sopApprovalProblems } from '../domain';
import { feeArrangementPolicy, sopApprovalPolicy } from './approval-policies';
import { accessScope, staffIdForUser, type Actor } from './context';
import { HR_APPROVAL_SOURCES } from './hr/approval-sources';
import { policyApprovalPolicy } from './policies-register';
import { hashContent } from './sops';
import { listTaskReviewsForDecider } from './tasks';

export interface ApprovalInboxItem {
  /** Stable id of the thing to decide (approval id, review id, version id). */
  id: string;
  title: string;
  detail: string | null;
  requestedByUserId: UserId | null;
  requestedByName: string | null;
  /** ISO instant (UTC). */
  requestedAt: string;
  /** In-module browser path where the decision is taken. */
  link: string;
  /** False when the decision is possible but something must happen first (shown, not hidden). */
  ready: boolean;
  blockers: string[];
}

export interface ApprovalSource {
  key: string;
  label: string;
  /** Permission needed to see this source at all (anyOf when an array). */
  permission: Permission | readonly Permission[];
  list(db: Database, actor: Actor): Promise<ApprovalInboxItem[]>;
}

const holdsSourcePermission = (actor: Actor, p: ApprovalSource['permission']) =>
  (Array.isArray(p) ? p : [p]).some((x: Permission) => can(actor, x));

const iso = (d: Date) => d.toISOString();

// --- core sources --------------------------------------------------------------------------------

export const sopVersionApprovalSource: ApprovalSource = {
  key: 'ops.sop_versions',
  label: 'SOP versions awaiting approval',
  permission: 'ops:sops:approve',
  async list(db, actor) {
    const rows = await db
      .select({ a: approvals, v: opsSopVersions, sop: opsSops, requester: users.displayName })
      .from(approvals)
      .innerJoin(opsSopVersions, eq(opsSopVersions.id, approvals.subjectId))
      .innerJoin(opsSops, eq(opsSops.id, opsSopVersions.sopId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(and(eq(approvals.policy, sopApprovalPolicy.key), eq(approvals.status, 'pending')))
      .orderBy(asc(approvals.requestedAt));
    const staff = await db
      .select({ id: staffMembers.id, userId: staffMembers.userId })
      .from(staffMembers);
    const userOf = (sid: string | null) => staff.find((s) => s.id === sid)?.userId ?? null;
    const out: ApprovalInboxItem[] = [];
    for (const { a, v, sop, requester } of rows) {
      if (a.requestedBy === actor.id) continue;
      const problems = sopApprovalProblems({
        versionStatus: v.status as 'in_review',
        ownerStaffId: sop.ownerStaffId,
        ownerUserId: userOf(sop.ownerStaffId),
        reviewerStaffId: sop.reviewerStaffId,
        reviewerUserId: userOf(sop.reviewerStaffId),
        review:
          v.reviewedBy && v.reviewOutcome
            ? { byUserId: v.reviewedBy, outcome: v.reviewOutcome }
            : null,
        deciderUserId: actor.id,
        submittedHash: v.contentHash,
        currentHash: hashContent(v.content),
      });
      // The owner can never approve their own SOP: not their item to decide.
      if (problems.includes('approver_is_owner')) continue;
      out.push({
        id: a.id,
        title: `${sop.code} ${sop.title} — version ${v.versionLabel}`,
        detail: a.requestComment,
        requestedByUserId: a.requestedBy,
        requestedByName: requester,
        requestedAt: iso(a.requestedAt),
        link: `/ops/sops/${sop.id}`,
        ready: problems.length === 0,
        blockers: problems.map((p) => SOP_APPROVAL_PROBLEM_LABELS[p]),
      });
    }
    return out;
  },
};

export const sopReviewSource: ApprovalSource = {
  key: 'ops.sop_reviews',
  label: 'SOP versions waiting for your review',
  permission: 'ops:sops:read',
  async list(db, actor) {
    const me = await staffIdForUser(db, actor.id);
    if (!me) return [];
    const rows = await db
      .select({ v: opsSopVersions, sop: opsSops, a: approvals, requester: users.displayName })
      .from(opsSopVersions)
      .innerJoin(opsSops, eq(opsSops.id, opsSopVersions.sopId))
      .innerJoin(approvals, eq(approvals.id, opsSopVersions.approvalId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(
        and(
          eq(opsSopVersions.status, 'in_review'),
          eq(opsSops.reviewerStaffId, me),
          isNull(opsSopVersions.reviewOutcome),
          eq(approvals.status, 'pending'),
        ),
      )
      .orderBy(asc(approvals.requestedAt));
    return rows
      .filter(({ a }) => a.requestedBy !== actor.id)
      .map(({ v, sop, a, requester }) => ({
        id: v.id,
        title: `${sop.code} ${sop.title} — version ${v.versionLabel}`,
        detail: 'Record a review: recommend approval or request changes.',
        requestedByUserId: a.requestedBy,
        requestedByName: requester,
        requestedAt: iso(a.requestedAt),
        link: `/ops/sops/${sop.id}`,
        ready: true,
        blockers: [],
      }));
  },
};

export const feeArrangementSource: ApprovalSource = {
  key: 'ops.fee_arrangements',
  label: 'Fee arrangements awaiting approval',
  permission: 'ops:admissions:approve',
  async list(db, actor) {
    await accessScope(db, actor, 'ops:admissions:approve');
    const rows = await db
      .select({
        a: approvals,
        code: opsAdmissions.code,
        admissionId: opsAdmissions.id,
        student: opsLeads.studentName,
        requester: users.displayName,
      })
      .from(approvals)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, approvals.subjectId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(and(eq(approvals.policy, feeArrangementPolicy.key), eq(approvals.status, 'pending')))
      .orderBy(asc(approvals.requestedAt));
    return rows
      .filter(({ a }) => a.requestedBy !== actor.id)
      .map(({ a, code, admissionId, student, requester }) => ({
        id: a.id,
        title: `${code} — ${student}`,
        detail: a.requestComment,
        requestedByUserId: a.requestedBy,
        requestedByName: requester,
        requestedAt: iso(a.requestedAt),
        link: `/ops/admissions/${admissionId}`,
        ready: true,
        blockers: [],
      }));
  },
};

export const taskReviewSource: ApprovalSource = {
  key: 'ops.task_reviews',
  label: 'Completed tasks waiting for your review',
  permission: 'ops:tasks:write',
  async list(db, actor) {
    const rows = await listTaskReviewsForDecider(db, actor);
    return rows.map(({ review, task, submitterName }) => ({
      id: review.id,
      title: `${task.code} ${task.title}`,
      detail: task.completionNote ?? (task.evidenceLink ? `Evidence: ${task.evidenceLink}` : null),
      requestedByUserId: review.submittedBy,
      requestedByName: submitterName,
      requestedAt: iso(review.submittedAt),
      link: `/ops/tasks/${task.id}`,
      ready: true,
      blockers: [],
    }));
  },
};

export const policyVersionApprovalSource: ApprovalSource = {
  key: 'ops.policy_versions',
  label: 'Company policy versions awaiting approval',
  permission: 'ops:policies:approve',
  async list(db, actor) {
    const rows = await db
      .select({ a: approvals, v: opsPolicyVersions, p: opsPolicies, requester: users.displayName })
      .from(approvals)
      .innerJoin(opsPolicyVersions, eq(opsPolicyVersions.id, approvals.subjectId))
      .innerJoin(opsPolicies, eq(opsPolicies.id, opsPolicyVersions.policyId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(and(eq(approvals.policy, policyApprovalPolicy.key), eq(approvals.status, 'pending')))
      .orderBy(asc(approvals.requestedAt));
    return rows
      .filter(({ a, v }) => a.requestedBy !== actor.id && v.proposedBy !== actor.id)
      .map(({ a, v, p, requester }) => ({
        id: a.id,
        title: `${p.code} ${p.title} — version ${v.versionNumber}`,
        detail: a.requestComment,
        requestedByUserId: a.requestedBy,
        requestedByName: requester,
        requestedAt: iso(a.requestedAt),
        link: `/ops/settings/policies/${p.id}`,
        ready: true,
        blockers: [],
      }));
  },
};

/** Sources implemented by the operations area. */
export const CORE_APPROVAL_SOURCES: readonly ApprovalSource[] = [
  sopVersionApprovalSource,
  sopReviewSource,
  feeArrangementSource,
  taskReviewSource,
  policyVersionApprovalSource,
];

/** The registry used by the inbox and the dashboards. Each source follows the rules above. */
export const APPROVAL_SOURCES: readonly ApprovalSource[] = [
  ...CORE_APPROVAL_SOURCES,
  ...HR_APPROVAL_SOURCES,
];

export interface InboxSourceResult {
  key: string;
  label: string;
  status: 'ok' | 'unavailable';
  /** null when unavailable (missing is not zero). */
  count: number | null;
  items: ApprovalInboxItem[];
  error?: string;
}

/** The signed-in user's inbox. Sources they lack permission for are omitted entirely. */
export async function listApprovalInbox(
  db: Database,
  actor: Actor,
  sources: readonly ApprovalSource[] = APPROVAL_SOURCES,
): Promise<{ sources: InboxSourceResult[]; total: number | null; unavailable: number }> {
  await accessScope(db, actor, 'ops:module:access');
  const results: InboxSourceResult[] = [];
  for (const source of sources) {
    if (!holdsSourcePermission(actor, source.permission)) continue;
    try {
      const items = (await source.list(db, actor)).filter((i) => i.requestedByUserId !== actor.id);
      results.push({
        key: source.key,
        label: source.label,
        status: 'ok',
        count: items.length,
        items,
      });
    } catch (error) {
      console.error('approval source failed', source.key, error);
      results.push({
        key: source.key,
        label: source.label,
        status: 'unavailable',
        count: null,
        items: [],
        error: 'This list could not be loaded. Try again; if it persists, tell an administrator.',
      });
    }
  }
  const unavailable = results.filter((r) => r.status === 'unavailable').length;
  const total = results.reduce((n, r) => n + (r.count ?? 0), 0);
  return {
    sources: results,
    total: unavailable === results.length && results.length ? null : total,
    unavailable,
  };
}
