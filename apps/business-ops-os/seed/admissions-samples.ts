/**
 * FICTIONAL admissions-administration samples for development (D-016): two
 * invented families (emails @example.test, no phone numbers), walked through
 * the real services so every rule, audit row and approval applies:
 *   - "Tara Sample (fictional)", CLAT: admitted (two different verifiers, fee
 *     arrangement approved by the seed director) with an amount due and an
 *     amount received recorded as SAMPLE manual fee records (fictional figures,
 *     not a verified transaction; no fee schedule is approved);
 *   - "Neel Sample (fictional)", IPMAT: admission pending with an amount due.
 * No enrolment is requested (that would publish a real outbox event).
 * Idempotent: skipped when the sample leads exist.
 */
import { eq } from 'drizzle-orm';
import { opsLeads, staffMembers, userRoles, users, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import {
  feeApprovalAction,
  recordAdmissionCheck,
  transitionAdmission,
} from '../src/server/admissions';
import { recordFee } from '../src/server/fees';
import { createLead, logActivity } from '../src/server/leads';
import { scheduleCounselling, updateCounselling } from '../src/server/schedule';

async function seedActor(db: Database, email: string) {
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

const SAMPLE_NOTE = 'Sample record with a fictional amount (development data, not a payment).';

export async function seedAdmissionsSamples(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  const director = await seedActor(db, 'director@example.test');
  if (!manager || !counsellor?.staffId || !director)
    return log('admissions samples skipped: seed users missing');
  const [already] = await db
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.studentEmail, 'tara.sample@example.test'));
  if (already) return log('admissions samples already present');

  const make = (name: string, email: string, programmeCode: string, guardian: string) =>
    createLead(db, manager.actor, {
      studentName: `${name} (fictional)`,
      studentEmail: email,
      guardianName: `${guardian} (fictional)`,
      guardianRelationship: 'father',
      guardianEmail: email.replace('.sample@', '.parent@'),
      currentStage: 'class_12',
      programmeCode,
      interestMode: 'offline',
      sourceCode: 'WALK_IN',
      ownerStaffId: counsellor.staffId,
    } as never);

  async function toPending(leadId: string, admissionId: string) {
    await logActivity(db, counsellor!.actor, leadId, {
      kind: 'visit',
      outcome: 'visited',
      note: 'Sample walk-in (fictional)',
    } as never);
    const session = await scheduleCounselling(db, counsellor!.actor, {
      admissionId,
      scheduledAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      mode: 'in_person',
      attendees: 'both',
    } as never);
    if (session)
      await updateCounselling(db, counsellor!.actor, session.id, {
        action: 'complete',
        outcome: 'Family decided to join (sample).',
      } as never);
    await transitionAdmission(db, counsellor!.actor, admissionId, {
      to: 'admission_pending',
      reason: 'Family joins without a demo (sample).',
    });
  }

  const tara = await make('Tara Sample', 'tara.sample@example.test', 'CLAT', 'Vikram Sample');
  await toPending(tara.lead.id, tara.admission.id);
  for (const itemKey of [
    'admission_form',
    'documents_verified',
    'fee_verification_1',
    'down_payment_verified',
  ] as const)
    await recordAdmissionCheck(db, counsellor.actor, tara.admission.id, {
      itemKey,
      status: 'done',
      reference: 'Sample reference (fictional)',
    });
  await recordAdmissionCheck(db, manager.actor, tara.admission.id, {
    itemKey: 'fee_verification_2',
    status: 'done',
  });
  await feeApprovalAction(db, counsellor.actor, tara.admission.id, {
    action: 'request',
    comment: 'Sample fee arrangement (fictional).',
  });
  await feeApprovalAction(db, director.actor, tara.admission.id, {
    action: 'approve',
    comment: 'Sample approval (fictional).',
  });
  await transitionAdmission(db, counsellor.actor, tara.admission.id, { to: 'admitted' });
  await recordFee(db, manager.actor, tara.admission.id, {
    kind: 'due',
    amountPaise: 6_500_000,
    pricingReference: 'No approved fee schedule (OD-013); sample figure only',
    notes: SAMPLE_NOTE,
  } as never);
  await recordFee(db, manager.actor, tara.admission.id, {
    kind: 'received',
    amountPaise: 1_500_000,
    method: 'bank_transfer',
    paymentDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    receiptReference: 'SAMPLE-RCPT-0001',
    notes: SAMPLE_NOTE,
  } as never);

  const neel = await make('Neel Sample', 'neel.sample@example.test', 'IPMAT', 'Suresh Sample');
  await toPending(neel.lead.id, neel.admission.id);
  await recordFee(db, manager.actor, neel.admission.id, {
    kind: 'due',
    amountPaise: 5_000_000,
    pricingReference: 'No approved fee schedule (OD-013); sample figure only',
    notes: SAMPLE_NOTE,
  } as never);
  log('admissions samples: 2 fictional leads, 3 sample fee records');
}

export const admissionsSampleSeeds = [
  defineSeed({
    name: 'ops.admissions-samples',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members', 'core.programmes', 'ops.lead-sources'],
    description:
      '2 FICTIONAL admissions (one admitted, one pending) with 3 sample manual fee records (fictional amounts)',
    run: ({ db, log }) => seedAdmissionsSamples(db, log),
  }),
];
