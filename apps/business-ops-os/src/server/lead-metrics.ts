/**
 * Records behind Marketing target actuals (owner brief 23 Oct 2026 §15; metric definitions in the
 * MKT schema contract). Read-only, in the caller's lead scope; Marketing counts these rows, so a
 * target's actual always equals its drill-down. Periods are IST days, `cutoff` freezes a snapshot.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  auditEvents,
  opsAdmissionApprovals,
  opsAdmissions,
  opsDemos,
  opsEnquiries,
  opsFollowUps,
  opsLeads,
  opsLeadStageHistory,
  opsLeadStages,
  type Database,
} from '@elevate/database';
import { addDays, istInstant, type IsoDate } from '../domain';
import { isConfirmedAdmission } from '../domain/lead-stages';
import { accessScope, type Actor } from './context';
import { leadScope } from './leads-read';

export type LeadMetric =
  'qualified_leads' | 'follow_ups_completed' | 'demo_bookings' | 'verified_admissions';

export interface LeadMetricQuery {
  metric: LeadMetric;
  ownerStaffIds: string[] | 'all';
  from: IsoDate;
  to: IsoDate;
  /** Ignore anything after this instant (frozen report snapshots). */
  cutoff?: Date;
  /** Only 'lead_owner_at_confirmation' exists (setting marketing.targets.admission_attribution). */
  attribution?: 'lead_owner_at_confirmation';
  /** Host basePath for links, default '/marketing'. */
  base?: string;
}

export interface LeadMetricRecord {
  id: string;
  title: string;
  at: Date;
  /** Set when the lead has no ownership history and its current owner was credited. */
  ownerNote?: string;
  /** Null when the reader no longer owns the lead (title redacted). */
  href: string | null;
}

/** Title of a record credited to the reader on a lead they can no longer open. */
export const REDACTED_LEAD = 'Lead now with another owner';

const STAGE_OF: Partial<Record<LeadMetric, string>> = {
  qualified_leads: 'qualified',
  demo_bookings: 'demo_booked',
};

