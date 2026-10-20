/**
 * SAMPLE placeholder values (owner request, 20 Oct 2026: "in the placeholder
 * thing add vague data for now"), so the PLACEHOLDERS.md screens are not empty
 * in development. This overrides, for these items only, the earlier "seed
 * nothing into the policy register" rule. Limits that still apply (AGENTS.md
 * rule 7, D-016):
 *   - every value is fictional or a public fact, and its name/title/source says
 *     "Sample — replace";
 *   - nothing is approved or locked: shift templates, holidays and leave types
 *     are `proposed`, the setting override is `proposed`, policies are `draft`;
 *   - no leave allocations (balances stay "not configured"), no assignments;
 *   - written only by `npm run db:seed` (local databases only), never by a
 *     migration; through the real services where one exists, so audit applies;
 *   - idempotent: an existing row (same code / date+location / key / title) is
 *     left exactly as it is, so a value the owner has since changed is kept.
 * Holidays: only fixed-date national holidays on/after 20 Oct 2026 in the
 * 2026–27 year (Republic Day 2027). Festival dates (Diwali 2026, Holi 2027) are
 * NOT seeded: no reliable source for them is available offline.
 */
import { eq } from 'drizzle-orm';
import {
  opsHolidays,
  opsLeaveTypes,
  opsPolicies,
  opsSettings,
  opsShiftTemplates,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed, type SeedDefinition } from '@elevate/database/seed';
import { withTransaction } from '@elevate/server-kit';
import type { RoleKey, UserId } from '@elevate/shared-types';
import { isSettingKey, settingSchemas } from '../src/domain';
import { createLeaveType } from '../src/server/hr/leave';
import { createHoliday, createShiftTemplate } from '../src/server/hr/shifts';
import {
  createHolidayBody,
  createLeaveTypeBody,
  createShiftBody,
} from '../src/server/hr/time-schemas';
import { opsAudit } from '../src/server/ops-common';
import { createPolicy } from '../src/server/policies-register';
import { createPolicyBody } from '../src/server/work-schemas';

export const SAMPLE_LABEL = 'Sample — replace';
export const SAMPLE_SOURCE = 'Sample placeholder (20 Oct 2026) — replace';
/** Fixed "as of" date so the seed is deterministic: holidays before it are skipped. */
const SAMPLE_AS_OF = '2026-10-20';
const SIKAR = 'Sikar';
const MON_SAT = [1, 2, 3, 4, 5, 6];

export const SAMPLE_SHIFTS = [
  {
    code: 'SAMPLE-SIKAR-DAY',
    name: `${SAMPLE_LABEL}: Sikar centre day shift`,
    startTime: '09:30',
    endTime: '18:00',
    unpaidBreakMinutes: 60,
    workingWeekdays: MON_SAT,
    location: SIKAR,
    notes: `${SAMPLE_SOURCE}. Placeholder timings, not an approved staff shift (OD-030).`,
  },
  {
    code: 'SAMPLE-ONLINE',
    name: `${SAMPLE_LABEL}: Online support shift`,
    startTime: '11:00',
    endTime: '18:00',
    unpaidBreakMinutes: 0,
    workingWeekdays: MON_SAT,
    notes: `${SAMPLE_SOURCE}. Placeholder timings; break length not given (0) (OD-030).`,
  },
] as const;

/** Public national holidays (fixed dates) in 2026–27; past dates are filtered out. */
const NATIONAL_HOLIDAYS = [
  { holidayDate: '2026-08-15', name: 'Independence Day' },
  { holidayDate: '2026-10-02', name: 'Gandhi Jayanti' },
  { holidayDate: '2027-01-26', name: 'Republic Day' },
] as const;

export const SAMPLE_HOLIDAYS = NATIONAL_HOLIDAYS.filter((h) => h.holidayDate >= SAMPLE_AS_OF).map(
  (h) => ({
    holidayDate: h.holidayDate,
    name: `${SAMPLE_LABEL}: ${h.name}`,
    location: SIKAR,
    note: `${SAMPLE_SOURCE}. Public national holiday; the staff holiday list is the owner's (OD-031).`,
  }),
);

export const SAMPLE_LEAVE_TYPES = [
  {
    code: 'SAMPLE_CASUAL',
    name: `${SAMPLE_LABEL}: Casual leave`,
    paid: true,
    halfDayAllowed: true,
    requiresDocument: false,
    description: `${SAMPLE_SOURCE}. Paid; half days allowed. No entitlement is set (OD-026).`,
  },
  {
    code: 'SAMPLE_SICK',
    name: `${SAMPLE_LABEL}: Sick leave`,
    paid: true,
    halfDayAllowed: true,
    requiresDocument: false,
    description: `${SAMPLE_SOURCE}. Paid. A document reference is expected for absences longer than 2 days (guidance only, not enforced). No entitlement is set (OD-026).`,
  },
  {
    code: 'SAMPLE_UNPAID',
    name: `${SAMPLE_LABEL}: Unpaid leave`,
    paid: false,
    halfDayAllowed: true,
    requiresDocument: false,
    description: `${SAMPLE_SOURCE}. Unpaid. No entitlement is set (OD-026).`,
  },
] as const;

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

