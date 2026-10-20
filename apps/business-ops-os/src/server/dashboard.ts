/**
 * Management dashboard (OPS-024). Loads plain rows and hands them to the pure
 * KPI functions (domain/kpis.ts); definitions in docs/KPI_DEFINITIONS.md.
 * Academic and Marketing panels come from their summary contracts and show
 * "source unavailable" when the fetch fails.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAdmissionTransitions,
  opsFollowUps,
  opsLeads,
  opsRisks,
  opsTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  followUpCompliance,
  isOpenStatus,
  isOpenTask,
  istToday,
  istWeekContaining,
  latestElapsedCohortWeek,
  leadToAdmissionConversion,
  newLeads,
  OPEN_TASK_STATUSES,
  overdueWork,
  taskCompletionRate,
  unresolvedBlockers,
  workloadPerStaff,
  type AdmissionStatus,
  type IsoDate,
  type KpiWindow,
  type TaskStatus,
} from '../domain';
import { accessScope, type Actor } from './context';
import { loadSettings } from './settings';
import {
  fetchCrossModuleSummaries,
  type CrossModuleSummaries,
  type SummaryFetchOptions,
} from './summaries';

export interface DashboardOptions {
  now?: Date;
  window?: Partial<KpiWindow>;
  summaries?: SummaryFetchOptions | false;
}

/** Load the rows the KPI functions need (no permission check; used by buildDashboard and tests). */
export async function loadKpiRows(db: Database) {
  const [leads, admittedTransitions, followUps, tasks, risks, staff, openAdmissions] =
    await Promise.all([
      db
        .select({
          id: opsLeads.id,
          receivedAt: opsLeads.firstReceivedAt,
          merged: opsLeads.mergedIntoLeadId,
        })
        .from(opsLeads),
      db
        .select({ leadId: opsAdmissions.leadId, at: opsAdmissionTransitions.at })
        .from(opsAdmissionTransitions)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsAdmissionTransitions.admissionId))
        .where(eq(opsAdmissionTransitions.toStatus, 'admitted')),
      db
        .select({
          kind: opsFollowUps.kind,
          dueDate: opsFollowUps.dueDate,
          status: opsFollowUps.status,
          completedAt: opsFollowUps.completedAt,
          ownerStaffId: opsFollowUps.ownerStaffId,
        })
        .from(opsFollowUps),
      db
        .select({
          status: opsTasks.status,
          dueDate: opsTasks.dueDate,
          completedAt: opsTasks.completedAt,
          ownerStaffId: opsTasks.ownerStaffId,
        })
        .from(opsTasks),
      db.select({ kind: opsRisks.kind, status: opsRisks.status }).from(opsRisks),
      db
        .select({
          id: staffMembers.id,
          fullName: staffMembers.fullName,
          status: staffMembers.status,
        })
        .from(staffMembers),
      db
        .select({
          status: opsAdmissions.status,
          counsellor: opsAdmissions.counsellorStaffId,
          leadId: opsAdmissions.leadId,
        })
        .from(opsAdmissions)
        .innerJoin(
          opsLeads,
          and(eq(opsLeads.id, opsAdmissions.leadId), isNull(opsLeads.mergedIntoLeadId)),
        ),
    ]);
  const firstAdmitted = new Map<string, Date>();
  for (const t of admittedTransitions) {
    const prev = firstAdmitted.get(t.leadId);
    if (!prev || t.at < prev) firstAdmitted.set(t.leadId, t.at);
  }
  return {
    leads: leads.map((l) => ({
      receivedAt: l.receivedAt,
      merged: Boolean(l.merged),
      admittedAt: firstAdmitted.get(l.id) ?? null,
    })),
    followUps: followUps.map((f) => ({ ...f, dueDate: f.dueDate as IsoDate })),
    tasks: tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
      dueDate: t.dueDate as IsoDate | null,
    })),
    risks,
    staff,
    openAdmissions: openAdmissions.filter((a) => isOpenStatus(a.status as AdmissionStatus)),
  };
}

export async function buildDashboard(db: Database, actor: Actor, options: DashboardOptions = {}) {
  await accessScope(db, actor, 'ops:dashboard:read');
  const now = options.now ?? new Date();
  const today = istToday(now);
  const week = istWeekContaining(today);
  const window: KpiWindow = {
    from: (options.window?.from ?? week.from) as IsoDate,
    to: (options.window?.to ?? week.to) as IsoDate,
  };
  const settings = await loadSettings(db);
  const conversionDays = settings['kpi.conversion'].value.windowDays;
  const cohort = latestElapsedCohortWeek(now, conversionDays);
  const rows = await loadKpiRows(db);
  const overdue = overdueWork(rows.tasks, rows.followUps, now);
  const blockers = unresolvedBlockers(rows.risks, rows.tasks, now);
  const workload = workloadPerStaff({
    staff: rows.staff,
    openTaskOwners: rows.tasks.filter((t) => isOpenTask(t.status)).map((t) => t.ownerStaffId),
    openFollowUpOwners: rows.followUps
      .filter((f) => f.status === 'open')
      .map((f) => f.ownerStaffId),
    openAdmissionCounsellors: rows.openAdmissions.map((a) => a.counsellor),
  });
  const summaries: CrossModuleSummaries | null =
    options.summaries === false
      ? null
      : await fetchCrossModuleSummaries(window, options.summaries ?? {});
  return {
    asOf: now.toISOString(),
    window,
    cohort: { ...cohort, windowDays: conversionDays, setting: settings['kpi.conversion'] },
    kpis: {
      newLeads: newLeads(rows.leads, window),
      conversion: leadToAdmissionConversion(rows.leads, cohort, conversionDays, now),
      followUpCompliance: followUpCompliance(rows.followUps, window, now),
      taskCompletionRate: taskCompletionRate(rows.tasks, window, now),
      overdueWork: overdue.metric,
      unresolvedBlockers: blockers.metric,
    },
    breakdown: {
      overdueTasks: overdue.tasks,
      overdueFollowUps: overdue.followUps,
      blockerRegisterItems: blockers.registerItems,
      blockedTasks: blockers.blockedTasks,
    },
    workload,
    crossModule: summaries,
  };
}

/** The signed-in user's own work (home page for roles without the dashboard). */
export async function myWork(db: Database, actor: Actor, now = new Date()) {
  await accessScope(db, actor, 'ops:module:access');
  const today = istToday(now);
  const [me] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, actor.id));
  if (!me)
    return {
      linked: false as const,
      followUpsDue: 0,
      followUpsOverdue: 0,
      openTasks: 0,
      openAdmissions: 0,
    };
  const followUps = await db
    .select({ dueDate: opsFollowUps.dueDate })
    .from(opsFollowUps)
    .where(and(eq(opsFollowUps.ownerStaffId, me.id), eq(opsFollowUps.status, 'open')));
  const tasks = await db
    .select({ id: opsTasks.id })
    .from(opsTasks)
    .where(
      and(eq(opsTasks.ownerStaffId, me.id), inArray(opsTasks.status, [...OPEN_TASK_STATUSES])),
    );
  const admissions = await db
    .select({ status: opsAdmissions.status })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.counsellorStaffId, me.id));
  return {
    linked: true as const,
    followUpsDue: followUps.filter((f) => f.dueDate === today).length,
    followUpsOverdue: followUps.filter((f) => f.dueDate < today).length,
    openTasks: tasks.length,
    openAdmissions: admissions.filter((a) => isOpenStatus(a.status as AdmissionStatus)).length,
  };
}
