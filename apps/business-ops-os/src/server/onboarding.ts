/**
 * Onboarding checklist of a student (owner brief §8, acceptance 13). Items are copied from the
 * versioned templates that apply when the checklist is built (multi-programme = union of keys)
 * and never rewritten by a later template version: new keys come in only on an explicit
 * "add items from templates" or "add item" request (audited). Status is an append-only event
 * stream; material items complete only from the issue/return/replacement rows. Reading needs
 * `ops:students:read`, changes `ops:admissions:write` (own scope = the student's cases).
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsLeads,
  opsMaterialIssues,
  opsOnboardingItemEvents,
  opsOnboardingItems,
  opsOnboardingTemplates,
  programmes,
  staffMembers,
  users,
  type Database,
  type OpsOnboardingItemId,
  type OpsOnboardingTemplateId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { AdmissionId, StudentIdentityId, UserId } from '@elevate/shared-types';
import { istToday, type IsoDate } from '../domain/dates';
import {
  checklistToAdd,
  isOnboardingOverdue,
  itemStatus,
  materialMoveError,
  materialsSummary,
  netIssued,
  statusChangeError,
  type OnboardingStatus,
  type OnboardingTemplateItem,
} from '../domain/onboarding';
import { caseState } from '../domain/student-lifecycle';
import { accessScope, activeStaff, assertScope, clean, scopeCovers, type Actor } from './context';
import { defined, fieldError, inOrder, opsAudit } from './ops-common';
import type {
  MaterialInput,
  OnboardingInput,
  OnboardingItemInput,
  TemplateInput,
} from './profile-schemas';

const audit = opsAudit('admission');

/** The template entry an item was copied from (none for items added by hand). */
const sourceOf = (items: unknown, key: string) =>
  (items as OnboardingTemplateItem[] | null)?.find((t) => t.key === key);

/** The student's admission cases (with their lead) after the permission + own-scope check. */
async function studentCases(
  db: Database,
  actor: Actor,
  identityId: string,
  permission: 'ops:students:read' | 'ops:admissions:write',
) {
  const access = await accessScope(db, actor, permission);
  const rows = await db
    .select({ a: opsAdmissions, lead: opsLeads, programmeCode: programmes.code })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(eq(opsAdmissions.studentId, identityId as StudentIdentityId));
  if (!rows.length) throw new NotFoundError('Student not found.');
  const owners = rows.flatMap((r) => [r.a.counsellorStaffId, r.lead.ownerStaffId]);
  assertScope(access, owners, 'students');
  return { rows, owners };
}

/** The item (of one of the student's cases), locked, with its template entry and copies held. */
async function itemOf(tx: Database, caseIds: readonly string[], itemId: string) {
  const [item] = await tx
    .select()
    .from(opsOnboardingItems)
    .where(
      and(
        eq(opsOnboardingItems.id, itemId as OpsOnboardingItemId),
        inArray(opsOnboardingItems.admissionId, caseIds as AdmissionId[]),
      ),
    )
    .for('update');
  if (!item) throw new NotFoundError('Checklist item not found.');
  const [events, moves, [template]] = await inOrder([
    tx.select().from(opsOnboardingItemEvents).where(eq(opsOnboardingItemEvents.itemId, item.id)),
    tx.select().from(opsMaterialIssues).where(eq(opsMaterialIssues.itemId, item.id)),
    item.templateId
      ? tx
          .select({ items: opsOnboardingTemplates.items })
          .from(opsOnboardingTemplates)
          .where(eq(opsOnboardingTemplates.id, item.templateId))
      : [],
  ]);
  const net = netIssued(moves);
  const source = sourceOf(template?.items, item.itemKey);
  const required = source?.requiredQuantity ?? 1;
  return { item, net, required, source, status: itemStatus(item.kind, events, net, required) };
}