const PLACEHOLDER_SENTENCE =
  "It is a placeholder so the register is not empty and will be replaced by the owner's real policy. It has not been reviewed or approved and is not legal advice.";

export const SAMPLE_POLICIES = [
  {
    title: `${SAMPLE_LABEL}: Staff attendance policy`,
    area: 'attendance',
    summary: `Sample entry for how staff attendance, shifts and late arrival are handled. ${PLACEHOLDER_SENTENCE}`,
    linkedSettingKeys: ['attendance.rules', 'shifts.rules'],
    ownerDecisionRef: 'OD-026',
  },
  {
    title: `${SAMPLE_LABEL}: Leave policy`,
    area: 'leave',
    summary: `Sample entry for staff leave types, entitlements and approvals. ${PLACEHOLDER_SENTENCE}`,
    linkedSettingKeys: ['leave.rules', 'leave.entitlements'],
    ownerDecisionRef: 'OD-026',
  },
  {
    title: `${SAMPLE_LABEL}: Student data protection notice`,
    area: 'data_protection',
    summary: `Sample entry for how student and guardian personal data is collected, used and kept. ${PLACEHOLDER_SENTENCE}`,
    linkedSettingKeys: [],
    ownerDecisionRef: null,
  },
] as const;

async function seedActor(db: Database, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  const [staff] = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.userId, u.id));
  return { actor: { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) }, staff };
}

const auditSetting = opsAudit('setting');

export async function seedSamplePlaceholders(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  if (!manager) return log('ops.sample-placeholders: seed operations manager missing; skipped');
  const { actor } = manager;
  const counts = { shifts: 0, holidays: 0, leaveTypes: 0, settings: 0, policies: 0 };

  for (const s of SAMPLE_SHIFTS) {
    const [exists] = await db
      .select({ id: opsShiftTemplates.id })
      .from(opsShiftTemplates)
      .where(eq(opsShiftTemplates.code, s.code));
    if (exists) continue;
    await createShiftTemplate(db, actor, createShiftBody.parse(s));
    counts.shifts += 1;
  }

  const holidays = await db
    .select({ date: opsHolidays.holidayDate, location: opsHolidays.location })
    .from(opsHolidays);
  for (const h of SAMPLE_HOLIDAYS) {
    const clash = holidays.some(
      (r) => r.date === h.holidayDate && (r.location ?? '').toLowerCase() === SIKAR.toLowerCase(),
    );
    if (clash) continue;
    await createHoliday(db, actor, createHolidayBody.parse(h));
    counts.holidays += 1;
  }

  for (const t of SAMPLE_LEAVE_TYPES) {
    const [exists] = await db
      .select({ id: opsLeaveTypes.id })
      .from(opsLeaveTypes)
      .where(eq(opsLeaveTypes.code, t.code));
    if (exists) continue;
    await createLeaveType(db, actor, createLeaveTypeBody.parse(t));
    counts.leaveTypes += 1;
  }

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
    if (inserted) counts.settings += 1;
  }

  const titles = new Set(
    (await db.select({ title: opsPolicies.title }).from(opsPolicies)).map((p) => p.title),
  );
  for (const p of SAMPLE_POLICIES) {
    if (titles.has(p.title)) continue;
    const linkedSettingKeys = p.linkedSettingKeys.filter((k) => isSettingKey(k));
    await createPolicy(
      db,
      actor,
      createPolicyBody.parse({
        ...p,
        linkedSettingKeys,
        accountableStaffId: manager.staff?.id ?? null,
        sourceReference: SAMPLE_SOURCE,
        effectiveDate: null,
        nextReviewDate: null,
      }),
    );
    counts.policies += 1;
  }

  log(
    `ops.sample-placeholders: added ${counts.shifts} shift template(s), ${counts.holidays} holiday(s), ` +
      `${counts.leaveTypes} leave type(s), ${counts.settings} setting override(s), ${counts.policies} draft policy(ies) — all "${SAMPLE_LABEL}", none approved`,
  );
}

export const samplePlaceholderSeeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'ops.sample-placeholders',
    module: 'ops',
    dependsOn: ['core.users', 'core.staff_members', 'ops.staff', 'ops.hr-time'],
    description:
      'SAMPLE placeholder values ("Sample — replace"): 2 proposed shift templates, proposed national holidays for Sikar, 3 proposed leave types, a proposed sample fee-schedule reference and 3 draft policies; no allocations, nothing approved',
    run: ({ db, log }) => seedSamplePlaceholders(db, log),
  }),
];
