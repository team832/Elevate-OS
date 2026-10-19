/**
 * Follow-ups (OPS-007, BR-OPS-9) and the reminder job (PLT-010).
 * Due rules, overdue and reminder selection are pure (domain/follow-ups.ts).
 */
import { and, asc, eq, inArray, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFollowUps,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, ValidationError } from '@elevate/shared-contracts';
import type { AdmissionId, LeadId, StaffMemberId } from '@elevate/shared-types';
import {
  addDays,
  followUpDueState,
  istToday,
  isIsoDate,
  proposeFollowUp,
  selectReminders,
  type FollowUpKind,
  type FollowUpTrigger,
  type IsoDate,
  type ResolvedSettings,
} from '../domain';
import {
  accessScope,
  activeStaff,
  assertScope,
  notFound,
  staffIdForUser,
  type Actor,
} from './context';
import { loadSettings } from './settings';

export type FollowUpRow = typeof opsFollowUps.$inferSelect;

/** Create the follow-up a pipeline event calls for (rule-based). Skipped when nobody owns the case. */
export async function createRuleFollowUp(
  tx: Database,
  input: {
    trigger: FollowUpTrigger;
    eventAt: Date;
    leadId: LeadId;
    admissionId: AdmissionId | null;
    ownerStaffId: StaffMemberId | null;
    settings: ResolvedSettings;
    createdBy: Actor['id'] | null;
  },
): Promise<FollowUpRow | null> {
  if (!input.ownerStaffId) return null;
  const proposal = proposeFollowUp(
    input.trigger,
    input.eventAt,
    input.settings['followups.due_rules'].value,
  );
  const [row] = await tx
    .insert(opsFollowUps)
    .values({
      leadId: input.leadId,
      admissionId: input.admissionId,
      kind: proposal.kind,
      title: proposal.title,
      dueDate: proposal.dueDate,
      ownerStaffId: input.ownerStaffId,
      source: 'rule',
      createdBy: input.createdBy,
    })
    .returning();
  return row ?? null;
}

async function leadOwnership(db: Database, leadId: string) {
  const [lead] = await db
    .select({ id: opsLeads.id, ownerStaffId: opsLeads.ownerStaffId })
    .from(opsLeads)
    .where(eq(opsLeads.id, leadId as LeadId))
    .limit(1);
  if (!lead) notFound('Lead');
  return lead;
}

export async function createFollowUp(
  db: Database,
  actor: Actor,
  input: {
    leadId: string;
    admissionId?: string | null;
    kind: FollowUpKind;
    title?: string | null;
    dueDate: string;
    ownerStaffId?: string | null;
  },
  requestId?: string,
): Promise<FollowUpRow> {
  const access = await accessScope(db, actor, 'ops:leads:write');
  if (!isIsoDate(input.dueDate)) throw new ValidationError('dueDate must be YYYY-MM-DD.');
  const lead = await leadOwnership(db, input.leadId);
  let admissionCounsellor: string | null = null;
  if (input.admissionId) {
    const [adm] = await db
      .select({ leadId: opsAdmissions.leadId, counsellor: opsAdmissions.counsellorStaffId })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, input.admissionId as AdmissionId));
    if (!adm || adm.leadId !== lead.id)
      throw new ValidationError('The admission does not belong to this lead.');
    admissionCounsellor = adm.counsellor;
  }
  assertScope(access, [lead.ownerStaffId, admissionCounsellor], 'leads');
  const ownerId =
    input.ownerStaffId ?? (access.scope === 'own' ? access.staffId : null) ?? lead.ownerStaffId;
  if (!ownerId)
    throw new ValidationError('Every follow-up needs an owner (BR-OPS-9).', {
      details: [{ location: 'body', path: ['ownerStaffId'], message: 'Required' }],
    });
  if (access.scope === 'own' && ownerId !== access.staffId)
    throw new ValidationError('You can only create follow-ups owned by yourself.');
  await activeStaff(db, ownerId, 'ownerStaffId');
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsFollowUps)
      .values({
        leadId: lead.id,
        admissionId: (input.admissionId as AdmissionId | null) ?? null,
        kind: input.kind,
        title: input.title?.trim() || 'Follow-up',
        dueDate: input.dueDate,
        ownerStaffId: ownerId as StaffMemberId,
        source: 'manual',
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('follow-up insert returned no row');
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'followup.created',
      entityType: 'follow_up',
      entityId: row.id,
      after: row,
      requestId,
      metadata: { leadId: lead.id },
    });
    return row;
  });
}