/** GET /students/{id}/onboarding — every item of the student's cases with status and history. */
export async function getOnboarding(
  db: Database,
  actor: Actor,
  identityId: string,
  now = new Date(),
) {
  const { rows, owners } = await studentCases(db, actor, identityId, 'ops:students:read');
  const caseIds = rows.map((r) => r.a.id);
  const [items, events, moves, canEdit] = await Promise.all([
    db
      .select({
        i: opsOnboardingItems,
        ownerName: staffMembers.fullName,
        templateCode: opsOnboardingTemplates.code,
        templateItems: opsOnboardingTemplates.items,
      })
      .from(opsOnboardingItems)
      .leftJoin(staffMembers, eq(staffMembers.id, opsOnboardingItems.ownerStaffId))
      .leftJoin(
        opsOnboardingTemplates,
        eq(opsOnboardingTemplates.id, opsOnboardingItems.templateId),
      )
      .where(inArray(opsOnboardingItems.admissionId, caseIds))
      .orderBy(asc(opsOnboardingItems.createdAt), asc(opsOnboardingItems.itemKey)),
    db
      .select({ e: opsOnboardingItemEvents, actorName: users.displayName })
      .from(opsOnboardingItemEvents)
      .innerJoin(opsOnboardingItems, eq(opsOnboardingItems.id, opsOnboardingItemEvents.itemId))
      .innerJoin(users, eq(users.id, opsOnboardingItemEvents.actorUserId))
      .where(inArray(opsOnboardingItems.admissionId, caseIds))
      .orderBy(asc(opsOnboardingItemEvents.at)),
    db
      .select({ m: opsMaterialIssues, actorName: users.displayName })
      .from(opsMaterialIssues)
      .innerJoin(users, eq(users.id, opsMaterialIssues.actorUserId))
      .where(inArray(opsMaterialIssues.admissionId, caseIds))
      .orderBy(asc(opsMaterialIssues.issuedOn), asc(opsMaterialIssues.at)),
    can(actor, 'ops:admissions:write') &&
      accessScope(db, actor, 'ops:admissions:write').then((w) => scopeCovers(w, owners)),
  ]);
  const today = istToday(now);
  const list = items.map(({ i, ownerName, templateCode, templateItems }) => {
    const history = events
      .filter((x) => x.e.itemId === i.id)
      .map((x) => ({ ...x.e, actorName: x.actorName }));
    const materials = moves
      .filter((x) => x.m.itemId === i.id)
      .map((x) => ({ ...x.m, actorName: x.actorName }));
    const held = netIssued(materials);
    const required = sourceOf(templateItems, i.itemKey)?.requiredQuantity ?? 1;
    const status = itemStatus(i.kind, history, held, required);
    return {
      ...i,
      held,
      required,
      ownerName,
      template: templateCode ? `${templateCode} v${i.templateVersion}` : null,
      status,
      overdue: isOnboardingOverdue({ dueDate: i.dueDate, status }, today),
      latest: history.at(-1) ?? null,
      history: history.reverse(),
      materials,
    };
  });
  return {
    items: list,
    materials: materialsSummary(list),
    counts: {
      total: list.length,
      completed: list.filter((i) => i.status === 'completed').length,
      notApplicable: list.filter((i) => i.status === 'not_applicable').length,
      blocked: list.filter((i) => i.status === 'blocked').length,
      overdue: list.filter((i) => i.overdue).length,
    },
    canEdit,
  };
}

/** POST /students/{id}/onboarding — build or extend from templates, or add one item by hand. */
export async function changeChecklist(
  db: Database,
  actor: Actor,
  identityId: string,
  input: OnboardingInput,
  requestId?: string,
) {
  const { rows } = await studentCases(db, actor, identityId, 'ops:admissions:write');
  const target = rows.find((r) => r.a.id === input.admissionId);
  if (!target) throw fieldError('admissionId', 'Not an admission of this student.');
  if (input.action === 'add') {
    if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
    return withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(opsOnboardingItems)
        .values({
          admissionId: target.a.id,
          itemKey: input.itemKey,
          label: input.label,
          kind: input.kind,
          dueDate: input.dueDate ?? null,
          ownerStaffId: (input.ownerStaffId ?? null) as never,
          addedExplicitly: true,
          createdBy: actor.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictError(`The checklist already has an item "${input.itemKey}".`);
      await audit(
        tx,
        actor,
        target.a.id,
        'onboarding.item_added',
        {
          after: { itemKey: row.itemKey, label: row.label, kind: row.kind },
        },
        requestId,
      );
      return { added: [row.itemKey] };
    });
  }
  // Programmes of every case still running (multi-programme = union) and the class/category.
  const programmeCodes = rows
    .filter((r) => caseState(r.a).population !== 'former' && r.programmeCode)
    .map((r) => r.programmeCode as string);
  const student = { programmeCodes, classCategory: target.lead.currentStage };
  const templates = await db.select().from(opsOnboardingTemplates);
  return withTransaction(db, async (tx) => {
    await tx
      .select({ id: opsAdmissions.id })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, target.a.id))
      .for('update');
    const existing = await tx
      .select({ key: opsOnboardingItems.itemKey })
      .from(opsOnboardingItems)
      .where(eq(opsOnboardingItems.admissionId, target.a.id));
    const start = (target.a.admissionDate ?? istToday(new Date())) as IsoDate;
    const add = checklistToAdd(
      templates,
      student,
      existing.map((e) => e.key),
      start,
    );
    if (!add.length && !existing.length)
      throw new ValidationError(
        'No active onboarding template covers these programmes and class. Add the items by hand, or publish a template under Admissions settings → Onboarding templates (needs ops:settings:manage).',
      );
    if (add.length)
      await tx
        .insert(opsOnboardingItems)
        .values(
          add.map((i) => ({
            ...i,
            templateId: i.templateId as OpsOnboardingTemplateId,
            admissionId: target.a.id,
            addedExplicitly: false,
            createdBy: actor.id,
          })),
        )
        .onConflictDoNothing();
    await audit(
      tx,
      actor,
      target.a.id,
      'onboarding.generated',
      {
        after: {
          added: add.map((i) => i.itemKey),
          templates: [...new Set(add.map((i) => `${i.templateId}@v${i.templateVersion}`))],
          programmeCodes,
        },
      },
      requestId,
    );
    return { added: add.map((i) => i.itemKey) };
  });
}

