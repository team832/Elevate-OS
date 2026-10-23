/**
 * Work reports: end-of-day (owner brief 2 §9–11), weekly and monthly (brief 23 Oct 2026 §13, R7).
 * One report per staff member, period kind and period start; the row is the working draft (facts
 * rebuilt from task events and updates, plus the employee's narrative).
 * Submitting freezes an immutable version (`eod_report_versions`) addressed to the resolved
 * reporting manager — or, when none can be resolved, to an EOD reviewer the employee chooses
 * (recorded on the version only, never saved as a reporting line). A revision request reopens the
 * draft; resubmitting makes version n+1. Nothing is sent outside Elevate OS (no provider).
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  departments,
  opsEodReports as reports,
  opsEodReportVersions as versions,
  opsEodReviewEvents as reviewEvents,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday, type IsoDate } from '../domain/dates';
import { factsMissingReasons, isEodFacts, isImportedReport, type EodFacts } from '../domain/eod';
import {
  KIND_LABELS,
  periodLabel,
  periodOf,
  reportDeadline,
  reportStanding,
  type Period,
} from '../domain/work-report';
import { accessScope, notFound, staffIdForUser, type Actor } from './context';
import { collectFacts, factsHash } from './eod-facts';
import type { EodDraftInput } from './eod-schemas';
import { fieldError, opsAudit, rowById } from './ops-common';
import { ownStaffId } from './staff-tasks';
import { notifyHosted } from './task-links';
import {
  canReviewReport,
  manager,
  periodOfRow,
  readerOf,
  reportSettings,
  resolveRecipient,
  storedDeadline,
} from './eod-report-access';

export {
  canReviewReport,
  ownReportPath,
  periodOfRow,
  readerOf,
  reportSettings,
} from './eod-report-access';

type Row = typeof reports.$inferSelect;
export const audit = opsAudit('eod_report');
const EDITABLE: readonly Row['status'][] = ['draft', 'revision_requested'];

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
  const period = periodOfRow(row);
  const settings = await reportSettings(db);
  const deadline = reportDeadline(period, settings.deadlines);
  const sourceChanged =
    options.checkSource && current && isEodFacts(current.snapshot)
      ? factsHash(await collectFacts(db, row.staffId, period)) !== factsHash(current.snapshot)
      : null;
  const isOwner = row.staffId === self;
  return {
    // Others read only what was sent: never the owner's unsubmitted rewrite during a revision.
    ...(isOwner || !current ? row : { ...row, ...current.narrative, snapshot: current.snapshot }),
    staffName: owner?.fullName ?? 'Name not on record',
    department: owner?.department ?? null,
    managerName: owner?.managerName ?? null,
    imported: isImportedReport(row.snapshot),
    period,
    kindLabel: `${KIND_LABELS[period.kind]} report`,
    periodLabel: periodLabel(period),
    deadline: deadline?.toISOString() ?? null,
    external: settings.external,
    late: reportStanding(
      {
        status: row.status,
        firstSubmittedAt: versionRows[0]?.submittedAt ?? null,
        deadlineAtSubmit: storedDeadline(versionRows[0]?.snapshot),
      },
      period,
      deadline,
      new Date(),
    ).late,
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

const samePeriod = (staffId: string, p: Period) =>
  and(
    eq(reports.staffId, staffId as StaffMemberId),
    eq(reports.periodKind, p.kind),
    eq(reports.periodStart, p.start),
  );

/** The caller's report for a period (null when not started), its recipient and fresh facts. */
export async function reportContext(db: Database, actor: Actor, period: Period) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const [[row], recipient, facts] = await Promise.all([
    db.select({ id: reports.id }).from(reports).where(samePeriod(staffId, period)),
    resolveRecipient(db, staffId),
    collectFacts(db, staffId, period),
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
export const eodContext = (db: Database, actor: Actor, day: string) =>
  reportContext(db, actor, periodOf('day', day as IsoDate));

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
  const period = periodOf(
    input.periodKind,
    input.reportDate as IsoDate,
    (await reportSettings(db)).weekStart,
  );
  if (period.start > istToday(new Date()))
    throw fieldError('reportDate', 'A report can be for the current or an earlier period only.');
  const facts = await collectFacts(db, staffId, period);
  const narrative = Object.fromEntries(
    (['summary', 'nextDayPlan', 'notes'] as const)
      .filter((k) => input[k] !== undefined)
      .map((k) => [k, input[k] ?? null]),
  );
  return withTransaction(db, async (tx) => {
    const [cur] = await tx.select().from(reports).where(samePeriod(staffId, period)).for('update');
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
            periodKind: period.kind,
            periodStart: period.start,
            periodEnd: period.end,
            reportDate: period.kind === 'day' ? period.start : null,
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
      { after: { ...narrative, counts: facts.counts }, metadata: { period } },
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
  const period = periodOfRow(pre);
  const [built, recipient, settings] = await Promise.all([
    collectFacts(db, staffId, period),
    resolveRecipient(db, staffId),
    reportSettings(db),
  ]);
  const facts = {
    ...built,
    deadline: reportDeadline(period, settings.deadlines)?.toISOString() ?? null,
  };
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
      title: `${KIND_LABELS[period.kind]} report: ${recipient.staffName}, ${periodLabel(period)}${version!.version > 1 ? ` (version ${version!.version})` : ''}`,
      body: `${c.submitted ?? 0} submitted, ${c.completed} approved or done, ${c.backlog} open at cut-off (${c.overdue} overdue), ${c.blocked} blocked.`,
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
