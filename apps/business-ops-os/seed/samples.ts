/**
 * The ONE sample set for Business Ops development (D-036). Every record is sample data:
 * leads and students carry `is_sample` (SAMPLE DATA badge), names read "<First> Sample
 * Student" (Tanisha keeps the brief's "Tanisha Demo Student"), emails are @example.test,
 * no phone numbers exist. Sample staff come from the core seed and ./reference.ts; the
 * owner-supplied real teachers (./teachers.ts) are never given a class, meeting or feedback.
 * Each case is walked through the real services, so history, audit and admission numbers
 * are genuine. Dates are relative to today (IST); leads arrive over the last 30 days.
 * Idempotent per case: a case whose lead email exists is skipped, so new cases can be added
 * to a seeded database. Enrolment needs Academic OS: the platform seed
 * (apps/platform/seed) runs the real handoff consumers and then `seedSampleLifecycle`.
 * Fee plans use the sample fee structure (./sample-placeholders.ts). Remove samples:
 * `npm run db:clear-samples`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointments,
  opsDemos,
  opsFollowUps,
  opsGuardians,
  opsLeadHandoffReceipts,
  opsLeads,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { withTransaction } from '@elevate/server-kit';
import type { IsoDateTime, RoleKey, StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, istToday, type ExitStatus, type IsoDate } from '../src/domain';
import type { AppointmentType } from '../src/domain/appointments';
import { combinationLabel } from '../src/domain/catalog';
import { publishMockLeadHandoff } from '../src/server/adapters/marketing-intake';
import { recordAdmissionCheck } from '../src/server/admissions';
import { changeAppointment, scheduleAppointment } from '../src/server/appointments';
import { assignAdmissionNumber, convertDemo } from '../src/server/conversion';
import {
  createDemo,
  setDemoChecklistItem,
  updateDemo,
  updateDemoSession,
} from '../src/server/demos';
import type { SessionAction } from '../src/server/demos-schemas';
import { createTeacherFeedback } from '../src/server/feedback';
import {
  createFeePlan,
  decideFeePlan,
  feePlanAction,
  recordPlanEntry,
  requestFeePlanApproval,
} from '../src/server/fees';
import { createFollowUp } from '../src/server/follow-ups';
import { publishEnrolmentRequest } from '../src/server/enrolment';
import { processLeadIntake } from '../src/server/lead-intake';
import { createLead, logActivity } from '../src/server/leads';
import { applyTransition } from '../src/server/pipeline';
import { loadSettings } from '../src/server/settings';
import { addGuardian, changeStudentLifecycle } from '../src/server/students';
import { SAMPLE_LOGIN_TEACHER, SAMPLE_TEACHERS } from './reference';
import { PROGRAMME_NAMES, sampleFee } from './sample-placeholders';

export const TANISHA_EMAIL = 'tanisha.sample@example.test';
const SAMPLE_FIGURE = 'Sample figure (development data; not a payment).';
const thisYear = Number(istToday(new Date()).slice(0, 4));
const SAMPLE_YEAR = `${thisYear}-${String((thisYear + 1) % 100).padStart(2, '0')}`;
const NO_SCHEDULE = 'No approved fee schedule (OD-013); sample figures only';

/** Demo subjects per programme; each subject has one sample teacher. */
const DEMO_SUBJECTS = {
  CLAT: ['English', 'Legal Reasoning', 'Logical Reasoning'],
  IPMAT: ['Mathematics', 'English', 'Logical Reasoning'],
  CUET: ['English', 'Economics', 'Current Affairs'],
  CA_FOUNDATION: ['Accountancy', 'Mathematics', 'Economics'],
  CLASS_11: ['Accountancy', 'Economics', 'Mathematics'],
} as const;

type Step =
  | { session: number; body: SessionAction }
  /** Reschedule to that many days from today, at the student's class hour. */
  | { session: number; rescheduleToDay: number; reason: string }
  | { checklist: string; status: 'complete' | 'pending'; reason?: string }
  | { outcome: 'declined' | 'withdrawn' | 'not_converted'; reason: string };
