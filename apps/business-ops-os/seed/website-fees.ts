/**
 * The prices the public website states (docs/PUBLIC_COURSE_CATALOG_RESEARCH.md, checked 20 Oct 2026):
 * drafts with their source, not sample and not confirmed by the owner. `db:seed` writes them inside
 * `ops.fee-structures`; `ops.website-fees` is the same rows for a database that has no samples.
 */
import { opsFeeStructures } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { UserId } from '@elevate/shared-types';
import { firstOperationsManager } from './onboarding-templates';

export const WEBSITE_FEES = [
  {
    programmeCodes: ['COMMERCE_11_12', 'CUET'],
    label: 'Commerce + CUET Batch (price as stated on elevateeducation.in)',
    amountPaise: 10_000_00,
    sourceNote:
      'FAQ on /commerce-coaching and /online-coaching: "Commerce + CUET batch (₹10,000/month)"; package cards say "Unlock Pricing". Recorded 20 Oct 2026; not confirmed by the owner.',
  },
  {
    programmeCodes: ['COMMERCE_11_12', 'IPMAT', 'CUET'],
    label: 'The ACE Batch — Commerce + IPMAT + CUET (price as stated on elevateeducation.in)',
    amountPaise: 12_000_00,
    sourceNote:
      'FAQ on /commerce-coaching: "The ACE Batch (₹12,000/month)"; package cards say "Unlock Pricing". Recorded 20 Oct 2026; not confirmed by the owner. Not one of the owner’s programme combinations (catalog.ts).',
  },
];

export const websiteFeeRows = (updatedBy: UserId) =>
  WEBSITE_FEES.map((w) => ({
    ...w,
    mode: 'online' as const,
    billingPeriod: 'per_month' as const,
    billingNote: 'Per month; the course length is not stated on the website.',
    source: 'website_stated' as const,
    updatedBy,
  }));

export const websiteFeesSeed = defineSeed({
  name: 'ops.website-fees',
  module: 'ops',
  dependsOn: ['core.programmes'],
  description: `${WEBSITE_FEES.length} prices stated on the public website (draft, not confirmed by the owner)`,
  async run({ db, log }) {
    const manager = await firstOperationsManager(db);
    if (!manager)
      return log('ops.website-fees waited: no operations manager yet; run this again later');
    await db.insert(opsFeeStructures).values(websiteFeeRows(manager)).onConflictDoNothing();
  },
});
