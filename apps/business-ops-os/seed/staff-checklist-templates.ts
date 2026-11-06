/**
 * The PROPOSED staff joining and leaving checklists (FEATURES-W4 F4-09; owner to confirm the
 * items), published as version 1. Configuration, not sample data. Idempotent: an event that already
 * has a version is left alone, so HR's edits are never overwritten.
 */
import { eq } from 'drizzle-orm';
import { opsStaffChecklistTemplates, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { UserId } from '@elevate/shared-types';
import { publishChecklistTemplate } from '../src/server/hr-staff-records';
import { firstOperationsManager } from './onboarding-templates';

export const PROPOSED_STAFF_CHECKLISTS = {
  joining: [
    'ID card issued',
    'Keys handed over',
    'Devices issued',
    'Induction done',
    'Policies explained',
  ],
  leaving: [
    'ID card returned',
    'Keys returned',
    'Devices returned',
    'Handover done',
    'Final settlement noted',
  ],
} as const;

export async function seedStaffChecklistTemplates(db: Database, actorUserId: UserId) {
  for (const [event, items] of Object.entries(PROPOSED_STAFF_CHECKLISTS) as [
    keyof typeof PROPOSED_STAFF_CHECKLISTS,
    readonly string[],
  ][]) {
    const [existing] = await db
      .select({ id: opsStaffChecklistTemplates.id })
      .from(opsStaffChecklistTemplates)
      .where(eq(opsStaffChecklistTemplates.event, event))
      .limit(1);
    if (!existing)
      await publishChecklistTemplate(
        db,
        { id: actorUserId, roles: ['operations_manager'] },
        {
          event,
          items: [...items],
        },
      );
  }
}

export const staffChecklistTemplateSeeds = [
  defineSeed({
    name: 'ops.staff-checklist-templates',
    module: 'ops',
    dependsOn: ['core.users'],
    description: 'The proposed staff joining and leaving checklists (owner to confirm)',
    async run({ db, log }) {
      const manager = await firstOperationsManager(db);
      if (manager) await seedStaffChecklistTemplates(db, manager);
      else
        log(
          'ops.staff-checklist-templates waited: no operations manager yet; run this again later',
        );
    },
  }),
];