const mark =
  (attendance: 'present' | 'absent') =>
  (session: number): Step => ({ session, body: { action: 'attendance', attendance } });
const present = mark('present');
const absent = mark('absent');
const allPresent = [present(1), present(2), present(3)];

interface SampleMeeting {
  type: AppointmentType;
  /** `counsellor`, or the subject whose sample teacher meets. */
  with: string;
  day: number;
  hour: number;
  purpose?: string;
  /** Past meetings: completed with this outcome, or cancelled with this reason. */
  outcome?: string;
  cancel?: string;
}

interface SampleStudent {
  first: string;
  name?: string;
  stage: 'class_11' | 'class_12' | 'gap_year';
  programme: keyof typeof DEMO_SUBJECTS;
  /** The case this record shows. */
  shows: string;
  /** Demo class days relative to today and the IST hour of the classes. */
  days: [number, number, number];
  hour: number;
  steps: Step[];
  /**
   * Conversion → application draft. `admit`: the case is then admitted as a sample WITHOUT the
   * final confirmation (see `admitSample`); `requestEnrolment` also hands it to Academic OS.
   */
  convert?: {
    programmes: string[];
    admit?: boolean;
    requestEnrolment?: boolean;
  };
  /** Hold or exit, applied by `seedSampleLifecycle` once the status allows it. */
  lifecycle?:
    | { action: 'hold'; reason: string }
    | { action: 'exit'; exitStatus: ExitStatus; reason: string; guardianFeedback?: string };
  /** Annual agreement: the three instalment due days and how many are paid; `pendingApproval` stops at the approval request. */
  fees?: { dueIn: number[]; paid: number; pendingApproval?: boolean };
  meetings?: SampleMeeting[];
  feedback?: { subject: string; day: number; observations: string; areasToImprove: string };
  followUp?: { title: string; dueIn: number };
}

const enrol = (programmes: string[]) => ({ programmes, admit: true, requestEnrolment: true });

