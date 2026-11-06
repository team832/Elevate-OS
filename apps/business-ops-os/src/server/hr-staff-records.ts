/**
 * Staff joining / leaving checklists and the staff asset register (F4-09). Templates are versioned
 * per event like student onboarding (retireForNextVersion); a checklist copies the items of the
 * version it was started from. HR reads within its staff reach (ops:hr:read) and changes within
 * its remit (ops:staff:manage, never your own record). A tag is out with one person at a time.
 * Every change is audited. The leaver hand-over notice reads leaverOpenRecords.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  OPS_STAFF_CHECKLIST_EVENTS as EVENTS,
  OPS_STAFF_CHECKLIST_ITEM_STATUSES as ITEM_STATUSES,
  opsStaffAssets as assets,
  opsStaffChecklistItems as items,
  opsStaffChecklists as checklists,
  opsStaffChecklistTemplates as templates,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { containsPattern, csvResponse, toCsv, withTransaction } from '@elevate/server-kit';
import { ConflictError, isoDateSchema, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain';
import { accessScope, notFound, staffIdForUser, type Actor } from './context';
import { hrReachWhere, hrScopeFor } from './hr-scope';
import { scopedStaff } from './hr-staff';
import { assertRemit } from './hr-staff-actions';
import { retireForNextVersion } from './onboarding-templates';
import { fieldError, opsAudit, rowById } from './ops-common';

export type ChecklistEvent = (typeof EVENTS)[number];
export type ChecklistItemStatus = (typeof ITEM_STATUSES)[number];
export const CHECKLIST_EVENT_LABELS: Record<ChecklistEvent, string> = {
  joining: 'Joining',
  leaving: 'Leaving',
};
export const CHECKLIST_ITEM_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  not_applicable: 'Not applicable',
};
export const ASSET_VIEWS = ['out', 'returned', 'all'] as const;
export const STAFF_RECORDS_PAGE_SIZE = 25;
const EXPORT_MAX_ROWS = 5000;

const text = (max: number) => z.string().trim().max(max);
const note = (max = 300) => text(max).nullish();
const page = z.coerce.number().int().min(1).max(10_000).optional();
/** "ID card issued" → `id_card_issued`: the key a checklist row keeps across versions. */
const keyOf = (label: string) => {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return (/^[a-z]/.test(k) ? k : `item_${k}`).slice(0, 60);
};

export const checklistTemplateBody = z
  .object({
    event: z.enum(EVENTS),
    /** One item per line. */
    items: z
      .string()
      .transform((s) =>
        s
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(text(120).min(2, 'Each item needs at least 2 characters'))
          .min(1, 'List at least one item')
          .max(40),
      ),
  })
  .strict();
export const checklistStartBody = z
  .object({ staffId: z.uuid('Choose a staff member'), event: z.enum(EVENTS) })
  .strict();
export const checklistItemBody = z
  .object({ status: z.enum(ITEM_STATUSES), note: note(500) })
  .strict();
export const assetIssueBody = z
  .object({
    staffId: z.uuid('Choose a staff member'),
    assetType: text(60).min(2, 'Say what it is, e.g. ID card or laptop'),
    tag: text(60).nullish(),
    description: note(),
    issuedOn: isoDateSchema,
    conditionNote: note(),
  })
  .strict();
export const assetReturnBody = z
  .object({ returnedOn: isoDateSchema, conditionNote: note() })
  .strict();
export const checklistListQuery = z.object({ event: z.enum(EVENTS).optional(), page }).strict();
export const assetListQuery = z
  .object({ view: z.enum(ASSET_VIEWS).optional(), q: text(100).optional(), page })
  .strict();

const audit = opsAudit('staff_record');
const doneBy = alias(users, 'done_by');
const issuedBy = alias(users, 'issued_by');
const returnedBy = alias(users, 'returned_by');

/** Rows whose staff member the reader reaches in HR (their scope; never limited for others). */
async function reach(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:hr:read');
  return hrReachWhere(actor, await hrScopeFor(db, actor));
}

