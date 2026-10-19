/**
 * HR lifecycle seed (D-016): one FICTIONAL draft requisition and one FICTIONAL
 * candidate, created through the real services as the seed operations manager
 * so codes, audit and rules apply. The requisition stays a draft (approving it
 * would be a decision nobody made); no applications, interviews, offers,
 * conversions or lifecycle cases are seeded — inventing hiring outcomes would
 * be fake data. Idempotent: skipped when the sample candidate exists.
 */
import { eq } from 'drizzle-orm';
import { opsCandidates, userRoles, users, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { createCandidate, createRequisition } from '../src/server/hr/recruitment';

const SAMPLE_EMAIL = 'riya.candidate.sample@example.test';

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

export async function seedHrLifecycleSamples(db: Database, log: (m: string) => void = () => {}) {
  const actor = await seedActor(db);
  if (!actor) return log('hr lifecycle samples skipped: seed operations manager missing');
  const [already] = await db
    .select({ id: opsCandidates.id })
    .from(opsCandidates)
    .where(eq(opsCandidates.email, SAMPLE_EMAIL));
  if (already) return log('hr lifecycle samples already present');
  const req = await createRequisition(db, actor, {
    title: 'Commerce faculty — sample requisition (fictional)',
    openings: 1,
    employmentType: 'full_time',
    location: 'Sikar (sample)',
    roleDescription: 'Sample draft for trying the approval flow. Not a real vacancy.',
  });
  const cand = await createCandidate(db, actor, {
    fullName: 'Riya Sample (fictional)',
    email: SAMPLE_EMAIL,
    source: 'other',
    sourceDetail: 'Seed data for development',
    privacyNoticeGiven: false,
  });
  log(`hr lifecycle samples: draft ${req.code}, candidate ${cand.code}`);
}

export const hrLifecycleSeeds = [
  defineSeed({
    name: 'ops.hr-lifecycle-samples',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members'],
    description:
      '1 fictional draft requisition and 1 fictional candidate (@example.test, no phone); no hiring outcomes',
    run: ({ db, log }) => seedHrLifecycleSamples(db, log),
  }),
];