export const SAMPLE_STUDENTS: readonly SampleStudent[] = [
  {
    first: 'Tanisha',
    name: 'Tanisha Demo Student',
    stage: 'class_12',
    programme: 'CLAT',
    shows:
      'S1 present, S2 present, S3 scheduled; mock not scheduled; fee structure, admission details and feedback pending',
    days: [-2, -1, 1],
    hour: 16,
    steps: [
      present(1),
      present(2),
      { session: 3, body: { action: 'mock', mockStatus: 'pending' } },
      {
        checklist: 'fee_structure_explained',
        status: 'pending',
        reason: 'To explain after class 3.',
      },
      { checklist: 'admission_process_explained', status: 'pending' },
    ],
    meetings: [
      { type: 'demo_review', with: 'English', day: 1, hour: 18, purpose: 'Review after class 3' },
      {
        type: 'student_counselling',
        with: 'counsellor',
        day: 2,
        hour: 11,
        purpose: 'Fee structure and admission steps',
      },
    ],
    followUp: { title: 'Explain the fee structure to the parent', dueIn: 0 },
  },
  {
    first: 'Aarav',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'all three classes attended, decision open',
    days: [-5, -4, -3],
    hour: 15,
    steps: [...allPresent, { session: 3, body: { action: 'mock', mockStatus: 'prepared' } }],
    meetings: [
      {
        type: 'demo_review',
        with: 'Mathematics',
        day: -2,
        hour: 12,
        purpose: 'Review of the three demo classes',
        outcome: 'Strong quantitative base; recommend the IPMAT batch.',
      },
    ],
    followUp: { title: 'Ask the family for their decision', dueIn: -2 },
  },
  {
    first: 'Meera',
    stage: 'class_11',
    programme: 'CUET',
    shows: 'one absence (class 2), class 3 upcoming',
    days: [-3, -2, 2],
    hour: 17,
    steps: [present(1), absent(2)],
  },
  {
    first: 'Kabir',
    stage: 'class_11',
    programme: 'CLAT',
    shows: 'class 1 rescheduled at the family’s request',
    days: [2, 3, 4],
    hour: 14,
    steps: [{ session: 1, rescheduleToDay: 5, reason: 'Family travelling on the first date.' }],
  },
  {
    first: 'Riya',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'demo completed, not converted',
    days: [-9, -8, -7],
    hour: 11,
    steps: [
      present(1),
      present(2),
      absent(3),
      { outcome: 'not_converted', reason: 'Family chose to wait a year.' },
    ],
  },
  {
    first: 'Dev',
    stage: 'class_12',
    programme: 'CLAT',
    shows: 'declined after class 1',
    days: [-6, 3, 4],
    hour: 12,
    steps: [present(1), { outcome: 'declined', reason: 'Chose another institute.' }],
  },
  {
    first: 'Ishaan',
    stage: 'class_11',
    programme: 'CUET',
    shows: 'withdrawn before the first class',
    days: [6, 7, 8],
    hour: 13,
    steps: [{ outcome: 'withdrawn', reason: 'Moved to another city before the demo.' }],
  },
  {
    first: 'Zoya',
    stage: 'class_12',
    programme: 'CLAT',
    shows: 'Class 12 Commerce + CLAT, enrolled; fee plan with a payment; meetings',
    days: [-12, -11, -10],
    hour: 10,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'CLAT']),
    fees: { dueIn: [-5, 40, 100], paid: 1 },
    meetings: [
      {
        type: 'parent_teacher_meeting',
        with: 'Mathematics',
        day: 5,
        hour: 16,
        purpose: 'First-month progress',
      },
      {
        type: 'teacher_academic',
        with: 'English',
        day: 3,
        hour: 15,
        cancel: 'Student unwell (sample).',
      },
    ],
  },
  {
    first: 'Sana',
    stage: 'gap_year',
    programme: 'IPMAT',
    shows: 'converted to Dropper + IPMAT, then cancelled before enrolment (past student)',
    days: [-12, -11, -10],
    hour: 17,
    steps: allPresent,
    convert: { programmes: ['DROPPER', 'IPMAT'], admit: true },
    lifecycle: {
      action: 'exit',
      exitStatus: 'cancelled_before_enrolment',
      reason: 'Family moved to another city before classes began (sample).',
      guardianFeedback: 'Would return if the family moves back (sample).',
    },
  },
  {
    first: 'Arjun',
    stage: 'class_11',
    programme: 'CLAT',
    shows: 'active: Class 11 Commerce + CLAT; fee instalment 2 upcoming; teacher feedback',
    days: [-24, -23, -22],
    hour: 9,
    steps: allPresent,
    convert: enrol(['CLASS_11', 'CLAT']),
    fees: { dueIn: [-20, 25, 85], paid: 1 },
    meetings: [
      {
        type: 'guardian_counselling',
        with: 'counsellor',
        day: -8,
        hour: 18,
        purpose: 'Settling-in conversation with the parent',
        outcome: 'Parent happy with the timetable; asked for monthly updates.',
      },
    ],
    feedback: {
      subject: 'Legal Reasoning',
      day: -3,
      observations: 'Reads passages carefully; applies principles to facts well.',
      areasToImprove: 'Finish the passage sets inside the time limit.',
    },
  },
  {
    first: 'Diya',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'active: Class 12 Commerce + IPMAT; instalment 2 overdue; PTM upcoming',
    days: [-21, -20, -19],
    hour: 10,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'IPMAT']),
    fees: { dueIn: [-18, -3, 60], paid: 1 },
    meetings: [
      {
        type: 'parent_teacher_meeting',
        with: 'Mathematics',
        day: 6,
        hour: 17,
        purpose: 'Quant progress and mock plan',
      },
    ],
    feedback: {
      subject: 'Mathematics',
      day: -2,
      observations: 'Quick with arithmetic; algebra needs steadier practice.',
      areasToImprove: 'Two timed algebra sets a week.',
    },
  },
  {
    first: 'Kavya',
    stage: 'class_12',
    programme: 'CA_FOUNDATION',
    shows: 'active: Class 12 Commerce + CA Foundation; fees fully paid; PTM held',
    days: [-21, -20, -19],
    hour: 15,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'CA_FOUNDATION']),
    fees: { dueIn: [-18, -5, -1], paid: 3 },
    meetings: [
      {
        type: 'parent_teacher_meeting',
        with: 'Accountancy',
        day: -2,
        hour: 17,
        purpose: 'First test review',
        outcome: 'Accounts fundamentals solid; continue the weekly practice papers.',
      },
    ],
  },
  {
    first: 'Rohan',
    stage: 'gap_year',
    programme: 'CUET',
    shows: 'active: Dropper + CUET; instalment 2 due this week',
    days: [-18, -17, -16],
    hour: 11,
    steps: allPresent,
    convert: enrol(['DROPPER', 'CUET']),
    fees: { dueIn: [-15, 4, 64], paid: 1 },
  },
  {
    first: 'Anaya',
    stage: 'class_11',
    programme: 'CLASS_11',
    shows: 'active: Class 11 Commerce only; instalment 2 overdue',
    days: [-18, -17, -16],
    hour: 14,
    steps: allPresent,
    convert: enrol(['CLASS_11']),
    fees: { dueIn: [-15, -2, 40], paid: 1 },
  },
  {
    first: 'Vihaan',
    stage: 'class_12',
    programme: 'CUET',
    shows: 'active: Class 12 Commerce + CUET; fee plan with a payment',
    days: [-15, -14, -13],
    hour: 12,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'CUET']),
    fees: { dueIn: [-12, 3, 50], paid: 1 },
  },
  {
    first: 'Myra',
    stage: 'class_11',
    programme: 'IPMAT',
    shows: 'on hold after enrolment (Class 11 Commerce + IPMAT), review in two weeks',
    days: [-24, -23, -22],
    hour: 16,
    steps: allPresent,
    convert: enrol(['CLASS_11', 'IPMAT']),
    lifecycle: { action: 'hold', reason: 'Family medical leave for a month (sample).' },
    meetings: [
      {
        type: 'guardian_counselling',
        with: 'counsellor',
        day: 10,
        hour: 12,
        purpose: 'Review of the hold',
      },
    ],
  },
  {
    first: 'Aditya',
    stage: 'class_12',
    programme: 'CLAT',
    shows: 'former: withdrew after enrolment (Class 12 Commerce + CLAT)',
    days: [-21, -20, -19],
    hour: 17,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'CLAT']),
    lifecycle: {
      action: 'exit',
      exitStatus: 'withdrawn',
      reason: 'Chose to prepare at home (sample).',
      guardianFeedback: 'Travel time was too long (sample).',
    },
  },
  {
    first: 'Ira',
    stage: 'class_12',
    programme: 'CUET',
    shows: 'former: completed the programme (Class 12 Commerce + CUET)',
    days: [-18, -17, -16],
    hour: 16,
    steps: allPresent,
    convert: enrol(['CLASS_12', 'CUET']),
    lifecycle: {
      action: 'exit',
      exitStatus: 'completed',
      reason: 'Finished the CUET crash course (sample).',
    },
  },
  {
    first: 'Reyansh',
    stage: 'class_11',
    programme: 'CUET',
    shows: 'former: transferred out (Class 11 Commerce + CUET)',
    days: [-15, -14, -13],
    hour: 16,
    steps: allPresent,
    convert: enrol(['CLASS_11', 'CUET']),
    lifecycle: {
      action: 'exit',
      exitStatus: 'transferred',
      reason: 'Family moved; continuing at another centre (sample).',
    },
  },
  {
    first: 'Saanvi',
    stage: 'gap_year',
    programme: 'CLAT',
    shows: 'converted to Dropper + CLAT; fee agreement waiting for approval',
    days: [-9, -8, -7],
    hour: 16,
    steps: allPresent,
    convert: { programmes: ['DROPPER', 'CLAT'] },
    fees: { dueIn: [10, 70, 130], paid: 0, pendingApproval: true },
    followUp: { title: 'Chase the fee agreement approval', dueIn: 0 },
  },
  {
    first: 'Parth',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'demo booked, first class in three days',
    days: [3, 4, 5],
    hour: 11,
    steps: [],
  },
];

