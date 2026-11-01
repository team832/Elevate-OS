/**
 * The ONE sample set for Business Ops development (D-036). Every record is sample data:
 * leads and students carry `is_sample` (SAMPLE DATA badge); people are made up, with parents,
 * @example.test emails and numbers no real line uses (seed/sample-people.ts). Sample staff come
 * from the core seed and ./reference.ts; the
 * owner-supplied real teachers (./teachers.ts) are never given a class, meeting or feedback.
 * Teacher reviews of students are Academic's (owner answer 1): sample ones are seeded there.
 * Each case is walked through the real services, so history, audit and admission numbers
 * are genuine: applications to their stage (./fill-application.ts), money (./fill-fees.ts).
 * Dates are relative to today (IST); leads arrive over the last 30 days.
 * Idempotent per case: a case whose lead email exists is skipped, so new cases can be added
 * to a seeded database. Enrolment needs Academic OS: the platform seed
 * (apps/platform/seed) runs the real handoff consumers and then `seedSampleLifecycle`.
 * Fee plans use the sample fee structure (./sample-placeholders.ts). Remove samples:
 * `npm run db:clear-samples`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointments,
  opsDemos,
  opsFeePlans,
  opsFollowUps,
  opsGuardians,
  opsLeads,
  opsStaffProfiles,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed, knownPerson } from '@elevate/database/seed';
import type { IsoDateTime, RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../src/domain';
import { recordAdmissionCheck } from '../src/server/admissions';
import { changeAppointment, scheduleAppointment } from '../src/server/appointments';
import { convertDemo } from '../src/server/conversion';
import {
  createDemo,
  setDemoChecklistItem,
  updateDemo,
  updateDemoSession,
} from '../src/server/demos';
import type { SessionAction } from '../src/server/demos-schemas';
import { DEMO_SUBJECTS, SAMPLE_STUDENTS, type SampleStudent } from './sample-cases';
import { feePlanAction, recordPlanEntry } from '../src/server/fees';
import { createFollowUp } from '../src/server/follow-ups';
import { createLead, logActivity } from '../src/server/leads';
import { changeStudentLifecycle } from '../src/server/students';
import {
  addParents,
  admitLegacy,
  leadDetails,
  recordDocuments,
  walkApplication,
  type People,
} from './fill-application';
import { seedCharges, seedFeeAgreement } from './fill-fees';
import { SAMPLE_LOGIN_TEACHER, SAMPLE_TEACHERS } from './reference';

export const TANISHA_EMAIL = knownPerson('Tanisha').email;
const thisYear = Number(istToday(new Date()).slice(0, 4));
const SAMPLE_YEAR = `${thisYear}-${String((thisYear + 1) % 100).padStart(2, '0')}`;
/** The Academic batch a refused enrolment asks for: closed long ago, so it is not found there. */
const CLOSED_BATCH_ID = '0f3b8f54-7c1e-4a5e-9d27-1a2b3c4d5e6f';

export { SAMPLE_STUDENTS };

const emailOf = (s: SampleStudent) => knownPerson(s.first).email;

export const SAMPLE_LEAD_COUNT = SAMPLE_STUDENTS.length;

export async function seedActor(db: Database, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  const [staff] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, u.id));
  return {
    actor: { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) },
    staffId: (staff?.id ?? null) as StaffMemberId | null,
  };
}
type Seeded = NonNullable<Awaited<ReturnType<typeof seedActor>>>;
type Actor = Seeded['actor'];

/** Sample teacher per subject (never a real person who happens to share the name). */
async function sampleTeachers(db: Database, loginTeacher: StaffMemberId) {
  const rows = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(
      and(
        eq(opsStaffProfiles.isSample, true),
        inArray(
          staffMembers.fullName,
          SAMPLE_TEACHERS.map(([n]) => n),
        ),
      ),
    );
  const byName = new Map(rows.map((r) => [r.fullName, r.id]));
  const bySubject = new Map<string, StaffMemberId>([[SAMPLE_LOGIN_TEACHER.subject, loginTeacher]]);
  for (const [name, subject] of SAMPLE_TEACHERS)
    if (byName.has(name)) bySubject.set(subject, byName.get(name)!);
  return bySubject;
}

const leadExists = async (db: Database, email: string) =>
  (await db.$count(opsLeads, eq(opsLeads.studentEmail, email))) > 0;

const istInstant = (today: IsoDate) => (offset: number, hour: number) =>
  new Date(
    `${addDays(today, offset)}T${String(hour).padStart(2, '0')}:00:00+05:30`,
  ).toISOString() as IsoDateTime;

