/**
 * Automatic lead sharing (F4-16): rules per programme plus one default, managed by whoever may
 * assign leads (ops:leads:assign). `shareNewLead` runs inside the lead-create transaction for a lead
 * with no owner: it locks the rule row, picks the next counsellor (domain/lead-sharing.ts) and moves
 * the rule's pointer. Off unless `leads.sharing.enabled` is on.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPS_LEAD_ASSIGNMENT_MODES,
  opsLeadAssignmentRules as rules,
  opsLeads,
  opsLeaveRecords,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { csvResponse, toCsv, withTransaction } from '@elevate/server-kit';
import { programmeCodeSchema } from '@elevate/shared-contracts';
import type { ProgrammeId, StaffMemberId } from '@elevate/shared-types';
import { istInstant, istToday, type ResolvedSettings } from '../domain';
import { pickCounsellor, type SharingCounsellor } from '../domain/lead-sharing';
import { accessScope, activeStaff, notFound, programmeByCode, type Actor } from './context';
import { opsAudit } from './ops-common';

const audit = opsAudit('lead_assignment_rule');

export const SHARING_MODE_LABELS: Record<(typeof OPS_LEAD_ASSIGNMENT_MODES)[number], string> = {
  round_robin: 'In turn (round robin)',
  fewest_open: 'Fewest open leads',
};

/** The screen posts ticked boxes ({ id: true }); the API may send the ids in turn order. */
const ticked = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] === true)
    : v;

export const sharingRuleBody = z
  .object({
    /** Empty = the default rule (every programme without its own rule, and no programme). */
    programmeCode: programmeCodeSchema.nullish(),
    mode: z.enum(OPS_LEAD_ASSIGNMENT_MODES).default('round_robin'),
    counsellors: z.preprocess(
      ticked,
      z
        .array(z.uuid())
        .min(1, 'Choose at least one counsellor.')
        .max(50, 'A rule can list at most 50 counsellors.')
        .refine((ids) => new Set(ids).size === ids.length, 'Each counsellor can be listed once.'),
    ),
    dailyCap: z.int().min(1).max(500).nullish(),
  })
  .strict();
export type SharingRuleInput = z.output<typeof sharingRuleBody>;

/** Open lead (as the leaver notice counts them): not merged, at no stage yet or at an open one. */
const OPEN_LEAD = sql`${opsLeads.mergedIntoLeadId} is null and (${opsLeads.stageKey} is null or ${opsLeads.stageKey} in (select key from ops.lead_stages where kind = 'open'))`;

/**
 * Who gets a new lead nobody owns: null when sharing is off or no rule applies; `owner` null when
 * every counsellor of the rule is inactive or at the day's cap (the lead stays unassigned).
 */
export async function shareNewLead(
  tx: Database,
  settings: ResolvedSettings,
  programmeId: ProgrammeId | null,
) {
  if (!settings['leads.sharing.enabled'].value.enabled) return null;
  const [rule] = await tx
    .select()
    .from(rules)
    .where(
      programmeId
        ? or(eq(rules.programmeId, programmeId), isNull(rules.programmeId))
        : isNull(rules.programmeId),
    )
    .orderBy(sql`${rules.programmeId} nulls last`)
    .limit(1)
    .for('update');
  if (!rule) return null;
  const today = istToday(new Date());
  const since = istInstant(today).toISOString();
  // Approved leave covering today (a half day too) takes a counsellor out, like a staff status.
  const away = await tx
    .selectDistinct({ id: opsLeaveRecords.staffId })
    .from(opsLeaveRecords)
    .where(
      and(
        inArray(opsLeaveRecords.staffId, rule.counsellorStaffIds),
        eq(opsLeaveRecords.status, 'approved'),
        lte(opsLeaveRecords.fromDate, today),
        gte(opsLeaveRecords.toDate, today),
      ),
    );
  const onLeave = new Set<string>(away.map((a) => a.id));
  const staff = await tx
    .select({
      id: staffMembers.id,
      userId: staffMembers.userId,
      fullName: staffMembers.fullName,
      managerId: staffMembers.managerId,
      active: sql<boolean>`${staffMembers.status} = 'active'`,
    })
    .from(staffMembers)
    .where(inArray(staffMembers.id, rule.counsellorStaffIds));
  const counts = await tx
    .select({
      id: opsLeads.ownerStaffId,
      today: sql<number>`(count(*) filter (where ${opsLeads.ownerAssignedAt} >= ${since}::timestamptz))::int`,
      open: sql<number>`(count(*) filter (where ${OPEN_LEAD}))::int`,
    })
    .from(opsLeads)
    .where(inArray(opsLeads.ownerStaffId, rule.counsellorStaffIds))
    .groupBy(opsLeads.ownerStaffId);
  const held = new Map(counts.map((c) => [c.id as string, c]));
  const chosen = pickCounsellor(
    rule,
    new Map<string, SharingCounsellor>(
      staff.map((s) => [
        s.id,
        { active: s.active && !onLeave.has(s.id), today: 0, open: 0, ...held.get(s.id) },
      ]),
    ),
  );
  const owner = staff.find((s) => s.id === chosen) ?? null;
  if (owner)
    await tx.update(rules).set({ lastAssignedStaffId: owner.id }).where(eq(rules.id, rule.id));
  return { ruleId: rule.id, outcome: owner ? 'assigned_by_rule' : 'no_counsellor_free', owner };
}

