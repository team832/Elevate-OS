/**
 * FICTIONAL sample pipeline and tasks for development (D-016): every person is
 * invented, emails use the reserved example.test domain, and no phone numbers
 * are seeded. Created through the real services (as the seed operations manager)
 * so the audit trail and rules apply. Skipped when already present (idempotent).
 */
import { eq } from 'drizzle-orm';
import {
  opsLeads,
  opsTasks,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, istToday } from '../src/domain';
import { createLead, logActivity } from '../src/server/leads';
import { scheduleCounselling, updateCounselling } from '../src/server/schedule';
import { transitionAdmission } from '../src/server/admissions';
import { addDependency, createTask } from '../src/server/tasks';

async function actorByEmail(db: Database, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  const [staff] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, u.id));
  return {
    actor: { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) },
    staffId: (staff?.id ?? null) as StaffMemberId | null,
  };
}

export async function seedSamplePipeline(db: Database, log: (m: string) => void = () => {}) {
  const manager = await actorByEmail(db, 'operations-manager@example.test');
  const counsellor = await actorByEmail(db, 'admissions-counsellor@example.test');
  if (!manager || !counsellor?.staffId) return log('sample pipeline skipped: seed users missing');
  const [already] = await db
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.studentEmail, 'aarav.sample@example.test'));
  if (already) return log('sample pipeline already present');
  const owner = counsellor.staffId;
  const make = (
    name: string,
    email: string,
    programmeCode: string,
    sourceCode: string,
    guardian?: string,
  ) =>
    createLead(db, manager.actor, {
      studentName: `${name} (fictional)`,
      studentEmail: email,
      guardianName: guardian ? `${guardian} (fictional)` : null,
      guardianRelationship: guardian ? 'mother' : null,
      guardianEmail: guardian ? email.replace('.sample@', '.parent@') : null,
      currentStage: 'class_11',
      programmeCode,
      interestMode: 'offline',
      sourceCode,
      ownerStaffId: owner,
    });
  await createLead(db, manager.actor, {
    studentName: 'Ishaan Unassigned (fictional)',
    studentEmail: 'ishaan.sample@example.test',
    programmeCode: 'CUET',
    interestMode: 'undecided',
    sourceCode: 'WALK_IN',
  });
  await make('Aarav Sample', 'aarav.sample@example.test', 'CLAT', 'INSTAGRAM_ORGANIC');
  const meera = await make(
    'Meera Sample',
    'meera.sample@example.test',
    'IPMAT',
    'WEBINAR',
    'Kavita Sample',
  );
  await logActivity(db, counsellor.actor, meera.lead.id, {
    kind: 'call',
    outcome: 'connected_two_way',
    note: 'Sample contact (fictional)',
  });
  const session = await scheduleCounselling(db, counsellor.actor, {
    admissionId: meera.admission.id,
    scheduledAt: new Date(Date.now() - 2 * 86_400_000).toISOString() as never,
    mode: 'in_person',
    attendees: 'both',
  });
  if (session)
    await updateCounselling(db, counsellor.actor, session.id, {
      action: 'complete',
      outcome: 'Interested; wants a demo (sample).',
      nextStep: 'Book demo',
    });
  const kabir = await make(
    'Kabir Sample',
    'kabir.sample@example.test',
    'COMMERCE_11_12',
    'REFERRAL',
  );
  await logActivity(db, counsellor.actor, kabir.lead.id, { kind: 'whatsapp', outcome: 'replied' });
  await transitionAdmission(db, counsellor.actor, kabir.admission.id, {
    to: 'lost',
    reason: 'Chose another institute (sample).',
  });
  log('sample pipeline: 4 fictional leads');
}

export async function seedSampleTasks(db: Database, log: (m: string) => void = () => {}) {
  const manager = await actorByEmail(db, 'operations-manager@example.test');
  const counsellor = await actorByEmail(db, 'admissions-counsellor@example.test');
  if (!manager?.staffId || !counsellor?.staffId) return log('sample tasks skipped');
  const [already] = await db
    .select({ id: opsTasks.id })
    .from(opsTasks)
    .where(eq(opsTasks.title, 'Sample: name owners and backups for the 12 online roles'));
  if (already) return log('sample tasks already present');
  const today = istToday(new Date());
  const t1 = await createTask(db, manager.actor, {
    title: 'Sample: name owners and backups for the 12 online roles',
    description: 'Fictional sample task. Needed before responsibilities have holders (OD-009).',
    ownerStaffId: manager.staffId,
    accountableStaffId: manager.staffId,
    backupStaffId: counsellor.staffId,
    dueDate: addDays(today, -3),
    priority: 'high',
  });
  const t2 = await createTask(db, manager.actor, {
    title: 'Sample: draft the enquiry-capture SOP (LEGACY-OPSWB-SOP-002)',
    description: 'Fictional sample task; the SOP is "Not drafted" in the legacy register.',
    ownerStaffId: counsellor.staffId,
    accountableStaffId: manager.staffId,
    dueDate: addDays(today, 5),
    priority: 'medium',
  });
  await createTask(db, manager.actor, {
    title: 'Sample: confirm demo limits with the director (OD-012)',
    ownerStaffId: null,
    dueDate: null,
    priority: 'medium',
  });
  await addDependency(db, manager.actor, t2.id, t1.id);
  log('sample tasks: 3');
}

export const sampleSeeds = [
  defineSeed({
    name: 'ops.sample-pipeline',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members', 'core.programmes', 'ops.lead-sources'],
    description: '4 FICTIONAL leads across pipeline stages (emails @example.test, no phones)',
    run: ({ db, log }) => seedSamplePipeline(db, log),
  }),
  defineSeed({
    name: 'ops.sample-tasks',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members'],
    description: '3 fictional sample tasks (one overdue, one blocked by it, one without owner)',
    run: ({ db, log }) => seedSampleTasks(db, log),
  }),
];
