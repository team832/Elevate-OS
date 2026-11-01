/**
 * Owner, 31 Oct 2026: requests through HR in every state, a forward with a reply and its relay, and
 * student feedback about teachers: imports in each state, moderated responses, summaries (approved,
 * draft, withdrawn; one below the 5-response rule) and development actions, for sample teachers and
 * the demo teacher. Steps go through the real services, so HR notes, forwards, the summary figures
 * and approvals are the real ones; the rows are then marked `is_sample`. Skipped once they exist.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  academicBatches,
  opsHrRequestEvents,
  opsHrRequests,
  opsStaffTasks,
  opsStudentTeacherFeedback as feedback,
  opsTeacherDevelopmentActions,
  opsTeacherFeedbackImportRows,
  opsTeacherFeedbackImports,
  opsTeacherFeedbackSummaries,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import {
  PEOPLE,
  POOJA_EMAIL,
  ROHIT_EMAIL,
  SAMPLE_SCHAR,
  UNMATCHED_TEACHER,
} from '@elevate/database/seed';
import { addDays, istInstant, type IsoDate } from '../src/domain/dates';
import type { HrRequestAction } from '../src/domain/hr-requests';
import { periodOf } from '../src/domain/work-report';
import {
  createAction,
  createSummary,
  updateAction,
  updateSummary,
} from '../src/server/feedback-summaries';
import { createHrRequest, hrRequestAction } from '../src/server/hr-requests';
import { loadSettings } from '../src/server/settings';
import { DEMO_TEACHER_EMAIL } from './fill-people';
import { sampleAnchorDate } from './sample-staff';
import { seedActor } from './samples';

const TEACHER = DEMO_TEACHER_EMAIL;
const ADITI = 'aditi.mehra@example.test';
const KARAN = 'karan.bedi@example.test';
const ISHA = 'isha.nair@example.test';
const NISHA = 'nisha.rao@example.test';
const ARJUN = 'arjun.menon@example.test';
const RAGHAV = 'raghav.sethi@example.test';
const ARJUN_NAME = 'Arjun Menon';

type Step = [HrRequestAction | 'answer', string | null, string | null];
interface RequestCase {
  subject: string;
  from: string;
  to: 'hr' | 'schar' | string;
  category: string;
  urgency?: 'low' | 'normal' | 'high' | 'urgent';
  message: string;
  draft?: true;
  daysAgo: number;
  /** [action, what is said, HR's own note]; `answer` = the recipient's reply. */
  steps: Step[];
}

