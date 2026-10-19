/**
 * Private HR fields (OPS-034) — SENSITIVE, `ops:employee_private:*`. Legal
 * name, personal contacts, address, emergency contacts and identity-document
 * references (last four characters only, OD-014). `own` = the employee
 * themself only (`selfOrAllScope`), never a manager's reporting chain.
 * Audit payloads name the fields that changed; they never contain the values.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  opsEmergencyContacts,
  opsEmployeeDocuments,
  opsEmployeeIdentityReferences,
  opsEmployeePrivateDetails,
  opsEmployeeRecords,
  type Database,
} from '@elevate/database';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { normaliseEmail, normalisePhone } from '../../domain/contacts';
import type { Actor } from '../context';
import { assertHrScope } from '../hr-scope';
import { invalidField, selfOrAllScope } from './access';
import type {
  emergencyContactBody,
  identityReferenceBody,
  PrivateDetailsInput,
  updateEmergencyContactBody,
} from './schemas';

type EmergencyContactId = typeof opsEmergencyContacts.$inferSelect.id;
type IdentityReferenceId = typeof opsEmployeeIdentityReferences.$inferSelect.id;

async function employeeRecord(db: Database, staffId: string) {
  const [r] = await db
    .select({ staffId: opsEmployeeRecords.staffId, legalName: opsEmployeeRecords.legalName })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId));
  if (!r) throw new NotFoundError('Employee not found.');
  return r;
}

async function readScope(db: Database, actor: Actor, staffId: string) {
  const scope = await selfOrAllScope(db, actor, 'ops:employee_private:read');
  assertHrScope(scope, staffId, 'this employee’s private HR record');
  return scope;
}

async function manageScope(db: Database, actor: Actor, staffId: string) {
  const scope = await selfOrAllScope(db, actor, 'ops:employee_private:manage');
  assertHrScope(scope, staffId, 'this employee’s private HR record');
  return scope;
}

function audit(
  tx: Database,
  actor: Actor,
  staffId: string,
  action: string,
  fieldsChanged: string[],
  requestId?: string,
  extra: Record<string, unknown> = {},
) {
  return recordAudit(tx, {
    actorUserId: actor.id,
    module: 'ops',
    action,
    entityType: 'employee_private',
    entityId: staffId,
    // Field NAMES only — never values (OPS-037).
    metadata: { fieldsChanged, ...extra },
    requestId,
  });
}

/** Private HR panel for one employee. */
export async function getPrivateRecord(db: Database, actor: Actor, staffId: string) {
  await readScope(db, actor, staffId);
  const record = await employeeRecord(db, staffId);
  const sid = staffId as StaffMemberId;
  const [details, contacts, identity] = await Promise.all([
    db.select().from(opsEmployeePrivateDetails).where(eq(opsEmployeePrivateDetails.staffId, sid)),
    db
      .select()
      .from(opsEmergencyContacts)
      .where(eq(opsEmergencyContacts.staffId, sid))
      .orderBy(desc(opsEmergencyContacts.isPrimary), asc(opsEmergencyContacts.name)),
    db
      .select({
        id: opsEmployeeIdentityReferences.id,
        kind: opsEmployeeIdentityReferences.kind,
        last4: opsEmployeeIdentityReferences.last4,
        documentId: opsEmployeeIdentityReferences.documentId,
        notes: opsEmployeeIdentityReferences.notes,
        status: opsEmployeeIdentityReferences.status,
        createdAt: opsEmployeeIdentityReferences.createdAt,
      })
      .from(opsEmployeeIdentityReferences)
      .where(eq(opsEmployeeIdentityReferences.staffId, sid))
      .orderBy(asc(opsEmployeeIdentityReferences.kind)),
  ]);
  const d = details[0] ?? null;
  return {
    staffId,
    legalName: record.legalName,
    details: d
      ? {
          personalEmail: d.personalEmail,
          personalPhone: d.personalPhone,
          addressLine1: d.addressLine1,
          addressLine2: d.addressLine2,
          city: d.city,
          state: d.state,
          postalCode: d.postalCode,
          country: d.country,
          updatedAt: d.updatedAt,
        }
      : null,
    emergencyContacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phone,
      isPrimary: c.isPrimary,
    })),
    identityReferences: identity.map((i) => ({
      ...i,
      /** Display form: never more than the last four characters. */
      masked: i.last4 ? `•••• ${i.last4}` : 'Reference only (no digits recorded)',
    })),
  };
}

const DETAIL_FIELDS = [
  'personalEmail',
  'personalPhone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
] as const;

