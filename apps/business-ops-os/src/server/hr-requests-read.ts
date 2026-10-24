/**
 * Requests through HR, read side (owner brief 23 Oct 2026 §6): who someone is on a request
 * (sender, HR covering the sender, recipient of a forward), the HR queue with tab counts from the
 * same query, the sender's and the recipient's lists, one request as that viewer may see it, and
 * the file rule for `hr_request` attachments. HR never sees drafts; nobody handles their own request.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { can } from '@elevate/authorization';
import {
  opsHrRequestEvents as events,
  opsHrRequests as requests,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  decideHrRequest,
  eventsFor,
  HR_QUEUE_TABS,
  HR_REQUEST_ACTIONS,
  recipientKeyLabel,
  resolveRecipient,
  type HrQueueTab,
  type HrRequestRole,
} from '../domain/hr-requests';
import { accessScope, notFound, staffIdForUser, type Actor } from './context';
import type { HrRequestListQuery } from './hr-requests-schemas';
import { hrReachWhere, hrScopeFor } from './hr-scope';
import { rowById } from './ops-common';
import { loadSettings } from './settings';

export type HrRequestRow = typeof requests.$inferSelect;
export const HR_REQUESTS_PAGE_SIZE = 25;
const isUuid = (id: string) => z.uuid().safeParse(id).success;

/** HR's reach over one sender: the permission, HR's department scope, and never your own request. */
export async function hrCovers(db: Database, actor: Actor, sender: string, self: string | null) {
  const read = can(actor, 'ops:hr_requests:read');
  const manage = can(actor, 'ops:hr_requests:manage');
  if ((!read && !manage) || sender === self) return { read: false, manage: false };
  const hit = await inHrReach(db, actor, sender);
  return { read: read && hit, manage: manage && hit };
}

/** The staff member is inside the caller's HR department scope (no scope = everyone). */
export async function inHrReach(db: Database, actor: Actor, staffId: string) {
  const scope = await hrScopeFor(db, actor);
  if (!scope) return true;
  const [hit] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(eq(staffMembers.id, staffId as StaffMemberId), hrReachWhere(actor, scope)));
  return !!hit;
}

/** The caller's roles on a request; `hr` = may manage it. Drafts belong to their sender alone. */
export async function viewerOn(db: Database, actor: Actor, r: HrRequestRow) {
  const self = await staffIdForUser(db, actor.id);
  const draft = r.status === 'draft';
  const staffSide = !!self && can(actor, 'ops:hr_requests:create');
  const hr = draft
    ? { read: false, manage: false }
    : await hrCovers(db, actor, r.senderStaffId, self);
  const [forwarded] =
    staffSide && !draft
      ? await db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.requestId, r.id),
              eq(events.kind, 'forwarded'),
              eq(events.forwardedToStaffId, self),
              eq(events.visibleToRecipient, true),
            ),
          )
          .limit(1)
      : [];
  const sender = staffSide && r.senderStaffId === self;
  const roles: HrRequestRole[] = [
    ...(sender ? (['sender'] as const) : []),
    ...(hr.manage ? (['hr'] as const) : []),
    ...(forwarded ? (['recipient'] as const) : []),
  ];
  return { self, roles, sender, hrRead: hr.read || hr.manage, recipient: !!forwarded };
}

/**
 * Files on a request (`owner_id` = the request) are the sender's and HR's: the sender adds them
 * while it is a draft. Files HR shares with a recipient sit on HR's forward (`owner_id` = that
 * `forwarded` event): HR and that one recipient read them, HR adds them.
 */
export async function hrRequestFileAccess(db: Database, user: Actor, ownerId: string) {
  const none = { canRead: false, canWrite: false };
  if (!isUuid(ownerId)) return none;
  const [direct] = await db
    .select()
    .from(requests)
    .where(eq(requests.id, ownerId as never));
  if (direct) {
    const v = await viewerOn(db, user, direct);
    return {
      canRead: v.sender || v.hrRead,
      canWrite: (v.sender && direct.status === 'draft') || v.roles.includes('hr'),
    };
  }
  const [hit] = await db
    .select({ r: requests, to: events.forwardedToStaffId })
    .from(events)
    .innerJoin(requests, eq(requests.id, events.requestId))
    .where(and(eq(events.id, ownerId), eq(events.kind, 'forwarded')));
  if (!hit) return none;
  const v = await viewerOn(db, user, hit.r);
  return {
    canRead: v.hrRead || (v.recipient && hit.to === v.self),
    canWrite: v.roles.includes('hr'),
  };
}

