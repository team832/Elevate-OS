/**
 * The manager side of end-of-day reports (owner brief 2 §10): the inbox of reports sent to the
 * reader (all reports for EOD reviewers), and review actions recorded as `eod_review_events`.
 * Acknowledging a report never completes its tasks; a follow-up is a new task (O1's service).
 */
import { and, count, desc, eq, gte, ilike, lte, ne, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  departments,
  opsEodReports as reports,
  opsEodReportVersions as versions,
  opsEodReviewEvents as reviewEvents,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { isImportedReport } from '../domain/eod';
import { KIND_LABELS, periodLabel } from '../domain/work-report';
import {
  accessScope,
  managedStaffIds,
  staffIdForUser,
  userIdsForStaff,
  type Actor,
} from './context';
import { audit, canReviewReport, ownReportPath, periodOfRow, readerOf } from './eod-reports';
import type { EodInboxQuery, EodReviewInput } from './eod-schemas';
import { rowById } from './ops-common';
import { hrScopeFor, hrScopeWhere } from './organisation';
import { notifyHosted } from './task-links';
import { createTask } from './staff-tasks';
import { taskBody } from './staff-tasks-schemas';

export const INBOX_PAGE_SIZE = 25;

export const REVIEW_LABELS: Record<EodReviewInput['kind'] | 'follow_up_task_created', string> = {
  viewed: 'Viewed',
  comment: 'Comment',
  clarification_requested: 'Clarification requested',
  revision_requested: 'Changes requested',
  acknowledged: 'Reviewed',
  follow_up_task_created: 'Follow-up task created',
};

/** Lock a report the actor may review (404 when they cannot read it at all). */
async function reviewable(tx: Database, actor: Actor, id: string) {
  const row = await rowById(tx, reports, id, 'Report', true);
  const self = await readerOf(tx, actor, row);
  if (row.staffId === self) throw new ForbiddenError('You cannot review your own report.');
  if (isImportedReport(row.snapshot))
    throw new InvalidStateTransitionError(
      'This report was imported from the old task tracker and was never sent, so it cannot be reviewed.',
    );
  if (!canReviewReport(actor, self, row)) {
    if (row.status === 'draft')
      throw new InvalidStateTransitionError('This report has not been submitted.');
    throw new ForbiddenError(
      'Only the person it was sent to, or an EOD reviewer, can review this report.',
    );
  }
  const [current] = await tx
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.reportId, row.id))
    .orderBy(desc(versions.version))
    .limit(1);
  return { row, versionId: current?.id ?? null };
}

/**
 * Record a review action. Revision request → `revision_requested` (the owner edits and
 * resubmits a new version); acknowledge → `acknowledged`. Both need a submitted report.
 * Viewing, and acknowledging twice, are recorded once.
 */
export async function reviewReport(
  db: Database,
  actor: Actor,
  id: string,
  input: EodReviewInput,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { row, versionId } = await reviewable(tx, actor, id);
    const once = input.kind === 'viewed' || input.kind === 'acknowledged';
    if (once) {
      const [seen] = await tx
        .select({ id: reviewEvents.id })
        .from(reviewEvents)
        .where(
          and(
            eq(reviewEvents.reportId, row.id),
            eq(reviewEvents.kind, input.kind),
            eq(reviewEvents.actorUserId, actor.id),
            versionId ? eq(reviewEvents.versionId, versionId) : undefined,
          ),
        )
        .limit(1);
      if (seen) return row;
    }
    if (
      (input.kind === 'revision_requested' || input.kind === 'acknowledged') &&
      row.status !== 'submitted'
    )
      throw new InvalidStateTransitionError(
        row.status === 'revision_requested'
          ? 'Changes were already requested; wait for the new version.'
          : 'This report was already reviewed.',
      );
    await tx.insert(reviewEvents).values({
      reportId: row.id,
      versionId,
      kind: input.kind,
      actorUserId: actor.id,
      text: input.text ?? null,
    });
    const set =
      input.kind === 'revision_requested'
        ? { status: 'revision_requested' as const }
        : input.kind === 'acknowledged'
          ? { status: 'acknowledged' as const, reviewedBy: actor.id, reviewedAt: new Date() }
          : null;
    const [after] = set
      ? await tx
          .update(reports)
          .set({ ...set, version: row.version + 1 })
          .where(eq(reports.id, row.id))
          .returning()
      : [row];
    if (input.kind !== 'viewed')
      await notifyHosted(
        tx,
        actor,
        await userIdsForStaff(tx, [row.staffId]),
        'work',
        ownReportPath(row),
        {
          kind: `eod.${input.kind}`,
          title: `${REVIEW_LABELS[input.kind]}: your ${KIND_LABELS[row.periodKind].toLowerCase()} report for ${periodLabel(periodOfRow(row))}`,
          body: input.text ?? null,
          entityType: 'eod_report',
          entityId: row.id,
        },
      );
    await audit(
      tx,
      actor,
      row.id,
      `eod_report.${input.kind}`,
      { metadata: { versionId, text: input.text ?? null } },
      requestId,
    );
    return after!;
  });
}