/** The staff row a change may touch, locked: in the actor's reach and remit, never their own. */
async function staffToChange(tx: Database, actor: Actor, staffId: string) {
  const staff = await scopedStaff(tx, actor, staffId, true);
  await assertRemit(tx, actor, staff);
  return staff;
}

const today = () => istToday(new Date());
/** Items in their template's order (an item row keeps no position of its own). */
const inTemplateOrder = <R extends { itemKey: string }>(
  rows: R[],
  order: readonly { key: string }[],
) =>
  rows.toSorted(
    (a, b) =>
      order.findIndex((i) => i.key === a.itemKey) - order.findIndex((i) => i.key === b.itemKey),
  );
const notFuture = (path: string, day: string) => {
  if (day > today()) throw fieldError(path, 'This date is in the future.');
};

// ---- Templates ------------------------------------------------------------------------------

/** Every template version, newest first per event. */
export async function checklistTemplates(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:hr:read');
  return db.select().from(templates).orderBy(asc(templates.event), desc(templates.version));
}

/** Publish the next version of an event's template (active; checklists started keep theirs). */
export async function publishChecklistTemplate(
  db: Database,
  actor: Actor,
  input: z.output<typeof checklistTemplateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:hr_settings:manage');
  const list = input.items.map((label) => ({ key: keyOf(label), label }));
  const twice = list.find((x, i) => list.findIndex((y) => y.key === x.key) !== i);
  if (twice) throw fieldError('items', `"${twice.label}" is listed twice.`);
  return withTransaction(db, async (tx) => {
    const version = await retireForNextVersion(tx, templates, eq(templates.event, input.event));
    const [row] = await tx
      .insert(templates)
      .values({ event: input.event, version, items: list, status: 'active', createdBy: actor.id })
      .returning();
    await audit(
      tx,
      actor,
      row!.id,
      'staff_checklist.template_published',
      { after: row },
      requestId,
    );
    return row!;
  });
}

// ---- Checklists -----------------------------------------------------------------------------

/** Staff checklists in reach, newest first, with pending / total item counts. */
export async function listStaffChecklists(
  db: Database,
  actor: Actor,
  q: z.output<typeof checklistListQuery> & { pageSize?: number },
) {
  const where = and(await reach(db, actor), q.event ? eq(checklists.event, q.event) : undefined);
  const size = q.pageSize ?? STAFF_RECORDS_PAGE_SIZE;
  const [total] = await db
    .select({ n: count() })
    .from(checklists)
    .innerJoin(staffMembers, eq(staffMembers.id, checklists.staffId))
    .where(where);
  const rows = await db
    .select({
      id: checklists.id,
      event: checklists.event,
      staffId: checklists.staffId,
      staffName: staffMembers.fullName,
      version: templates.version,
      createdAt: checklists.createdAt,
      isSample: checklists.isSample,
      items: sql<number>`count(${items.id})::int`,
      pending: sql<number>`(count(${items.id}) filter (where ${items.status} = 'pending'))::int`,
    })
    .from(checklists)
    .innerJoin(staffMembers, eq(staffMembers.id, checklists.staffId))
    .innerJoin(templates, eq(templates.id, checklists.templateId))
    .leftJoin(items, eq(items.checklistId, checklists.id))
    .where(where)
    .groupBy(checklists.id, staffMembers.fullName, templates.version)
    .orderBy(desc(checklists.createdAt), asc(staffMembers.fullName))
    .limit(size)
    .offset(((q.page ?? 1) - 1) * size);
  return { rows, total: total?.n ?? 0, page: q.page ?? 1, pageSize: size };
}

