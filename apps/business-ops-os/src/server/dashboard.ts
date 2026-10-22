/**
 * Management dashboard (OPS-024). Loads plain rows and hands them to the pure
 * KPI functions (domain/kpis.ts); definitions in docs/KPI_DEFINITIONS.md.
 * Academic and Marketing panels come from their summary contracts and show
 * "source unavailable" when the fetch fails.
 */
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAdmissionTransitions,
  opsDemos,
  opsFollowUps,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import {
  addDays,
  followUpCompliance,
  isOpenStatus,
  istToday,
  istWeekContaining,
  latestElapsedCohortWeek,
  leadToAdmissionConversion,
  newLeads,
  overdueWork,
  workloadPerStaff,
  type IsoDate,
  type KpiWindow,
} from '../domain';
import { ownAdmissionFilter } from './admissions';
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
  const [leads, admittedTransitions, followUps, staff, openAdmissions] = await Promise.all([
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
    staff,
    openAdmissions: openAdmissions.filter((a) => isOpenStatus(a.status)),
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
  const workload = workloadPerStaff({
    staff: rows.staff,
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
      overdueWork: overdueWork(rows.followUps, now),
    },
    workload,
    crossModule: summaries,
  };
}

/** Counts per Asia/Kolkata day for the `days` days ending `to`, oldest first; other dates are ignored. */
export function perDay(dates: readonly Date[], to: IsoDate, days: number) {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(istToday(d), (counts.get(istToday(d)) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(to, i - days + 1);
    return { date, count: counts.get(date) ?? 0 };
  });
}

/**
 * Dashboard and report-card series (OPS-024 charts) from Ops' own complete tables, so an
 * empty day is a real 0: leads received and demos converted per day over the last `days`
 * days, and follow-ups by due state. Own scope matches the lists the figures link to:
 * leads (owner or case counsellor), demos (plus the demo counsellor), follow-ups (owner).
 */
export async function activitySeries(
  db: Database,
  actor: Actor,
  { now = new Date(), days = 30 }: { now?: Date; days?: number } = {},
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const today = istToday(now);
  const from = addDays(today, -(days - 1));
  const since = new Date(`${from}T00:00:00+05:30`);
  const own = access.scope === 'own' ? access.staffId : undefined;
  const nothing = sql`false`;
  const leadScope =
    own === undefined
      ? undefined
      : own
        ? or(
            eq(opsLeads.ownerStaffId, own),
            inArray(
              opsLeads.id,
              db
                .select({ id: opsAdmissions.leadId })
                .from(opsAdmissions)
                .where(eq(opsAdmissions.counsellorStaffId, own)),
            ),
          )
        : nothing;
  const demoScope = own
    ? or(ownAdmissionFilter(access), eq(opsDemos.counsellorStaffId, own))
    : ownAdmissionFilter(access);
  const followUpScope =
    own === undefined ? undefined : own ? eq(opsFollowUps.ownerStaffId, own) : nothing;
  const [leads, conversions, followUps] = await Promise.all([
    db
      .select({ at: opsLeads.firstReceivedAt })
      .from(opsLeads)
      .where(
        and(isNull(opsLeads.mergedIntoLeadId), gte(opsLeads.firstReceivedAt, since), leadScope),
      ),
    db
      .select({ at: opsDemos.outcomeAt })
      .from(opsDemos)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
      .where(and(eq(opsDemos.outcome, 'converted'), gte(opsDemos.outcomeAt, since), demoScope)),
    db
      .select({ status: opsFollowUps.status, dueDate: opsFollowUps.dueDate })
      .from(opsFollowUps)
      .where(
        and(
          or(eq(opsFollowUps.status, 'open'), gte(opsFollowUps.completedAt, since)),
          followUpScope,
        ),
      ),
  ]);
  const week = istWeekContaining(today);
  const leadsPerDay = perDay(
    leads.map((l) => l.at),
    today,
    days,
  );
  const open = followUps.filter((f) => f.status === 'open');
  return {
    scope: access.scope,
    window: { from, to: today },
    week,
    leadsPerDay,
    newLeadsThisWeek: leadsPerDay
      .filter((d) => d.date >= week.from)
      .reduce((n, d) => n + d.count, 0),
    conversionsPerDay: perDay(
      conversions.flatMap((c) => (c.at ? [c.at] : [])),
      today,
      days,
    ),
    followUps: {
      overdue: open.filter((f) => f.dueDate < today).length,
      dueToday: open.filter((f) => f.dueDate === today).length,
      upcoming: open.filter((f) => f.dueDate > today).length,
      doneInWindow: followUps.filter((f) => f.status === 'done').length,
    },
  };
}
