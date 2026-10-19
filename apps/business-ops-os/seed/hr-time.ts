/**
 * HR time reference seed (OPS-053). Deliberately small: one shift template in
 * state `proposed`, whose timing copies the recorded online office hours
 * (setting `office.online_hours`: Monday–Saturday 11:00–18:00). Nobody is
 * assigned to it. No leave types, holidays, allocations or attendance are
 * seeded: those are owner decisions (OD-026) and HR records them in the app.
 * Idempotent (upsert on the template code, never changes a decided status).
 */
import { eq } from 'drizzle-orm';
import { opsShiftTemplates, users, type Database } from '@elevate/database';
import { defineSeed, type SeedDefinition } from '@elevate/database/seed';

export const SEED_SHIFT = {
  code: 'OFFICE-ONLINE',
  name: 'Online office hours (proposed template)',
  startTime: '11:00',
  endTime: '18:00',
  crossesMidnight: false,
  unpaidBreakMinutes: 0,
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  notes:
    'Copied from the recorded online office hours (office.online_hours). Not an approved staff shift; break length unknown (0). OD-026.',
} as const;

export async function seedHrTime(db: Database, log?: (message: string) => void) {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'operations-manager@example.test'))
    .limit(1);
  if (!owner) {
    log?.('ops.hr-time: seed user operations-manager@example.test missing; skipped');
    return;
  }
  await db
    .insert(opsShiftTemplates)
    .values({
      ...SEED_SHIFT,
      workingWeekdays: [...SEED_SHIFT.workingWeekdays],
      status: 'proposed',
      createdBy: owner.id,
    })
    .onConflictDoUpdate({
      target: opsShiftTemplates.code,
      set: { name: SEED_SHIFT.name, notes: SEED_SHIFT.notes },
    });
  log?.('ops.hr-time: 1 proposed shift template (no assignments, leave types or holidays)');
}

export const hrTimeSeeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'ops.hr-time',
    module: 'ops',
    dependsOn: ['core.users'],
    description:
      'One PROPOSED shift template copied from the recorded online office hours; no leave types, holidays or attendance (OD-026)',
    run: ({ db, log }) => seedHrTime(db, log),
  }),
];