/** Every state: draft, submitted, reviewed, forwarded (waiting, answered, relayed), resolved, declined. */
export const FILL_REQUESTS: readonly RequestCase[] = [
  {
    subject: 'Swap my Saturday class with Monday',
    from: TEACHER,
    to: 'hr',
    category: 'timetable',
    message:
      'I have an exam-duty letter for Saturday. Could my Quant class move to Monday at the same time?',
    draft: true,
    daysAgo: 0,
    steps: [],
  },
  {
    subject: 'Projector in Room 2 is not working',
    from: ADITI,
    to: 'hr',
    category: 'resources',
    urgency: 'high',
    message:
      'The projector in Room 2 has not worked since Tuesday and I need it for the CA Foundation class on Thursday.',
    daysAgo: 1,
    steps: [],
  },
  {
    subject: 'Clarify who marks the Business Laws test',
    from: KARAN,
    to: 'hr',
    category: 'tasks',
    message: 'Two of us were told to mark the Business Laws test. Who should do it?',
    daysAgo: 2,
    steps: [['review', null, 'Checking with the academic manager.']],
  },
  {
    subject: 'Quant examples for the IPMAT post',
    from: POOJA_EMAIL,
    to: TEACHER,
    category: 'classes',
    message:
      'Could the Quant teacher share two simple percentage examples for a post about daily practice?',
    daysAgo: 2,
    steps: [
      ['review', null, 'Fine to pass on; no student names.'],
      [
        'forward',
        'The marketing team would like two simple percentage examples for a post. Can you share two by Friday?',
        'Forwarded to the Quant teacher.',
      ],
    ],
  },
  {
    subject: 'Dates for the campus visit',
    from: ROHIT_EMAIL,
    to: 'schar',
    category: 'other',
    message:
      'Which of the two proposed dates suits the campus visit, and who will take the group around?',
    daysAgo: 4,
    steps: [
      ['review', null, 'For Schar to decide.'],
      [
        'forward',
        'Please choose one of the two proposed campus visit dates and name who takes the group around.',
        'Waiting for Schar.',
      ],
      ['answer', 'The later date works. I will take the group around myself.', null],
      ['relay', 'Schar chose the later date and will take the group around.', null],
      ['resolve', 'Date confirmed with Schar.', 'Closed after the relay.'],
    ],
  },
  {
    subject: 'Permission to invite a guest speaker',
    from: TEACHER,
    to: 'schar',
    category: 'development',
    message:
      'May I invite a guest speaker for one Quant session next month? It would need one hour in the seminar hall.',
    daysAgo: 1,
    steps: [
      ['review', null, 'Schar decides on guests.'],
      [
        'forward',
        'A teacher asks to invite a guest speaker for one hour next month. Please say whether this is allowed.',
        'Not answered yet.',
      ],
    ],
  },
  {
    subject: 'A second copy of the CA Foundation guide',
    from: NISHA,
    to: 'hr',
    category: 'resources',
    message: 'I teach from the guide and my copy is falling apart. Can I have a second copy?',
    daysAgo: 6,
    steps: [
      ['review', null, 'One copy is in the store room.'],
      ['resolve', 'A copy is at the front desk for you.', 'Issued from the store room.'],
    ],
  },
  {
    subject: 'Extra day off next week',
    from: ARJUN,
    to: 'hr',
    category: 'other',
    message: 'Can I take Wednesday off next week without using my leave?',
    daysAgo: 5,
    steps: [
      ['review', null, 'No such arrangement exists.'],
      [
        'decline',
        'Days off need a leave entry. Please ask for it as leave.',
        'Told him how to apply.',
      ],
    ],
  },
  {
    subject: 'Help with the projector booking sheet',
    from: ISHA,
    to: 'hr',
    category: 'resources',
    message: 'The booking sheet for the projector is confusing. Can someone show me how it works?',
    daysAgo: 3,
    steps: [['review', null, 'Make this a small task for the coordinator.']],
  },
  {
    subject: 'Printer in the staff room is out of toner',
    from: 'academic-coordinator@example.test',
    to: 'hr',
    category: 'resources',
    urgency: 'normal',
    message: 'We cannot print the Saturday test papers. Who orders toner now?',
    daysAgo: 1,
    steps: [],
  },
  {
    subject: 'Change of emergency contact',
    from: 'dev.malhotra@example.test',
    to: 'hr',
    category: 'other',
    urgency: 'low',
    message: 'My brother has moved abroad. Please change my emergency contact to my wife.',
    daysAgo: 8,
    steps: [
      ['review', null, 'Private details: update on the staff record.'],
      ['resolve', 'Updated on your staff record. Please check that it reads correctly.', 'Done on the staff record.'],
    ],
  },
  {
    subject: 'Extra class on Sunday before the mock',
    from: 'raghav.sethi@example.test',
    to: 'academic-manager@example.test',
    category: 'classes',
    urgency: 'high',
    message: 'Batch A has asked for one extra Logical Reasoning class on Sunday morning before the mock. May I take it?',
    daysAgo: 3,
    steps: [
      ['review', null, 'For the academic manager.'],
      ['forward', 'A teacher asks to take one extra class on Sunday morning before the mock. Is that acceptable?', 'Forwarded.'],
      ['answer', 'Yes, once, in Room 101. Please mark attendance as usual.', null],
    ],
  },
  {
    subject: 'A parent asked me about moving an instalment',
    from: 'isha.nair@example.test',
    to: 'academic-manager@example.test',
    category: 'other',
    urgency: 'urgent',
    message: 'After class a parent asked to move the second instalment by two weeks because of a medical bill. Who can agree this?',
    daysAgo: 2,
    steps: [
      ['review', null, 'Academic manager knows the family.'],
      ['forward', 'A parent asks to move the second instalment by two weeks after a medical bill. Can this be agreed?', 'Forwarded.'],
      ['answer', 'Please send the parent to the counsellor; a one-time move can be agreed there with the reason on the plan.', null],
      ['relay', 'Please send the parent to the counsellor, who can agree a one-time move and record it on the plan.', null],
    ],
  },
  {
    subject: 'A training course in Jaipur',
    from: 'marketing-contributor@example.test',
    to: 'hr',
    category: 'development',
    message: 'There is a two-day design course in Jaipur next month. Would the centre pay half?',
    daysAgo: 7,
    steps: [
      ['review', null, 'No training budget this quarter.'],
      ['decline', 'There is no training budget this quarter. Please ask again in January.', 'Told her when to ask again.'],
    ],
  },
  {
    subject: 'Who approves my Saturday timetable change',
    from: 'neel.shah@example.test',
    to: 'hr',
    category: 'timetable',
    urgency: 'low',
    message: 'I would like to swap my Saturday slot with Thursday. Should I ask you or the coordinator?',
    draft: true,
    daysAgo: 0,
    steps: [],
  },
];

