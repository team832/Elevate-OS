/**
 * Counselling appointments (OPS-008) and demo classes (OPS-009, BR-OPS-2).
 * Booking/completing them drives the admission pipeline through applyTransition.
 * Demo terms, fee and limits come from settings with their decision states.
 */
import { and, asc, eq, gte, inArray, lt, ne, type SQL } from 'drizzle-orm';
import {
  opsAdmissions,
  opsCounsellingSessions,
  opsDemos,
  opsDemoTeachers,
  opsLeads,
  staffMembers,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, daysBetween, istToday, istWeekContaining, type IsoDate } from '../domain';
import { assertAdmissionAccess } from './admissions';
import { accessScope, activeStaff, notFound, programmeByCode, type Actor } from './context';
import { createRuleFollowUp } from './follow-ups';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import type { z } from 'zod';
import type { counsellingBody, counsellingUpdateBody, demoBody, demoUpdateBody } from './schemas';
import { loadSettings } from './settings';

const COUNSELLING_ALLOWED = [
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
];

async function lockForWork(tx: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(tx, actor, 'ops:leads:write');
  const admission = await lockAdmission(tx, admissionId);
  if (!admission) notFound('Admission');
  await assertAdmissionAccess(tx, access, admission);
  return { admission, access };
}

export async function scheduleCounselling(
  db: Database,
  actor: Actor,
  input: z.output<typeof counsellingBody>,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { admission, access } = await lockForWork(tx, actor, input.admissionId);
    if (!COUNSELLING_ALLOWED.includes(admission.status))
      throw new InvalidStateTransitionError(
        admission.status === 'new'
          ? 'Log a successful contact before booking counselling (BR-OPS-4).'
          : `Counselling cannot be booked for an admission that is ${admission.status}.`,
      );
    const counsellorId =
      input.counsellorStaffId ??
      admission.counsellorStaffId ??
      (access.scope === 'own' ? access.staffId : null);
    if (!counsellorId)
      throw new ValidationError('Choose a counsellor.', {
        details: [{ location: 'body', path: ['counsellorStaffId'], message: 'Required' }],
      });
    await activeStaff(tx, counsellorId, 'counsellorStaffId');
    const [session] = await tx
      .insert(opsCounsellingSessions)
      .values({
        admissionId: admission.id,
        leadId: admission.leadId,
        scheduledAt: new Date(input.scheduledAt),
        counsellorStaffId: counsellorId as StaffMemberId,
        mode: input.mode,
        attendees: input.attendees ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (admission.status === 'contacted') {
      await applyTransition(tx, {
        admission,
        to: 'counselling_scheduled',
        actorType: 'user',
        actorUserId: actor.id,
        reason: 'Counselling booked',
        context: {},
        requestId,
        settings,
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'counselling.scheduled',
      entityType: 'counselling_session',
      entityId: session?.id ?? null,
      after: session,
      requestId,
      metadata: { leadId: admission.leadId },
    });
    return session;
  });
}

export async function updateCounselling(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof counsellingUpdateBody>,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  const recommended = input.recommendedProgrammeCode
    ? await programmeByCode(db, input.recommendedProgrammeCode)
    : null;
  return withTransaction(db, async (tx) => {
    const [session] = await tx
      .select()
      .from(opsCounsellingSessions)
      .where(eq(opsCounsellingSessions.id, id as typeof opsCounsellingSessions.$inferSelect.id))
      .for('update');
    if (!session) notFound('Counselling session');
    const { admission } = await lockForWork(tx, actor, session.admissionId);
    if (session.status !== 'scheduled')
      throw new InvalidStateTransitionError(`This session is already ${session.status}.`);
    if (input.action === 'complete' && !input.outcome?.trim())
      throw new ValidationError('Record the counselling outcome.', {
        details: [{ location: 'body', path: ['outcome'], message: 'Required' }],
      });
    if (input.action !== 'complete' && !input.reason?.trim())
      throw new ValidationError('Give a reason.', {
        details: [{ location: 'body', path: ['reason'], message: 'Required' }],
      });
    const now = new Date();
    const [after] = await tx
      .update(opsCounsellingSessions)
      .set({
        status:
          input.action === 'complete'
            ? 'completed'
            : input.action === 'no_show'
              ? 'no_show'
              : 'cancelled',
        outcome: input.outcome?.trim() || input.reason?.trim() || null,
        objections: input.objections ?? session.objections,
        nextStep: input.nextStep ?? session.nextStep,
        attendees: input.attendees ?? session.attendees,
        recommendedProgrammeId: recommended?.id ?? session.recommendedProgrammeId,
        completedAt: input.action === 'complete' ? now : null,
      })
      .where(eq(opsCounsellingSessions.id, session.id))
      .returning();
    let current: AdmissionRow = admission;
    if (input.action === 'complete') {
      if (current.status === 'counselling_scheduled') {
        current = await applyTransition(tx, {
          admission: current,
          to: 'counselled',
          actorType: 'user',
          actorUserId: actor.id,
          reason: 'Counselling completed',
          context: {},
          requestId,
          settings,
        });
      }
      if (recommended && !current.programmeId)
        await tx
          .update(opsAdmissions)
          .set({ programmeId: recommended.id })
          .where(eq(opsAdmissions.id, current.id));
      await createRuleFollowUp(tx, {
        trigger: 'counselling_completed',
        eventAt: now,
        leadId: current.leadId,
        admissionId: current.id,
        ownerStaffId: current.counsellorStaffId ?? session.counsellorStaffId,
        settings,
        createdBy: actor.id,
      });
    } else if (current.status === 'counselling_scheduled') {
      const others = await tx
        .select({ id: opsCounsellingSessions.id })
        .from(opsCounsellingSessions)
        .where(
          and(
            eq(opsCounsellingSessions.admissionId, current.id),
            eq(opsCounsellingSessions.status, 'scheduled'),
            ne(opsCounsellingSessions.id, session.id),
          ),
        );
      if (others.length === 0) {
        await applyTransition(tx, {
          admission: current,
          to: 'contacted',
          actorType: 'user',
          actorUserId: actor.id,
          reason: `Counselling ${input.action === 'no_show' ? 'missed' : 'cancelled'}: ${input.reason}`,
          context: {},
          requestId,
          settings,
        });
      }
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `counselling.${input.action}`,
      entityType: 'counselling_session',
      entityId: session.id,
      before: session,
      after,
      requestId,
      metadata: { leadId: session.leadId },
    });
    return after;
  });
}

