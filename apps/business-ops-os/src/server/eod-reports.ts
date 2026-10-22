/**
 * End-of-day reports (owner brief 2 §9–11). One report per staff member and IST day; the row is
 * the working draft (facts rebuilt from task events and updates, plus the employee's narrative).
 * Submitting freezes an immutable version (`eod_report_versions`) addressed to the resolved
 * reporting manager — or, when none can be resolved, to an EOD reviewer the employee chooses
 * (recorded on the version only, never saved as a reporting line). A revision request reopens the
 * draft; resubmitting makes version n+1. Nothing is sent outside Elevate OS (no provider).
 */
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { can, grantsForRole, ROLE_KEYS } from '@elevate/authorization';
import {
  departments,
  opsEodReports as reports,
  opsEodReportVersions as versions,
  opsEodReviewEvents as reviewEvents,
  staffMembers,
  userRoles,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { istToday } from '../domain/dates';
import { factsMissingReasons, isEodFacts, isImportedReport, type EodFacts } from '../domain/eod';
import { fmtDate } from '../ui/format';
import { accessScope, managedStaffIds, notFound, staffIdForUser, type Actor } from './context';
import { collectFacts, factsHash } from './eod-facts';
import type { EodDraftInput } from './eod-schemas';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import { ownStaffId } from './staff-tasks';
import { notifyHosted } from './task-links';

type Row = typeof reports.$inferSelect;
export const audit = opsAudit('eod_report');
export const EXTERNAL_DELIVERY = 'External delivery not configured';
const EDITABLE: readonly Row['status'][] = ['draft', 'revision_requested'];

/** Submitted after the report day ended (IST). */
export const submittedLate = (r: Pick<Row, 'submittedAt' | 'reportDate'>) =>
  Boolean(r.submittedAt && istToday(r.submittedAt) > r.reportDate);

const manager = alias(staffMembers, 'manager');

/** Active staff with a login who hold ops:eod:review (the choice when no manager resolves). */
async function reviewerCandidates(db: Database, exceptStaffId: string) {
  const roles = ROLE_KEYS.filter((r) => grantsForRole(r).has('ops:eod:review'));
  return db
    .selectDistinct({
      staffId: staffMembers.id,
      name: staffMembers.fullName,
      userId: staffMembers.userId,
    })
    .from(staffMembers)
    .innerJoin(userRoles, eq(userRoles.userId, staffMembers.userId))
    .where(
      and(
        inArray(userRoles.role, roles),
        eq(staffMembers.status, 'active'),
        ne(staffMembers.id, exceptStaffId as StaffMemberId),
      ),
    )
    .orderBy(asc(staffMembers.fullName)) as Promise<
    { staffId: StaffMemberId; name: string; userId: UserId }[]
  >;
}

/**
 * Who a staff member's report goes to (§11): their reporting manager when active with a login;
 * otherwise why not, and the EOD reviewers they may choose from.
 */
export async function resolveRecipient(db: Database, staffId: string) {
  const [me] = await db
    .select({
      staffName: staffMembers.fullName,
      managerId: staffMembers.managerId,
      name: manager.fullName,
      status: manager.status,
      userId: manager.userId,
    })
    .from(staffMembers)
    .leftJoin(manager, eq(manager.id, staffMembers.managerId))
    .where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!me) notFound('Staff member');
  if (me.managerId && me.status === 'active' && me.userId)
    return {
      kind: 'manager' as const,
      staffName: me.staffName,
      staffId: me.managerId,
      name: me.name!,
      userId: me.userId,
    };
  const why = !me.managerId
    ? 'No reporting manager is set for you in the Staff directory.'
    : me.status !== 'active'
      ? `Your reporting manager, ${me.name}, is not active.`
      : `Your reporting manager, ${me.name}, cannot sign in.`;
  return {
    kind: 'choose' as const,
    staffName: me.staffName,
    why,
    candidates: await reviewerCandidates(db, staffId),
  };
}
export type Recipient = Awaited<ReturnType<typeof resolveRecipient>>;

/**
 * Who may read a report: its owner; all-scope task readers; whoever a version was submitted
 * to; and, when `eod.manager_history` is `current_team_all`, the current manager chain (R3).
 * Drafts are the owner's (and all-scope readers'). Anyone else gets 404.
 */
export async function readerOf(db: Database, actor: Actor, row: Row) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const self = await staffIdForUser(db, actor.id);
  if (row.staffId === self || access.scope === 'all') return self;
  if (self && row.status !== 'draft') {
    const sent = await db
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.reportId, row.id), eq(versions.submittedToStaffId, self)))
      .limit(1);
    if (sent.length) return self;
    const history = (await loadSettings(db))['eod.manager_history'].value.scope;
    if (history === 'current_team_all' && (await managedStaffIds(db, self)).includes(row.staffId))
      return self;
  }
  notFound('Report');
}

/**
 * Can this reader act on a submitted report: an EOD reviewer, or the person it was sent to.
 * Imported tracker reports were never sent, so nobody reviews them.
 */
