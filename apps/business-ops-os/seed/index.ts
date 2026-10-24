/**
 * Business Ops OS seeds, run by `npm run db:seed` after the core seeds.
 * Idempotent; sample people only (D-036) plus the owner-supplied staff directory. The twelve
 * sample teachers and their work (brief 2 §14) are ./sample-staff.ts and ./sample-work.ts; the
 * marketing team's leads, tasks and HR requests (brief 23 Oct 2026 §25) are ./sample-leads.ts and
 * ./sample-team-work.ts. `clearSamples` backs `npm run db:clear-samples`.
 */
import type { SeedDefinition } from '@elevate/database/seed';
import { onboardingTemplateSeeds } from './onboarding-templates';
import { referenceSeeds } from './reference';
import { sampleLeadSeeds } from './sample-leads';
import { samplePlaceholderSeeds } from './sample-placeholders';
import { sampleStaffSeeds } from './sample-staff';
import { sampleTeamWorkSeeds } from './sample-team-work';
import { sampleWorkSeeds } from './sample-work';
import { sampleSeeds } from './samples';
import { teacherSeeds } from './teachers';

export { ClearSamplesRefused, clearSamples } from './clear-samples';
export { seedSampleLifecycle } from './samples';
export { seedSampleScoreImport } from './sample-score-import';

export const seeds: readonly SeedDefinition[] = [
  ...referenceSeeds,
  ...teacherSeeds,
  ...samplePlaceholderSeeds,
  ...onboardingTemplateSeeds,
  ...sampleSeeds,
  ...sampleStaffSeeds,
  ...sampleWorkSeeds,
  ...sampleLeadSeeds,
  ...sampleTeamWorkSeeds,
];
