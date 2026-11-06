/**
 * Business Ops OS seeds, run by `npm run db:seed` after the core seeds.
 * Idempotent; made-up people only (./teachers.ts, the real staff, is for the reference seed alone:
 * scripts/release/reference-seeds.ts). The twelve
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
import { staffChecklistTemplateSeeds } from './staff-checklist-templates';
import { sampleSeeds } from './samples';
import { websiteFormSeeds } from './website-form';

export { ClearSamplesRefused, clearSamples } from './clear-samples';
export { seedActor, seedSampleLifecycle } from './samples';
export { seedConfirmedScoreImport, seedSampleScoreImport } from './sample-score-import';
export { seedFillAdmissions } from './fill-admissions';
export { seedFillFeedback, seedFillRequests } from './fill-hr';
export { seedFillAttendance } from './fill-attendance';
export { seedFillPeople } from './fill-people';
export { seedFillTasks } from './fill-tasks';
export { seedFillWork } from './fill-work';
export { OWNER_SUPPLIED_STAFF } from './teachers'; // for tests; only the reference seed writes them

export const seeds: readonly SeedDefinition[] = [
  ...referenceSeeds,
  ...websiteFormSeeds,
  ...samplePlaceholderSeeds,
  ...onboardingTemplateSeeds,
  ...staffChecklistTemplateSeeds,
  ...sampleSeeds,
  ...sampleStaffSeeds,
  ...sampleWorkSeeds,
  ...sampleLeadSeeds,
  ...sampleTeamWorkSeeds,
];
