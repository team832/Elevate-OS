/**
 * The PROPOSED onboarding template (owner brief §8 examples; owner to confirm items, owners and
 * due days, and how many copies make each programme's set). Configuration, not sample data: it
 * applies to every catalogue programme, with one material set per programme (a Class 12 + CLAT
 * student needs both sets). Idempotent: published only when no version of the code exists yet,
 * so edits made in Admissions settings are never overwritten.
 */
import { eq } from 'drizzle-orm';
import { opsOnboardingTemplates, userRoles, type Database } from '@elevate/database';
import { SEED_PROGRAMMES } from '@elevate/database/seed';
import { defineSeed } from '@elevate/database/seed';
import type { UserId } from '@elevate/shared-types';
import type { OnboardingTemplateItem } from '../src/domain/onboarding';
import { publishTemplateVersion } from '../src/server/onboarding';

export const PROPOSED_TEMPLATE = {
  code: 'proposed_standard',
  programmeCodes: SEED_PROGRAMMES.map(([code]) => code),
  classCategory: null,
  items: [
    {
      key: 'kyc_verification',
      label: 'KYC and documents verified (proposed)',
      kind: 'check',
      dueDays: 7,
    },
    { key: 'batch_allocation', label: 'Batch allocated (proposed)', kind: 'check', dueDays: 7 },
    {
      key: 'registration_payment',
      label: 'Registration payment recorded (proposed)',
      kind: 'check',
      dueDays: 7,
    },
    {
      key: 'counselling',
      label: 'Onboarding counselling held (proposed)',
      kind: 'check',
      dueDays: 14,
    },
    {
      key: 'biometric_registration',
      label: 'Biometric registration — status and external reference only (proposed)',
      kind: 'biometric',
      dueDays: 14,
    },
    { key: 'id_card', label: 'ID card issued (proposed)', kind: 'check', dueDays: 21 },
    // Dropper always comes with an exam programme, whose set covers it.
    ...SEED_PROGRAMMES.filter(([code]) => code !== 'DROPPER').map(([code, name]) => ({
      key: `${code.toLowerCase()}_study_set`,
      label: `${name}: complete set of books and study material (proposed)`,
      kind: 'material' as const,
      programmeCode: code,
      catalogueCode: `${code.toLowerCase()}_study_set`,
      requiredQuantity: 1,
      dueDays: 14,
    })),
  ] satisfies OnboardingTemplateItem[],
};

/** Publish v1 of the proposed template unless the code already has a version. */
export async function seedOnboardingTemplates(db: Database, actorUserId: UserId) {
  const [existing] = await db
    .select({ id: opsOnboardingTemplates.id })
    .from(opsOnboardingTemplates)
    .where(eq(opsOnboardingTemplates.code, PROPOSED_TEMPLATE.code))
    .limit(1);
  if (existing) return null;
  return publishTemplateVersion(
    db,
    { id: actorUserId, roles: ['operations_manager'] },
    PROPOSED_TEMPLATE,
  );
}

export const onboardingTemplateSeeds = [
  defineSeed({
    name: 'ops.onboarding-templates',
    module: 'ops',
    dependsOn: ['core.users', 'core.programmes'],
    description: 'The proposed onboarding checklist template (owner to confirm)',
    async run({ db }) {
      const [manager] = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'operations_manager'))
        .limit(1);
      if (manager) await seedOnboardingTemplates(db, manager.userId);
    },
  }),
];
