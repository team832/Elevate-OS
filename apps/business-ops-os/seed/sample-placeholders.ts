/**
 * SAMPLE placeholder values (owner request, 20 Oct 2026: "in the placeholder
 * thing add vague data for now"), so the PLACEHOLDERS.md screens are not empty
 * in development. Limits that still apply (AGENTS.md rule 7, D-016):
 *   - every value is fictional and its source says "Sample — replace";
 *   - nothing is approved or locked: the setting override is `proposed`;
 *   - written only by `npm run db:seed` (local databases only), never by a
 *     migration; audited like a real change;
 *   - idempotent: an existing row with the same key is left exactly as it is,
 *     so a value the owner has since changed is kept.
 * The fee structure (owner, 21 Oct 2026: "give me the total fee structure"): one SAMPLE row
 * per allowed combination (sample, removed by db:clear-samples) plus the prices the public
 * website states (`website_stated`, drafts, kept). Existing rows are never overwritten.
 * The HR shift, holiday, leave-type and draft-policy samples were removed with
 * HR and Operations (owner, 20 Oct 2026, D-032).
 */
import { eq } from 'drizzle-orm';
import { opsFeeStructures, opsSettings, userRoles, users, type Database } from '@elevate/database';
import { defineSeed, SEED_PROGRAMMES, type SeedDefinition } from '@elevate/database/seed';
import { withTransaction } from '@elevate/server-kit';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { settingSchemas } from '../src/domain';
import { ALLOWED_PROGRAMME_COMBINATIONS, combinationLabel } from '../src/domain/catalog';
import { opsAudit } from '../src/server/ops-common';

export const SAMPLE_LABEL = 'Sample — replace';
export const SAMPLE_SOURCE = 'Sample placeholder (20 Oct 2026) — replace';

/** Stored overrides. `fees.schedule` accepts only a reference text (≤300 chars), so the sample amounts are written there. */
export const SAMPLE_SETTINGS = [
  {
    key: 'fees.schedule',
    value: {
      scheduleReference: `${SAMPLE_LABEL} (not approved, OD-013): sample amounts per programme per year — CLAT ₹1,00,000; IPMAT ₹1,00,000; CUET ₹50,000; Class 11–12 Commerce ₹50,000. Placeholder figures only.`,
    },
    ownerDecision: 'OD-013',
  },
] as const;

async function seedActor(db: Database, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  return { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) };
}

const auditSetting = opsAudit('setting');

export async function seedSamplePlaceholders(db: Database, log: (m: string) => void = () => {}) {
  const actor = await seedActor(db, 'operations-manager@example.test');
  if (!actor) return log('ops.sample-placeholders: seed operations manager missing; skipped');
  let added = 0;

  for (const s of SAMPLE_SETTINGS) {
    const value = settingSchemas[s.key].parse(s.value);
    const inserted = await withTransaction(db, async (tx) => {
      const [after] = await tx
        .insert(opsSettings)
        .values({
          key: s.key,
          value,
          decisionState: 'proposed',
          source: SAMPLE_SOURCE,
          ownerDecision: s.ownerDecision,
          note: SAMPLE_LABEL,
          updatedBy: actor.id,
        })
        .onConflictDoNothing({ target: opsSettings.key })
        .returning();
      if (after) await auditSetting(tx, actor, s.key, 'setting.changed', { after });
      return Boolean(after);
    });
    if (inserted) added += 1;
  }

  log(
    `ops.sample-placeholders: added ${added} setting override(s) — "${SAMPLE_LABEL}", not approved`,
  );
}

/** SAMPLE amount per programme (paise); a combination's sample total is the sum. Not real fees. */
const SAMPLE_FEE_PAISE: Record<string, number> = {
  CLAT: 100_000_00,
  IPMAT: 100_000_00,
  CUET: 50_000_00,
  CA_FOUNDATION: 60_000_00,
  CLASS_11: 50_000_00,
  CLASS_12: 50_000_00,
  DROPPER: 0,
};
export const sampleFee = (codes: readonly string[]) =>
  codes.reduce((sum, c) => sum + (SAMPLE_FEE_PAISE[c] ?? 0), 0);
export const PROGRAMME_NAMES: Record<string, string> = Object.fromEntries(
  SEED_PROGRAMMES.map(([code, name]) => [code, name]),
);

/** Prices the public website states (docs/PUBLIC_COURSE_CATALOG_RESEARCH.md, checked 20 Oct 2026). */
const WEBSITE_FEES = [
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

/** One SAMPLE row per allowed combination + the website prices (drafts). Existing rows are kept. */
export async function seedFeeStructures(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  if (!manager) return log('ops.fee-structures skipped: sample users missing');
  const updatedBy = manager.id;
  const rows = await db
    .insert(opsFeeStructures)
    .values([
      ...ALLOWED_PROGRAMME_COMBINATIONS.map((codes) => ({
        programmeCodes: [...codes],
        label: `${combinationLabel(codes, PROGRAMME_NAMES)} — sample figure, replace with your real fee`,
        mode: 'both' as const,
        amountPaise: sampleFee(codes),
        instalmentCount: 3,
        instalmentNote: 'At admission, after 3 months and after 6 months (sample template).',
        source: 'sample' as const,
        sourceNote: SAMPLE_SOURCE,
        isSample: true,
        updatedBy,
      })),
      ...WEBSITE_FEES.map((w) => ({
        ...w,
        mode: 'online' as const,
        billingPeriod: 'per_month' as const,
        billingNote: 'Per month; the course length is not stated on the website.',
        source: 'website_stated' as const,
        updatedBy,
      })),
    ])
    .onConflictDoNothing()
    .returning({ id: opsFeeStructures.id });
  log(`ops.fee-structures: ${rows.length} row(s) added (sample figures and website-stated drafts)`);
}

export const samplePlaceholderSeeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'ops.sample-placeholders',
    module: 'ops',
    dependsOn: ['core.users'],
    description:
      'SAMPLE placeholder value ("Sample — replace"): a proposed sample fee-schedule reference; nothing approved',
    run: ({ db, log }) => seedSamplePlaceholders(db, log),
  }),
  defineSeed({
    name: 'ops.fee-structures',
    module: 'ops',
    dependsOn: ['core.users', 'core.programmes'],
    description: `Fee structure: ${ALLOWED_PROGRAMME_COMBINATIONS.length} sample rows (one per combination) + ${WEBSITE_FEES.length} website-stated prices (draft)`,
    run: ({ db, log }) => seedFeeStructures(db, log),
  }),
];