export async function leadMetricRecords(
  db: Database,
  actor: Actor,
  q: LeadMetricQuery,
): Promise<LeadMetricRecord[]> {
  const { scope, start, end, inPeriod, owners, leadHref, shown } = await window(db, actor, q);
  if (!scope) return [];

  const stage = STAGE_OF[q.metric];
  if (stage) return leadStageEntries(db, actor, { ...q, stageKey: stage });

  if (q.metric === 'follow_ups_completed') {
    const rows = await db
      .select({
        id: opsFollowUps.id,
        title: opsFollowUps.title,
        at: opsFollowUps.completedAt,
        leadId: opsLeads.id,
        code: opsLeads.code,
      })
      .from(opsFollowUps)
      .innerJoin(opsLeads, eq(opsLeads.id, opsFollowUps.leadId))
      .where(
        and(
          scope,
          eq(opsFollowUps.status, 'done'),
          gte(opsFollowUps.completedAt, start),
          lt(opsFollowUps.completedAt, end),
          owners(opsFollowUps.ownerStaffId as never),
        ),
      )
      .orderBy(asc(opsFollowUps.completedAt));
    return shown(rows, (r) => ({
      id: r.id,
      title: `${r.code}: ${r.title}`,
      at: r.at as Date,
      href: leadHref(r.leadId),
    }));
  }

  // verified_admissions: confirmed by Ops (approval, verified legacy case, else admission day).
  const cases = await db
    .select({
      id: opsAdmissions.id,
      admissionNumber: opsAdmissions.admissionNumber,
      status: opsAdmissions.status,
      legacyVerification: opsAdmissions.legacyVerification,
      legacyVerifiedAt: opsAdmissions.legacyVerifiedAt,
      admissionDate: opsAdmissions.admissionDate,
      approvedAt: opsAdmissionApprovals.approvedAt,
      leadId: opsLeads.id,
      code: opsLeads.code,
      name: opsLeads.studentName,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(opsAdmissionApprovals, eq(opsAdmissionApprovals.admissionId, opsAdmissions.id))
    .where(and(scope, isNotNull(opsAdmissions.admissionNumber)));
  const confirmed = cases
    .filter(isConfirmedAdmission)
    .map((c) => ({
      ...c,
      at:
        c.approvedAt ??
        c.legacyVerifiedAt ??
        (c.admissionDate ? istInstant(c.admissionDate) : null),
    }))
    .filter((c): c is typeof c & { at: Date } => inPeriod(c.at));
  return shown(await creditedTo(db, q.ownerStaffIds, confirmed), (c) => ({
    id: c.id,
    title: `Admission ${c.admissionNumber} (${c.code}: ${c.name})`,
    at: c.at,
    href: leadHref(c.leadId),

    ...(c.ownerNote ? { ownerNote: c.ownerNote } : {}),
  }));
}

type Window = Pick<LeadMetricQuery, 'from' | 'to' | 'cutoff' | 'base'> & {
  ownerStaffIds?: string[] | 'all';
};

/** Scope, IST period bounds and owner filter shared by every metric. */
async function window(db: Database, actor: Actor, q: Window) {
  const reader = await accessScope(db, actor, 'ops:leads:read');
  const access = leadScope(db, reader);
  const ids = q.ownerStaffIds ?? 'all';
  // Reading their own credit: records from ownership history count even after a reassignment.
  const self =
    reader.scope === 'own' &&
    !!reader.staffId &&
    Array.isArray(ids) &&
    ids.length === 1 &&
    ids[0] === reader.staffId;
  const start = istInstant(q.from);
  const endDay = istInstant(addDays(q.to, 1));
  const end = q.cutoff && q.cutoff < endDay ? q.cutoff : endDay;
  return {
    scope: ids !== 'all' && ids.length === 0 ? null : self ? sql`true` : access,
    start,
    end,
    inPeriod: (at: Date | null): at is Date => !!at && at >= start && at < end,
    owners: (col: unknown) => (ids === 'all' ? undefined : inArray(col as never, ids as never[])),
    leadHref: (id: string) => `${q.base ?? '/marketing'}/leads/${id}`,
    /** Records as the reader may see them: leads they can no longer open are redacted. */
    shown: async <T extends { leadId: string }, R extends LeadMetricRecord>(
      items: T[],
      record: (i: T) => R,
    ): Promise<R[]> => {
      if (!self || !access || items.length === 0) return items.map(record);
      const open = new Set(
        (
          await db
            .select({ id: opsLeads.id })
            .from(opsLeads)
            .where(and(access, inArray(opsLeads.id, items.map((i) => i.leadId) as never[])))
        ).map((l) => l.id as string),
      );
      return items.map((i) =>
        open.has(i.leadId) ? record(i) : { ...record(i), title: REDACTED_LEAD, href: null },
      );
    },
  };
}

export const LEAD_STAGE_ENTRY_DEFINITION =
  'Leads that entered this stage for the first time between these dates (India time), whatever stage they are in now. A lead counts once per stage. Marketing employees count only their own leads.';

/**
 * "Reached stage X in the period": the first time each lead ever entered a stage, when that
 * falls in the period (credited to whoever owned the lead at that moment). One row per lead and stage.
 */
export async function leadStageEntries(
  db: Database,
  actor: Actor,
  q: Window & { stageKey?: string },
): Promise<(LeadMetricRecord & { stageKey: string })[]> {
  const { scope, inPeriod, leadHref, shown } = await window(db, actor, q);
  if (!scope) return [];
  const rows = await db
    .select({
      leadId: opsLeads.id,
      code: opsLeads.code,
      name: opsLeads.studentName,
      stageKey: opsLeadStageHistory.toKey,
      at: opsLeadStageHistory.changedAt,
    })
    .from(opsLeadStageHistory)
    .innerJoin(opsLeads, eq(opsLeads.id, opsLeadStageHistory.leadId))
    .where(
      and(
        scope,
        isNull(opsLeads.mergedIntoLeadId),
        q.stageKey ? eq(opsLeadStageHistory.toKey, q.stageKey) : undefined,
      ),
    )
    .orderBy(asc(opsLeadStageHistory.changedAt));
  const first = new Map<string, (typeof rows)[number]>();
  for (const r of rows)
    if (!first.has(`${r.leadId}:${r.stageKey}`)) first.set(`${r.leadId}:${r.stageKey}`, r);
  const entered = [...first.values()].filter((r) => inPeriod(r.at));
  return shown(await creditedTo(db, q.ownerStaffIds ?? 'all', entered), (r) => ({
    id: r.leadId,
    stageKey: r.stageKey,
    title: `${r.code}: ${r.name}`,
    at: r.at,
    href: leadHref(r.leadId),

    ...(r.ownerNote ? { ownerNote: r.ownerNote } : {}),
  }));
}

/** Funnel of stage entries in the period, in stage order; drill-down = leadStageEntries(stageKey). */
export async function leadStageFunnel(db: Database, actor: Actor, q: Window) {
  const entries = await leadStageEntries(db, actor, q);
  const stages = await db.select().from(opsLeadStages).orderBy(asc(opsLeadStages.sortOrder));
  return stages
    .map((s) => ({
      key: s.key,
      label: s.label,
      active: s.active,
      count: entries.filter((e) => e.stageKey === s.key).length,
    }))
    .filter((s) => s.active || s.count > 0);
}

/**
 * Campaign outcome card: leads with an enquiry tagged `campaignCode`, how many had a demo
 * (not cancelled) and how many Ops admitted (confirmed admission), in the caller's lead scope.
 */
export async function campaignLeadOutcomes(db: Database, actor: Actor, campaignCode: string) {
  const scope = leadScope(db, await accessScope(db, actor, 'ops:leads:read'));
  const leadIds = scope
    ? (
        await db
          .selectDistinct({ id: opsLeads.id })
          .from(opsLeads)
          .innerJoin(opsEnquiries, eq(opsEnquiries.leadId, opsLeads.id))
          .where(
            and(
              scope,
              isNull(opsLeads.mergedIntoLeadId),
              eq(opsEnquiries.campaignRef, campaignCode),
            ),
          )
      ).map((r) => r.id)
    : [];
  if (leadIds.length === 0) return { leads: 0, demos: 0, admissions: 0 };
  const demos = await db
    .selectDistinct({ leadId: opsDemos.leadId })
    .from(opsDemos)
    .where(and(inArray(opsDemos.leadId, leadIds), ne(opsDemos.outcome, 'cancelled')));
  const cases = await db
    .select({
      leadId: opsAdmissions.leadId,
      status: opsAdmissions.status,
      admissionNumber: opsAdmissions.admissionNumber,
      legacyVerification: opsAdmissions.legacyVerification,
    })
    .from(opsAdmissions)
    .where(inArray(opsAdmissions.leadId, leadIds));
  return {
    leads: leadIds.length,
    demos: demos.length,
    admissions: new Set(cases.filter(isConfirmedAdmission).map((c) => c.leadId)).size,
  };
}

export const OWNER_WITHOUT_HISTORY = 'owner from current record (no history)';

/**
 * Items credited to `owners`: the lead's owner at each item's instant (reassignment-proof). A lead
 * with no ownership trail (migrated rows) falls back to its current owner and says so.
 */
async function creditedTo<T extends { leadId: string; at: Date }>(
  db: Database,
  owners: string[] | 'all',
  items: T[],
): Promise<(T & { ownerNote?: string })[]> {
  if (items.length === 0) return items;
  const owner = await ownedAt(db, items);
  return items.flatMap((i) => {
    const o = owner(i);
    if (owners !== 'all' && !owners.includes(o.staffId ?? '')) return [];
    return [o.fromHistory ? i : { ...i, ownerNote: OWNER_WITHOUT_HISTORY }];
  });
}

/** Owner of each lead at an instant, from the lead.created / lead.assigned audit trail. */
async function ownedAt(db: Database, items: { leadId: string; at: Date }[]) {
  const leadIds = [...new Set(items.map((i) => i.leadId))];
  const events = await db
    .select({ leadId: auditEvents.entityId, at: auditEvents.at, after: auditEvents.after })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.module, 'ops'),
        eq(auditEvents.entityType, 'lead'),
        inArray(auditEvents.action, ['lead.created', 'lead.assigned']),
        inArray(auditEvents.entityId, leadIds),
      ),
    )
    .orderBy(asc(auditEvents.at));
  const current = new Map(
    (
      await db
        .select({ id: opsLeads.id, ownerStaffId: opsLeads.ownerStaffId })
        .from(opsLeads)
        .where(inArray(opsLeads.id, leadIds as never[]))
    ).map((l) => [l.id as string, l.ownerStaffId as string | null]),
  );
  return (item: { leadId: string; at: Date }) => {
    const own = events.filter((e) => e.leadId === item.leadId);
    if (own.length === 0) return { staffId: current.get(item.leadId) ?? null, fromHistory: false };
    // A day-only confirmation can start before the lead's first event: then its first owner counts.
    const event = own.filter((e) => e.at <= item.at).at(-1) ?? own[0];
    const after = event?.after as { ownerStaffId?: string | null } | undefined;
    return { staffId: after?.ownerStaffId ?? null, fromHistory: true };
  };
}
