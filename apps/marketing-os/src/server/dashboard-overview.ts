/**
 * The manager Overview (brief 23 Oct 2026 §10): the decisions of the day, each block from the
 * SAME query as the list it drills into, in the reader's own scope. A source that is not shared
 * with Marketing yet is `null` ("Not available yet"); a failed load is 'failed' — never 0.
 */
import { and, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { followUpDaySummary, leadStageFunnel, listLeads } from '@elevate/business-ops-os/leads';
import { listTasks, myReports, taskListQuery } from '@elevate/business-ops-os/work';
import { marketingCampaigns, marketingPlacements, type Database } from '@elevate/database';
import type { AuthenticatedUser } from '@elevate/authentication';
import { addDays } from '@elevate/shared-types';
import { istMidnightUtc, modulePath } from '../domain';
import { calendarCounts, calendarListHref } from './calendar-queries';
import { loadDashboard } from './dashboard';
import { filterQuery, type DashboardFilters } from './dashboard-filters';
import { listCampaigns } from './groups';
import { campaignResults } from './reports';
import { targetVsActual } from './targets';

const failed = () => 'failed' as const;

/**
 * Leads (Business Operations, the caller's lead scope): stage entries in the period for the
 * funnel, and open leads nobody has reached yet. Each figure opens the Ops list built from the
 * same query: `leads?from&to&leadStage=<key>&reached=1` and `leads?flag=awaiting_contact`.
 * The owner filter is not applied: neither list can filter by owner yet.
 */
async function loadLeads(db: Database, user: AuthenticatedUser, f: DashboardFilters) {
  const [funnel, awaiting] = await Promise.all([
    leadStageFunnel(db, user, { from: f.from, to: f.to, base: modulePath() }),
    listLeads(db, user, { flag: 'awaiting_contact' }),
  ]);
  return {
    awaitingContact: awaiting.length,
    awaitingHref: modulePath('leads?flag=awaiting_contact'),
    hasSample: awaiting.some((l) => l.isSample),
    funnel: funnel.map((s) => ({
      ...s,
      href: modulePath(
        `leads?${new URLSearchParams({ from: f.from, to: f.to, leadStage: s.key, reached: '1' })}`,
      ),
    })),
  };
}
export type LeadFigures = Awaited<ReturnType<typeof loadLeads>>;

/** Task list query for the tracker, with the owner filter; the drill link carries the same params. */
function taskDrill(f: DashboardFilters, q: Record<string, string>) {
  const params = { ...q, ...(f.owner ? { staffId: f.owner } : {}) };
  return {
    query: taskListQuery.parse(params),
    href: `${modulePath('tasks')}?${new URLSearchParams({ tab: 'all', ...params })}`,
  };
}

export async function loadOverview(
  db: Database,
  user: AuthenticatedUser,
  f: DashboardFilters,
  now = new Date(),
) {
  const tasksOk = can(user, 'ops:tasks:read');
  const tasks = (q: Record<string, string>, size = 1) => {
    const d = taskDrill(f, q);
    return tasksOk
      ? listTasks(db, user, d.query, size)
          .then((r) => ({ ...r, href: d.href }))
          .catch(failed)
      : undefined;
  };
  const inCampaign: SQL | undefined = f.campaign
    ? eq(marketingCampaigns.id, f.campaign as never)
    : undefined;
  // A campaign without a course covers every course.
  const byCourse: SQL | undefined = f.course
    ? or(
        eq(marketingCampaigns.programmeId, f.course as never),
        isNull(marketingCampaigns.programmeId),
      )
    : undefined;
  const [
    dashboard,
    followUps,
    overdue,
    dueInPeriod,
    blocked,
    leads,
    campaigns,
    campaignContent,
    calendar,
    targets,
    monthlyReports,
  ] = await Promise.all([
    loadDashboard(db, now),
    can(user, 'ops:leads:read') ? followUpDaySummary(db, user, now).catch(failed) : undefined,
    tasks({ due: 'overdue' }),
    tasks({ from: f.from, to: f.to }),
    tasks({ flag: 'blocked' }),
    can(user, 'ops:leads:read') ? loadLeads(db, user, f).catch(failed) : undefined,
    listCampaigns(db, and(eq(marketingCampaigns.status, 'active'), inCampaign, byCourse)),
    f.campaign
      ? db
          .selectDistinct({ id: marketingPlacements.contentItemId })
          .from(marketingPlacements)
          .where(
            and(
              eq(marketingPlacements.campaignId, f.campaign as never),
              isNotNull(marketingPlacements.contentItemId),
            ),
          )
      : undefined,
    can(user, 'marketing:calendar:read')
      ? calendarCounts(
          db,
          { from: istMidnightUtc(f.from), to: istMidnightUtc(addDays(f.to, 1)) },
          f.owner,
          f.campaign,
          f.course,
        ).catch(failed)
      : undefined,
    can(user, 'marketing:targets:read')
      ? targetVsActual(db, user, {
          from: f.from,
          to: f.to,
          staffId: f.owner,
          campaignId: f.campaign,
        }).catch(failed)
      : undefined,
    tasksOk ? myReports(db, user, 'month').catch(failed) : undefined,
  ]);
  const calendarQuery = {
    from: f.from,
    to: f.to,
    owner: f.owner,
    campaign: f.campaign,
    course: f.course,
  };
  const ids = campaignContent && new Set(campaignContent.map((c) => c.id));
  return {
    filters: f,
    query: filterQuery(f),
    asOf: now,
    dashboard,
    followUps,
    tasks: { overdue, dueInPeriod, blocked },
    leads,
    awaitingReview: ids
      ? dashboard.awaitingApproval.filter((a) => ids.has(a.id))
      : dashboard.awaitingApproval,
    running: await campaignResults(db, campaigns),
    calendar:
      typeof calendar !== 'object'
        ? calendar
        : {
            ...calendar,
            dueHref: calendarListHref({ ...calendarQuery, due: true }),
            reviewHref: calendarListHref({ ...calendarQuery, status: 'submitted' }),
          },
    targets,
    monthlyReports,
  };
}
export type Overview = Awaited<ReturnType<typeof loadOverview>>;