/** One checklist with its items and who marked each (404 outside the reader's reach). */
export async function getStaffChecklist(db: Database, actor: Actor, id: string) {
  const where = await reach(db, actor);
  const [c] = await db
    .select({
      c: checklists,
      staffName: staffMembers.fullName,
      version: templates.version,
      order: templates.items,
    })
    .from(checklists)
    .innerJoin(staffMembers, eq(staffMembers.id, checklists.staffId))
    .innerJoin(templates, eq(templates.id, checklists.templateId))
    .where(and(eq(checklists.id, id), where));
  if (!c) notFound('Checklist');
  const rows = await db
    .select({
      id: items.id,
      itemKey: items.itemKey,
      label: items.label,
      status: items.status,
      note: items.note,
      doneAt: items.doneAt,
      doneByName: doneBy.displayName,
    })
    .from(items)
    .leftJoin(doneBy, eq(doneBy.id, items.doneBy))
    .where(eq(items.checklistId, id));
  return {
    ...c.c,
    staffName: c.staffName,
    version: c.version,
    items: inTemplateOrder(rows, c.order),
  };
}

/** Start a staff member's joining or leaving checklist from the event's active template. */
export async function startChecklist(
  db: Database,
  actor: Actor,
  input: z.output<typeof checklistStartBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const staff = await staffToChange(tx, actor, input.staffId);
    const [template] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.event, input.event), eq(templates.status, 'active')));
    const what = CHECKLIST_EVENT_LABELS[input.event].toLowerCase();
    if (!template)
      throw new ConflictError(
        `There is no ${what} checklist template yet. Publish one under Templates.`,
      );
    const [started] = await tx
      .select({ id: checklists.id })
      .from(checklists)
      .where(and(eq(checklists.staffId, staff.id), eq(checklists.event, input.event)));
    if (started) throw new ConflictError(`${staff.fullName} already has a ${what} checklist.`);
    const [row] = await tx
      .insert(checklists)
      .values({
        staffId: staff.id,
        event: input.event,
        templateId: template.id,
        createdBy: actor.id,
      })
      .returning();
    await tx
      .insert(items)
      .values(
        template.items.map((i) => ({ checklistId: row!.id, itemKey: i.key, label: i.label })),
      );
    await audit(
      tx,
      actor,
      row!.id,
      'staff_checklist.started',
      { after: row, metadata: { staffId: staff.id, version: template.version } },
      requestId,
    );
    return row!;
  });
}

/** Mark an item done, not applicable (who and when recorded) or back to pending. */
export async function setChecklistItem(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof checklistItemBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, items, id, 'Checklist item', true);
    const list = await rowById(tx, checklists, before.checklistId, 'Checklist');
    await staffToChange(tx, actor, list.staffId);
    const marked = input.status !== 'pending';
    const [after] = await tx
      .update(items)
      .set({
        status: input.status,
        doneBy: marked ? actor.id : null,
        doneAt: marked ? new Date() : null,
        note: input.note || null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id))
      .returning();
    await audit(tx, actor, id, 'staff_checklist.item_set', { before, after }, requestId);
    return after!;
  });
}

// ---- Assets ---------------------------------------------------------------------------------

const VIEW_WHERE: Record<(typeof ASSET_VIEWS)[number], SQL | undefined> = {
  out: isNull(assets.returnedOn),
  returned: isNotNull(assets.returnedOn),
  all: undefined,
};

/** The asset register in reach: out (default), returned or all; newest issue first. */
export async function listAssets(
  db: Database,
  actor: Actor,
  q: z.output<typeof assetListQuery> & { pageSize?: number },
) {
  const words = q.q ? containsPattern(q.q) : null;
  const where = and(
    await reach(db, actor),
    VIEW_WHERE[q.view ?? 'out'],
    words
      ? or(
          ilike(assets.assetType, words),
          ilike(assets.tag, words),
          ilike(staffMembers.fullName, words),
        )
      : undefined,
  );
  const size = q.pageSize ?? STAFF_RECORDS_PAGE_SIZE;
  const [total] = await db
    .select({ n: count() })
    .from(assets)
    .innerJoin(staffMembers, eq(staffMembers.id, assets.staffId))
    .where(where);
  const rows = await db
    .select({
      id: assets.id,
      assetType: assets.assetType,
      tag: assets.tag,
      description: assets.description,
      staffId: assets.staffId,
      staffName: staffMembers.fullName,
      issuedOn: assets.issuedOn,
      issuedByName: issuedBy.displayName,
      returnedOn: assets.returnedOn,
      returnedByName: returnedBy.displayName,
      conditionNote: assets.conditionNote,
      isSample: assets.isSample,
    })
    .from(assets)
    .innerJoin(staffMembers, eq(staffMembers.id, assets.staffId))
    .leftJoin(issuedBy, eq(issuedBy.id, assets.issuedBy))
    .leftJoin(returnedBy, eq(returnedBy.id, assets.returnedBy))
    .where(where)
    .orderBy(desc(assets.issuedOn), asc(assets.assetType))
    .limit(size)
    .offset(((q.page ?? 1) - 1) * size);
  return { rows, total: total?.n ?? 0, page: q.page ?? 1, pageSize: size };
}