const SOURCES = ['WALK_IN', 'REFERRAL', 'GOOGLE_SEARCH_MAPS', 'INSTAGRAM_ORGANIC', 'SEMINAR'];
const FIRST_VISIT = [
  'Walked in with a parent after school to ask about batches.',
  'Came with an older cousin who studied here.',
  'Asked about fees and the demo classes at the front desk.',
  'Parent visited alone first; the student came for the second talk.',
];
const CHECK_REFERENCE: Record<string, string> = {
  admission_form: 'Paper form filed in the admissions folder.',
  documents_verified: 'Originals seen at the front desk.',
  fee_verification_1: 'Fee and instalment dates read out to the parent.',
  down_payment_verified: 'First payment matched with the receipt book.',
};

export async function seedSamples(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  const director = await seedActor(db, 'director@example.test');
  const finance = await seedActor(db, 'finance-officer@example.test');
  const teacher = await seedActor(db, 'teacher@example.test');
  if (!manager || !counsellor?.staffId || !director || !finance || !teacher?.staffId)
    return log('ops.samples skipped: sample users missing');
  const people: People = { manager, counsellor, director, finance };
  const teachers = await sampleTeachers(db, teacher.staffId);
  const today = istToday(new Date());
  const at = istInstant(today);
  const actor = counsellor.actor;
  let added = 0;

  for (const [i, s] of SAMPLE_STUDENTS.entries()) {
    if (await leadExists(db, emailOf(s))) continue;
    const person = knownPerson(s.first);
    const parent = i % 2 ? person.father : person.mother;
    const counsellingDay = Math.min(s.days[0], 0) - 3;
    const { lead, admission } = await createLead(db, manager.actor, {
      studentName: person.fullName,
      studentEmail: person.email,
      studentPhone: person.phone,
      guardianName: parent.fullName,
      guardianRelationship: parent.relationship,
      guardianEmail: parent.email,
      guardianPhone: parent.phone,
      currentStage: s.stage,
      programmeCode: s.programme,
      interestMode: s.convert?.online ? 'online' : i % 5 === 3 ? 'undecided' : 'offline',
      sourceCode: SOURCES[i % SOURCES.length],
      ownerStaffId: counsellor.staffId,
      receivedAt: at(counsellingDay - 2, 9),
      isSample: true,
    } as never);
    // The rest of the KYC before anything is printed: a later fill would make a signed form stale.
    await db
      .update(opsLeads)
      .set(leadDetails(s.first, parent.relationship)!.lead)
      .where(eq(opsLeads.id, lead.id));
    await logActivity(db, actor, lead.id, {
      kind: 'visit',
      outcome: 'visited',
      note: FIRST_VISIT[i % FIRST_VISIT.length],
    } as never);
    const counselling = await book(db, actor, {
      type: 'student_counselling',
      admissionId: admission.id,
      staffId: counsellor.staffId,
      startsAt: at(counsellingDay, 10 + (i % 8)),
      purpose: 'Programme choice.',
    });
    await changeAppointment(db, actor, counselling.id, {
      action: 'complete',
      outcome: 'Family wants to see three demo classes before deciding.',
      nextStep: 'Book the demo classes',
    } as never);
    const demo = await createDemo(db, actor, {
      admissionId: admission.id,
      durationMinutes: 60,
      sessions: s.days.map((d, n) => ({
        startsAt: at(d, s.hour),
        subject: DEMO_SUBJECTS[s.programme][n]!,
        teacherStaffId: teachers.get(DEMO_SUBJECTS[s.programme][n]!) ?? null,
      })),
      notes: 'Three trial classes agreed with the parent at the counselling meeting.',
    });
    for (const step of s.steps) {
      if ('session' in step) {
        const body: SessionAction =
          'body' in step
            ? step.body
            : {
                action: 'reschedule',
                startsAt: at(step.rescheduleToDay, s.hour),
                reason: step.reason,
              };
        await updateDemoSession(db, actor, demo.id, demo.sessions[step.session - 1]!.id, body);
      } else if ('checklist' in step)
        await setDemoChecklistItem(db, actor, demo.id, {
          itemKey: step.checklist,
          status: step.status,
          reason: step.reason,
        });
      else await updateDemo(db, actor, demo.id, { action: 'outcome', ...step });
    }
    const money = { first: s.first, admissionId: admission.id, today };
    const programmes = s.convert?.programmes ?? [s.programme];
    if (s.fees && !s.convert) {
      const [row] = await db
        .select({ studentId: opsAdmissions.studentId })
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, admission.id));
      await recordChecks(db, { manager, counsellor }, admission.id);
      await seedFeeAgreement(db, people, {
        ...money,
        studentId: row!.studentId!,
        programmes,
        fees: s.fees,
        academicYear: SAMPLE_YEAR,
      });
    }
    if (s.convert) {
      const { id, studentId } = await convertSample(
        db,
        { manager, counsellor },
        admission.id,
        demo.id,
        s.convert,
        addDays(today, s.days[2] + 2),
      );
      const day = addDays(today, Math.min(s.days[2] + 1, 0));
      await addParents(db, manager.actor, studentId, s.first, parent.relationship);
      await recordDocuments(db, people, studentId, s.first, day);
      if (s.fees)
        await seedFeeAgreement(db, people, {
          ...money,
          studentId,
          programmes,
          fees: s.fees,
          academicYear: SAMPLE_YEAR,
        });
      if (s.charges)
        await seedCharges(db, people, {
          ...money,
          demo,
          charges: s.charges,
          day: addDays(today, s.days[0]),
        });
      const stage = s.convert.stage ?? 'confirmed';
      if (stage === 'legacy' || stage === 'legacy_verified')
        await admitLegacy(db, people, admission.id, stage === 'legacy_verified');
      else
        await walkApplication(db, people, {
          first: s.first,
          classStage: s.stage,
          relationship: parent.relationship,
          stage,
          applicationId: id,
          academicYear: SAMPLE_YEAR,
          day,
          requestEnrolment: !s.convert.noEnrolment,
          ...(s.convert.refusedBatch ? { intendedBatchId: CLOSED_BATCH_ID } : {}),
          ...(s.convert.withdrawReason ? { withdrawReason: s.convert.withdrawReason } : {}),
          ...(s.convert.correctAddress ? { correctAddress: true as const } : {}),
        });
    } else if (s.charges)
      await seedCharges(db, people, {
        ...money,
        demo,
        charges: s.charges,
        day: addDays(today, s.days[0]),
      });
    added += 1;
  }
  await seedMeetingsAndFollowUps(db, { manager, counsellor }, teachers, today);
  await seedSampleLifecycle(db, log);
  log(`ops.samples: ${added} demo case(s) added`);
}