/** POST /students/{id}/onboarding/{itemId} — record a status (append-only) and owner / due date. */
export async function recordItemStatus(
  db: Database,
  actor: Actor,
  identityId: string,
  itemId: string,
  input: OnboardingItemInput,
  requestId?: string,
) {
  const { rows } = await studentCases(db, actor, identityId, 'ops:admissions:write');
  if (input.ownerStaffId) await activeStaff(db, input.ownerStaffId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const { item, net, required, status } = await itemOf(
      tx,
      rows.map((r) => r.a.id),
      itemId,
    );
    const refused = statusChangeError(item.kind, input.status, net, required, input.evidenceRef);
    if (refused) throw fieldError('status', refused);
    const set = defined({ ownerStaffId: input.ownerStaffId as never, dueDate: input.dueDate });
    if (Object.keys(set).length)
      await tx.update(opsOnboardingItems).set(set).where(eq(opsOnboardingItems.id, item.id));
    const [event] = await tx
      .insert(opsOnboardingItemEvents)
      .values({
        itemId: item.id,
        status: input.status,
        note: clean(input.note),
        evidenceRef: clean(input.evidenceRef),
        actorUserId: actor.id as UserId,
      })
      .returning();
    await audit(
      tx,
      actor,
      item.admissionId,
      'onboarding.item_status',
      {
        before: {
          itemKey: item.itemKey,
          status,
          ownerStaffId: item.ownerStaffId,
          dueDate: item.dueDate,
        },
        after: { itemKey: item.itemKey, status: input.status satisfies OnboardingStatus, ...set },
      },
      requestId,
    );
    return event!;
  });
}

/** POST /students/{id}/materials — issue, return or replace copies for one material item. */
export async function recordMaterial(
  db: Database,
  actor: Actor,
  identityId: string,
  input: MaterialInput,
  requestId?: string,
) {
  const { rows } = await studentCases(db, actor, identityId, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const { item, net, source } = await itemOf(
      tx,
      rows.map((r) => r.a.id),
      input.itemId,
    );
    if (item.kind !== 'material') throw fieldError('itemId', 'This item is not a material item.');
    const refused = materialMoveError(input.kind, input.quantity, net);
    if (refused) throw fieldError('quantity', refused);
    const [row] = await tx
      .insert(opsMaterialIssues)
      .values({
        admissionId: item.admissionId,
        itemId: item.id,
        catalogueCode: source?.catalogueCode ?? item.itemKey,
        title: item.label,
        edition: clean(input.edition) ?? source?.edition ?? null,
        quantity: input.quantity,
        kind: input.kind,
        issuedOn: input.issuedOn,
        note: clean(input.note),
        actorUserId: actor.id as UserId,
      })
      .returning();
    await audit(
      tx,
      actor,
      item.admissionId,
      'onboarding.material_recorded',
      {
        after: {
          itemKey: item.itemKey,
          kind: input.kind,
          quantity: input.quantity,
          edition: row!.edition,
        },
      },
      requestId,
    );
    return row!;
  });
}

/** GET /onboarding-templates — every version, newest first per code (settings screens). */
export async function listTemplates(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:settings:read');
  return db
    .select()
    .from(opsOnboardingTemplates)
    .orderBy(asc(opsOnboardingTemplates.code), desc(opsOnboardingTemplates.version));
}

/**
 * POST /onboarding-templates — publish the next version of `code` (active; the earlier active
 * version is retired). Existing checklists keep the version they were built from.
 */
export async function publishTemplateVersion(
  db: Database,
  actor: Actor,
  input: TemplateInput,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:settings:manage');
  const known = await db
    .select({ code: programmes.code })
    .from(programmes)
    .where(inArray(programmes.code, input.programmeCodes));
  const unknown = input.programmeCodes.filter((c) => !known.some((k) => k.code === c));
  if (unknown.length)
    throw fieldError('programmeCodes', `Unknown programme: ${unknown.join(', ')}`);
  return withTransaction(db, async (tx) => {
    const old = await tx
      .select()
      .from(opsOnboardingTemplates)
      .where(eq(opsOnboardingTemplates.code, input.code))
      .for('update');
    await tx
      .update(opsOnboardingTemplates)
      .set({ status: 'retired' })
      .where(
        and(
          eq(opsOnboardingTemplates.code, input.code),
          eq(opsOnboardingTemplates.status, 'active'),
        ),
      );
    const [row] = await tx
      .insert(opsOnboardingTemplates)
      .values({
        ...input,
        classCategory: input.classCategory as never,
        version: Math.max(0, ...old.map((t) => t.version)) + 1,
        status: 'active',
        createdBy: actor.id,
      })
      .returning();
    await opsAudit('onboarding_template')(
      tx,
      actor,
      row!.id,
      'onboarding.template_published',
      { after: { code: row!.code, version: row!.version, items: row!.items.map((i) => i.key) } },
      requestId,
    );
    return row!;
  });
}