const emailOf = (s: SampleStudent) => `${s.first.toLowerCase()}.sample@example.test`;

/**
 * Leads handed off by MOCK Marketing events (live sync is not configured). Mira shares Meera's
 * parent email, so intake sends her to duplicate review. The Marketing lead id is new on every
 * run: the outbox keeps processed events, so a fixed id would be ignored after db:clear-samples.
 */
const HANDOFFS = [
  {
    source: { code: 'META_ADS', channel: 'Instagram ads (sample)' },
    campaign: { ref: 'SAMPLE-CMP-CLAT-01', name: 'CLAT foundation enquiries (sample)' },
    contacts: {
      studentName: 'Naina Sample Student',
      studentEmail: 'naina.sample@example.test',
      guardianName: 'Naina Sample Parent',
      guardianRelationship: 'mother' as const,
      guardianEmail: 'naina.parent@example.test',
    },
    courseInterest: 'CLAT',
    capturedDay: -1,
  },
  {
    source: { code: 'META_ADS', channel: 'Facebook ads (sample)' },
    campaign: { ref: 'SAMPLE-CMP-CUET-01', name: 'CUET enquiries (sample)' },
    contacts: {
      studentName: 'Mira Sample Student',
      studentEmail: 'mira.sample@example.test',
      guardianName: 'Meera Sample Parent',
      guardianRelationship: 'mother' as const,
      guardianEmail: 'meera.parent@example.test',
    },
    courseInterest: 'CUET',
    capturedDay: 0,
  },
];
export const SAMPLE_LEAD_COUNT = SAMPLE_STUDENTS.length + HANDOFFS.length;

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