/** Update legal name and personal details (upsert). */
export async function updatePrivateDetails(
  db: Database,
  actor: Actor,
  staffId: string,
  input: PrivateDetailsInput,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  await employeeRecord(db, staffId);
  const patch: Record<string, string | null> = {};
  for (const f of DETAIL_FIELDS) if (f in input) patch[f] = input[f]?.trim() || null;
  if (patch.personalEmail) {
    const r = normaliseEmail(patch.personalEmail);
    if (!r.ok) throw invalidField('personalEmail', 'Personal email is not a valid address.');
    patch.personalEmail = r.email;
  }
  if (patch.personalPhone) {
    const r = normalisePhone(patch.personalPhone);
    if (!r.ok) throw invalidField('personalPhone', 'Personal phone is not a valid phone number.');
    patch.personalPhone = r.e164;
  }
  await withTransaction(db, async (tx) => {
    const sid = staffId as StaffMemberId;
    if ('legalName' in input)
      await tx
        .update(opsEmployeeRecords)
        .set({ legalName: input.legalName?.trim() || null })
        .where(eq(opsEmployeeRecords.staffId, sid));
    if (Object.keys(patch).length)
      await tx
        .insert(opsEmployeePrivateDetails)
        .values({ staffId: sid, ...patch, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: opsEmployeePrivateDetails.staffId,
          set: { ...patch, updatedBy: actor.id },
        });
    await audit(
      tx,
      actor,
      staffId,
      'employee_private.updated',
      [...('legalName' in input ? ['legalName'] : []), ...Object.keys(patch)],
      requestId,
    );
  });
  return getPrivateRecord(db, actor, staffId);
}

function phoneOrThrow(raw: string): string {
  const r = normalisePhone(raw);
  if (!r.ok) throw invalidField('phone', 'Phone is not a valid phone number.');
  return r.e164;
}

export async function addEmergencyContact(
  db: Database,
  actor: Actor,
  staffId: string,
  input: z.output<typeof emergencyContactBody>,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  await employeeRecord(db, staffId);
  const phone = phoneOrThrow(input.phone);
  return withTransaction(db, async (tx) => {
    const sid = staffId as StaffMemberId;
    const existing = await tx
      .select({ id: opsEmergencyContacts.id })
      .from(opsEmergencyContacts)
      .where(eq(opsEmergencyContacts.staffId, sid));
    if (existing.length >= 5) throw new ConflictError('At most five emergency contacts.');
    const isPrimary = input.isPrimary || existing.length === 0;
    if (isPrimary)
      await tx
        .update(opsEmergencyContacts)
        .set({ isPrimary: false })
        .where(eq(opsEmergencyContacts.staffId, sid));
    const [row] = await tx
      .insert(opsEmergencyContacts)
      .values({
        staffId: sid,
        name: input.name,
        relationship: input.relationship,
        phone,
        isPrimary,
        updatedBy: actor.id,
      })
      .returning({ id: opsEmergencyContacts.id });
    await audit(
      tx,
      actor,
      staffId,
      'employee_private.emergency_contact_added',
      ['name', 'relationship', 'phone'],
      requestId,
      { contactId: row?.id },
    );
    return { id: row!.id };
  });
}

async function contactRow(tx: Database, staffId: string, contactId: string) {
  const [c] = await tx
    .select()
    .from(opsEmergencyContacts)
    .where(
      and(
        eq(opsEmergencyContacts.id, contactId as EmergencyContactId),
        eq(opsEmergencyContacts.staffId, staffId as StaffMemberId),
      ),
    )
    .for('update');
  if (!c) throw new NotFoundError('Emergency contact not found.');
  return c;
}

export async function updateEmergencyContact(
  db: Database,
  actor: Actor,
  staffId: string,
  contactId: string,
  input: z.output<typeof updateEmergencyContactBody>,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  return withTransaction(db, async (tx) => {
    const c = await contactRow(tx, staffId, contactId);
    const patch: Partial<typeof opsEmergencyContacts.$inferInsert> = { updatedBy: actor.id };
    if (input.name) patch.name = input.name;
    if (input.relationship) patch.relationship = input.relationship;
    if (input.phone) patch.phone = phoneOrThrow(input.phone);
    if (input.isPrimary === true) {
      await tx
        .update(opsEmergencyContacts)
        .set({ isPrimary: false })
        .where(eq(opsEmergencyContacts.staffId, c.staffId));
      patch.isPrimary = true;
    }
    await tx.update(opsEmergencyContacts).set(patch).where(eq(opsEmergencyContacts.id, c.id));
    await audit(
      tx,
      actor,
      staffId,
      'employee_private.emergency_contact_updated',
      Object.keys(input),
      requestId,
      { contactId: c.id },
    );
    return { id: c.id };
  });
}