export async function listSharingRules(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:leads:assign');
  const rows = await db
    .select({ rule: rules, programmeCode: programmes.code, programmeName: programmes.name })
    .from(rules)
    .leftJoin(programmes, eq(programmes.id, rules.programmeId))
    .orderBy(sql`${rules.programmeId} is null`, asc(programmes.name));
  const ids = [...new Set(rows.flatMap((r) => r.rule.counsellorStaffIds))];
  const staff = ids.length
    ? await db
        .select({
          id: staffMembers.id,
          fullName: staffMembers.fullName,
          status: staffMembers.status,
        })
        .from(staffMembers)
        .where(inArray(staffMembers.id, ids))
    : [];
  const byId = new Map(staff.map((s) => [s.id as string, s]));
  return rows.map(({ rule, programmeCode, programmeName }) => ({
    ...rule,
    programmeCode,
    programmeName: programmeName ?? 'Default (any other programme, or none)',
    counsellors: rule.counsellorStaffIds.map((id) => ({
      id,
      fullName: byId.get(id)?.fullName ?? 'Staff record removed',
      active: byId.get(id)?.status === 'active',
    })),
    lastAssignedName: byId.get(rule.lastAssignedStaffId ?? '')?.fullName ?? null,
  }));
}
export type SharingRuleRow = Awaited<ReturnType<typeof listSharingRules>>[number];

/** Save the rule of a programme (or the default rule), replacing the one it has. */
export async function saveSharingRule(
  db: Database,
  actor: Actor,
  input: SharingRuleInput,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:assign');
  for (const id of input.counsellors) await activeStaff(db, id, 'counsellors');
  const programme = input.programmeCode ? await programmeByCode(db, input.programmeCode) : null;
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(rules)
      .where(programme ? eq(rules.programmeId, programme.id) : isNull(rules.programmeId))
      .for('update');
    const values = {
      mode: input.mode,
      counsellorStaffIds: input.counsellors as StaffMemberId[],
      dailyCap: input.dailyCap ?? null,
    };
    const [after] = before
      ? await tx
          .update(rules)
          .set({ ...values, updatedBy: actor.id })
          .where(eq(rules.id, before.id))
          .returning()
      : await tx
          .insert(rules)
          .values({ ...values, programmeId: programme?.id ?? null, createdBy: actor.id })
          .returning();
    await audit(tx, actor, after!.id, 'lead_assignment_rule.saved', { before, after }, requestId);
    return after!;
  });
}

export async function deleteSharingRule(
  db: Database,
  actor: Actor,
  id: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:leads:assign');
  return withTransaction(db, async (tx) => {
    const [before] = await tx.delete(rules).where(eq(rules.id, id)).returning();
    if (!before) notFound('Sharing rule');
    await audit(tx, actor, before.id, 'lead_assignment_rule.deleted', { before }, requestId);
    return { id: before.id };
  });
}

/** "Download (spreadsheet)" of the rules (list-exports pattern: same service, audited count). */
export async function sharingRulesCsv(db: Database, actor: Actor) {
  const list = await listSharingRules(db, actor);
  await opsAudit('export')(db, actor, null, 'export.downloaded', {
    metadata: { list: 'lead-sharing', filters: [], rows: list.length },
  });
  return csvResponse(
    toCsv(
      [
        'Programme',
        'How',
        'Counsellors in turn order',
        'Daily cap per counsellor',
        'Last lead went to',
      ],
      list.map((r) => [
        r.programmeName,
        SHARING_MODE_LABELS[r.mode],
        r.counsellors.map((c) => (c.active ? c.fullName : `${c.fullName} (not active)`)).join('; '),
        r.dailyCap ?? 'No cap',
        r.lastAssignedName ?? '',
      ]),
    ),
    `lead-sharing-${istToday(new Date())}.csv`,
  );
}