/** Issue an asset to a staff member; a tag already out with someone is refused (409). */
export async function issueAsset(
  db: Database,
  actor: Actor,
  input: z.output<typeof assetIssueBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  notFuture('issuedOn', input.issuedOn);
  const tag = input.tag || null;
  return withTransaction(db, async (tx) => {
    const staff = await staffToChange(tx, actor, input.staffId);
    if (staff.status === 'inactive')
      throw new ConflictError(`${staff.fullName} has left; nothing can be issued to them.`);
    if (tag) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.asset_tag.${tag}`}))`);
      const [out] = await tx
        .select({ name: staffMembers.fullName, issuedOn: assets.issuedOn })
        .from(assets)
        .innerJoin(staffMembers, eq(staffMembers.id, assets.staffId))
        .where(and(eq(assets.tag, tag), isNull(assets.returnedOn)));
      if (out)
        throw new ConflictError(
          `Tag ${tag} is out with ${out.name} since ${out.issuedOn}. Record its return first.`,
        );
    }
    const [row] = await tx
      .insert(assets)
      .values({
        assetType: input.assetType,
        tag,
        description: input.description || null,
        staffId: staff.id,
        issuedOn: input.issuedOn,
        issuedBy: actor.id,
        conditionNote: input.conditionNote || null,
      })
      .returning();
    await audit(tx, actor, row!.id, 'staff_asset.issued', { after: row }, requestId);
    return row!;
  });
}

/** Record an asset's return (date, condition); also for staff who have already left. */
export async function returnAsset(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof assetReturnBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:staff:manage');
  notFuture('returnedOn', input.returnedOn);
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, assets, id, 'Asset', true);
    await staffToChange(tx, actor, before.staffId);
    if (before.returnedOn) throw new ConflictError(`Already returned on ${before.returnedOn}.`);
    if (input.returnedOn < before.issuedOn)
      throw fieldError(
        'returnedOn',
        `It was issued on ${before.issuedOn}; the return cannot be earlier.`,
      );
    const [after] = await tx
      .update(assets)
      .set({
        returnedOn: input.returnedOn,
        returnedBy: actor.id,
        conditionNote: input.conditionNote || before.conditionNote,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, id))
      .returning();
    await audit(tx, actor, id, 'staff_asset.returned', { before, after }, requestId);
    return after!;
  });
}

/** Staff a checklist or asset form can name: in reach and remit-checked on save, never yourself. */
export async function staffRecordOptions(db: Database, actor: Actor) {
  const self = await staffIdForUser(db, actor.id);
  const rows = await db
    .select({ id: staffMembers.id, name: staffMembers.fullName, status: staffMembers.status })
    .from(staffMembers)
    .where(
      and(await reach(db, actor), self ? ne(staffMembers.id, self as StaffMemberId) : undefined),
    )
    .orderBy(asc(staffMembers.fullName));
  return rows.map((r) => ({
    value: r.id as string,
    label: r.status === 'inactive' ? `${r.name} (left)` : r.name,
    left: r.status === 'inactive',
  }));
}