export async function closeFollowUp(
  db: Database,
  actor: Actor,
  id: string,
  input: { action: 'complete' | 'cancel'; outcome?: string | null },
  requestId?: string,
): Promise<FollowUpRow> {
  const access = await accessScope(db, actor, 'ops:leads:write');
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(opsFollowUps)
      .where(eq(opsFollowUps.id, id as FollowUpRow['id']))
      .for('update');
    if (!current) notFound('Follow-up');
    assertScope(access, [current.ownerStaffId], 'follow-ups');
    if (current.status !== 'open')
      throw new InvalidStateTransitionError(`This follow-up is already ${current.status}.`);
    if (!input.outcome?.trim())
      throw new ValidationError('Record the outcome (completion needs evidence, BR-OPS-11).', {
        details: [{ location: 'body', path: ['outcome'], message: 'Required' }],
      });
    const [row] = await tx
      .update(opsFollowUps)
      .set(
        input.action === 'complete'
          ? {
              status: 'done',
              outcome: input.outcome.trim(),
              completedAt: new Date(),
              completedBy: actor.id,
            }
          : { status: 'cancelled', outcome: input.outcome.trim() },
      )
      .where(eq(opsFollowUps.id, current.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: input.action === 'complete' ? 'followup.completed' : 'followup.cancelled',
      entityType: 'follow_up',
      entityId: current.id,
      before: current,
      after: row,
      requestId,
      metadata: { leadId: current.leadId },
    });
    return row as FollowUpRow;
  });
}

export type FollowUpView = 'mine' | 'overdue' | 'due_today' | 'open' | 'all';