/**
 * Meetings and follow-ups of every case, each added only when missing (same type and purpose,
 * or same title), so cases seeded earlier get the ones added to the table later.
 */
async function seedMeetingsAndFollowUps(
  db: Database,
  { manager, counsellor }: Record<'manager' | 'counsellor', Seeded>,
  teachers: Map<string, StaffMemberId>,
  today: IsoDate,
) {
  const at = istInstant(today);
  for (const s of SAMPLE_STUDENTS) {
    if (!s.meetings && !s.followUp) continue;
    const [c] = await db
      .select({
        leadId: opsDemos.leadId,
        admissionId: opsDemos.admissionId,
        demoId: opsDemos.id,
        studentId: opsAdmissions.studentId,
      })
      .from(opsDemos)
      .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
      .where(eq(opsLeads.studentEmail, emailOf(s)));
    if (!c) continue;
    const [guardian] = c.studentId
      ? await db
          .select({ id: opsGuardians.id })
          .from(opsGuardians)
          .where(eq(opsGuardians.studentId, c.studentId))
          .limit(1)
      : [];
    for (const m of s.meetings ?? []) {
      const purpose = m.purpose ? `${m.purpose}.` : null;
      const about = c.studentId ? { studentId: c.studentId } : { leadId: c.leadId };
      const seen = await db.$count(
        opsAppointments,
        and(
          eq(opsAppointments.type, m.type),
          purpose ? eq(opsAppointments.purpose, purpose) : isNull(opsAppointments.purpose),
          c.studentId
            ? eq(opsAppointments.studentId, c.studentId)
            : eq(opsAppointments.leadId, c.leadId),
        ),
      );
      if (seen) continue;
      const row = await book(db, manager.actor, {
        type: m.type,
        staffId: m.with === 'counsellor' ? counsellor.staffId : teachers.get(m.with),
        startsAt: at(m.day, m.hour),
        subject: m.with === 'counsellor' ? null : m.with,
        purpose,
        ...about,
        demoId: m.type === 'demo_review' ? c.demoId : null,
        guardianIds:
          guardian && ['guardian_counselling', 'parent_teacher_meeting'].includes(m.type)
            ? [guardian.id]
            : [],
      });
      if (m.outcome || m.cancel)
        await changeAppointment(
          db,
          manager.actor,
          row.id,
          (m.outcome
            ? { action: 'complete', outcome: m.outcome }
            : { action: 'cancel', reason: m.cancel }) as never,
        );
    }
    if (!s.followUp) continue;
    const { title } = s.followUp;
    if (
      await db.$count(
        opsFollowUps,
        and(eq(opsFollowUps.leadId, c.leadId), eq(opsFollowUps.title, title)),
      )
    )
      continue;
    await createFollowUp(db, counsellor.actor, {
      leadId: c.leadId,
      admissionId: c.admissionId,
      kind: 'general',
      title,
      dueDate: addDays(today, s.followUp.dueIn),
    });
  }
}