/** Sample teacher per subject (never an owner-supplied teacher). */
async function sampleTeachers(db: Database, loginTeacher: StaffMemberId) {
  const rows = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(
      inArray(
        staffMembers.fullName,
        SAMPLE_TEACHERS.map(([n]) => n),
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

export async function seedSamples(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  const director = await seedActor(db, 'director@example.test');
  const teacher = await seedActor(db, 'teacher@example.test');
  if (!manager || !counsellor?.staffId || !director || !teacher?.staffId)
    return log('ops.samples skipped: sample users missing');
  const teachers = await sampleTeachers(db, teacher.staffId);
  const today = istToday(new Date());
  const at = istInstant(today);
  const actor = counsellor.actor;
  let added = 0;

  for (const [i, s] of SAMPLE_STUDENTS.entries()) {
    if (await leadExists(db, emailOf(s))) continue;
    const slug = s.first.toLowerCase();
    const counsellingDay = Math.min(s.days[0], 0) - 3;
    const { lead, admission } = await createLead(db, manager.actor, {
      studentName: s.name ?? `${s.first} Sample Student`,
      studentEmail: emailOf(s),
      guardianName: `${s.first} Sample Parent`,
      guardianRelationship: i % 2 ? 'father' : 'mother',
      guardianEmail: `${slug}.parent@example.test`,
      currentStage: s.stage,
      programmeCode: s.programme,
      interestMode: 'offline',
      sourceCode: 'WALK_IN',
      ownerStaffId: counsellor.staffId,
      receivedAt: at(counsellingDay - 2, 9),
      isSample: true,
    } as never);
    await logActivity(db, actor, lead.id, {
      kind: 'visit',
      outcome: 'visited',
      note: 'Walk-in enquiry (sample).',
    } as never);
    const counselling = await book(db, actor, {
      type: 'student_counselling',
      admissionId: admission.id,
      staffId: counsellor.staffId,
      startsAt: at(counsellingDay, 10 + (i % 8)),
      purpose: 'Programme choice (sample).',
    });
    await changeAppointment(db, actor, counselling.id, {
      action: 'complete',
      outcome: 'Family wants a demo (sample).',
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
      notes: 'Sample demo.',
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
    const studentId = s.convert
      ? (
          await convertSample(
            db,
            { manager, counsellor },
            admission.id,
            demo.id,
            s.convert,
            addDays(today, s.days[2] + 2),
          )
        ).studentId
      : null;
    if (studentId)
      await addGuardian(db, manager.actor, studentId, {
        fullName: `${s.first} Sample Parent`,
        relationship: i % 2 ? 'father' : 'mother',
        email: `${slug}.parent@example.test`,
        preferredContact: 'email',
        consentStatus: 'given',
      } as never);
    if (studentId && s.fees && s.convert)
      await seedFeePlan(
        db,
        { manager, counsellor, director },
        admission.id,
        studentId,
        s.convert.programmes,
        s.fees,
        today,
      );
    if (s.convert?.admit)
      await admitSample(db, manager.actor, admission.id, s.convert.requestEnrolment ?? false);
    if (studentId && s.feedback)
      await createTeacherFeedback(db, manager.actor, {
        studentId,
        teacherStaffId: teachers.get(s.feedback.subject),
        subject: s.feedback.subject,
        observedOn: addDays(today, s.feedback.day),
        observations: `${s.feedback.observations} (sample)`,
        areasToImprove: s.feedback.areasToImprove,
        status: 'final',
      } as never);
    added += 1;
  }
  await seedMeetingsAndFollowUps(db, { manager, counsellor }, teachers, today);
  await seedSampleLifecycle(db, log);

  const marketingLeadIds: string[] = [];
  for (const { capturedDay, ...h } of HANDOFFS) {
    if (await leadExists(db, h.contacts.studentEmail)) continue;
    const marketingLeadId = randomUUID();
    marketingLeadIds.push(marketingLeadId);
    await publishMockLeadHandoff(db, {
      ...h,
      sourceReference: 'Sample landing-page form',
      marketingLeadId,
      consent: { status: 'given', by: 'guardian', allowedChannels: ['call', 'email'] },
      capturedAt: at(capturedDay, 10),
    } as never);
  }
  if (marketingLeadIds.length) {
    await processLeadIntake(db, { actor: manager.actor });
    const receipts = await db
      .select({ leadId: opsLeadHandoffReceipts.leadId })
      .from(opsLeadHandoffReceipts)
      .where(inArray(opsLeadHandoffReceipts.marketingLeadId, marketingLeadIds));
    const ids = receipts.flatMap((r) => (r.leadId ? [r.leadId] : []));
    if (ids.length)
      await db.update(opsLeads).set({ isSample: true }).where(inArray(opsLeads.id, ids));
  }
  log(
    `ops.samples: ${added} demo case(s) and ${marketingLeadIds.length} Marketing handoff(s) added`,
  );
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
      const purpose = m.purpose ? `${m.purpose} (sample).` : null;
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
    const title = `${s.followUp.title} (sample)`;
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

async function convertSample(
  db: Database,
  { manager, counsellor }: Record<'manager' | 'counsellor', Seeded>,
  admissionId: string,
  demoId: string,
  convert: NonNullable<SampleStudent['convert']>,
  effectiveDate: IsoDate,
) {
  for (const itemKey of [
    'admission_form',
    'documents_verified',
    'fee_verification_1',
    'down_payment_verified',
  ])
    await recordAdmissionCheck(db, counsellor.actor, admissionId, {
      itemKey,
      status: 'done',
      reference: 'Sample reference',
    } as never);
  await recordAdmissionCheck(db, manager.actor, admissionId, {
    itemKey: 'fee_verification_2',
    status: 'done',
  } as never);
  return convertDemo(db, counsellor.actor, demoId, {
    identityVerified: true,
    guardianConfirmation: 'confirmed',
    programmeCodes: convert.programmes,
    deliveryMode: 'offline',
    effectiveDate,
    feePlanReference: NO_SCHEDULE,
  } as never);
}

/**
 * Sample-only shortcut (D-036): an admission without the password-confirmed approval cannot be
 * made honestly in a seed (no declaration text is approved and no approver types a password),
 * so sample cases that must look admitted are admitted directly and marked
 * `legacy_verification = 'required'`: the UI shows "Legacy — verification required" and no
 * approval, signed form or payment evidence is invented. The number comes from the real counter.
 */
async function admitSample(
  db: Database,
  actor: Actor,
  admissionId: string,
  requestEnrolment: boolean,
) {
  const settings = await loadSettings(db);
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ a: opsAdmissions, isSample: opsLeads.isSample })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.id, admissionId as never))
      .for('update');
    if (!row?.isSample) throw new Error('admitSample is for sample cases only');
    const number = await assignAdmissionNumber(
      tx,
      actor,
      row.a,
      settings['admissions.number.format'].value,
    );
    const admitted = await applyTransition(tx, {
      admission: { ...row.a, admissionNumber: number },
      to: 'admitted',
      actorUserId: actor.id,
      reason: 'Sample admission seeded without final confirmation (legacy marker).',
      context: { readinessMissing: [] },
      patch: { legacyVerification: 'required' },
      settings,
    });
    if (requestEnrolment) await publishEnrolmentRequest(tx, actor, admitted, { settings });
  });
}

