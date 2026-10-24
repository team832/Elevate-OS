/**
 * Platform seeds, run by `npm run db:seed` after the module seeds. Only the platform may
 * import two modules (D-011.3), so the cross-module step of the sample set lives here:
 * `platform.sample-enrolments` takes the sample admissions waiting for enrolment through the
 * real handoff (INTEGRATION_CONTRACT §6) — Academic's intake consumer, then Ops's
 * `ops.enrolment-replies` consumer — and then applies the Ops sample holds and exits that
 * need an enrolled student. It does nothing while a REAL enrolment request waits: a seed
 * never processes real work (run "Process intake" in Academic OS for that).
 */
import { and, eq } from 'drizzle-orm';
import { opsAdmissions, opsLeads } from '@elevate/database';
import { defineSeed, type SeedDefinition } from '@elevate/database/seed';
import { runEnrolmentIntake } from '@elevate/academic-os/server';
import { processEnrolmentReplies } from '@elevate/business-ops-os/server';
import { seedSampleLifecycle } from '@elevate/business-ops-os/seed';
import { sampleTestSeed } from './sample-tests';

export const seeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'platform.sample-enrolments',
    module: 'platform',
    dependsOn: ['ops.samples'],
    description:
      'Sample admissions → Academic intake → Ops enrolment replies (real consumers), then sample holds and exits',
    run: async ({ db, log }) => {
      const [real] = await db
        .select({ id: opsAdmissions.id })
        .from(opsAdmissions)
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .where(and(eq(opsAdmissions.status, 'enrolment_requested'), eq(opsLeads.isSample, false)))
        .limit(1);
      if (real)
        return log('platform.sample-enrolments skipped: a real enrolment request is waiting');
      const intake = await runEnrolmentIntake(db);
      const replies = await processEnrolmentReplies(db);
      log(
        `platform.sample-enrolments: intake ${JSON.stringify(intake)}, replies ${JSON.stringify(replies)}`,
      );
      await seedSampleLifecycle(db, log);
    },
  }),
  sampleTestSeed,
];