/** Category labels and named recipients from the settings, and who a request is for. */
async function lookups(db: Database, staffIds: readonly (string | null)[] = []) {
  const s = await loadSettings(db);
  const named = s['hr.request_recipients'].value;
  const ids = [...new Set([...Object.values(named), ...staffIds].filter(Boolean))] as string[];
  const staff = ids.length
    ? await db
        .select({ id: staffMembers.id, name: staffMembers.fullName, status: staffMembers.status })
        .from(staffMembers)
        .where(inArray(staffMembers.id, ids as StaffMemberId[]))
    : [];
  const byId = new Map(staff.map((p) => [p.id as string, p]));
  const categories = s['hr.request_categories'].value.categories;
  return {
    named,
    categories,
    categoryLabel: (code: string) => categories.find((c) => c.code === code)?.label ?? code,
    recipientOf: (r: Pick<HrRequestRow, 'recipientStaffId' | 'recipientKey'>) => {
      const to = resolveRecipient(r, named, (id) => byId.get(id)?.status === 'active');
      if (to.kind === 'hr') return { label: 'HR', unresolved: null };
      if (to.kind === 'unresolved')
        return { label: recipientKeyLabel(to.key), unresolved: to.note };
      const name = byId.get(to.staffId)?.name ?? 'Staff member';
      return {
        label: r.recipientKey ? `${recipientKeyLabel(r.recipientKey)} (${name})` : name,
        unresolved: null,
      };
    },
  };
}

/** Active staff with a login (who a request can be for, or forwarded to), by name. */
export async function activeStaffOptions(db: Database, exclude?: string | null) {
  const rows = await db
    .select({ id: staffMembers.id, name: staffMembers.fullName })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.status, 'active'),
        isNotNull(staffMembers.userId),
        exclude ? ne(staffMembers.id, exclude as StaffMemberId) : undefined,
      ),
    )
    .orderBy(asc(staffMembers.fullName));
  return rows.map((p) => ({ value: p.id as string, label: p.name }));
}

/** The new-request form: categories and who a request can be for (HR, named roles, colleagues). */
export async function requestFormOptions(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:hr_requests:create');
  const { named, categories } = await lookups(db);
  const staff = await activeStaffOptions(db, await staffIdForUser(db, actor.id));
  return {
    categories: categories.map((c) => ({ value: c.code, label: c.label })),
    recipients: [
      { value: 'hr', label: 'HR (no one else)' },
      ...Object.keys(named).map((k) => ({ value: `key:${k}`, label: recipientKeyLabel(k) })),
      ...staff.map((p) => ({ value: `staff:${p.value}`, label: p.label })),
    ],
  };
}

const listColumns = {
  id: requests.id,
  subject: requests.subject,
  category: requests.category,
  urgency: requests.urgency,
  status: requests.status,
  submittedAt: requests.submittedAt,
  decidedAt: requests.decidedAt,
  createdAt: requests.createdAt,
  recipientStaffId: requests.recipientStaffId,
  recipientKey: requests.recipientKey,
  linkedTaskId: requests.linkedTaskId,
  isSample: requests.isSample,
  senderName: staffMembers.fullName,
};

async function withLabels<
  R extends Pick<HrRequestRow, 'category' | 'recipientStaffId' | 'recipientKey'>,
>(db: Database, rows: R[]) {
  const l = await lookups(
    db,
    rows.map((r) => r.recipientStaffId),
  );
  return rows.map((r) => ({
    ...r,
    categoryLabel: l.categoryLabel(r.category),
    recipient: l.recipientOf(r),
  }));
}

/** The HR queue: one tab's page, and every tab's count from the same WHERE. */
export async function hrQueue(db: Database, actor: Actor, q: HrRequestListQuery) {
  await accessScope(db, actor, 'ops:hr_requests:read');
  const self = await staffIdForUser(db, actor.id);
  const text = q.q ? `%${q.q}%` : null;
  const where = and(
    ne(requests.status, 'draft'),
    self ? ne(requests.senderStaffId, self) : undefined,
    hrReachWhere(actor, await hrScopeFor(db, actor)),
    q.urgency ? eq(requests.urgency, q.urgency) : undefined,
    q.category ? eq(requests.category, q.category) : undefined,
    text ? or(ilike(requests.subject, text), ilike(staffMembers.fullName, text)) : undefined,
  );
  const byStatus = await db
    .select({ status: requests.status, n: count() })
    .from(requests)
    .innerJoin(staffMembers, eq(staffMembers.id, requests.senderStaffId))
    .where(where)
    .groupBy(requests.status);
  const counts = Object.fromEntries(
    HR_QUEUE_TABS.map((t) => [
      t.key,
      byStatus
        .filter((b) => (t.statuses as readonly string[]).includes(b.status))
        .reduce((n, b) => n + b.n, 0),
    ]),
  ) as Record<HrQueueTab, number>;
  const tab = HR_QUEUE_TABS.find((t) => t.key === q.tab) ?? HR_QUEUE_TABS[0];
  const page = Number(q.page ?? 1);
  const rows = await db
    .select(listColumns)
    .from(requests)
    .innerJoin(staffMembers, eq(staffMembers.id, requests.senderStaffId))
    .where(and(where, inArray(requests.status, [...tab.statuses])))
    .orderBy(tab.key === 'closed' ? desc(requests.decidedAt) : asc(requests.submittedAt))
    .limit(HR_REQUESTS_PAGE_SIZE)
    .offset((page - 1) * HR_REQUESTS_PAGE_SIZE);
  return {
    tab: tab.key,
    counts,
    rows: await withLabels(db, rows),
    total: counts[tab.key],
    page,
    pageSize: HR_REQUESTS_PAGE_SIZE,
  };
}

