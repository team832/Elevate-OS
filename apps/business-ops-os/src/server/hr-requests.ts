/**
 * Requests sent through HR (owner brief 23 Oct 2026 §6), the only staff-to-staff channel. Staff
 * write a request (a draft, or straight to HR); the subject and message are fixed once it is
 * sent. HR reviews it, forwards it (its own note kept apart from the text the recipient sees),
 * resolves or declines it, relays the recipient's answer and may create a task from it. Every
 * step is an event row plus an audit row; notifications are in-app only, nothing leaves the app.
 */
import { eq } from 'drizzle-orm';
import { can, grantsForRole } from '@elevate/authorization';
import { loadRoles } from '@elevate/authentication';
import {
  opsHrRequestEvents as events,
  opsHrRequests as requests,
  type Database,
} from '@elevate/database';
import { fetchInternal, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  isAppError,
  teachingAssignmentsV1Schema,
} from '@elevate/shared-contracts';
import { ROLE_KEYS, type StaffMemberId, type UserId } from '@elevate/shared-types';
import {
  decideHrRequest,
  isEditable,
  type HrRequestAction,
  type HrRequestDecision,
} from '../domain/hr-requests';
import { academicUrl } from './academic-summary';
import {
  accessScope,
  activeStaff,
  notFound,
  scopeCovers,
  staffIdForUser,
  userIdsForStaff,
  userIdsWithRole,
  type Actor,
} from './context';
import type { HrActionBody, HrRequestInput, HrRequestPatch } from './hr-requests-schemas';
import { getHrRequest, hrCovers, inHrReach, viewerOn, type HrRequestRow } from './hr-requests-read';
import { fieldError, notifyOthers, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import { resolveStudent } from './student-profile-sources';
import { createTask } from './task-create';
import { notifyHosted } from './task-links';
import { loadTaskFor } from './task-store';

const audit = opsAudit('hr_request');
const CANNOT_LINK = 'You can link only a record you can already open.';

/** A module's 403/404 as false; any other error still throws. */
const opens = (p: Promise<unknown>) =>
  p.then(
    () => true,
    (e: unknown) => {
      if (isAppError(e) && (e.status === 403 || e.status === 404)) return false;
      throw e;
    },
  );

/**
 * The related record must be one the sender can already open: a task through the task rules, a
 * student through the student rules, a batch among their own teaching assignments in Academic
 * OS (checked before any write). Campaigns and tests cannot be checked from here yet, so they
 * are refused rather than stored unchecked.
 */
async function checkRelated(db: Database, actor: Actor, self: string, b: Partial<HrRequestInput>) {
  const { relatedKind: kind, relatedId: id } = b;
  if (!kind || kind === 'none' || !id) return;
  let ok: boolean;
  if (kind === 'task') ok = await opens(loadTaskFor(db, actor, id, false));
  else if (kind === 'student') {
    const access = can(actor, 'ops:students:read')
      ? await accessScope(db, actor, 'ops:students:read')
      : null;
    const found = access ? await resolveStudent(db, id).catch(() => null) : null;
    ok =
      !!access &&
      !!found &&
      scopeCovers(
        access,
        found.cases.flatMap((c) => [c.a.counsellorStaffId, c.lead.ownerStaffId]),
      );
  } else if (kind === 'batch') {
    const r = await fetchInternal(
      academicUrl(`/academic/api/internal/v1/teaching-assignments?staffId=${self}&pageSize=100`),
      teachingAssignmentsV1Schema,
      { caller: 'ops', timeoutMs: 3000 },
    );
    if (r.status !== 'available')
      throw fieldError(
        'relatedId',
        `Source unavailable: Academic OS could not confirm the batch (${r.reason}). Try again, or name it in your message.`,
      );
    ok = r.data.items.some((a) => a.batchId === id);
  } else
    throw fieldError(
      'relatedKind',
      'Campaigns and tests cannot be checked from here yet. Name it in your message.',
    );
  if (!ok) throw new ForbiddenError(CANNOT_LINK);
}

/** `hr` | `staff:<id>` | `key:<k>` → the two columns; a staff member must be active, not you. */
async function recipientOf(db: Database, value: string | undefined, self: string) {
  if (value === undefined) return {};
  const [kind, ref] = value.split(':') as [string, string | undefined];
  if (kind === 'staff') {
    if (ref === self) throw fieldError('recipient', 'Choose someone other than yourself.');
    await activeStaff(db, ref!, 'recipient');
    return { recipientStaffId: ref as StaffMemberId, recipientKey: null };
  }
  if (kind === 'key') {
    const named = (await loadSettings(db))['hr.request_recipients'].value;
    if (!Object.hasOwn(named, ref!))
      throw fieldError('recipient', 'That recipient is not configured.');
    return { recipientStaffId: null, recipientKey: ref! };
  }
  return { recipientStaffId: null, recipientKey: null };
}

async function checkCategory(db: Database, code: string | undefined) {
  if (code === undefined) return;
  const list = (await loadSettings(db))['hr.request_categories'].value.categories;
  if (!list.some((c) => c.code === code)) throw fieldError('category', 'Choose a category.');
}

/** Everyone who may manage this sender's request (HR with a department scope only inside it). */
async function hrInbox(db: Database, senderStaffId: string): Promise<UserId[]> {
  const holders = new Set<UserId>();
  for (const role of ROLE_KEYS.filter((r) => grantsForRole(r).has('ops:hr_requests:manage')))
    for (const id of await userIdsWithRole(db, role)) holders.add(id);
  const out: UserId[] = [];
  for (const id of holders) {
    const hr: Actor = { id, roles: await loadRoles(db, id) };
    if ((await hrCovers(db, hr, senderStaffId, await staffIdForUser(db, id))).manage) out.push(id);
  }
  return out;
}

const newRequest = (r: HrRequestRow) =>
  `${r.urgency === 'urgent' ? 'Urgent request' : 'New request'} through HR: ${r.subject}`;
const TO_SENDER: Partial<Record<HrRequestAction, string>> = {
  resolve: 'Your request was resolved',
  decline: 'Your request was declined',
  relay: 'HR passed on an answer to your request',
};

const notifyHr = async (tx: Database, actor: Actor, r: HrRequestRow, kind: string, title: string) =>
  notifyOthers(tx, actor, await hrInbox(tx, r.senderStaffId), {
    kind,
    title,
    link: `/ops/hr/requests?open=${r.id}`,
    entityType: 'hr_request',
    entityId: r.id,
  });

const notifyStaffOf = async (
  tx: Database,
  actor: Actor,
  staffId: string,
  r: HrRequestRow,
  kind: string,
  title: string,
  tab = '',
) =>
  notifyHosted(
    tx,
    actor,
    await userIdsForStaff(tx, [staffId]),
    'work',
    `/hr-requests?${tab}open=${r.id}`,
    {
      kind,
      title,
      entityType: 'hr_request',
      entityId: r.id,
    },
  );

/** Write a request as a draft, or send it to HR straight away. */
export async function createHrRequest(
  db: Database,
  actor: Actor,
  body: HrRequestInput,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:hr_requests:create');
  const self = (await staffIdForUser(db, actor.id)) ?? notFound('Staff record');
  await checkCategory(db, body.category);
  const to = await recipientOf(db, body.recipient, self);
  await checkRelated(db, actor, self, body);
  const id = await withTransaction(db, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(requests)
      .values({
        senderStaffId: self,
        ...to,
        category: body.category,
        subject: body.subject,
        message: body.message,
        relatedKind: body.relatedKind,
        relatedId: body.relatedKind === 'none' ? null : body.relatedId,
        urgency: body.urgency,
        status: body.draft ? 'draft' : 'submitted',
        submittedAt: body.draft ? null : now,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, row!.id, 'hr_request.created', { after: row }, requestId);
    if (!body.draft) {
      await tx
        .insert(events)
        .values({ requestId: row!.id, kind: 'submitted', actorUserId: actor.id });
      await notifyHr(tx, actor, row!, 'hr_request.submitted', newRequest(row!));
    }
    return row!.id;
  });
  return getHrRequest(db, actor, id);
}

/** Change your draft; once sent, the subject and message never change (409). */
export async function updateHrRequest(
  db: Database,
  actor: Actor,
  id: string,
  patch: HrRequestPatch,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:hr_requests:create');
  const self = (await staffIdForUser(db, actor.id)) ?? notFound('Request');
  const current = await rowById(db, requests, id, 'Request');
  if (current.senderStaffId !== self) notFound('Request');
  if (!isEditable(current.status))
    throw new ConflictError('A request cannot be changed once it is sent to HR.');
  await checkCategory(db, patch.category);
  const to = await recipientOf(db, patch.recipient, self);
  await checkRelated(db, actor, self, patch);
  await withTransaction(db, async (tx) => {
    const before = await rowById(tx, requests, id, 'Request', true);
    if (!isEditable(before.status))
      throw new ConflictError('A request cannot be changed once it is sent to HR.');
    const { recipient: _r, relatedKind, relatedId, ...rest } = patch;
    const [after] = await tx
      .update(requests)
      .set({
        ...rest,
        ...to,
        ...(relatedKind
          ? { relatedKind, relatedId: relatedKind === 'none' ? null : relatedId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(requests.id, before.id))
      .returning();
    await audit(tx, actor, id, 'hr_request.updated', { before, after }, requestId);
  });
  return getHrRequest(db, actor, id);
}

function refuse(d: HrRequestDecision): asserts d is Extract<HrRequestDecision, { ok: true }> {
  if (d.ok) return;
  if (d.code === 'forbidden') throw new ForbiddenError(d.message);
  if (d.code === 'body') throw fieldError('body', d.message);
  throw new InvalidStateTransitionError(d.message);
}

/**
 * Where HR forwards: the person it names, else the intended (or configured) recipient. HR may
 * route to the sender's intended recipient, the configured person for a role (e.g. Schar), or
 * staff inside its own department scope; anyone else is refused (403).
 */
async function forwardTarget(
  db: Database,
  actor: Actor,
  r: HrRequestRow,
  toStaffId: string | null | undefined,
) {
  const named = (await loadSettings(db))['hr.request_recipients'].value;
  const configured =
    r.recipientKey && Object.hasOwn(named, r.recipientKey) ? named[r.recipientKey] : null;
  const id = toStaffId ?? r.recipientStaffId ?? configured;
  if (!id)
    throw new ConflictError(
      r.recipientKey
        ? `Recipient not set up: ${r.recipientKey}. Set them in HR settings or choose a person.`
        : 'Choose who to forward it to.',
    );
  const person = await activeStaff(db, id, 'toStaffId');
  if (!person.userId) throw fieldError('toStaffId', `${person.fullName} has no login yet.`);
  if (person.id === r.senderStaffId)
    throw fieldError('toStaffId', 'That is the sender. Resolve the request instead.');
  const intended = person.id === r.recipientStaffId || person.id === configured;
  if (!intended && !(await inHrReach(db, actor, person.id)))
    throw new ForbiddenError(
      `${person.fullName} is outside the departments you manage. Ask an operations manager to route it.`,
    );
  return person;
}

/** One step on a request: the sender's, HR's or the recipient's (domain/hr-requests.ts). */
export async function hrRequestAction(
  db: Database,
  actor: Actor,
  id: string,
  action: HrRequestAction,
  body: HrActionBody,
  requestId?: string,
) {
  const text = action === 'note' ? (body.hrNote ?? body.body) : body.body;
  const t = body.task;
  // createTask checks batch and subject links with Academic OS over the network: not while the request is locked.
  if (action === 'create_task' && (t?.relatedRef || t?.relatedKind || t?.relatedId))
    throw fieldError(
      'task.relatedRef',
      'A task made from a request cannot link a batch or subject here. Add the link on the task afterwards.',
    );
  await withTransaction(db, async (tx) => {
    const before = await rowById(tx, requests, id, 'Request', true);
    const v = await viewerOn(tx, actor, before);
    if (!v.roles.length && !v.hrRead) notFound('Request');
    const d = decideHrRequest(action, before.status, v.roles, text);
    refuse(d);
    const now = new Date();
    const event: typeof events.$inferInsert = {
      requestId: before.id,
      kind: d.event,
      actorUserId: actor.id,
      // Only HR writes HR notes; anything else sent as one is dropped.
      hrNote: !v.roles.includes('hr') ? null : action === 'note' ? text : (body.hrNote ?? null),
      body: action === 'note' ? null : (body.body ?? null),
    };
    let set: Partial<HrRequestRow> = {};
    if (action === 'submit') {
      if (!before.message.trim()) throw fieldError('message', 'Write your message.');
      set = { submittedAt: now };
    }
    if (action === 'forward') {
      const to = await forwardTarget(tx, actor, before, body.toStaffId);
      Object.assign(event, { forwardedToStaffId: to.id, visibleToRecipient: true });
    }
    if (action === 'respond') event.visibleToRecipient = true;
    if (d.to === 'resolved' || d.to === 'declined') set = { decidedAt: now };
    if (action === 'create_task') {
      if (before.linkedTaskId)
        throw new ConflictError('A task was already created from this request.');
      if (!body.task) throw fieldError('task.title', 'Describe the task.');
      const task = await createTask(tx, actor, body.task, requestId);
      set = { linkedTaskId: task.id };
      event.body = task.title;
    }
    const [after] = await tx
      .update(requests)
      .set({ ...set, status: d.to ?? before.status, updatedAt: now })
      .where(eq(requests.id, before.id))
      .returning();
    await tx.insert(events).values(event);
    await audit(
      tx,
      actor,
      id,
      `hr_request.${action}`,
      { before, after, metadata: { event: d.event } },
      requestId,
    );
    await notifyFor(tx, actor, action, after!, event);
  });
  return getHrRequest(db, actor, id);
}

/** In-app only: submit and replies → HR; a forward → its recipient; decisions and relays → the sender. */
async function notifyFor(
  tx: Database,
  actor: Actor,
  action: HrRequestAction,
  r: HrRequestRow,
  e: typeof events.$inferInsert,
) {
  if (action === 'submit') return notifyHr(tx, actor, r, 'hr_request.submitted', newRequest(r));
  if (action === 'respond')
    return notifyHr(
      tx,
      actor,
      r,
      'hr_request.recipient_responded',
      `Reply to a forwarded request: ${r.subject}`,
    );
  if (action === 'forward')
    return notifyStaffOf(
      tx,
      actor,
      e.forwardedToStaffId!,
      r,
      'hr_request.forwarded',
      'HR forwarded a request to you',
      'tab=forwarded&',
    );
  const title = TO_SENDER[action];
  if (title)
    return notifyStaffOf(
      tx,
      actor,
      r.senderStaffId,
      r,
      `hr_request.${action}`,
      `${title}: ${r.subject}`,
    );
}
