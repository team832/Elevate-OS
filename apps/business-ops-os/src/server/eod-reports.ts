/**
 * End-of-day reports (owner decision 21 Oct 2026): a staff member builds the day's report from
 * their tasks (domain/staff-tasks.ts A-TSK-4), adds a summary and submits it to their reporting
 * manager (core.staff_members.manager_id), who gets an in-app notification. Sharing by WhatsApp or
 * email goes through the mock messaging adapter: "Simulated — not sent". One report per staff
 * member and day; the snapshot is frozen once submitted.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { can, grantsForRole, ROLE_KEYS } from '@elevate/authorization';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditEvents,
  opsEodReports as reports,
  opsStaffTasks as tasks,
  staffMembers,
  userRoles,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain/dates';
import {
  buildEodSnapshot,
  missingReasons,
  TASK_STATUS_LABELS,
  type EodItem,
  type EodSnapshot,
} from '../domain/staff-tasks';
import { fmtDate, fmtDateTime } from '../ui/format';
import { getMessagingAdapter } from './adapters/messaging';
import { accessScope, notFound, scopeCovers, staffIdForUser, type Actor } from './context';
import { fieldError, notifyOthers, opsAudit, rowById } from './ops-common';
import { createPdf } from './pdf/document';
import { dayTasks, ownStaffId } from './staff-tasks';

type Row = typeof reports.$inferSelect;
const audit = opsAudit('eod_report');
export const SIMULATED = 'Simulated — not sent. No WhatsApp or email provider is connected.';

const snapshotOf = (r: Row) => r.snapshot as EodSnapshot;

/** Submitted after the report day ended (IST). */
export const submittedLate = (r: Pick<Row, 'submittedAt' | 'reportDate'>) =>
  Boolean(r.submittedAt && istToday(r.submittedAt) > r.reportDate);

/** Reader: own reports, reports addressed to the reader, or everyone's with all scope. */
async function readable(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:tasks:read');
  const [row] = await db
    .select({ report: reports, staffName: staffMembers.fullName })
    .from(reports)
    .innerJoin(staffMembers, eq(staffMembers.id, reports.staffId))
    .where(eq(reports.id, id as Row['id']))
    .limit(1);
  if (!row) notFound('Report');
  const addressed =
    access.scope === 'own' &&
    row.report.status === 'submitted' &&
    row.report.submittedToStaffId === access.staffId;
  if (!addressed && !scopeCovers(access, [row.report.staffId])) notFound('Report');
  return { ...row.report, staffName: row.staffName };
}

/** A report with its staff name, manager name and simulated shares. */
export async function getReport(db: Database, actor: Actor, id: string) {
  const r = await readable(db, actor, id);
  const [self, manager, shares] = await Promise.all([
    staffIdForUser(db, actor.id),
    r.submittedToStaffId
      ? db
          .select({ fullName: staffMembers.fullName })
          .from(staffMembers)
          .where(eq(staffMembers.id, r.submittedToStaffId))
      : [],
    db
      .select({ at: auditEvents.at, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'eod_report'),
          eq(auditEvents.entityId, r.id),
          eq(auditEvents.action, 'eod_report.shared'),
        ),
      )
      .orderBy(desc(auditEvents.at)),
  ]);
  return {
    ...r,
    snapshot: snapshotOf(r),
    late: submittedLate(r),
    managerName: manager[0]?.fullName ?? null,
    shares,
    canReview:
      r.status === 'submitted' &&
      !r.reviewedAt &&
      r.staffId !== self &&
      (can(actor, 'ops:eod:review') || (self !== null && r.submittedToStaffId === self)),
  };
}

const manager = alias(staffMembers, 'manager');

/** Where a staff member's report goes: their active reporting manager with a login, else none. */
async function submitTarget(db: Database, staffId: StaffMemberId) {
  const [row] = await db
    .select({
      fullName: staffMembers.fullName,
      managerId: manager.id,
      managerName: manager.fullName,
      managerUserId: manager.userId,
    })
    .from(staffMembers)
    .leftJoin(
      manager,
      and(
        eq(manager.id, staffMembers.managerId),
        eq(manager.status, 'active'),
        isNotNull(manager.userId),
      ),
    )
    .where(eq(staffMembers.id, staffId));
  return row!;
}

/** The caller's report for a day (null when not started) and who it goes to; null without a staff record. */
export async function eodContext(db: Database, actor: Actor, day: string) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const [[row], target] = await Promise.all([
    db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.staffId, staffId), eq(reports.reportDate, day))),
    submitTarget(db, staffId),
  ]);
  return {
    report: row ? await getReport(db, actor, row.id) : null,
    managerName: target.managerName,
  };
}