// ---- Leaver notice and downloads ------------------------------------------------------------

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** For the leaver hand-over notice: unreturned assets and open leaving-checklist items, in words. */
export async function leaverOpenRecords(tx: Database, staffId: string) {
  const out = await tx
    .select({ type: assets.assetType, tag: assets.tag })
    .from(assets)
    .where(and(eq(assets.staffId, staffId as StaffMemberId), isNull(assets.returnedOn)))
    .orderBy(asc(assets.assetType));
  const open = await tx
    .select({ label: items.label, itemKey: items.itemKey, order: templates.items })
    .from(items)
    .innerJoin(checklists, eq(checklists.id, items.checklistId))
    .innerJoin(templates, eq(templates.id, checklists.templateId))
    .where(
      and(
        eq(checklists.staffId, staffId as StaffMemberId),
        eq(checklists.event, 'leaving'),
        eq(items.status, 'pending'),
      ),
    );
  return [
    out.length
      ? `${plural(out.length, 'unreturned asset')}: ${out.map((a) => (a.tag ? `${a.type} (${a.tag})` : a.type)).join(', ')}`
      : null,
    open.length
      ? `${plural(open.length, 'open leaving checklist item')}: ${inTemplateOrder(
          open,
          open[0]!.order,
        )
          .map((i) => i.label)
          .join(', ')}`
      : null,
  ].filter((s): s is string => s !== null);
}

export const STAFF_RECORD_EXPORTS = ['assets', 'checklists'] as const;

/** The page's list with the page's filters as CSV (every matching row; audited like list-exports). */
export async function exportStaffRecords(
  db: Database,
  actor: Actor,
  list: (typeof STAFF_RECORD_EXPORTS)[number],
  params: Record<string, string>,
) {
  const pageSize = EXPORT_MAX_ROWS;
  const parse = <S extends z.ZodType>(s: S) => {
    const r = s.safeParse(params);
    if (!r.success)
      throw new ValidationError(
        'Some filters are not valid. Open the list again and download from there.',
      );
    return r.data as z.output<S>;
  };
  const sheet =
    list === 'assets'
      ? await listAssets(db, actor, { ...parse(assetListQuery), page: 1, pageSize }).then((r) => ({
          total: r.total,
          header: [
            'Type',
            'Tag',
            'Description',
            'Issued to',
            'Issued on',
            'Issued by',
            'Returned on',
            'Returned by',
            'Condition',
            'Sample data',
          ],
          rows: r.rows.map((a) => [
            a.assetType,
            a.tag ?? 'No tag',
            a.description,
            a.staffName,
            a.issuedOn,
            a.issuedByName,
            a.returnedOn ?? 'Not returned',
            a.returnedByName,
            a.conditionNote,
            a.isSample ? 'Sample data' : '',
          ]),
        }))
      : await listStaffChecklists(db, actor, {
          ...parse(checklistListQuery),
          page: 1,
          pageSize,
        }).then((r) => ({
          total: r.total,
          header: [
            'Staff member',
            'Checklist',
            'Template version',
            'Items',
            'Pending',
            'Started',
            'Sample data',
          ],
          rows: r.rows.map((c) => [
            c.staffName,
            CHECKLIST_EVENT_LABELS[c.event],
            c.version,
            c.items,
            c.pending,
            istToday(c.createdAt),
            c.isSample ? 'Sample data' : '',
          ]),
        }));
  if (sheet.total > EXPORT_MAX_ROWS)
    throw new ValidationError(
      `This list has ${sheet.total} rows. Narrow the filters to ${EXPORT_MAX_ROWS} or fewer to download it.`,
    );
  await opsAudit('export')(db, actor, null, 'export.downloaded', {
    metadata: {
      list: `staff_${list}`,
      filters: Object.keys(params)
        .filter((k) => params[k])
        .sort(),
      rows: sheet.rows.length,
    },
  });
  return csvResponse(toCsv(sheet.header, sheet.rows), `staff-${list}-${istToday(new Date())}.csv`);
}