export async function listFollowUps(
  db: Database,
  actor: Actor,
  options: { view?: FollowUpView; leadId?: string; now?: Date } = {},
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const now = options.now ?? new Date();
  const today = istToday(now);
  const settings = await loadSettings(db);
  const conditions: SQL[] = [];
  if (access.scope === 'own') {
    if (!access.staffId) return [];
    conditions.push(eq(opsFollowUps.ownerStaffId, access.staffId));
  }
  const view = options.view ?? 'open';
  if (view === 'mine') {
    const own = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
    if (!own) return [];
    conditions.push(eq(opsFollowUps.ownerStaffId, own), eq(opsFollowUps.status, 'open'));
  }
  if (view === 'overdue')
    conditions.push(eq(opsFollowUps.status, 'open'), lte(opsFollowUps.dueDate, addDays(today, -1)));
  if (view === 'due_today')
    conditions.push(eq(opsFollowUps.status, 'open'), eq(opsFollowUps.dueDate, today));
  if (view === 'open') conditions.push(eq(opsFollowUps.status, 'open'));
  if (options.leadId) conditions.push(eq(opsFollowUps.leadId, options.leadId as LeadId));
  const rows = await db
    .select({
      followUp: opsFollowUps,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      ownerName: staffMembers.fullName,
    })
    .from(opsFollowUps)
    .innerJoin(opsLeads, eq(opsLeads.id, opsFollowUps.leadId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsFollowUps.ownerStaffId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(opsFollowUps.dueDate), asc(opsLeads.code))
    .limit(500);
  const window = settings['followups.due_rules'].value.upcomingWindowDays;
  return rows.map((r) => ({
    ...r.followUp,
    leadCode: r.leadCode,
    studentName: r.studentName,
    ownerName: r.ownerName,
    due: followUpDueState(
      { status: r.followUp.status, dueDate: r.followUp.dueDate as IsoDate },
      now,
      window,
    ),
  }));
}

/**
 * Reminder job: notify the owner of every open follow-up that is due today or
 * overdue, once per IST day (`last_reminder_on`). Idempotent per day.
 */
export async function runFollowUpReminders(
  db: Database,
  options: { now?: Date; actor?: Actor; requestId?: string } = {},
): Promise<{ sent: number; overdue: number; dueToday: number; unreachable: number }> {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  const now = options.now ?? new Date();
  const today = istToday(now);
  return withTransaction(db, async (tx) => {
    const rows = await tx
      .select({
        id: opsFollowUps.id,
        status: opsFollowUps.status,
        dueDate: opsFollowUps.dueDate,
        lastReminderOn: opsFollowUps.lastReminderOn,
        title: opsFollowUps.title,
        leadId: opsFollowUps.leadId,
        leadCode: opsLeads.code,
        studentName: opsLeads.studentName,
        ownerUserId: staffMembers.userId,
      })
      .from(opsFollowUps)
      .innerJoin(staffMembers, eq(staffMembers.id, opsFollowUps.ownerStaffId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsFollowUps.leadId))
      .where(and(eq(opsFollowUps.status, 'open'), lte(opsFollowUps.dueDate, today)));
    const decisions = selectReminders(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        dueDate: r.dueDate as IsoDate,
        lastReminderOn: (r.lastReminderOn as IsoDate | null) ?? null,
        ownerUserId: r.ownerUserId,
      })),
      now,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    let sent = 0;
    let unreachable = 0;
    for (const d of decisions) {
      const r = byId.get(d.id as FollowUpRow['id']);
      if (!r) continue;
      // Claim today's reminder atomically: a concurrent run that already claimed it updates nothing.
      const claimed = await tx
        .update(opsFollowUps)
        .set({ lastReminderOn: today })
        .where(
          and(
            eq(opsFollowUps.id, r.id),
            or(isNull(opsFollowUps.lastReminderOn), ne(opsFollowUps.lastReminderOn, today)),
          ),
        )
        .returning({ id: opsFollowUps.id });
      if (claimed.length === 0) continue;
      if (d.ownerUserId) {
        await notify(tx, {
          userIds: [r.ownerUserId as NonNullable<typeof r.ownerUserId>],
          module: 'ops',
          kind: d.kind,
          title:
            d.kind === 'followup.overdue'
              ? `Overdue by ${d.daysOverdue} day(s): ${r.title} — ${r.leadCode}`
              : `Due today: ${r.title} — ${r.leadCode}`,
          body: `${r.studentName} (${r.leadCode}). Due ${r.dueDate}.`,
          link: `/ops/leads/${r.leadId}`,
          entityType: 'follow_up',
          entityId: r.id,
        });
        sent += 1;
      } else {
        unreachable += 1;
      }
    }
    await recordAudit(tx, {
      actorType: options.actor ? 'user' : 'system',
      actorUserId: options.actor?.id ?? null,
      module: 'ops',
      action: 'job.followup_reminders',
      entityType: 'job',
      entityId: 'followup-reminders',
      after: { sent, unreachable, considered: decisions.length, today },
      requestId: options.requestId,
    });
    return {
      sent,
      unreachable,
      overdue: decisions.filter((d) => d.kind === 'followup.overdue').length,
      dueToday: decisions.filter((d) => d.kind === 'followup.due_today').length,
    };
  });
}

/** Open follow-ups per lead (for list flags). */
export async function openFollowUpsForLeads(db: Database, leadIds: readonly LeadId[]) {
  if (leadIds.length === 0) return [];
  return db
    .select({
      leadId: opsFollowUps.leadId,
      status: opsFollowUps.status,
      dueDate: opsFollowUps.dueDate,
    })
    .from(opsFollowUps)
    .where(and(inArray(opsFollowUps.leadId, [...leadIds]), or(eq(opsFollowUps.status, 'open'))));
}