/** Build or refresh the caller's draft for a day; `summary` is saved when given. */
export async function saveDraft(
  db: Database,
  actor: Actor,
  input: { reportDate: string; summary?: string | null },
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  const staffId = await ownStaffId(db, actor);
  const now = new Date();
  if (input.reportDate > istToday(now))
    throw fieldError('reportDate', 'A report can be for today or an earlier day only.');
  return withTransaction(db, async (tx) => {
    const snapshot = buildEodSnapshot(
      await dayTasks(tx, staffId, input.reportDate),
      input.reportDate,
      now,
    );
    const [row] = await tx
      .insert(reports)
      .values({
        staffId,
        reportDate: input.reportDate,
        snapshot,
        summary: input.summary ?? null,
        createdBy: actor.id,
      })
      .onConflictDoUpdate({
        target: [reports.staffId, reports.reportDate],
        set: { snapshot, ...(input.summary !== undefined && { summary: input.summary }) },
        setWhere: eq(reports.status, 'draft'),
      })
      .returning();
    if (!row) throw new ConflictError('This report was already submitted and cannot be changed.');
    await audit(
      tx,
      actor,
      row.id,
      'eod_report.drafted',
      { after: { summary: row.summary, counts: snapshot.counts } },
      requestId,
    );
    return { ...row, snapshot };
  });
}

/** Users who hold ops:eod:review (the fallback when a staff member has no reporting manager). */
async function reviewerUserIds(db: Database) {
  const roles = ROLE_KEYS.filter((r) => grantsForRole(r).has('ops:eod:review'));
  const rows = await db
    .selectDistinct({ userId: userRoles.userId })
    .from(userRoles)
    .where(inArray(userRoles.role, roles));
  return rows.map((r) => r.userId);
}

/**
 * Submit the caller's report: refresh the snapshot, refuse while a task listed as not done has no
 * reason, freeze it and notify the reporting manager in-app (no manager with a login: the EOD
 * reviewers).
 */
export async function submitReport(db: Database, actor: Actor, id: string, requestId?: string) {
  await accessScope(db, actor, 'ops:tasks:write');
  const staffId = await ownStaffId(db, actor);
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, reports, id, 'Report', true);
    if (row.staffId !== staffId) notFound('Report');
    if (row.status === 'submitted') throw new ConflictError('This report was already submitted.');
    const snapshot = buildEodSnapshot(
      await dayTasks(tx, staffId, row.reportDate),
      row.reportDate,
      new Date(),
    );
    const missing = missingReasons(snapshot);
    if (missing.length)
      throw new ValidationError(
        `Add a reason to each task that is not done: ${missing.map((t) => t.title).join(', ')}.`,
        {
          details: missing.map((t) => ({
            location: 'body',
            path: ['tasks', t.id],
            message: `${t.title}: reason needed`,
          })),
        },
      );
    const me = await submitTarget(tx, staffId);
    // shortcut: no active manager with a login → every ops:eod:review holder; add backup managers if the owner wants them.
    const recipients = me.managerUserId ? [me.managerUserId] : await reviewerUserIds(tx);
    const [after] = await tx
      .update(reports)
      .set({
        status: 'submitted',
        snapshot,
        submittedAt: new Date(),
        submittedToStaffId: me.managerId,
      })
      .where(eq(reports.id, row.id))
      .returning();
    const c = snapshot.counts;
    await notifyOthers(tx, actor, recipients, {
      kind: 'eod.submitted',
      title: `End-of-day report: ${me.fullName}, ${fmtDate(row.reportDate)}`,
      body: `${c.done} done, ${c.open + c.carried} not done (${c.overdue} overdue).`,
      link: `/ops/tasks?date=${row.reportDate}&report=${row.id}`,
      entityType: 'eod_report',
      entityId: row.id,
    });
    await audit(
      tx,
      actor,
      row.id,
      'eod_report.submitted',
      {
        after: { counts: c, submittedToStaffId: after!.submittedToStaffId },
        metadata: { notified: recipients.filter((u) => u !== actor.id).length },
      },
      requestId,
    );
    return { ...after!, snapshot };
  });
}

/**
 * Mark a submitted report reviewed: an EOD reviewer, or the manager it was sent to; never your
 * own. Repeating it changes nothing.
 */
export async function reviewReport(db: Database, actor: Actor, id: string, requestId?: string) {
  await accessScope(db, actor, 'ops:tasks:read');
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, reports, id, 'Report', true);
    const self = await staffIdForUser(tx, actor.id);
    if (!can(actor, 'ops:eod:review') && (!self || row.submittedToStaffId !== self))
      throw new ForbiddenError(
        'Only the manager it was sent to, or an EOD reviewer, can mark a report reviewed.',
      );
    if (row.staffId === self) throw new ForbiddenError('You cannot review your own report.');
    if (row.status !== 'submitted')
      throw new InvalidStateTransitionError('Only a submitted report can be marked reviewed.');
    if (row.reviewedAt) return row;
    const [after] = await tx
      .update(reports)
      .set({ reviewedBy: actor.id, reviewedAt: new Date() })
      .where(eq(reports.id, row.id))
      .returning();
    await audit(tx, actor, row.id, 'eod_report.reviewed', {}, requestId);
    return after!;
  });
}