/** Requests you sent, newest first. */
export async function listMyRequests(db: Database, actor: Actor, page = 1) {
  await accessScope(db, actor, 'ops:hr_requests:create');
  const self = await staffIdForUser(db, actor.id);
  if (!self) return { rows: [], total: 0, page, pageSize: HR_REQUESTS_PAGE_SIZE };
  const mine = eq(requests.senderStaffId, self);
  const [total] = await db.select({ n: count() }).from(requests).where(mine);
  const rows = await db
    .select(listColumns)
    .from(requests)
    .innerJoin(staffMembers, eq(staffMembers.id, requests.senderStaffId))
    .where(mine)
    .orderBy(desc(requests.createdAt))
    .limit(HR_REQUESTS_PAGE_SIZE)
    .offset((page - 1) * HR_REQUESTS_PAGE_SIZE);
  return {
    rows: await withLabels(db, rows),
    total: total?.n ?? 0,
    page,
    pageSize: HR_REQUESTS_PAGE_SIZE,
  };
}

/**
 * What HR forwarded to you (only forwards to you marked visible), newest first, one row per
 * request, and whether you have replied since. Never the sender's own words.
 * shortcut: the latest 100 forwards; page this if one person ever receives more.
 */
export async function listForwardedToMe(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:hr_requests:create');
  const self = await staffIdForUser(db, actor.id);
  if (!self) return [];
  const forwards = await db
    .select({
      requestId: events.requestId,
      body: events.body,
      at: events.createdAt,
      status: requests.status,
      urgency: requests.urgency,
      category: requests.category,
    })
    .from(events)
    .innerJoin(requests, eq(requests.id, events.requestId))
    .where(
      and(
        eq(events.kind, 'forwarded'),
        eq(events.forwardedToStaffId, self),
        eq(events.visibleToRecipient, true),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(100);
  const latest = forwards.filter(
    (f, i) => forwards.findIndex((g) => g.requestId === f.requestId) === i,
  );
  const replies = latest.length
    ? await db
        .select({ requestId: events.requestId, at: events.createdAt })
        .from(events)
        .where(
          and(
            eq(events.kind, 'recipient_responded'),
            eq(events.actorUserId, actor.id),
            inArray(
              events.requestId,
              latest.map((f) => f.requestId),
            ),
          ),
        )
    : [];
  const l = await lookups(db);
  return latest.map((f) => ({
    ...f,
    categoryLabel: l.categoryLabel(f.category),
    replied: replies.some((r) => r.requestId === f.requestId && r.at >= f.at),
  }));
}

/** One request as the caller may see it (404 when they have no part in it). */
export async function getHrRequest(db: Database, actor: Actor, id: string) {
  if (!isUuid(id)) notFound('Request');
  const r = await rowById(db, requests, id, 'Request');
  const v = await viewerOn(db, actor, r);
  const as: 'hr' | 'sender' | 'recipient' = v.hrRead
    ? 'hr'
    : v.sender
      ? 'sender'
      : v.recipient
        ? 'recipient'
        : notFound('Request');
  const rows = await db
    .select({
      id: events.id,
      kind: events.kind,
      actorUserId: events.actorUserId,
      actorName: users.displayName,
      forwardedToStaffId: events.forwardedToStaffId,
      forwardedToName: staffMembers.fullName,
      visibleToRecipient: events.visibleToRecipient,
      hrNote: events.hrNote,
      body: events.body,
      createdAt: events.createdAt,
    })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorUserId))
    .leftJoin(staffMembers, eq(staffMembers.id, events.forwardedToStaffId))
    .where(eq(events.requestId, r.id))
    .orderBy(asc(events.createdAt));
  const viewer =
    as === 'recipient'
      ? { as: 'recipient' as const, staffId: v.self!, userId: actor.id }
      : { as: as === 'hr' ? ('hr' as const) : ('sender' as const) };
  const shown = eventsFor(viewer, rows).map(({ actorUserId, ...e }) =>
    as === 'hr'
      ? { ...e, actorUserId }
      : { ...e, forwardedToName: null, actorName: actorUserId === actor.id ? 'You' : 'HR' },
  );
  const allowed = HR_REQUEST_ACTIONS.filter(
    (a) =>
      decideHrRequest(a, r.status, v.roles, 'x').ok && !(a === 'create_task' && r.linkedTaskId),
  );
  const l = await lookups(db, [r.recipientStaffId]);
  const common = {
    id: r.id,
    as,
    status: r.status,
    urgency: r.urgency,
    categoryLabel: l.categoryLabel(r.category),
    events: shown,
    allowed,
    isSample: r.isSample,
  };
  if (as === 'recipient') return { ...common, request: null };
  const [sender] = await db
    .select({ name: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.id, r.senderStaffId));
  return {
    ...common,
    request: {
      ...r,
      // The task HR made is HR's to share; the sender may not be able to open it.
      linkedTaskId: as === 'hr' ? r.linkedTaskId : null,
      senderName: sender?.name ?? 'Staff member',
      recipient: l.recipientOf(r),
    },
  };
}
export type HrRequestView = Awaited<ReturnType<typeof getHrRequest>>;