export const canReviewReport = (actor: Actor, self: string | null, r: Row) =>
  r.status !== 'draft' &&
  !isImportedReport(r.snapshot) &&
  r.staffId !== self &&
  (can(actor, 'ops:eod:review') || (self !== null && r.submittedToStaffId === self));

/**
 * A report with its versions, review trail and names. `checkSource` rebuilds the facts to flag
 * "Source changed since submission" (costs a rebuild and an Academic call).
 */
export async function getReport(
  db: Database,
  actor: Actor,
  id: string,
  options: { checkSource?: boolean } = {},
) {
  const row = await rowById(db, reports, id, 'Report');
  const self = await readerOf(db, actor, row);
  const [[owner], versionRows, trail] = await Promise.all([
    db
      .select({
        fullName: staffMembers.fullName,
        department: departments.name,
        managerName: manager.fullName,
      })
      .from(staffMembers)
      .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
      .leftJoin(manager, eq(manager.id, staffMembers.managerId))
      .where(eq(staffMembers.id, row.staffId)),
    db.select().from(versions).where(eq(versions.reportId, row.id)).orderBy(asc(versions.version)),
    db
      .select({ event: reviewEvents, actorName: staffMembers.fullName })
      .from(reviewEvents)
      .leftJoin(staffMembers, eq(staffMembers.userId, reviewEvents.actorUserId))
      .where(eq(reviewEvents.reportId, row.id))
      .orderBy(desc(reviewEvents.createdAt)),
  ]);
  const ids = [
    ...new Set(versionRows.map((v) => v.submittedToStaffId).filter(Boolean)),
  ] as StaffMemberId[];
  const names = ids.length
    ? await db
        .select({ id: staffMembers.id, name: staffMembers.fullName })
        .from(staffMembers)
        .where(inArray(staffMembers.id, ids))
    : [];
  const nameOf = (s: string | null) => names.find((n) => n.id === s)?.name ?? null;
  const current = versionRows.at(-1) ?? null;
  const facts = (current?.snapshot ?? row.snapshot) as EodFacts;
  const sourceChanged =
    options.checkSource && current && isEodFacts(current.snapshot)
      ? factsHash(await collectFacts(db, row.staffId, row.reportDate)) !==
        factsHash(current.snapshot)
      : null;
  const isOwner = row.staffId === self;
  return {
    // Others read only what was sent: never the owner's unsubmitted rewrite during a revision.
    ...(isOwner || !current ? row : { ...row, ...current.narrative, snapshot: current.snapshot }),
    staffName: owner?.fullName ?? 'Name not on record',
    department: owner?.department ?? null,
    managerName: owner?.managerName ?? null,
    imported: isImportedReport(row.snapshot),
    late: submittedLate(row),
    isOwner,
    canReview: canReviewReport(actor, self, row),
    facts,
    versions: versionRows.map((v) => ({ ...v, recipientName: nameOf(v.submittedToStaffId) })),
    current: current ? { ...current, recipientName: nameOf(current.submittedToStaffId) } : null,
    trail: trail.map((t) => ({ ...t.event, actorName: t.actorName })),
    sourceChanged,
  };
}
export type EodReportView = Awaited<ReturnType<typeof getReport>>;

/** The caller's report for a day (null when not started), its recipient and fresh facts. */
export async function eodContext(db: Database, actor: Actor, day: string) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const [[row], recipient, facts] = await Promise.all([
    db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.staffId, staffId), eq(reports.reportDate, day))),
    resolveRecipient(db, staffId),
    collectFacts(db, staffId, day),
  ]);
  const report = row ? await getReport(db, actor, row.id) : null;
  const sent = report?.current?.snapshot;
  return {
    report: report && {
      ...report,
      sourceChanged: isEodFacts(sent) ? factsHash(facts) !== factsHash(sent) : null,
    },
    recipient,
    facts,
  };
}

/**
 * Build or refresh the caller's draft for a day (facts rebuilt; narrative saved when given).
 * Only a draft or a report sent back for revision can change; `version` guards concurrent edits.
 */
export async function saveDraft(
  db: Database,
  actor: Actor,
  input: EodDraftInput,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  const staffId = await ownStaffId(db, actor);
  if (input.reportDate > istToday(new Date()))
    throw fieldError('reportDate', 'A report can be for today or an earlier day only.');
  const facts = await collectFacts(db, staffId, input.reportDate);
  const narrative = Object.fromEntries(
    (['summary', 'nextDayPlan', 'notes'] as const)
      .filter((k) => input[k] !== undefined)
      .map((k) => [k, input[k] ?? null]),
  );
  return withTransaction(db, async (tx) => {
    const [cur] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.staffId, staffId), eq(reports.reportDate, input.reportDate)))
      .for('update');
    if (cur && !EDITABLE.includes(cur.status))
      throw new ConflictError(
        'This report was submitted and cannot be changed. Your manager can ask for a revision.',
      );
    if (cur && input.version !== undefined && cur.version !== input.version)
      throw new ConflictError(
        'This report was changed in another tab or window. Reload the page to see the latest version.',
      );
    const [row] = cur
      ? await tx
          .update(reports)
          .set({ snapshot: facts, ...narrative, version: cur.version + 1 })
          .where(eq(reports.id, cur.id))
          .returning()
      : await tx
          .insert(reports)
          .values({
            staffId,
            reportDate: input.reportDate,
            snapshot: facts,
            ...narrative,
            createdBy: actor.id,
          })
          .onConflictDoNothing()
          .returning();
    if (!row)
      throw new ConflictError('This report was just started in another tab. Reload the page.');
    await audit(
      tx,
      actor,
      row.id,
      'eod_report.drafted',
      { after: { ...narrative, counts: facts.counts } },
      requestId,
    );
    return row;
  });
}

