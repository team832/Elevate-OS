/**
 * The table of sample cases (D-036): who each one is, how far their demo, application and money go,
 * and what the record shows. ./samples.ts walks each row through the real services.
 */
import type { ExitStatus } from '../src/domain';
import type { AppointmentType } from '../src/domain/appointments';
import type { SessionAction } from '../src/server/demos-schemas';
import type { CaseStage } from './fill-application';
import type { Charges, FeeCase } from './fill-fees';

/** Demo subjects per programme; each subject has one sample teacher. */
export const DEMO_SUBJECTS = {
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

export interface SampleStudent {
  first: string;
  stage: 'class_11' | 'class_12' | 'gap_year';
  programme: keyof typeof DEMO_SUBJECTS;
  /** The case this record shows. */
  shows: string;
  /** Demo class days relative to today and the IST hour of the classes. */
  days: [number, number, number];
  hour: number;
  steps: Step[];
  /** Conversion → application: how far it goes (default `confirmed`) and what else happens on the way. */
  convert?: {
    programmes: string[];
    stage?: CaseStage;
    /** Confirmed without a request to Academic OS (a cancellation before enrolment). */
    noEnrolment?: true;
    /** Taught online instead of at the Sikar centre. */
    online?: true;
    /** Asks for a batch Academic no longer has, so Academic refuses the enrolment. */
    refusedBatch?: true;
    withdrawReason?: string;
    correctAddress?: true;
  };
  /** Hold or exit, applied by `seedSampleLifecycle` once the status allows it. */
  lifecycle?:
    | { action: 'hold'; reason: string }
    | {
        action: 'exit';
        exitStatus: ExitStatus;
        reason: string;
        reasonCode?: string;
        daysAgo: number;
        exitFeedback: string;
        guardianFeedback: string;
        feeReference?: string;
        materialStatus: string;
        closingNotes: string;
        /** The agreement closes with the exit. */
        closePlan?: string;
        /** Came back: a counsellor records the exit, the manager reactivates the case. */
        reactivate?: string;
      };
  /** Annual agreement: the three instalment due days, how many are paid and how its money went. */
  fees?: FeeCase;
  /** Registration, demo fee and tuition from before agreements. */
  charges?: Charges;
  meetings?: SampleMeeting[];
  followUp?: { title: string; dueIn: number };
}

export const SAMPLE_STUDENTS: readonly SampleStudent[] = [
  {
    first: 'Tanisha',
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
    charges: { demo: 'due' },
  },
  {
    first: 'Aarav',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'all three classes attended, decision open',
    days: [-5, -4, -3],
    hour: 15,
    steps: [...allPresent, {
        session: 3,
        body: { action: 'mock', mockStatus: 'completed', mockAttemptRef: 'IPMAT-DEMO-MOCK-03' },
      }],
    fees: { dueIn: [5, 65, 125], paid: 0, draft: true },
    charges: { demo: 'paid' },
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
    fees: { dueIn: [9, 69, 129], paid: 0, approvedOnly: true },
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
    charges: { demo: 'refunded' },
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
    days: [-30, -29, -28],
    hour: 10,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'CLAT'] },
    fees: { dueIn: [-25, 20, 80], paid: 1 },
    charges: { registration: 'paid', demo: 'credited' },
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
        cancel: 'Student unwell on the day.',
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
    convert: { programmes: ['DROPPER', 'IPMAT'], noEnrolment: true },
    fees: { dueIn: [-8, 30, 90], paid: 0 },
    charges: { registration: 'refunded', demo: 'paid' },
    lifecycle: {
      action: 'exit',
      exitStatus: 'cancelled_before_enrolment',
      reason: 'Family moved to Jaipur before classes began.',
      reasonCode: 'location_mode',
      daysAgo: 4,
      exitFeedback: 'Liked the demo classes; would have stayed if the family had not moved.',
      guardianFeedback: 'Would come back if the family returns to Sikar.',
      feeReference: 'Registration refunded; see the Fees tab.',
      materialStatus: 'not_applicable',
      closingNotes: 'No books were issued. Agreement closed the same day.',
      closePlan: 'Family cancelled before classes began; nothing further will be charged.',
    },
  },
  {
    first: 'Arjun',
    stage: 'class_11',
    programme: 'CLAT',
    shows: 'active: Class 11 Commerce + CLAT; fee instalment 2 upcoming',
    days: [-24, -23, -22],
    hour: 9,
    steps: allPresent,
    convert: { programmes: ['CLASS_11', 'CLAT'] },
    fees: { dueIn: [-20, 25, 85], paid: 1, unchecked: true },
    charges: { registration: 'paid' },
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
  },
  {
    first: 'Diya',
    stage: 'class_12',
    programme: 'IPMAT',
    shows:
      'active: Class 12 Commerce + IPMAT; instalment 2 part paid and overdue; address corrected after signing, so signed twice; PTM upcoming',
    days: [-21, -20, -19],
    hour: 10,
    steps: allPresent,
    convert: {
      programmes: ['CLASS_12', 'IPMAT'],
      correctAddress: true,
    },
    fees: {
      dueIn: [-18, -3, 60],
      paid: 1,
      part: 10_000_00,
      debit: [500_00, 'Cheque for the second instalment bounced; bank charge added.'],
    },
    charges: { registration: 'paid' },
    meetings: [
      {
        type: 'parent_teacher_meeting',
        with: 'Mathematics',
        day: 6,
        hour: 17,
        purpose: 'Quant progress and mock plan',
      },
    ],
  },
  {
    first: 'Kavya',
    stage: 'class_12',
    programme: 'CA_FOUNDATION',
    shows: 'active: Class 12 Commerce + CA Foundation; fees fully paid; PTM held',
    days: [-21, -20, -19],
    hour: 15,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'CA_FOUNDATION'] },
    fees: { dueIn: [-18, -5, -1], paid: 3 },
    charges: { registration: 'paid', demo: 'paid' },
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
    programme: 'CLAT',
    shows: 'active: Dropper + CLAT, online; a wrong payment reversed; instalment 2 due this week',
    days: [-18, -17, -16],
    hour: 11,
    steps: allPresent,
    convert: { programmes: ['DROPPER', 'CLAT'], online: true },
    fees: {
      dueIn: [-15, 4, 64],
      paid: 1,
      reverse: 'Half the amount was keyed by mistake; entered again in full.',
    },
    charges: { registration: 'due' },
  },
  {
    first: 'Anaya',
    stage: 'class_11',
    programme: 'CLASS_11',
    shows: 'active: Class 11 Commerce only; a discount given; instalment 2 overdue',
    days: [-18, -17, -16],
    hour: 14,
    steps: allPresent,
    convert: { programmes: ['CLASS_11'] },
    fees: {
      dueIn: [-15, -2, 40],
      paid: 1,
      discount: [5_000_00, 'Merit discount for 90% and above in Class 10.'],
    },
    charges: { registration: 'waived', demo: 'waived' },
  },
  {
    first: 'Vihaan',
    stage: 'class_12',
    programme: 'CUET',
    shows:
      'active: Class 12 Commerce + CUET; fee agreement active, nothing paid yet (instalment 1 overdue)',
    days: [-15, -14, -13],
    hour: 12,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'CUET'] },
    fees: { dueIn: [-12, 3, 50], paid: 0 },
    charges: { registration: 'due', demo: 'due' },
  },
  {
    first: 'Myra',
    stage: 'class_11',
    programme: 'IPMAT',
    shows:
      'on hold after enrolment (Class 11 Commerce + IPMAT), review in two weeks; agreement changed after the first payment',
    days: [-24, -23, -22],
    hour: 16,
    steps: allPresent,
    convert: { programmes: ['CLASS_11', 'IPMAT'] },
    fees: {
      dueIn: [-20, 25, 85],
      paid: 1,
      adjust: [1_40_000_00, 'Class 11 tuition lowered after the family asked for two subjects only.'],
    },
    charges: { registration: 'paid' },
    lifecycle: { action: 'hold', reason: 'Family medical leave for a month.' },
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
    shows: 'former: withdrew after enrolment (Class 12 Commerce + CLAT), leaving a balance owed',
    days: [-21, -20, -19],
    hour: 17,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'CLAT'] },
    fees: { dueIn: [-17, -2, 40], paid: 1 },
    charges: { registration: 'paid' },
    lifecycle: {
      action: 'exit',
      exitStatus: 'withdrawn',
      reason: 'Chose to prepare at home.',
      reasonCode: 'timing_schedule',
      daysAgo: 2,
      exitFeedback: 'Found the schedule hard alongside school.',
      guardianFeedback: 'Travel time was too long; thanked the teachers.',
      feeReference: 'Second and third instalments unpaid; the accounts office will write to the parent.',
      materialStatus: 'partly_returned',
      closingNotes: 'One book still to come back. Balance to be followed up by accounts.',
    },
  },
  {
    first: 'Ira',
    stage: 'class_12',
    programme: 'CUET',
    shows: 'former: completed the programme (Class 12 Commerce + CUET), fully paid after a waiver',
    days: [-18, -17, -16],
    hour: 16,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'CUET'] },
    fees: {
      dueIn: [-15, -10, -4],
      paid: 3,
      waiver: [2_500_00, 'Last ₹2,500 waived: the centre cancelled two classes in the final week.'],
    },
    charges: { registration: 'paid', demo: 'paid' },
    lifecycle: {
      action: 'exit',
      exitStatus: 'completed',
      reason: 'Finished the CUET crash course.',
      daysAgo: 1,
      exitFeedback: 'The mock tests helped most; would recommend the batch to juniors.',
      guardianFeedback: 'Happy with the weekly updates; asked for the final fee statement.',
      materialStatus: 'returned',
      closingNotes: 'All dues cleared and library books returned.',
    },
  },
  {
    first: 'Reyansh',
    stage: 'class_11',
    programme: 'CUET',
    shows:
      'former: transferred out (Class 11 Commerce + CUET) with money to refund; asking to rejoin',
    days: [-15, -14, -13],
    hour: 16,
    steps: allPresent,
    convert: { programmes: ['CLASS_11', 'CUET'] },
    fees: { dueIn: [-12, -8, -3], paid: 3, overpay: 3_000_00 },
    charges: { registration: 'paid', demo: 'paid' },
    lifecycle: {
      action: 'exit',
      exitStatus: 'transferred',
      reason: 'Family moved; continuing at another centre.',
      reasonCode: 'location_mode',
      daysAgo: 3,
      exitFeedback: 'Sorry to leave; found the batch friendly.',
      guardianFeedback: 'Asked for a transfer letter and the fee statement.',
      feeReference: 'Credit of ₹3,000 to be refunded by bank transfer.',
      materialStatus: 'returned',
      closingNotes: 'Transfer letter issued. Refund of the extra payment is with accounts.',
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
    convert: { programmes: ['DROPPER', 'CLAT'], stage: 'draft' },
    fees: { dueIn: [10, 70, 130], paid: 0, pendingApproval: true },
    charges: { registration: 'paid', demo: 'due' },
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
  {
    first: 'Harini',
    stage: 'class_12',
    programme: 'IPMAT',
    shows: 'application complete and ready; the form is still to print',
    days: [-10, -9, -8],
    hour: 19,
    steps: allPresent,
    convert: { programmes: ['CLASS_12', 'IPMAT'], stage: 'ready' },
    fees: { dueIn: [6, 60, 120], paid: 0 },
    charges: { registration: 'paid', demo: 'paid' },
  },
  {
    first: 'Mohit',
    stage: 'class_11',
    programme: 'CLAT',
    shows: 'form printed, waiting for the family to sign',
    days: [-8, -7, -6],
    hour: 8,
    steps: allPresent,
    convert: { programmes: ['CLASS_11', 'CLAT'], stage: 'form' },
    fees: { dueIn: [8, 68, 128], paid: 0 },
    charges: { registration: 'due' },
  },
  {
    first: 'Neha',
    stage: 'gap_year',
    programme: 'CUET',
    shows: 'signed by the family, waiting for the final approval',
    days: [-14, -13, -12],
    hour: 8,
    steps: allPresent,
    convert: { programmes: ['DROPPER', 'CUET'], stage: 'signed' },
    fees: { dueIn: [-2, 58, 118], paid: 1 },
    charges: { registration: 'paid', demo: 'paid' },
  },
  {
    first: 'Sahil',
    stage: 'class_12',
    programme: 'CLAT',
    shows: 'fee agreement refused by the director; the family then withdrew the application',
    days: [-16, -15, -14],
    hour: 19,
    steps: allPresent,
    convert: {
      programmes: ['CLASS_12', 'CLAT'],
      stage: 'withdrawn',
      withdrawReason: 'The family could not agree the fee and chose a school-based course.',
    },
    fees: {
      dueIn: [-3, 55, 115],
      paid: 0,
      refused: 'A 40% reduction is outside this year’s fee structure; ask the family again.',
    },
    charges: { demo: 'refunded' },
  },
  {
    first: 'Tanya',
    stage: 'class_12',
    programme: 'CLAT',
    shows: 'confirmed, but Academic refused the enrolment: the batch asked for is closed',
    days: [-27, -26, -25],
    hour: 9,
    steps: allPresent,
    convert: { programmes: ['CLAT'], refusedBatch: true },
    fees: { dueIn: [-22, 30, 90], paid: 1 },
    charges: { registration: 'paid' },
  },
  {
    first: 'Ruhi',
    stage: 'class_11',
    programme: 'CLASS_11',
    shows: 'legacy record: admitted on paper, tuition outside an agreement, one entry voided',
    days: [-40, -39, -38],
    hour: 10,
    steps: allPresent,
    convert: { programmes: ['CLASS_11'], stage: 'legacy' },
    charges: {
      registration: 'paid',
      legacyTuition: 'Same receipt entered twice by mistake; the first entry stands.',
    },
    lifecycle: {
      action: 'exit',
      exitStatus: 'withdrawn',
      reason: 'Stopped coming for a month; the father was posted out of town.',
      reasonCode: 'other',
      daysAgo: 6,
      exitFeedback: 'Wanted to continue but could not travel alone.',
      guardianFeedback: 'Asked us to keep her seat if possible.',
      materialStatus: 'not_returned',
      closingNotes: 'Books kept at home; she expects to come back.',
      reactivate: 'The family has sorted out travel; she rejoins the same batch.',
    },
  },
  {
    first: 'Lakshya',
    stage: 'gap_year',
    programme: 'CLAT',
    shows: 'legacy record checked against its paper file by an approver',
    days: [-45, -44, -43],
    hour: 11,
    steps: allPresent,
    convert: { programmes: ['CLAT'], stage: 'legacy_verified' },
    charges: { registration: 'paid' },
  },
];