const book = (db: Database, actor: Actor, input: Record<string, unknown>) =>
  scheduleAppointment(db, actor, {
    otherStaffIds: [],
    guardianIds: [],
    status: 'scheduled',
    mode: 'offline',
    ...input,
  } as never);

/** The admission checks, the two fee checks by two different people (BR-OPS-7). */
async function recordChecks(
  db: Database,
  { manager, counsellor }: Record<'manager' | 'counsellor', Seeded>,
  admissionId: string,
) {
  for (const [itemKey, reference] of Object.entries(CHECK_REFERENCE))
    await recordAdmissionCheck(db, counsellor.actor, admissionId, {
      itemKey,
      status: 'done',
      reference,
    } as never);
  await recordAdmissionCheck(db, manager.actor, admissionId, {
    itemKey: 'fee_verification_2',
    status: 'done',
    reference: 'Amounts checked against the fee structure.',
  } as never);
}

async function convertSample(
  db: Database,
  people: Record<'manager' | 'counsellor', Seeded>,
  admissionId: string,
  demoId: string,
  convert: NonNullable<SampleStudent['convert']>,
  effectiveDate: IsoDate,
) {
  await recordChecks(db, people, admissionId);
  return convertDemo(db, people.counsellor.actor, demoId, {
    identityVerified: true,
    guardianConfirmation: 'confirmed',
    programmeCodes: convert.programmes,
    deliveryMode: convert.online ? 'online' : 'offline',
    effectiveDate,
    feePlanReference: `Fee structure ${SAMPLE_YEAR}`,
  } as never);
}

/**
 * Holds and exits of the sample set, through the lifecycle service. Each applies only while the
 * admission is in the status it needs (enrolled; admitted for a cancellation before enrolment),
 * so it is idempotent and can run again after the platform seed has enrolled the students.
 */
export async function seedSampleLifecycle(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  if (!manager || !counsellor) return;
  const today = istToday(new Date());
  let changed = 0;
  for (const s of SAMPLE_STUDENTS) {
    const l = s.lifecycle;
    if (!l) continue;
    const needs =
      l.action === 'exit' && l.exitStatus === 'cancelled_before_enrolment'
        ? 'admitted'
        : 'enrolled';
    // A family leaving before classes owes nothing: the tuition is waived before the balance is taken.
    if (l.action === 'exit' && l.closePlan)
      for (const plan of await db
        .select({ id: opsFeePlans.id, total: opsFeePlans.totalPaise })
        .from(opsFeePlans)
        .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .where(
          and(
            eq(opsLeads.studentEmail, emailOf(s)),
            eq(opsFeePlans.status, 'active'),
            eq(opsAdmissions.status, needs),
          ),
        ))
        await recordPlanEntry(db, manager.actor, plan.id, {
          kind: 'waiver',
          amountPaise: plan.total,
          notes: l.closePlan,
        } as never);
    // Every programme case of the student: the bundle holds and leaves together.
    const cases = await db
      .select({ id: opsAdmissions.id })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(and(eq(opsLeads.studentEmail, emailOf(s)), eq(opsAdmissions.status, needs)));
    for (const a of cases) {
      if (l.action === 'hold')
        await changeStudentLifecycle(db, manager.actor, a.id, {
          ...l,
          reviewDate: addDays(today, 14),
        } as never);
      else {
        const { closePlan, daysAgo, reactivate, ...exit } = l;
        await changeStudentLifecycle(db, (reactivate ? counsellor : manager).actor, a.id, {
          ...exit,
          exitDate: addDays(today, -daysAgo),
          reactivationAllowed: true,
        } as never);
        if (reactivate)
          await changeStudentLifecycle(db, manager.actor, a.id, {
            action: 'reactivate',
            reason: reactivate,
          } as never);
        if (closePlan)
          for (const plan of await db
            .select({ id: opsFeePlans.id })
            .from(opsFeePlans)
            .where(and(eq(opsFeePlans.admissionId, a.id), eq(opsFeePlans.status, 'active'))))
            await feePlanAction(db, manager.actor, plan.id, {
              action: 'close',
              reason: closePlan,
            } as never);
      }
      changed += 1;
    }
  }
  log(`ops.samples lifecycle: ${changed} hold/exit change(s)`);
}

export const sampleSeeds = [
  defineSeed({
    name: 'ops.samples',
    module: 'ops',
    dependsOn: [
      'core.users',
      'core.staff_members',
      'core.programmes',
      'ops.lead-sources',
      'ops.lead-stages',
      'ops.staff',
    ],
    description: `The sample set (D-036): ${SAMPLE_STUDENTS.length} demo cases (demo, conversion, enrolment, hold and exit cases)`,
    run: ({ db, log }) => seedSamples(db, log),
  }),
];
