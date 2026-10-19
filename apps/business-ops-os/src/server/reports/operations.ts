/**
 * Operations dashboard (OPS-069): tasks, capacity by department and owner,
 * SOP approvals and acknowledgements, incidents and their resolution targets,
 * blocked projects, deadlines in the next 7 days, pending approvals and
 * unresolved integration errors for Ops consumers. Pure KPI functions live in
 * domain/kpis.ts; definitions in docs/parts/operations.md → KPI definitions.
 * Missing is not zero: a rate with no denominator is `missing`.
 */
import { and, count, desc, eq, inArray, isNotNull, like, ne, or } from 'drizzle-orm';
import {
  approvals,
  departments,
  eventDeliveries,
  integrationEvents,
  opsIncidents,
  opsMilestones,
  opsPolicies,
  opsPolicyVersions,
  opsProjects,
  opsSops,
  opsSopVersionSchedules,
  opsTaskReviews,
  opsTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { metric } from '@elevate/shared-contracts';
import {
  incidentSla,
  istToday,
  openTasksMetric,
  overdueTasksMetric,
  overdueTaskShare,
  pointCount,
  sopAcknowledgementCoverage,
  taskCapacity,
  upcomingDeadlines,
  windowLabel,
  type DeadlineItem,
  type IsoDate,
  type TaskStatus,
} from '../../domain';
import { listApprovalInbox } from '../approvals';
import { accessScope, type Actor } from '../context';
import { blockedProjectRows } from '../planning';
import { loadSettings } from '../settings';
import { acknowledgementTotals } from '../sops';

const OPEN_TASK = ['not_started', 'in_progress', 'waiting', 'at_risk', 'blocked'];

/** Unresolved deliveries for Ops consumers, or of Ops-produced events (read-only). */
export async function unresolvedIntegrationErrors(db: Database, limit = 50) {
  const where = and(
    inArray(eventDeliveries.status, ['failed', 'dead']),
    or(like(eventDeliveries.consumer, 'ops.%'), eq(integrationEvents.producer, 'ops')),
  );
  const [total] = await db
    .select({ n: count() })
    .from(eventDeliveries)
    .innerJoin(integrationEvents, eq(integrationEvents.id, eventDeliveries.eventId))
    .where(where);
  const rows = await db
    .select({
      id: eventDeliveries.id,
      consumer: eventDeliveries.consumer,
      status: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
      lastError: eventDeliveries.lastError,
      updatedAt: eventDeliveries.updatedAt,
      eventType: integrationEvents.type,
      producer: integrationEvents.producer,
    })
    .from(eventDeliveries)
    .innerJoin(integrationEvents, eq(integrationEvents.id, eventDeliveries.eventId))
    .where(where)
    .orderBy(desc(eventDeliveries.updatedAt))
    .limit(limit);
  return {
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({
      ...r,
      direction: r.consumer.startsWith('ops.')
        ? ('ops_consumer' as const)
        : ('ops_producer' as const),
      lastError: r.lastError ? r.lastError.slice(0, 300) : null,
    })),
  };
}

