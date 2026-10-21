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
 * Sources: annual fee agreement versions (D-039; decided here through the same decide function
 * as the student's fee section) and the older admission-level fee arrangements. The SOP, task
 * review, policy and HR sources were removed with HR and Operations (D-032).
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can, type Permission } from '@elevate/authorization';
import {
  approvals,
  opsAdmissions,
  opsFeePlans,
  opsLeads,
  students,
  users,
  type Database,
} from '@elevate/database';
import type { UserId } from '@elevate/shared-types';
import { ownAdmissionFilter } from './admissions';
import { feeAgreementPolicy, feeArrangementPolicy } from './approval-policies';
import { accessScope, type Actor } from './context';

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
  /** API path that decides it from the inbox (approve / reject), when the source allows that. */
  decide?: string;
  /** False when the decision is possible but something must happen first (shown, not hidden). */
  ready: boolean;
  blockers: string[];
  /** Tuition before → after (before null = a new agreement); only with ops:fees:read. */
  beforePaise?: number | null;
  afterPaise?: number;
}

export interface ApprovalSource {
  key: string;
  label: string;
  /** Permission needed to see this source at all (anyOf when an array). */
  permission: Permission | readonly Permission[];
  list(db: Database, actor: Actor): Promise<ApprovalInboxItem[]>;
}

/** What the actor may see of a request: the student's name, and amounts (a request comment may name them). */
const visibility = (actor: Actor) => ({
  named: can(actor, 'ops:students:read'),
  amounts: can(actor, 'ops:fees:read'),
});
const HIDDEN_NAME = 'Student (name hidden)';

const holdsSourcePermission = (actor: Actor, p: ApprovalSource['permission']) =>
  (Array.isArray(p) ? p : [p]).some((x: Permission) => can(actor, x));

/** An inbox item; ready with no blockers unless the source says otherwise. */
const inboxItem = (
  i: Omit<ApprovalInboxItem, 'requestedAt' | 'ready' | 'blockers'> &
    Partial<Pick<ApprovalInboxItem, 'ready' | 'blockers'>> & { requestedAt: Date },
): ApprovalInboxItem => ({
  ...i,
  requestedAt: i.requestedAt.toISOString(),
  ready: i.ready ?? true,
  blockers: i.blockers ?? [],
});

// --- core sources --------------------------------------------------------------------------------

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
    const { named, amounts } = visibility(actor);
    return rows
      .filter(({ a }) => a.requestedBy !== actor.id)
      .map(({ a, code, admissionId, student, requester }) =>
        inboxItem({
          id: a.id,
          title: `${code} — ${named ? student : HIDDEN_NAME}`,
          detail: amounts ? a.requestComment : null,
          requestedByUserId: a.requestedBy,
          requestedByName: requester,
          requestedAt: a.requestedAt,
          link: `/ops/admissions/${admissionId}`,
        }),
      );
  },
};

const previous = alias(opsFeePlans, 'previous_plan');

/** Draft agreement versions waiting for their own approval; never listed to their maker. */
export const feeAgreementSource: ApprovalSource = {
  key: 'ops.fee_agreements',
  label: 'Fee agreements awaiting approval',
  permission: 'ops:admissions:approve',
  async list(db, actor) {
    const access = await accessScope(db, actor, 'ops:admissions:approve');
    const rows = await db
      .select({
        a: approvals,
        plan: opsFeePlans,
        before: previous.totalPaise,
        student: students.fullName,
        requester: users.displayName,
      })
      .from(approvals)
      .innerJoin(opsFeePlans, eq(opsFeePlans.id, approvals.subjectId))
      .leftJoin(previous, eq(previous.id, opsFeePlans.supersedesPlanId))
      .innerJoin(students, eq(students.id, opsFeePlans.studentId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .innerJoin(users, eq(users.id, approvals.requestedBy))
      .where(
        and(
          eq(approvals.policy, feeAgreementPolicy.key),
          eq(approvals.status, 'pending'),
          eq(opsFeePlans.status, 'draft'),
          ne(opsFeePlans.createdBy, actor.id),
          ne(approvals.requestedBy, actor.id),
          ownAdmissionFilter(access),
        ),
      )
      .orderBy(asc(approvals.requestedAt));
    const { named, amounts } = visibility(actor);
    return rows.map(({ a, plan, before, student, requester }) =>
      inboxItem({
        id: a.id,
        title: `${named ? student : HIDDEN_NAME}: fee agreement ${plan.academicYear ?? '(year not recorded)'}, version ${plan.version}`,
        detail: amounts ? a.requestComment : null,
        ...(amounts && { beforePaise: before, afterPaise: plan.totalPaise }),
        requestedByUserId: a.requestedBy,
        requestedByName: requester,
        requestedAt: a.requestedAt,
        link: `/ops/students/${plan.studentId}?tab=fees`,
        decide: `/ops/api/v1/fee-plans/${plan.id}/decision`,
      }),
    );
  },
};

/** The registry used by the inbox and the dashboards. Each source follows the rules above. */
export const APPROVAL_SOURCES: readonly ApprovalSource[] = [
  feeAgreementSource,
  feeArrangementSource,
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
    const { key, label } = source;
    try {
      const items = (await source.list(db, actor)).filter((i) => i.requestedByUserId !== actor.id);
      results.push({ key, label, status: 'ok', count: items.length, items });
    } catch (error) {
      console.error('approval source failed', key, error);
      results.push({
        key,
        label,
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