const PROJECTOR_TASK = 'Show Isha how the projector booking sheet works';
const ORIGINAL_MESSAGES: Readonly<Record<string, string>> = {
  'Leave on Friday afternoon':
    'I need Friday afternoon for a family function. Please tell me how to record it.',
  'Need the CLAT batch timetable for posts':
    'To plan posts around classes I need the CLAT batch timetable for this month.',
  'Deadline of the open-house post':
    'The post is due Wednesday but the design arrives Thursday. Can the deadline move?',
  'Question for Schar about the campus visit':
    'Can the campus visit fall on a Saturday so that students are free to attend?',
};

export async function seedFillRequests(db: Database, log: (m: string) => void = () => {}) {
  const hr = (await seedActor(db, 'hr-manager@example.test'))!;
  for (const [subject, message] of Object.entries(ORIGINAL_MESSAGES))
    await db
      .update(opsHrRequests)
      .set({ message })
      .where(and(eq(opsHrRequests.subject, subject), eq(opsHrRequests.isSample, true)));
  const known = new Set(
    (
      await db
        .select({ s: opsHrRequests.subject })
        .from(opsHrRequests)
        .where(eq(opsHrRequests.isSample, true))
    ).map((r) => r.s),
  );
  const named = (await loadSettings(db))['hr.request_recipients'].value;
  const schar = await seedActor(db, SAMPLE_SCHAR.email);
  const scharReady = Boolean(schar?.staffId && named.schar === schar.staffId);
  let added = 0;
  for (const r of FILL_REQUESTS) {
    const { subject } = r;
    if (known.has(subject) || (r.to === 'schar' && !scharReady)) continue;
    const sender = (await seedActor(db, r.from))!;
    const target =
      r.to === 'hr'
        ? 'hr'
        : r.to === 'schar'
          ? 'key:schar'
          : `staff:${(await seedActor(db, r.to))!.staffId}`;
    const row = await createHrRequest(db, sender.actor, {
      category: r.category,
      subject,
      message: r.message,
      recipient: target,
      relatedKind: 'none',
      urgency: r.urgency ?? 'normal',
      draft: Boolean(r.draft),
    } as never);
    const answerer = r.to === 'schar' ? schar! : r.to === 'hr' ? null : await seedActor(db, r.to);
    for (const [action, body, hrNote] of r.steps) {
      if (action === 'answer' && !answerer) continue;
      if (action === 'answer')
        await hrRequestAction(db, answerer!.actor, row.id, 'respond', { body });
      else await hrRequestAction(db, hr.actor, row.id, action, { body, hrNote });
    }
    const back = sql`make_interval(days => ${r.daysAgo})`;
    await db
      .update(opsHrRequests)
      .set({
        isSample: true,
        createdAt: sql`${opsHrRequests.createdAt} - ${back}`,
        submittedAt: sql`${opsHrRequests.submittedAt} - ${back}`,
        decidedAt: sql`${opsHrRequests.decidedAt} - ${back}`,
      })
      .where(eq(opsHrRequests.id, row.id));
    await db
      .update(opsHrRequestEvents)
      .set({ createdAt: sql`${opsHrRequestEvents.createdAt} - ${back}` })
      .where(eq(opsHrRequestEvents.requestId, row.id));
    added += 1;
  }
  // A task HR made from a request: the request's link and the task's are both sample.
  const [fromRequest] = await db
    .select()
    .from(opsHrRequests)
    .where(
      and(
        eq(opsHrRequests.subject, 'Help with the projector booking sheet'),
        eq(opsHrRequests.isSample, true),
      ),
    );
  const coordinator = await seedActor(db, 'academic-coordinator@example.test');
  if (fromRequest && !fromRequest.linkedTaskId && coordinator?.staffId) {
    await hrRequestAction(db, hr.actor, fromRequest.id, 'create_task', {
      hrNote: 'Coordinator to show how the sheet works.',
      task: {
        title: PROJECTOR_TASK,
        details: 'Ten minutes at the front desk; note anything on the sheet that should change.',
        staffId: coordinator.staffId,
        reviewRequired: false,
        dueOn: addDays(sampleAnchorDate() as IsoDate, 2),
        priority: 'low',
        status: 'pending',
        progressPercent: 0,
        recurrence: 'none',
        visibility: 'assignee_chain',
        publish: true,
      } as never,
    });
    await db
      .update(opsStaffTasks)
      .set({ isSample: true })
      .where(eq(opsStaffTasks.title, PROJECTOR_TASK));
  }
  log(`ops.fill-requests: ${added} request(s) through HR added`);
}

