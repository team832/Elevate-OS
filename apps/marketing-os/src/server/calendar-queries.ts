/** Calendar reads shared by the calendar views, Deliverables, the item page and dashboards (§12). */
import {
  and,
  asc,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import {
  marketingCalendarItems,
  marketingCampaigns,
  marketingIdeas,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { NotFoundError } from '@elevate/server-kit';
import type { CalendarStatus } from '../domain/calendar';
import { memberOptions } from './campaign-members';

export interface CalendarFilters {
  id?: string;
  ideaId?: string;
  /** Planned or published in [from, to). */
  from?: Date;
  to?: Date;
  /** Items without a planned date (ideas not yet dated). */
  undated?: boolean;
  ownerStaffId?: string;
  status?: CalendarStatus;
  campaignId?: string;
  /** Course (core.programmes). */
  programmeId?: string;
  /** Still open: not published and not cancelled. */
  due?: boolean;
}

const OPEN_ONLY = ['published', 'cancelled'] as const;

/** The one filter behind the calendar, Deliverables and the dashboard counts. */
function calendarWhere(f: CalendarFilters): SQL | undefined {
  const t = marketingCalendarItems;
  const inRange = (col: typeof t.plannedAt | typeof t.publishedAt) =>
    and(f.from ? gte(col, f.from) : undefined, f.to ? lt(col, f.to) : undefined);
  return and(
    f.id ? eq(t.id, f.id as never) : undefined,
    f.ideaId ? eq(t.ideaId, f.ideaId as never) : undefined,
    f.from || f.to ? or(inRange(t.plannedAt), inRange(t.publishedAt)) : undefined,
    f.undated ? isNull(t.plannedAt) : undefined,
    f.ownerStaffId ? eq(t.ownerStaffId, f.ownerStaffId as never) : undefined,
    f.status ? eq(t.status, f.status) : undefined,
    f.campaignId ? eq(t.campaignId, f.campaignId as never) : undefined,
    f.programmeId ? eq(t.programmeId, f.programmeId as never) : undefined,
    f.due ? notInArray(t.status, [...OPEN_ONLY]) : undefined,
  );
}

/** Calendar items with names for owner, campaign, course and idea; the calendar, deliverables and detail share it. */
export async function listCalendarItems(db: Database, f: CalendarFilters = {}) {
  const t = marketingCalendarItems;
  const rows = await db
    .select({
      item: t,
      ownerName: staffMembers.fullName,
      campaignCode: marketingCampaigns.code,
      campaignName: marketingCampaigns.name,
      programmeName: programmes.name,
      ideaCode: marketingIdeas.code,
    })
    .from(t)
    .leftJoin(staffMembers, eq(staffMembers.id, t.ownerStaffId))
    .leftJoin(marketingCampaigns, eq(marketingCampaigns.id, t.campaignId))
    .leftJoin(programmes, eq(programmes.id, t.programmeId))
    .leftJoin(marketingIdeas, eq(marketingIdeas.id, t.ideaId))
    .where(calendarWhere(f))
    .orderBy(asc(t.plannedAt), asc(t.title))
    // shortcut: 500 rows per window; add paging if a month ever holds more.
    .limit(500);
  return rows.map(({ item, ...names }) => ({ ...item, ...names }));
}
export type CalendarListRow = Awaited<ReturnType<typeof listCalendarItems>>[number];

/** Placements that already appear through a calendar item (shown once, as that item). */
export async function linkedPlacementIds(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ id: marketingCalendarItems.placementId })
    .from(marketingCalendarItems)
    .where(isNotNull(marketingCalendarItems.placementId));
  return new Set(rows.map((r) => r.id!));
}

export async function getCalendarItem(db: Database, id: string): Promise<CalendarListRow> {
  const [row] = await listCalendarItems(db, { id });
  if (!row) throw new NotFoundError('Calendar item not found.');
  return row;
}

/**
 * For dashboards: open items planned or published in [from, to) and items awaiting review in the
 * same period, optionally for one owner, campaign and course. Same filter as the list behind `calendarListHref`, so a
 * count always equals its drill-down when from/to are IST midnights.
 */
export async function calendarCounts(
  db: Database,
  period: { from: Date; to: Date },
  ownerStaffId?: string,
  campaignId?: string,
  programmeId?: string,
): Promise<{ due: number; awaitingReview: number }> {
  const n = async (f: CalendarFilters) =>
    (
      await db
        .select({ n: count() })
        .from(marketingCalendarItems)
        .where(calendarWhere({ ...period, ownerStaffId, campaignId, programmeId, ...f }))
    )[0]?.n ?? 0;
  return { due: await n({ due: true }), awaitingReview: await n({ status: 'submitted' }) };
}

/** Drill-down to the calendar list for IST dates `from`..`to` (inclusive), matching calendarCounts. */
export const calendarListHref = (q: {
  from: string;
  to: string;
  owner?: string;
  campaign?: string;
  course?: string;
  due?: boolean;
  status?: CalendarStatus;
}) =>
  `/marketing/calendar?${new URLSearchParams(
    Object.entries({ view: 'list', ...q, due: q.due ? '1' : undefined }).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  )}`;

/** Choices for the item form and filters: active courses, open campaigns, marketing staff. */
export async function calendarOptions(db: Database) {
  const courses = await db
    .select({ id: programmes.id, name: programmes.name })
    .from(programmes)
    .where(eq(programmes.status, 'active'))
    .orderBy(asc(programmes.name));
  const campaigns = await db
    .select({
      id: marketingCampaigns.id,
      name: marketingCampaigns.name,
      code: marketingCampaigns.code,
    })
    .from(marketingCampaigns)
    .where(notInArray(marketingCampaigns.status, ['cancelled']))
    .orderBy(asc(marketingCampaigns.code));
  return { courses, campaigns, owners: await memberOptions(db) };
}
export type CalendarOptions = Awaited<ReturnType<typeof calendarOptions>>;