/** Create a follow-up task for the report's owner and record it on the report. */
export async function createFollowUp(
  db: Database,
  actor: Actor,
  id: string,
  input: { title: string; details?: string | null; dueOn?: string },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { row, versionId } = await reviewable(tx, actor, id);
    const task = await createTask(
      tx,
      actor,
      taskBody.parse({ ...input, staffId: row.staffId }),
      requestId,
    );
    await tx.insert(reviewEvents).values({
      reportId: row.id,
      versionId,
      kind: 'follow_up_task_created',
      actorUserId: actor.id,
      taskId: task.id,
    });
    await audit(
      tx,
      actor,
      row.id,
      'eod_report.follow_up_task_created',
      { metadata: { taskId: task.id } },
      requestId,
    );
    return task;
  });
}

/**
 * Submitted reports addressed to the reader (EOD reviewers: everyone's), newest day first, with
 * the inbox filters. Counts come from the latest submitted version; imported tracker reports
 * are flagged (never sent, not reviewable).
 */
export async function eodInbox(
  db: Database,
  actor: Actor,
  q: EodInboxQuery,
  pageSize = INBOX_PAGE_SIZE,
  /** HR view (ops:work_reports:read): the staff HR manages, never the reader's own reports. */
  { hr = false } = {},
) {
  await accessScope(db, actor, hr ? 'ops:work_reports:read' : 'ops:tasks:read');
  const self = await staffIdForUser(db, actor.id);
  // Counts come from the latest submitted version, never the owner's draft.
  const counts = sql<Record<string, number> | null>`${versions.snapshot}->'counts'`;
  const blocked = sql<number>`coalesce((${versions.snapshot}->'counts'->>'blocked')::int, 0)`;
  const current = and(
    eq(versions.reportId, reports.id),
    eq(versions.version, reports.currentVersion),
  );
  const where = and(
    ne(reports.status, 'draft'),
    hr
      ? and(hrScopeWhere(await hrScopeFor(db, actor)), self ? ne(reports.staffId, self) : undefined)
      : can(actor, 'ops:eod:review')
        ? undefined
        : self
          ? eq(reports.submittedToStaffId, self)
          : sql`false`,
    q.q ? ilike(staffMembers.fullName, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.from ? gte(reports.periodEnd, q.from) : undefined,
    q.to ? lte(reports.periodStart, q.to) : undefined,
    q.kind ? eq(reports.periodKind, q.kind) : undefined,
    q.staffId ? eq(reports.staffId, q.staffId as StaffMemberId) : undefined,
    q.departmentId ? eq(staffMembers.departmentId, q.departmentId as DepartmentId) : undefined,
    q.status ? eq(reports.status, q.status) : undefined,
    q.blockers ? sql`${blocked} > 0` : undefined,
  );
  const base = () =>
    db
      .select({
        id: reports.id,
        staffId: reports.staffId,
        staffName: staffMembers.fullName,
        department: departments.name,
        reportDate: reports.reportDate,
        periodKind: reports.periodKind,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        status: reports.status,
        currentVersion: reports.currentVersion,
        submittedAt: reports.submittedAt,
        reviewedAt: reports.reviewedAt,
        isSample: reports.isSample,
        counts,
        imported: sql<boolean>`coalesce(${versions.snapshot}->>'kind' = 'legacy_tracker_report', false)`,
      })
      .from(reports)
      .innerJoin(staffMembers, eq(staffMembers.id, reports.staffId))
      .leftJoin(versions, current)
      .leftJoin(departments, eq(departments.id, staffMembers.departmentId));
  const [rows, [total]] = await Promise.all([
    base()
      .where(where)
      .orderBy(desc(reports.periodStart), desc(reports.submittedAt))
      .limit(pageSize)
      .offset((q.page - 1) * pageSize),
    db
      .select({ n: count() })
      .from(reports)
      .innerJoin(staffMembers, eq(staffMembers.id, reports.staffId))
      .leftJoin(versions, current)
      .where(where),
  ]);
  return { rows, total: total?.n ?? 0, page: q.page, pageSize };
}

/** Show the Inbox tab: EOD reviewers, managers of anyone, or anyone a report was sent to. */
export async function hasInbox(db: Database, actor: Actor) {
  if (can(actor, 'ops:eod:review')) return true;
  const self = await staffIdForUser(db, actor.id);
  if (!self) return false;
  if ((await managedStaffIds(db, self)).length) return true;
  const [sent] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.submittedToStaffId, self))
    .limit(1);
  return Boolean(sent);
}