const CATEGORIES = [
  'explanation_clarity',
  'pace',
  'doubt_resolution',
  'preparedness',
  'classroom_engagement',
  'helpfulness_of_materials',
];
const COMMENTS = [
  'Explains each step on the board and waits for questions.',
  'The practice sheets are useful before tests.',
  'Sometimes moves fast through the last topic of the class.',
  'Answers doubts after class when asked.',
  'Starts on time and comes prepared.',
  'I would like more worked examples for hard questions.',
  'Homework is checked and returned quickly.',
  'Revision before the test helped me.',
];

/** [teacher, batch, approved responses, summary state]: everyone not named below by hand. */
const EVERY_OTHER_TEACHER: readonly [string, string, number, 'approved' | 'draft' | 'withdrawn' | null][] = [
  ['Karan Bedi', 'COM-C12-A', 7, 'approved'],
  ['Nisha Rao', 'IPMAT-A', 9, 'approved'],
  ['Dev Malhotra', 'CLAT-A', 8, 'approved'],
  ['Kavya Joshi', 'CLAT-A', 6, 'draft'],
  ['Mehul Desai', 'COM-C12-A', 5, 'approved'],
  ['Tara Kapoor', 'COM-C11-A', 6, 'approved'],
  ['Neel Shah', 'CAF-A', 7, 'approved'],
  ['Sanya Kulkarni', 'COM-C12-A', 5, 'draft'],
  ['Anil Chawla', 'COM-C11-A', 8, 'approved'],
  ['Farida Khan', 'CLAT-A', 10, 'approved'],
  ['Imran Qureshi', 'CLAT-A', 5, 'withdrawn'],
  ['Lalit Bhatt', 'CLAT-A', 7, 'approved'],
  ['Geeta Menon', 'CLAT-A', 6, 'approved'],
  ['Hemant Joshi', 'COM-C11-A', 5, 'approved'],
  ['Tanvi Gokhale', 'CAF-A', 6, 'draft'],
  ['Ramesh Chandak', 'COM-C11-A', 11, 'approved'],
  ['Kunal Vyas', 'COM-C12-A', 9, 'approved'],
  ['Jatin Oberoi', 'COM-C11-A', 7, 'approved'],
  ['Priya Thomas', 'COM-C12-A', 8, 'approved'],
  ['Siddharth Rao', 'IPMAT-B', 9, 'approved'],
  ['Usha Pandey', 'COM-C12-A', 6, 'approved'],
  ['Bhavna Soni', 'COM-C12-A', 5, 'approved'],
  ['Lata Krishnan', 'CLAT-A', 6, 'approved'],
];
const SUMMARY_WORDS = [
  ['Clear board work and steady pace.', 'More practice before tests.', 'Students say the classes are easy to follow and ask for more timed practice before tests.'],
  ['Patient with doubts and approachable after class.', 'Homework comes back late at times.', 'Most responses praise how doubts are handled; several ask for homework to come back sooner.'],
  ['Well prepared; examples are close to the exam.', 'The last topic of a class is often rushed.', 'A good month. Students like the examples and ask for a slower finish.'],
  ['Keeps the class engaged and starts on time.', 'Weaker students want more worked steps.', 'Students enjoy the classes; a few ask for steps to be written out in full.'],
  ['Materials are useful for revision.', 'More discussion of wrong answers.', 'The notes are valued. Several responses ask for more time on why an answer is wrong.'],
];
const COMMENT_MORE = [
  'Explains the reason behind each step, not only the method.',
  'I understood the chapter only after this teacher’s class.',
  'Would like the test papers discussed in more detail.',
  'Always ready to take questions after class.',
  'Please give more practice questions on the hard topics.',
  'Good examples from real exam papers.',
  'The class is lively, but the pace is quick at the end.',
  'My child comes home clear about the homework.',
];
/** A development action for the teachers below, in turn. */
const MORE_ACTIONS = [
  'Keep ten minutes at the end of each class for questions.',
  'Return homework within three days.',
  'Share a revision plan a week before each test.',
  'Sit in on a colleague’s class this month.',
  'Add one worked example to each practice sheet.',
  'Discuss wrong answers after each test, not only the marks.',
];