/** Share by WhatsApp or email through the messaging adapter (mock: simulated, nothing sent). */
export async function shareReport(
  db: Database,
  actor: Actor,
  id: string,
  channel: 'email' | 'whatsapp',
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:tasks:write');
  const staffId = await ownStaffId(db, actor);
  const r = await readable(db, actor, id);
  if (r.staffId !== staffId) notFound('Report');
  if (r.status !== 'submitted')
    throw new InvalidStateTransitionError('Submit the report before sharing it.');
  const c = snapshotOf(r).counts;
  const { providerRef } = await getMessagingAdapter().send({
    channel,
    body: `End-of-day report ${fmtDate(r.reportDate)}: ${c.done} done, ${c.open + c.carried} not done.`,
    // shortcut: no recipient; add the manager's contact when a real provider is connected.
    to: [],
  });
  const status = providerRef ? 'sent' : 'simulated';
  await audit(
    db,
    actor,
    id,
    'eod_report.shared',
    { metadata: { channel, status, providerRef } },
    requestId,
  );
  return { status, message: status === 'simulated' ? SIMULATED : 'Handed to the provider.' };
}

/**
 * Team view for a day (EOD reviewers): every active staff member with a login and their report
 * state, plus tasks that are blocked or on hold.
 */
export async function teamDay(db: Database, actor: Actor, day: string) {
  await accessScope(db, actor, 'ops:eod:review');
  // shortcut: everyone active with a login is expected to report; add a per-role setting if some roles never do.
  const [people, stuck] = await Promise.all([
    db
      .select({
        staffId: staffMembers.id,
        name: staffMembers.fullName,
        reportId: reports.id,
        status: reports.status,
        submittedAt: reports.submittedAt,
        reviewedAt: reports.reviewedAt,
        reportDate: reports.reportDate,
      })
      .from(staffMembers)
      .leftJoin(reports, and(eq(reports.staffId, staffMembers.id), eq(reports.reportDate, day)))
      .where(and(eq(staffMembers.status, 'active'), isNotNull(staffMembers.userId)))
      .orderBy(asc(staffMembers.fullName)),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        reason: tasks.reason,
        dueOn: tasks.dueOn,
        staffName: staffMembers.fullName,
      })
      .from(tasks)
      .innerJoin(staffMembers, eq(staffMembers.id, tasks.staffId))
      .where(
        and(inArray(tasks.status, ['blocked', 'on_hold']), ne(staffMembers.status, 'inactive')),
      )
      .orderBy(asc(tasks.dueOn))
      .limit(100),
  ]);
  return {
    people: people.map((p) => ({
      ...p,
      late: p.reportDate
        ? submittedLate({ submittedAt: p.submittedAt, reportDate: p.reportDate })
        : false,
    })),
    stuck,
  };
}

const itemRows = (items: EodItem[]) =>
  items.map((t) => [
    t.title,
    t.priority,
    `${TASK_STATUS_LABELS[t.status]}${t.overdue ? ' (overdue)' : ''}`,
    `${t.progressPercent}%`,
    `${fmtDate(t.dueOn)}${t.dueTime ? ` ${t.dueTime.slice(0, 5)}` : ''}`,
    t.reason,
  ]);
const COLUMNS = [
  { header: 'Task', width: 0.3 },
  { header: 'Priority', width: 0.1 },
  { header: 'Status', width: 0.15 },
  { header: 'Done', width: 0.08, align: 'right' as const },
  { header: 'Due', width: 0.15 },
  { header: 'Reason', width: 0.22 },
];

/** The report as a PDF (same read rules as the screen). */
export async function eodReportPdf(db: Database, actor: Actor, id: string) {
  const r = await getReport(db, actor, id);
  const s = r.snapshot;
  const pdf = await createPdf({
    title: 'End-of-day report',
    reference: `${r.staffName} · ${fmtDate(r.reportDate)}`,
    templateVersion: 'eod-report v1',
  });
  if (r.status === 'draft') pdf.banner('Draft — not submitted');
  pdf.keyValues([
    ['Staff member', r.staffName],
    ['Report day', fmtDate(r.reportDate)],
    [
      'Submitted',
      r.submittedAt ? `${fmtDateTime(r.submittedAt)}${r.late ? ' (submitted later)' : ''}` : null,
    ],
    ['Submitted to', r.submittedAt ? (r.managerName ?? 'EOD reviewers') : null],
    ['Reviewed', r.reviewedAt ? fmtDateTime(r.reviewedAt) : null],
    [
      'Tasks',
      `${s.counts.done} done · ${s.counts.open} open today · ${s.counts.carried} carried forward · ${s.counts.overdue} overdue`,
    ],
  ]);
  pdf.heading('Summary');
  pdf.paragraph(r.summary);
  for (const [title, items] of [
    ['Done today', s.done],
    ['Still open (due today)', s.open],
    ['Carried forward from earlier days', s.carried],
  ] as const) {
    pdf.heading(title);
    if (items.length) pdf.table(COLUMNS, itemRows(items));
    else pdf.paragraph('None.', { muted: true });
  }
  return {
    bytes: await pdf.finish(),
    filename: `eod-report-${r.reportDate}-${r.id.slice(0, 8)}.pdf`,
  };
}