/**
 * Validate demo days against the demo terms (days = configured count, distinct)
 * and the OPEN limits (enforced only when the owner has set them, OD-012).
 */
export function validateDemoPlan(
  dayDates: readonly string[],
  subjects: readonly string[],
  terms: { days: number },
  limits: { maxConsecutiveDays: number | null; subjectCap: number | null },
): string[] {
  const problems: string[] = [];
  const sorted = [...new Set(dayDates)].sort() as IsoDate[];
  if (sorted.length !== dayDates.length) problems.push('Demo days must be different dates.');
  if (dayDates.length !== terms.days)
    problems.push(`A demo has ${terms.days} day(s) under the recorded demo terms.`);
  if (limits.subjectCap !== null && subjects.length > limits.subjectCap)
    problems.push(`At most ${limits.subjectCap} subject(s) per demo.`);
  if (limits.maxConsecutiveDays !== null && sorted.length > 1) {
    const span = daysBetween(sorted[0] as IsoDate, sorted[sorted.length - 1] as IsoDate) + 1;
    if (span > limits.maxConsecutiveDays)
      problems.push(`Demo days must fall within ${limits.maxConsecutiveDays} consecutive day(s).`);
  }
  return problems;
}

export async function bookDemo(
  db: Database,
  actor: Actor,
  input: z.output<typeof demoBody>,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  const terms = settings['demo.terms'];
  const fee = settings['demo.fee'];
  const problems = validateDemoPlan(
    input.dayDates,
    input.subjects,
    terms.value,
    settings['demo.limits'].value,
  );
  if (problems.length)
    throw new ValidationError(problems.join(' '), {
      details: problems.map((m) => ({ location: 'body', path: ['dayDates'], message: m })),
    });
  const teachers: Awaited<ReturnType<typeof activeStaff>>[] = [];
  for (const t of input.teacherStaffIds) teachers.push(await activeStaff(db, t, 'teacherStaffIds'));
  return withTransaction(db, async (tx) => {
    const { admission } = await lockForWork(tx, actor, input.admissionId);
    if (!['counselled', 'demo_scheduled'].includes(admission.status))
      throw new InvalidStateTransitionError(
        'A demo is booked after counselling (status Counselled).',
      );
    const active = await tx
      .select({ id: opsDemos.id })
      .from(opsDemos)
      .where(and(eq(opsDemos.admissionId, admission.id), eq(opsDemos.status, 'scheduled')));
    if (active.length)
      throw new ConflictError(
        'This admission already has a scheduled demo; mark it attended, missed or cancelled first.',
      );
    const [demo] = await tx
      .insert(opsDemos)
      .values({
        admissionId: admission.id,
        leadId: admission.leadId,
        subjects: input.subjects.map((s) => s.trim()),
        dayDates: [...input.dayDates].sort(),
        feeAmountInr: String(fee.value.amountInr),
        feeTermsState: fee.decisionState,
        notes: input.notes?.trim() || null,
        createdBy: actor.id,
      })
      .returning();
    if (!demo) throw new Error('demo insert returned no row');
    const now = new Date();
    for (const t of teachers) {
      await tx
        .insert(opsDemoTeachers)
        .values({ demoId: demo.id, staffId: t.id, notifiedAt: t.userId ? now : null });
    }
    const teacherUsers = teachers
      .map((t) => t.userId)
      .filter((u): u is NonNullable<typeof u> => Boolean(u));
    if (teacherUsers.length) {
      await notify(tx, {
        userIds: teacherUsers,
        module: 'ops',
        kind: 'demo.booked',
        title: `Demo class booked: ${demo.subjects.join(', ')}`,
        body: `Separate demo session (not the main batch) on ${demo.dayDates.join(' and ')}.`,
        link: `/ops/schedule`,
        entityType: 'demo',
        entityId: demo.id,
      });
    }
    if (admission.status === 'counselled') {
      await applyTransition(tx, {
        admission,
        to: 'demo_scheduled',
        actorType: 'user',
        actorUserId: actor.id,
        reason: 'Demo booked',
        context: {},
        requestId,
        settings,
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'demo.booked',
      entityType: 'demo',
      entityId: demo.id,
      after: demo,
      requestId,
      metadata: {
        leadId: admission.leadId,
        termsState: terms.decisionState,
        feeState: fee.decisionState,
      },
    });
    return demo;
  });
}

export async function updateDemo(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof demoUpdateBody>,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const [demo] = await tx
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.id, id as typeof opsDemos.$inferSelect.id))
      .for('update');
    if (!demo) notFound('Demo');
    const { admission } = await lockForWork(tx, actor, demo.admissionId);
    let patch: Partial<typeof opsDemos.$inferInsert>;
    if (input.action === 'record_fee') {
      if (!['not_paid', 'paid_verified'].includes(demo.feeStatus))
        throw new ConflictError(`The demo fee is already ${demo.feeStatus}.`);
      if (input.feeStatus === 'paid_verified' && !input.feeReference?.trim())
        throw new ValidationError(
          'A verified payment needs a reference (receipt number in the accounts system).',
        );
      patch = { feeStatus: input.feeStatus, feeReference: input.feeReference?.trim() || null };
    } else {
      if (demo.status !== 'scheduled')
        throw new InvalidStateTransitionError(`This demo is already ${demo.status}.`);
      const now = new Date();
      if (input.action === 'attended') {
        const last = [...demo.dayDates].sort().at(-1) as IsoDate;
        if (istToday(now) < last)
          throw new ValidationError(
            `The demo runs until ${last}; mark it attended after the last day.`,
          );
        patch = { status: 'attended', completedAt: now, notes: input.notes?.trim() || demo.notes };
        if (admission.status === 'demo_scheduled') {
          await applyTransition(tx, {
            admission,
            to: 'demo_attended',
            actorType: 'user',
            actorUserId: actor.id,
            reason: 'Demo attended',
            context: {},
            requestId,
            settings,
          });
        }
        await createRuleFollowUp(tx, {
          trigger: 'demo_attended',
          eventAt: now,
          leadId: admission.leadId,
          admissionId: admission.id,
          ownerStaffId: admission.counsellorStaffId,
          settings,
          createdBy: actor.id,
        });
      } else {
        patch = { status: input.action === 'missed' ? 'missed' : 'cancelled', notes: input.reason };
        if (admission.status === 'demo_scheduled') {
          await applyTransition(tx, {
            admission,
            to: 'counselled',
            actorType: 'user',
            actorUserId: actor.id,
            reason: `Demo ${input.action === 'missed' ? 'missed' : 'cancelled'}: ${input.reason}`,
            context: {},
            requestId,
            settings,
          });
        }
      }
    }
    const [after] = await tx
      .update(opsDemos)
      .set(patch)
      .where(eq(opsDemos.id, demo.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `demo.${input.action}`,
      entityType: 'demo',
      entityId: demo.id,
      before: demo,
      after,
      requestId,
      metadata: { leadId: demo.leadId },
    });
    return after;
  });
}