/** [teacher, months back, approved responses, summary state, its words]. */
const FEEDBACK_SETS: readonly {
  teacher: string;
  back: 1 | 2;
  n: number;
  batch: string | null;
  summary: 'approved' | 'draft' | 'withdrawn' | null;
  words?: { strengths: string; improve: string; text: string };
}[] = [
  {
    teacher: TEACHER,
    back: 1,
    n: 8,
    batch: 'IPMAT-B',
    summary: 'approved',
    words: {
      strengths: 'Clear explanations and good practice sheets.',
      improve: 'A slower pace at the end of class; more worked examples for hard questions.',
      text: 'Students on batch B value the worked steps on the board. Several ask for more time on the last topic of each class.',
    },
  },
  // Below the 5-response rule: the summary exists, the teacher sees no figures or comments.
  {
    teacher: TEACHER,
    back: 2,
    n: 3,
    batch: 'IPMAT-B',
    summary: 'approved',
    words: {
      strengths: 'Too few responses to say.',
      improve: 'Too few responses to say.',
      text: 'Only three students answered this month.',
    },
  },
  {
    teacher: ARJUN,
    back: 1,
    n: 12,
    batch: 'IPMAT-A',
    summary: 'approved',
    words: {
      strengths: 'Well prepared; explains shortcuts clearly.',
      improve: 'Doubt time after class is short.',
      text: 'A strong month. Students rate preparedness highly and ask for ten more minutes of doubt time.',
    },
  },
  {
    teacher: ISHA,
    back: 1,
    n: 6,
    batch: 'IPMAT-A',
    summary: 'draft',
    words: {
      strengths: 'Engaging reading sessions.',
      improve: 'Homework returned late twice.',
      text: 'Draft for HR to read before it goes to the teacher.',
    },
  },
  {
    teacher: RAGHAV,
    back: 1,
    n: 5,
    batch: 'IPMAT-A',
    summary: 'withdrawn',
    words: {
      strengths: 'Patient with doubts.',
      improve: 'Needs more mixed practice.',
      text: 'Withdrawn: two responses belonged to the wrong batch and were corrected.',
    },
  },
  { teacher: ADITI, back: 1, n: 2, batch: 'CAF-A', summary: null },
  ...EVERY_OTHER_TEACHER.map(([teacher, batch, n, summary], i) => {
    const w = SUMMARY_WORDS[i % SUMMARY_WORDS.length]!;
    return {
      teacher,
      back: ((i % 2) + 1) as 1 | 2,
      n,
      batch,
      summary,
      words: { strengths: w[0], improve: w[1], text: w[2] },
    };
  }),
];