/** Removing an emergency contact deletes it (data minimisation); the audit keeps the fact only. */
export async function removeEmergencyContact(
  db: Database,
  actor: Actor,
  staffId: string,
  contactId: string,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  return withTransaction(db, async (tx) => {
    const c = await contactRow(tx, staffId, contactId);
    await tx.delete(opsEmergencyContacts).where(eq(opsEmergencyContacts.id, c.id));
    if (c.isPrimary) {
      const [next] = await tx
        .select({ id: opsEmergencyContacts.id })
        .from(opsEmergencyContacts)
        .where(eq(opsEmergencyContacts.staffId, c.staffId))
        .orderBy(asc(opsEmergencyContacts.createdAt))
        .limit(1);
      if (next)
        await tx
          .update(opsEmergencyContacts)
          .set({ isPrimary: true })
          .where(eq(opsEmergencyContacts.id, next.id));
    }
    await audit(tx, actor, staffId, 'employee_private.emergency_contact_removed', [], requestId, {
      contactId: c.id,
    });
    return { id: c.id, removed: true };
  });
}

/**
 * Last-four rule (OD-014): accepts at most four letters/digits after removing
 * spaces and dashes; a longer value is REFUSED (we never store or truncate a
 * full identity number someone pasted).
 */
export function normaliseLast4(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  if (v === '') return null;
  if (!/^[A-Z0-9]+$/.test(v)) throw invalidField('last4', 'Use letters and digits only.');
  if (v.length > 4)
    throw invalidField(
      'last4',
      'Record only the last four characters — never the full identity number.',
    );
  return v;
}

export async function addIdentityReference(
  db: Database,
  actor: Actor,
  staffId: string,
  input: z.output<typeof identityReferenceBody>,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  await employeeRecord(db, staffId);
  const last4 = normaliseLast4(input.last4);
  return withTransaction(db, async (tx) => {
    if (input.documentId) {
      const [doc] = await tx
        .select({ staffId: opsEmployeeDocuments.staffId, kind: opsEmployeeDocuments.kind })
        .from(opsEmployeeDocuments)
        .where(
          eq(
            opsEmployeeDocuments.id,
            input.documentId as typeof opsEmployeeDocuments.$inferSelect.id,
          ),
        );
      if (!doc || doc.staffId !== staffId)
        throw invalidField('documentId', 'Unknown document for this employee.');
      if (doc.kind !== 'identification_reference')
        throw invalidField('documentId', 'Link an identification document.');
    }
    const [row] = await tx
      .insert(opsEmployeeIdentityReferences)
      .values({
        staffId: staffId as StaffMemberId,
        kind: input.kind,
        last4,
        documentId:
          (input.documentId as typeof opsEmployeeDocuments.$inferSelect.id | null) ?? null,
        notes: input.notes ?? null,
        recordedBy: actor.id,
      })
      .returning({ id: opsEmployeeIdentityReferences.id });
    await audit(
      tx,
      actor,
      staffId,
      'employee_private.identity_reference_added',
      ['kind', 'last4'],
      requestId,
      {
        referenceId: row?.id,
        kind: input.kind,
      },
    );
    return { id: row!.id };
  });
}

export async function retireIdentityReference(
  db: Database,
  actor: Actor,
  staffId: string,
  refId: string,
  requestId?: string,
) {
  await manageScope(db, actor, staffId);
  return withTransaction(db, async (tx) => {
    const [ref] = await tx
      .select()
      .from(opsEmployeeIdentityReferences)
      .where(
        and(
          eq(opsEmployeeIdentityReferences.id, refId as IdentityReferenceId),
          eq(opsEmployeeIdentityReferences.staffId, staffId as StaffMemberId),
        ),
      )
      .for('update');
    if (!ref) throw new NotFoundError('Identity reference not found.');
    if (ref.status === 'retired') throw new ConflictError('Already retired.');
    await tx
      .update(opsEmployeeIdentityReferences)
      .set({ status: 'retired' })
      .where(eq(opsEmployeeIdentityReferences.id, ref.id));
    await audit(
      tx,
      actor,
      staffId,
      'employee_private.identity_reference_retired',
      ['status'],
      requestId,
      {
        referenceId: ref.id,
      },
    );
    return { id: ref.id, status: 'retired' as const };
  });
}