/**
 * Active annual agreement (50/25/25 of the sample fee) through the real flow: the manager makes it,
 * the counsellor asks for its approval, the director approves, the manager activates; the first
 * `paid` instalments are received.
 */
async function seedFeePlan(
  db: Database,
  { manager, counsellor, director }: Record<'manager' | 'counsellor' | 'director', Seeded>,
  admissionId: string,
  studentId: string,
  programmes: readonly string[],
  fees: NonNullable<SampleStudent['fees']>,
  today: IsoDate,
) {
  const totalPaise = sampleFee(programmes);
  const label = `${combinationLabel(programmes, PROGRAMME_NAMES)} (sample)`;
  const plan = await createFeePlan(db, manager.actor, {
    admissionId,
    studentId,
    label,
    pricingReference: `Sample fee structure: ${label}`,
    academicYear: SAMPLE_YEAR,
    totalPaise,
    dueDates: fees.dueIn.map((d) => addDays(today, d)),
  } as never);
  await requestFeePlanApproval(db, counsellor.actor, plan.id, {});
  if (fees.pendingApproval) return;
  await decideFeePlan(db, director.actor, plan.id, { decision: 'approved' });
  await feePlanAction(db, manager.actor, plan.id, { action: 'activate' } as never);
  for (const inst of plan.instalments.slice(0, fees.paid))
    await recordPlanEntry(db, manager.actor, plan.id, {
      kind: 'received',
      amountPaise: inst.amountPaise,
      paymentDate: inst.dueDate < today ? inst.dueDate : today,
      receiptReference: `SAMPLE-RCPT-${inst.id.slice(0, 8)}`,
      method: 'bank_transfer',
      instalmentId: inst.id,
      notes: SAMPLE_FIGURE,
    } as never);
}