export async function buildOperationsReport(
  db: Database,
  actor: Actor,
  options: { now?: Date } = {},
) {
  await accessScope(db, actor, 'ops:dashboard:read');
  const now = options.now ?? new Date();
  const today = istToday(now);
  const asOfLabel = `As of ${windowLabel(today, today)}`;
  const asOf = { from: today, to: today, label: asOfLabel };
  const settings = await loadSettings(db);

  // --- tasks and capacity -------------------------------------------------------------------------
  const tasks = await db
    .select({
      id: opsTasks.id,
      code: opsTasks.code,
      title: opsTasks.title,
      status: opsTasks.status,
      dueDate: opsTasks.dueDate,
      completedAt: opsTasks.completedAt,
      ownerStaffId: opsTasks.ownerStaffId,
      ownerName: staffMembers.fullName,
      departmentId: opsTasks.departmentId,
      departmentName: departments.name,
    })
    .from(opsTasks)
    .leftJoin(staffMembers, eq(staffMembers.id, opsTasks.ownerStaffId))
    .leftJoin(departments, eq(departments.id, opsTasks.departmentId));
  const kpiTasks = tasks.map((t) => ({
    ...t,
    status: t.status as TaskStatus,
    dueDate: t.dueDate as IsoDate | null,
  }));
  const byDepartment = taskCapacity(
    kpiTasks.map((t) => ({ ...t, groupKey: t.departmentId, groupLabel: t.departmentName })),
    now,
    'No department',
  );
  const byOwner = taskCapacity(
    kpiTasks.map((t) => ({ ...t, groupKey: t.ownerStaffId, groupLabel: t.ownerName })),
    now,
    'No owner',
  );
  const [awaitingReview] = await db
    .select({ n: count() })
    .from(opsTaskReviews)
    .where(eq(opsTaskReviews.status, 'pending'));

  // --- SOPs ---------------------------------------------------------------------------------------
  const [sopsAwaiting] = await db
    .select({ n: count() })
    .from(approvals)
    .where(and(eq(approvals.policy, 'ops.sop.approve'), eq(approvals.status, 'pending')));
  const acks = await acknowledgementTotals(db);

  // --- incidents ----------------------------------------------------------------------------------
  const incidents = await db
    .select()
    .from(opsIncidents)
    .where(inArray(opsIncidents.status, ['open', 'in_progress']));
  const slaValue = settings['incidents.resolution_sla'].value;
  const incidentRows = incidents.map((i) => ({
    id: i.id,
    code: i.code,
    title: i.title,
    severity: i.severity,
    status: i.status,
    sla: incidentSla(i, now, slaValue),
  }));
  const breaching = incidentRows.filter((i) => i.sla.state === 'breached');

  // --- projects -----------------------------------------------------------------------------------
  const blockedProjects = await blockedProjectRows(db, now);

  // --- deadlines (next 7 days) --------------------------------------------------------------------
  const deadlineItems: DeadlineItem[] = [];
  for (const t of kpiTasks)
    if (OPEN_TASK.includes(t.status) && t.dueDate)
      deadlineItems.push({
        kind: 'task',
        id: t.id,
        title: `${t.code} ${t.title}`,
        dueDate: t.dueDate,
        link: `/ops/tasks/${t.id}`,
      });
  const milestones = await db
    .select({
      id: opsMilestones.id,
      title: opsMilestones.title,
      dueDate: opsMilestones.dueDate,
      project: opsProjects.code,
    })
    .from(opsMilestones)
    .innerJoin(opsProjects, eq(opsProjects.id, opsMilestones.projectId))
    .where(and(eq(opsMilestones.status, 'planned'), isNotNull(opsMilestones.dueDate)));
  for (const m of milestones)
    deadlineItems.push({
      kind: 'milestone',
      id: m.id,
      title: `${m.project} milestone: ${m.title}`,
      dueDate: m.dueDate as IsoDate,
      link: '/ops/projects',
    });
  const sopReviews = await db
    .select({
      id: opsSops.id,
      code: opsSops.code,
      title: opsSops.title,
      scheduled: opsSopVersionSchedules.nextReviewDate,
      register: opsSops.nextReviewDate,
    })
    .from(opsSops)
    .leftJoin(
      opsSopVersionSchedules,
      eq(opsSopVersionSchedules.versionId, opsSops.approvedVersionId),
    )
    .where(and(isNotNull(opsSops.approvedVersionId), ne(opsSops.status, 'retired')));
  for (const s of sopReviews) {
    const date = s.scheduled ?? s.register;
    if (date)
      deadlineItems.push({
        kind: 'sop_review',
        id: s.id,
        title: `Review ${s.code} ${s.title}`,
        dueDate: date as IsoDate,
        link: `/ops/sops/${s.id}`,
      });
  }
  for (const s of acks.bySop)
    if (s.dueDate && s.outstanding > 0)
      deadlineItems.push({
        kind: 'sop_acknowledgement',
        id: s.id,
        title: `${s.outstanding} acknowledgement(s) outstanding: ${s.code} ${s.title}`,
        dueDate: s.dueDate as IsoDate,
        link: `/ops/sops/${s.id}`,
      });
  const policyReviews = await db
    .select({
      id: opsPolicies.id,
      code: opsPolicies.code,
      title: opsPolicies.title,
      date: opsPolicyVersions.nextReviewDate,
    })
    .from(opsPolicies)
    .innerJoin(opsPolicyVersions, eq(opsPolicyVersions.id, opsPolicies.approvedVersionId))
    .where(and(ne(opsPolicies.status, 'retired'), isNotNull(opsPolicyVersions.nextReviewDate)));
  for (const p of policyReviews)
    deadlineItems.push({
      kind: 'policy_review',
      id: p.id,
      title: `Review ${p.code} ${p.title}`,
      dueDate: p.date as IsoDate,
      link: `/ops/settings/policies/${p.id}`,
    });
  const deadlines = upcomingDeadlines(deadlineItems, now, 7);

  // --- approvals and integration errors ---------------------------------------------------------
  const inbox = await listApprovalInbox(db, actor);
  const pendingByPolicy = await db
    .select({ policy: approvals.policy, n: count() })
    .from(approvals)
    .where(and(eq(approvals.subjectModule, 'ops'), eq(approvals.status, 'pending')))
    .groupBy(approvals.policy);
  const integration = await unresolvedIntegrationErrors(db);

  return {
    asOf: now.toISOString(),
    today,
    kpis: {
      openTasks: openTasksMetric(kpiTasks, now),
      overdueTasks: overdueTasksMetric(kpiTasks, now),
      overdueTaskShare: overdueTaskShare(kpiTasks, now),
      tasksAwaitingReview: pointCount(
        Number(awaitingReview?.n ?? 0),
        'Completed tasks whose latest supervisor review is pending. Point in time.',
        now,
      ),
      sopsAwaitingApproval: pointCount(
        Number(sopsAwaiting?.n ?? 0),
        'SOP versions with a pending core approval request (policy ops.sop.approve). Point in time.',
        now,
      ),
      outstandingSopAcknowledgements: pointCount(
        acks.totals.outstanding,
        'People (with a login) in an active acknowledgement audience who have not acknowledged the approved SOP version in force. Point in time.',
        now,
      ),
      sopAcknowledgementCoverage: sopAcknowledgementCoverage(
        acks.totals.required,
        acks.totals.acknowledged,
        now,
      ),
      unresolvedIncidents: pointCount(
        incidentRows.length,
        'Incidents and exceptions with status Open or In progress. Point in time.',
        now,
      ),
      incidentsBreachingTarget: pointCount(
        breaching.length,
        'Open or in-progress incidents past their resolution target (occurred date IST + days by severity, setting incidents.resolution_sla — proposed). Point in time.',
        now,
      ),
      blockedProjects: pointCount(
        blockedProjects.length,
        'Planned, active or on-hold projects with at least one block reason (on hold, missed milestone, milestone waiting on an overdue dependency, blocked linked task, open linked blocker). Point in time.',
        now,
      ),
      pendingApprovalsForYou:
        inbox.total === null
          ? metric.missing('The approval sources could not be loaded.', {
              definition:
                'Items in your approvals inbox: requests you may decide that you did not raise.',
              window: asOf,
              unit: 'count',
            })
          : pointCount(
              inbox.total,
              'Items in your approvals inbox: requests you may decide that you did not raise. Point in time.',
              now,
            ),
      unresolvedIntegrationErrors: pointCount(
        integration.total,
        'Event deliveries with status failed or dead whose consumer is an Ops consumer (ops.*) or whose event was produced by Ops. Read-only. Point in time.',
        now,
      ),
    },
    capacity: { byDepartment, byOwner },
    acknowledgements: acks,
    incidents: { rows: incidentRows, setting: settings['incidents.resolution_sla'] },
    blockedProjects,
    deadlines,
    approvals: {
      inbox: inbox.sources.map((s) => ({
        key: s.key,
        label: s.label,
        status: s.status,
        count: s.count,
      })),
      pendingByPolicy: pendingByPolicy.map((p) => ({ policy: p.policy, count: Number(p.n) })),
    },
    integrationErrors: integration.rows,
  };
}
