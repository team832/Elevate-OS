/**
 * Integration-test fixtures: core reference rows, lead sources and staff-linked
 * test users. Everything is fictional; numbers come from a counter so every
 * test uses unique contacts.
 */
import { createTestUser, type TestUser } from '@elevate/testing';
import { departments, programmes, staffMembers, type Database } from '@elevate/database';
import { SEED_DEPARTMENTS, SEED_PROGRAMMES } from '@elevate/database/seed';
import type { RoleKey, StaffMemberId } from '@elevate/shared-types';
import { seedLeadSources } from '../../seed/reference';

export async function setupReference(db: Database) {
  for (const [code, name, description] of SEED_DEPARTMENTS)
    await db.insert(departments).values({ code, name, description }).onConflictDoNothing();
  for (const [code, name, description, status] of SEED_PROGRAMMES)
    await db.insert(programmes).values({ code, name, description, status }).onConflictDoNothing();
  await seedLeadSources(db);
}

export type StaffUser = TestUser & { staffId: StaffMemberId };

export async function staffUser(
  db: Database,
  roles: RoleKey[],
  options: { managerId?: StaffMemberId | null; name?: string } = {},
): Promise<StaffUser> {
  const user = await createTestUser(db, {
    roles,
    displayName: options.name ?? `${roles.join('+') || 'staff'} (fictional)`,
  });
  const [staff] = await db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: user.displayName, managerId: options.managerId ?? null })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: staff!.id };
}

let n = 0;
/** A unique fictional Indian mobile in a raw, human-typed format. */
export function phone(): string {
  n += 1;
  return `098${String(70000000 + n).padStart(8, '0')}`;
}
export function e164(raw: string): string {
  return `+91${raw.replace(/\D/g, '').slice(-10)}`;
}
export function uniqueEmail(prefix = 'student'): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}@example.test`;
}

/** ISO date offset from today (UTC date; fine for "past"/"future" fixtures). */
export function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
