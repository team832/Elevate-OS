/**
 * HR records seed (D-016): gives the existing FICTIONAL seed staff (core seed
 * users and the two Ops sample staff) an employee record with an EMP code,
 * through the real service (`registerExistingStaff`) so history and audit
 * apply. No private details, documents, compensation or assets are seeded: none
 * exist for fictional people, and inventing them would be fake data.
 * Idempotent: staff that already have a record are skipped.
 */
import { asc, eq, isNull, ne, and } from 'drizzle-orm';
import {
  opsEmployeeRecords,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { withTransaction } from '@elevate/server-kit';
import { registerExistingStaff } from '../src/server/hr/employee-core';

async function seedActor(db: Database) {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'operations-manager@example.test'));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  return { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) };
}

export async function seedEmployeeRecords(db: Database, log: (m: string) => void = () => {}) {
  const actor = await seedActor(db);
  if (!actor) return log('hr records skipped: seed operations manager missing');
  const staff = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .leftJoin(opsEmployeeRecords, eq(opsEmployeeRecords.staffId, staffMembers.id))
    .where(and(isNull(opsEmployeeRecords.staffId), ne(staffMembers.status, 'inactive')))
    .orderBy(asc(staffMembers.fullName));
  let created = 0;
  for (const s of staff) {
    // Only fictional people are ever seeded (D-016).
    if (!/\(fictional\)/i.test(s.fullName)) continue;
    await withTransaction(db, (tx) =>
      registerExistingStaff(tx, actor, s.id, {
        employmentStatus: 'active',
        employmentStartDate: null,
      }),
    );
    created += 1;
  }
  log(`hr records: ${created} employee record(s) created`);
}

export const hrRecordsSeeds = [
  defineSeed({
    name: 'ops.hr-employee-records',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members', 'ops.staff'],
    description:
      'Employee records (EMP codes) for the fictional seed staff; no private data, documents, pay or assets',
    run: ({ db, log }) => seedEmployeeRecords(db, log),
  }),
];