/**
 * Submit the caller's report: rebuild the facts, refuse while an open task due by the report
 * day has no reason, and freeze version n+1 for the resolved recipient (in-app notification).
 * Submitting an already submitted report returns its current version (double click, retry).
 */
export async function submitReport(
  db: Database,
  actor: Actor,
  id: string,
  body: { recipientStaffId?: string; expectedVersion?: number },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  const staffId = await ownStaffId(db, actor);
  const pre = await rowById(db, reports, id, 'Report');
  if (pre.staffId !== staffId) notFound('Report');
  const [facts, recipient] = await Promise.all([
    collectFacts(db, staffId, pre.reportDate),
    resolveRecipient(db, staffId),
  ]);
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, reports, id, 'Report', true);
    const [last] = await tx
      .select()
      .from(versions)
      .where(eq(versions.reportId, row.id))
      .orderBy(desc(versions.version))
      .limit(1);
    if (!EDITABLE.includes(row.status)) return { ...row, submittedVersion: last!, replayed: true };
    if (body.expectedVersion !== undefined && body.expectedVersion !== row.version)
      throw new ConflictError(
        'This report was changed in another tab or window. Reload the page and check it before submitting.',
      );
    const to =
      recipient.kind === 'manager'
        ? recipient
        : recipient.candidates.find((c) => c.staffId === body.recipientStaffId);
    if (
      recipient.kind === 'manager' &&
      body.recipientStaffId &&
      body.recipientStaffId !== recipient.staffId
    )
      throw fieldError(
        'recipientStaffId',
        `Reports go to your reporting manager, ${recipient.name}.`,
      );
    if (!to)
      throw fieldError(
        'recipientStaffId',
        recipient.kind === 'choose' && recipient.candidates.length
          ? `${recipient.why} Choose who receives this report.`
          : 'No one can receive this report yet. Ask an operations manager to set your reporting manager.',
      );
    const missing = factsMissingReasons(facts);
    if (missing.length)
      throw new ValidationError(
        `Add a reason to each task that is not done: ${missing.map((t) => t.title).join(', ')}.`,
        {
          details: missing.map((t) => ({
            location: 'body',
            path: ['tasks', t.taskId],
            message: `${t.title}: reason needed`,
          })),
        },
      );
    const [request] =
      row.status === 'revision_requested'
        ? await tx
            .select({ id: reviewEvents.id })
            .from(reviewEvents)
            .where(
              and(eq(reviewEvents.reportId, row.id), eq(reviewEvents.kind, 'revision_requested')),
            )
            .orderBy(desc(reviewEvents.createdAt))
            .limit(1)
        : [];
    const [version] = await tx
      .insert(versions)
      .values({
        reportId: row.id,
        version: row.currentVersion + 1,
        snapshot: facts,
        narrative: { summary: row.summary, nextDayPlan: row.nextDayPlan, notes: row.notes },
        sourceCutoffAt: new Date(facts.generatedAt),
        submittedByUserId: actor.id,
        submittedToStaffId: to.staffId,
        revisionOfVersionId: last?.id ?? null,
        revisionRequestEventId: request?.id ?? null,
      })
      .returning();
    const [after] = await tx
      .update(reports)
      .set({
        status: 'submitted',
        snapshot: facts,
        submittedAt: version!.submittedAt,
        submittedToStaffId: to.staffId,
        currentVersion: version!.version,
        version: row.version + 1,
        reviewedBy: null,
        reviewedAt: null,
      })
      .where(eq(reports.id, row.id))
      .returning();
    const c = facts.counts;
    await notifyHosted(tx, actor, [to.userId], 'work', `/tasks/inbox?open=${row.id}`, {
      kind: 'eod.submitted',
      title: `End-of-day report: ${recipient.staffName}, ${fmtDate(row.reportDate)}${version!.version > 1 ? ` (version ${version!.version})` : ''}`,
      body: `${c.completed} completed, ${c.backlog} open at cut-off (${c.overdue} overdue), ${c.blocked} blocked.`,
      entityType: 'eod_report',
      entityId: row.id,
    });
    await audit(
      tx,
      actor,
      row.id,
      'eod_report.submitted',
      {
        after: { version: version!.version, submittedToStaffId: to.staffId, counts: c },
        metadata: { recipientChosen: recipient.kind === 'choose' },
      },
      requestId,
    );
    return { ...after!, submittedVersion: version!, replayed: false };
  });
}
