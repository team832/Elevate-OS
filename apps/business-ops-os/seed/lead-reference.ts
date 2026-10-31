/**
 * Reference data with no people: the configurable lead-source list (OPS-002, from the legacy CRM
 * Import dropdown) and the 12 system lead stages (brief 23 Oct 2026 §11).
 */
import workflows from '../../../data/legacy/ops/workflows.json';
import { opsLeadSources, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { ensureSystemLeadStages } from '../src/server/lead-stages';

/** Legacy label → stable code. "Unknown" stays its own source (BR-OPS-5). */
export function leadSourceCode(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function seedLeadSources(db: Database) {
  const labels = (workflows as { lead_sources: { crm_first_enquiry_source_dropdown: string[] } })
    .lead_sources.crm_first_enquiry_source_dropdown;
  let sortOrder = 0;
  for (const label of labels) {
    sortOrder += 10;
    const code = leadSourceCode(label);
    await db
      .insert(opsLeadSources)
      .values({ code, label, sortOrder })
      .onConflictDoNothing({ target: opsLeadSources.code });
  }
}

export const leadReferenceSeeds = [
  defineSeed({
    name: 'ops.lead-sources',
    module: 'ops',
    description:
      '12 lead sources from the legacy CRM Import dropdown (Unknown kept as its own source)',
    run: ({ db }) => seedLeadSources(db),
  }),
  defineSeed({
    name: 'ops.lead-stages',
    module: 'ops',
    description:
      'The 12 system lead stages (reference data, not sample: kept by db:clear-samples; labels, order and on/off stay the marketing manager’s)',
    run: ({ db }) => ensureSystemLeadStages(db),
  }),
];