/** [teacher, words, due in days, state, agreed]. */
const ACTIONS: readonly [string, string, number, 'open' | 'done' | 'dropped', boolean][] = [
  [
    TEACHER,
    'Keep the last ten minutes of each class for the hardest question of the day.',
    7,
    'open',
    true,
  ],
  [TEACHER, 'Add two worked examples to each practice sheet.', 14, 'open', false],
  [TEACHER, 'Share the revision plan before each chapter test.', -5, 'done', true],
  [TEACHER, 'Observe a colleague’s doubt class.', -2, 'open', true],
  [
    ARJUN,
    'Offer ten minutes of doubt time after class on two days a week.',
    10,
    'open',
    true,
  ],
  [ARJUN, 'Pair with a new teacher for one class.', 20, 'dropped', false],
];

const score = (seed: number, i: number) => 3 + ((seed * 7 + i * 3) % 3);
/** A teacher by login address, or by name when they have no login. */
const teacherNamed = async (db: Database, who: string) => {
  if (who.includes('@')) return seedActor(db, who);
  const [s] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.fullName, who));
  return s ? { staffId: s.id } : null;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function seedFillFeedback(db: Database, log: (m: string) => void = () => {}) {
  if (await db.$count(feedback, eq(feedback.isSample, true)))
    return log('ops.fill-feedback skipped: sample feedback exists');
  const hr = (await seedActor(db, 'hr-manager@example.test'))!;
  const anchor = sampleAnchorDate() as IsoDate;
  const decided = istInstant(addDays(anchor, -1), '11:00');
  const monthBack = (n: number) => {
    let p = periodOf('month', anchor);
    for (let i = 0; i < n; i += 1) p = periodOf('month', addDays(p.start, -1));
    return p;
  };
  const batches = await db
    .select({ id: academicBatches.id, code: academicBatches.code })
    .from(academicBatches);
  const someStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.isSample, true))
    .limit(4);
  const [committed] = await db
    .insert(opsTeacherFeedbackImports)
    .values({
      sha256: sha('Feedback form export, September.csv'),
      originalName: 'Feedback form export, September.csv',
      status: 'committed',
      rowsTotal: 8,
      rowsValid: 8,
      mapping: { Teacher: 'teacher', Rating: 'rating', Comment: 'comment' },
      createdBy: hr.actor.id,
      committedAt: decided,
      isSample: true,
    })
    .returning();
  let importRow = 0;
  for (const set of FEEDBACK_SETS) {
    const teacher = await teacherNamed(db, set.teacher);
    if (!teacher?.staffId) continue;
    const p = monthBack(set.back);
    const batch = batches.find((b) => b.code === set.batch);
    const fromFile = set.teacher === TEACHER && set.back === 1;
    for (let i = 0; i < set.n; i += 1) {
      const student = i === 0 ? someStudents[0] : undefined;
      const [row] = await db
        .insert(feedback)
        .values({
          teacherStaffId: teacher.staffId,
          studentId: student?.id ?? null,
          submittedByKind: i % 5 === 4 ? 'guardian' : 'student',
          subjectRef: set.batch,
          feedbackOn: addDays(p.start, 3 + i),
          rating: score(set.n, i),
          ratingScaleMax: 5,
          categoryRatings: Object.fromEntries(CATEGORIES.map((c, k) => [c, score(k + 1, i)])),
          periodStart: p.start,
          periodEnd: p.end,
          collectionMethod: fromFile ? 'import' : i % 2 ? 'form' : 'paper',
          batchId: batch?.id ?? null,
          courseLabel: set.batch,
          importId: fromFile ? committed!.id : null,
          importRow: fromFile ? (importRow += 1) : null,
          isAnonymous: !student,
          respondentIdentifiable: Boolean(student),
          reviewedAt: decided,
          reviewedByUserId: hr.actor.id,
          isSample: true,
          comment: (set.teacher.includes('@') ? COMMENTS : COMMENT_MORE)[(set.n + i) % 8]!,
          moderationStatus: 'approved',
          moderatedBy: hr.actor.id,
          moderatedAt: decided,
          visibility: i % 3 ? 'teacher_and_staff' : 'staff_only',
          recordedBy: hr.actor.id,
        })
        .returning();
      if (fromFile)
        await db.insert(opsTeacherFeedbackImportRows).values({
          importId: committed!.id,
          rowNumber: importRow,
          raw: {
            Teacher: PEOPLE.teacherLogin,
            Rating: String(row!.rating),
            Comment: row!.comment,
          },
          outcome: 'valid',
          feedbackId: row!.id,
        });
    }
    if (!set.summary) continue;
    const s = await createSummary(db, hr.actor, {
      teacherStaffId: teacher.staffId,
      periodStart: p.start,
      periodEnd: p.end,
      eligiblePopulation: set.n + 3,
    });
    await updateSummary(db, hr.actor, s.id, {
      action: 'edit',
      strengths: set.words!.strengths,
      areasToImprove: set.words!.improve,
      summaryText: set.words!.text,
    });
    if (set.summary === 'approved') await updateSummary(db, hr.actor, s.id, { action: 'approve' });
    if (set.summary === 'withdrawn')
      await updateSummary(db, hr.actor, s.id, { action: 'withdraw' });
  }
  // Rows HR has not cleared, one in each other moderation state.
  const isha = await seedActor(db, ISHA);
  const base = {
    teacherStaffId: isha!.staffId!,
    submittedByKind: 'student' as const,
    feedbackOn: addDays(anchor, -2),
    ratingScaleMax: 5,
    collectionMethod: 'paper' as const,
    isAnonymous: true,
    respondentIdentifiable: false,
    isSample: true,
    recordedBy: hr.actor.id,
  };
  const when = {
    moderatedBy: hr.actor.id,
    moderatedAt: decided,
    reviewedAt: decided,
    reviewedByUserId: hr.actor.id,
  };
  await db.insert(feedback).values([
    { ...base, rating: 4, comment: 'Waiting for HR to read.' },
    {
      ...base,
      rating: 2,
      comment: 'Waiting for HR to read: homework took too long to come back.',
    },
    {
      ...base,
      rating: 1,
      comment: 'Names another student.',
      moderationStatus: 'rejected',
      moderationNote: 'Names a student; not usable.',
      ...when,
    },
    {
      ...base,
      rating: 5,
      comment: 'Duplicate entry on the same form.',
      moderationStatus: 'hidden',
      moderationNote: 'Same paper entered twice.',
      ...when,
    },
  ]);
  // A file HR has not committed, with one row of each outcome.
  const [preview] = await db
    .insert(opsTeacherFeedbackImports)
    .values({
      sha256: sha('Feedback form export, October.csv'),
      originalName: 'Feedback form export, October.csv',
      status: 'preview',
      rowsTotal: 4,
      rowsValid: 1,
      rowsInvalid: 1,
      rowsDuplicate: 1,
      mapping: { Teacher: 'teacher', Rating: 'rating', Comment: 'comment' },
      createdBy: hr.actor.id,
      isSample: true,
    })
    .returning();
  await db.insert(opsTeacherFeedbackImportRows).values(
    (
      [
        ['valid', ARJUN_NAME, '4', 'Clear about shortcuts.', []],
        [
          'invalid',
          ARJUN_NAME,
          '9',
          'Rating out of range.',
          ['Ratings go from 1 to 5.'],
        ],
        [
          'duplicate',
          ARJUN_NAME,
          '4',
          'Clear about shortcuts.',
          ['The same answer is on row 1.'],
        ],
        [
          'unresolved',
          UNMATCHED_TEACHER,
          '3',
          'Teacher name not found.',
          ['No teacher matches this name.'],
        ],
      ] as const
    ).map(([outcome, Teacher, Rating, Comment, messages], i) => ({
      importId: preview!.id,
      rowNumber: i + 1,
      raw: { Teacher, Rating, Comment },
      outcome,
      messages: [...messages],
    })),
  );
  // Development actions, on the approved summary when the teacher has one.
  for (const [email, action, due, state, agreed] of ACTIONS) {
    const teacher = await seedActor(db, email);
    if (!teacher?.staffId) continue;
    const [summary] = await db
      .select({ id: opsTeacherFeedbackSummaries.id })
      .from(opsTeacherFeedbackSummaries)
      .where(
        and(
          eq(opsTeacherFeedbackSummaries.teacherStaffId, teacher.staffId),
          eq(opsTeacherFeedbackSummaries.status, 'approved'),
        ),
      )
      .orderBy(sql`${opsTeacherFeedbackSummaries.periodEnd} DESC`)
      .limit(1);
    const row = await createAction(db, hr.actor, {
      teacherStaffId: teacher.staffId,
      summaryId: summary?.id ?? null,
      action,
      ownerStaffId: hr.staffId,
      dueOn: addDays(anchor, due),
      agreed,
    });
    if (state !== 'open') await updateAction(db, hr.actor, row.id, { status: state });
  }
  for (const [i, [name]] of EVERY_OTHER_TEACHER.entries()) {
    const teacher = await teacherNamed(db, name);
    if (!teacher?.staffId) continue;
    const row = await createAction(db, hr.actor, {
      teacherStaffId: teacher.staffId,
      summaryId: null,
      action: MORE_ACTIONS[i % MORE_ACTIONS.length]!,
      ownerStaffId: hr.staffId,
      dueOn: addDays(anchor, i % 4 === 0 ? -3 - i : 5 + i),
      agreed: i % 3 !== 2,
    });
    if (i % 5 === 1) await updateAction(db, hr.actor, row.id, { status: 'done' });
    if (i % 7 === 3) await updateAction(db, hr.actor, row.id, { status: 'dropped' });
  }
  // No route may set the sample flag.
  for (const t of [opsTeacherFeedbackSummaries, opsTeacherDevelopmentActions])
    await db
      .update(t)
      .set({ isSample: true })
      .where(
        inArray(t.teacherStaffId, sql`(SELECT staff_id FROM ops.staff_profiles WHERE is_sample)`),
      );
  log(
    `ops.fill-feedback: ${FEEDBACK_SETS.length} feedback sets, ${ACTIONS.length} development actions`,
  );
}
