/**
 * Configurable policies (marketing.policy_settings). Owner decisions that are still open
 * (OD-xxx) ship as `proposed` defaults — visible on the Settings screen, never hard-coded
 * as fact. Values read from the database are validated; an invalid value falls back to
 * the default (and is reported).
 */
import { z } from 'zod';
import { marketingPolicySettings, type Database } from '@elevate/database';
import { ROLE_KEYS, type RoleKey } from '@elevate/shared-types';

export interface PolicyDefinition<T> {
  key: string;
  schema: z.ZodType<T>;
  defaultValue: T;
  status: 'proposed' | 'approved';
  ownerDecision: string | null;
  description: string;
  source: string;
}

function def<T>(d: PolicyDefinition<T>): PolicyDefinition<T> {
  return d;
}

export const POLICY_DEFINITIONS = {
  approverRoles: def<RoleKey[]>({
    key: 'approval.approver_roles',
    schema: z.array(z.enum(ROLE_KEYS)).min(1),
    defaultValue: ['marketing_manager', 'director'],
    status: 'proposed',
    ownerDecision: 'OD-002',
    description:
      'Roles that may approve content (they must also hold marketing:content:approve). Legacy rule: only the Co-Founder approves; the handover SOP adds the Marketing Lead. Proposed: marketing_manager and director.',
    source: 'content-os/CLAUDE.md L68; handover Marketing-Easy SOP Register!G8',
  }),
  consentRequiredForStudents: def<boolean>({
    key: 'approval.consent_required_for_students',
    schema: z.boolean(),
    defaultValue: true,
    status: 'proposed',
    ownerDecision: 'OD-008',
    description:
      "Content that shows students (mostly minors) cannot be approved without a consent reference (student's and a parent's OK, CO-001). Proposed as a hard block.",
    source: 'content-os/library/_broll/README.md L19',
  }),
  duplicateRenumbering: def<string>({
    key: 'ideas.duplicate_id_resolution',
    schema: z.string(),
    defaultValue: 'quarantine_until_decided',
    status: 'proposed',
    ownerDecision: 'OD-003',
    description:
      'Legacy rows sharing an idea ID (CLAT-027, GEN-012, CUET-002, COM-005) are quarantined without a live code. The proposed renumbering (CLAT-028, GEN-014, CUET-006, COM-006) is reserved but NOT applied.',
    source: 'data/legacy/marketing/ideas.json duplicate_groups',
  }),
  duplicateThresholds: def<{ sameCourse: number; crossCourse: number }>({
    key: 'ideas.duplicate_thresholds',
    schema: z.object({ sameCourse: z.number().gt(0).lte(1), crossCourse: z.number().gt(0).lte(1) }),
    defaultValue: { sameCourse: 0.5, crossCourse: 0.75 },
    status: 'proposed',
    ownerDecision: null,
    description:
      'Title-similarity (Jaccard) thresholds above which a new idea shows a duplicate warning.',
    source: 'apps/marketing-os/docs/ALGORITHMS.md §2',
  }),
  slotWindowMinutes: def<number>({
    key: 'schedule.slot_window_minutes',
    schema: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    defaultValue: 60,
    status: 'proposed',
    ownerDecision: 'OD-007',
    description:
      'Two placements on one account closer than this many minutes are flagged as a slot collision.',
    source: 'apps/marketing-os/docs/ALGORITHMS.md §5',
  }),
  staggerWarning: def<boolean>({
    key: 'schedule.stagger_warning',
    schema: z.boolean(),
    defaultValue: true,
    status: 'proposed',
    ownerDecision: null,
    description:
      'Warn when one idea is scheduled on several accounts the same IST day outside a collab (MKT-016).',
    source: 'content-os/.claude/skills/repurpose step 3',
  }),
  publishMaxAttempts: def<number>({
    key: 'publishing.max_attempts',
    schema: z.number().int().min(1).max(10),
    defaultValue: 3,
    status: 'proposed',
    ownerDecision: null,
    description: 'Adapter publish attempts per (placement, version) before a person must step in.',
    source: 'apps/marketing-os/docs/ALGORITHMS.md §6',
  }),
  accountModel: def<string>({
    key: 'accounts.model',
    schema: z.string(),
    defaultValue: 'content_os_9_plus_later',
    status: 'proposed',
    ownerDecision: 'OD-001',
    description:
      'The registry follows the Content OS model (9 approved accounts + IGN later). The handover lists "Elevate CA" and "Elevate Online" pages (ACC-CONFLICT-001); they are not created until the owner decides.',
    source: 'data/legacy/marketing/accounts.json conflicts',
  }),
  ipmatCaComparison: def<string>({
    key: 'rules.no_ca_comparison_covers_ipmat',
    schema: z.string(),
    defaultValue: 'undecided',
    status: 'proposed',
    ownerDecision: 'OD-005',
    description:
      'Whether the "no CA comparisons" rule (CR-009, CLAT) also covers IPMAT. Undecided: no IPMAT rule is enforced.',
    source: 'docs/EXISTING_PROJECT_AUDIT.md OD-005',
  }),
} as const;

type Defs = typeof POLICY_DEFINITIONS;
export type Policy = { [K in keyof Defs]: Defs[K]['defaultValue'] };

export function defaultPolicy(): Policy {
  const out = {} as Record<string, unknown>;
  for (const [name, d] of Object.entries(POLICY_DEFINITIONS)) out[name] = d.defaultValue;
  return out as Policy;
}

/** Current policy: database values (when valid) over the defaults. */
export async function loadPolicy(db: Database): Promise<Policy> {
  const rows = await db.select().from(marketingPolicySettings);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = defaultPolicy() as Record<string, unknown>;
  for (const [name, d] of Object.entries(POLICY_DEFINITIONS)) {
    if (!byKey.has(d.key)) continue;
    const parsed = (d.schema as z.ZodType).safeParse(byKey.get(d.key));
    if (parsed.success) out[name] = parsed.data;
  }
  return out as Policy;
}

/** Insert missing settings with their proposed defaults (idempotent; never overwrites). */
export async function seedPolicySettings(db: Database): Promise<number> {
  const rows = Object.values(POLICY_DEFINITIONS).map((d) => ({
    key: d.key,
    value: d.defaultValue as unknown as object,
    status: d.status,
    ownerDecision: d.ownerDecision,
    description: d.description,
    source: d.source,
  }));
  const inserted = await db
    .insert(marketingPolicySettings)
    .values(rows)
    .onConflictDoNothing({ target: marketingPolicySettings.key })
    .returning({ id: marketingPolicySettings.id });
  return inserted.length;
}

export async function listPolicySettings(db: Database) {
  const rows = await db.select().from(marketingPolicySettings);
  const stored = new Map(rows.map((r) => [r.key, r]));
  return Object.values(POLICY_DEFINITIONS).map((d) => {
    const row = stored.get(d.key);
    return {
      key: d.key,
      value: row ? row.value : d.defaultValue,
      status: row?.status ?? d.status,
      ownerDecision: d.ownerDecision,
      description: d.description,
      source: d.source,
      stored: Boolean(row),
    };
  });
}