/** Counselling and demos in a date range (default: this IST week). */
export async function listSchedule(
  db: Database,
  actor: Actor,
  range: { from?: string; to?: string } = {},
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const week = istWeekContaining(istToday(now));
  const from = (range.from ?? week.from) as IsoDate;
  const to = (range.to ?? week.to) as IsoDate;
  if (from > to) throw new ValidationError('"from" must not be after "to".');
  const own = access.scope === 'own' ? access.staffId : undefined;
  if (own === null) return { from, to, counselling: [], demos: [] };
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${addDays(to, 1)}T00:00:00+05:30`);
  const cWhere: SQL[] = [
    gte(opsCounsellingSessions.scheduledAt, start),
    lt(opsCounsellingSessions.scheduledAt, end),
  ];
  if (own) cWhere.push(eq(opsCounsellingSessions.counsellorStaffId, own));
  const counselling = await db
    .select({
      s: opsCounsellingSessions,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      counsellorName: staffMembers.fullName,
    })
    .from(opsCounsellingSessions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsCounsellingSessions.leadId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsCounsellingSessions.counsellorStaffId))
    .where(and(...cWhere))
    .orderBy(asc(opsCounsellingSessions.scheduledAt));
  const demoRows = await db
    .select({
      d: opsDemos,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      counsellor: opsAdmissions.counsellorStaffId,
    })
    .from(opsDemos)
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .orderBy(asc(opsDemos.createdAt));
  const demos = demoRows
    .filter((r) => r.d.dayDates.some((d) => d >= from && d <= to))
    .filter((r) => !own || r.counsellor === own);
  const teachers = demos.length
    ? await db
        .select({ demoId: opsDemoTeachers.demoId, fullName: staffMembers.fullName })
        .from(opsDemoTeachers)
        .innerJoin(staffMembers, eq(staffMembers.id, opsDemoTeachers.staffId))
        .where(
          inArray(
            opsDemoTeachers.demoId,
            demos.map((r) => r.d.id),
          ),
        )
    : [];
  return {
    from,
    to,
    counselling: counselling.map((c) => ({
      ...c.s,
      leadCode: c.leadCode,
      studentName: c.studentName,
      counsellorName: c.counsellorName,
    })),
    demos: demos.map((r) => ({
      ...r.d,
      leadCode: r.leadCode,
      studentName: r.studentName,
      teachers: teachers.filter((t) => t.demoId === r.d.id).map((t) => t.fullName),
    })),
  };
}