/**
 * Holds and exits of the sample set, through the lifecycle service. Each applies only while the
 * admission is in the status it needs (enrolled; admitted for a cancellation before enrolment),
 * so it is idempotent and can run again after the platform seed has enrolled the students.
 */
export async function seedSampleLifecycle(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  if (!manager) return;
  const today = istToday(new Date());
  let changed = 0;
  for (const s of SAMPLE_STUDENTS) {
    const l = s.lifecycle;
    if (!l) continue;
    const [a] = await db
      .select({ id: opsAdmissions.id, status: opsAdmissions.status })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(and(eq(opsLeads.studentEmail, emailOf(s)), isNotNull(opsAdmissions.admissionNumber)));
    const needs =
      l.action === 'exit' && l.exitStatus === 'cancelled_before_enrolment'
        ? 'admitted'
        : 'enrolled';
    if (a?.status !== needs) continue;
    await changeStudentLifecycle(
      db,
      manager.actor,
      a.id,
      (l.action === 'hold'
        ? { ...l, reviewDate: addDays(today, 14) }
        : { ...l, exitDate: today, reactivationAllowed: true }) as never,
    );
    changed += 1;
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
      'ops.staff',
    ],
    description: `The sample set (D-036): ${SAMPLE_STUDENTS.length} demo cases (demo, conversion, enrolment, hold and exit cases) and ${HANDOFFS.length} mock Marketing handoffs`,
    run: ({ db, log }) => seedSamples(db, log),
  }),
];
