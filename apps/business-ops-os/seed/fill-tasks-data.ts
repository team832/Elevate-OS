/**
 * What the sample tasks say (owner, 31 Oct 2026): the briefs, the demo teacher's and the office
 * staff's tasks in every state, deadline changes, comments, checklists, update notes and work reports.
 * Written by ./fill-tasks.ts. Fictional, sample rows only (D-036).
 */
import { ack, to, type SampleReport, type SampleTask } from './sample-work';

export const DEMO = 'demo-teacher';

/** The demo teacher's work in every state (co-teaches Quant on IPMAT-B). */
export const FILL_TEACHER_TASKS: readonly SampleTask[] = [
  {
    owner: DEMO,
    title: 'Prepare the Percentages worksheet for IPMAT batch B',
    shows: 'assigned, not acknowledged',
    source: 'manager',
    received: [0, '09:15'],
    due: 3,
    dueTime: '17:00',
    priority: 'high',
    steps: [],
  },
  {
    owner: DEMO,
    title: 'Collect the answer sheets of the Ratio and Proportion test',
    shows: 'verbal request, acknowledged',
    source: 'verbal',
    received: [-1, '11:00'],
    due: 1,
    priority: 'medium',
    steps: [ack(-1, '11:10')],
  },
  {
    owner: DEMO,
    title: 'Set 30 Time and Work questions for the Friday practice',
    shows: 'in progress with updates',
    source: 'manager',
    received: [-3, '10:00'],
    due: 2,
    priority: 'high',
    progress: 60,
    steps: [ack(-3, '10:05'), to('in_progress', -3, '15:00')],
    updates: [
      {
        on: -2,
        work: 'Wrote the first 18 questions with worked answers',
        at: [-2, '16:00'],
        minutes: 95,
      },
      {
        on: -1,
        work: 'Checked difficulty against the last IPMAT paper',
        at: [-1, '16:30'],
        minutes: 40,
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Plan the doubt class on Averages',
    shows: 'blocked with a reason',
    source: 'manager',
    received: [-4, '09:30'],
    due: 1,
    priority: 'medium',
    progress: 30,
    steps: [
      ack(-4, '09:40'),
      to('in_progress', -3, '11:00'),
      {
        kind: 'blocked_set',
        at: [-1, '12:00'],
        reason: 'No free room on Tuesday; the coordinator is checking the timetable (sample).',
      },
    ],
    updates: [
      {
        on: -3,
        work: 'Listed the seven doubts students asked most',
        at: [-3, '12:30'],
        minutes: 35,
        blocker: 'Room not confirmed',
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Check the Number Systems homework of batch B',
    shows: 'submitted, waiting for review',
    source: 'manager',
    review: true,
    deliverable: 'A list of who handed in, with common mistakes',
    received: [-3, '09:00'],
    due: 0,
    priority: 'medium',
    progress: 100,
    steps: [
      ack(-3, '09:30'),
      to('in_progress', -2, '10:00'),
      { kind: 'submitted_for_review', at: [-1, '17:20'] },
    ],
    updates: [
      {
        on: -1,
        work: 'Checked 6 notebooks and noted three common mistakes',
        at: [-1, '16:50'],
        minutes: 70,
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Build the IPMAT Quant formula sheet',
    shows: 'changes requested after review',
    source: 'manager',
    review: true,
    deliverable: 'A one-page formula sheet (PDF)',
    received: [-5, '10:00'],
    due: 1,
    priority: 'high',
    progress: 80,
    steps: [
      ack(-5, '10:10'),
      to('in_progress', -5, '14:00'),
      { kind: 'submitted_for_review', at: [-2, '15:00'] },
      {
        kind: 'changes_requested',
        at: [-1, '11:00'],
        reason: 'Add the compound interest formulas and keep it to one page (sample).',
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Upload the answer key of the Arithmetic chapter test',
    shows: 'approved after review',
    source: 'manager',
    review: true,
    deliverable: 'Answer key with a one-line reason for each answer',
    received: [-7, '09:00'],
    due: -4,
    priority: 'medium',
    progress: 100,
    steps: [
      ack(-7, '09:05'),
      to('in_progress', -6, '10:00'),
      { kind: 'submitted_for_review', at: [-5, '16:00'] },
      { kind: 'review_approved', at: [-4, '10:30'] },
    ],
    updates: [
      {
        on: -5,
        work: 'Uploaded the key and rechecked questions 12 and 19',
        at: [-5, '15:40'],
        minutes: 45,
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Enter the marks of the Quant unit test',
    shows: 'overdue, still in progress',
    source: 'manager',
    received: [-6, '09:00'],
    due: -2,
    priority: 'high',
    progress: 50,
    steps: [ack(-6, '09:20'), to('in_progress', -3, '10:00')],
    updates: [{ on: -3, work: 'Marked half of the answer sheets', at: [-3, '13:00'], minutes: 60 }],
  },
  {
    owner: DEMO,
    title: 'Arrange a Saturday revision class for batch B',
    shows: 'cancelled with a reason',
    source: 'manager',
    received: [-8, '12:00'],
    due: -1,
    priority: 'low',
    steps: [
      ack(-8, '12:10'),
      {
        kind: 'cancelled',
        at: [-3, '10:00'],
        reason: 'The batch has a mock test that Saturday (sample).',
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Re-check two answers in the Percentages key',
    shows: 'done, then reopened',
    source: 'manager',
    received: [-5, '09:00'],
    due: 2,
    priority: 'medium',
    progress: 40,
    steps: [
      ack(-5, '09:10'),
      to('in_progress', -5, '10:00'),
      to('done', -4, '16:00'),
      {
        kind: 'reopened',
        at: [-1, '09:30'],
        reason: 'A student found a third answer that does not match (sample).',
      },
    ],
  },
  {
    owner: DEMO,
    title: 'Write my notes on the Ratio chapter',
    shows: 'self-logged',
    source: 'self',
    received: [-2, '18:00'],
    due: 4,
    priority: 'low',
    progress: 20,
    steps: [ack(-2, '18:00'), to('in_progress', -2, '18:05')],
    updates: [{ on: -2, work: 'Outlined the worked examples', at: [-2, '18:30'], minutes: 25 }],
  },
];

/** Office staff (assigned by the sample operations manager). */
export const FILL_OFFICE_TASKS: readonly SampleTask[] = [
  {
    owner: 'counsellor',
    title: 'Call back the parents waiting for the fee structure',
    shows: 'in progress',
    source: 'manager',
    received: [-2, '10:00'],
    due: 0,
    priority: 'high',
    progress: 50,
    steps: [ack(-2, '10:15'), to('in_progress', -1, '11:00')],
    updates: [{ on: -1, work: 'Called three of the six families', at: [-1, '17:00'], minutes: 55 }],
  },
  {
    owner: 'coordinator',
    title: 'Publish next week’s timetable for the batches',
    shows: 'assigned, not acknowledged',
    source: 'manager',
    received: [0, '09:00'],
    due: 1,
    priority: 'high',
    steps: [],
  },
  {
    owner: 'schar',
    title: 'Reply on the campus visit dates',
    shows: 'acknowledged',
    source: 'manager',
    received: [-1, '14:00'],
    due: 2,
    priority: 'medium',
    steps: [ack(-1, '15:00')],
  },
  {
    owner: 'contributor',
    title: 'Resize the CLAT poster for Instagram stories',
    shows: 'done',
    source: 'manager',
    received: [-4, '11:00'],
    due: -2,
    priority: 'low',
    progress: 100,
    steps: [ack(-4, '11:10'), to('in_progress', -4, '12:00'), to('done', -3, '16:00')],
    updates: [
      {
        on: -3,
        work: 'Made three sizes and shared them with the team',
        at: [-3, '15:30'],
        minutes: 30,
      },
    ],
  },
];

interface TaskText {
  details: string;
  deliverable?: string;
  done: string;
  category: string;
  /** Who asked, when it is not the assigner. */
  requested?: 'coordinator' | 'hr' | 'counsellor' | 'marketing';
  note?: string;
  submitted?: string;
  start?: number;
}
const CAT = {
  prep: 'Teaching preparation',
  check: 'Checking and marks',
  admin: 'Administration',
  content: 'Content',
  calls: 'Calls and follow-up',
} as const;

/** Every sample task's brief, by title. */
export const TASK_TEXT: Readonly<Record<string, TaskText>> = {
  'Plan the November staff meeting': {
    details: 'Agenda, room and who presents. Not assigned yet: HR is still writing it.',
    deliverable: 'An agenda shared with the staff',
    done: 'Everyone has the agenda two days before the meeting.',
    category: CAT.admin,
    requested: 'hr',
  },
  'Show Isha how the projector booking sheet works': {
    details: 'Ten minutes at the front desk; note anything on the sheet that should change.',
    deliverable: 'A note on what should change on the sheet',
    done: 'Isha can book the projector without help.',
    category: CAT.admin,
    requested: 'hr',
  },
  'Prepare the CA Foundation chapter 3 revision sheet': {
    details:
      'Students asked for one sheet on bills of exchange before the chapter test: the entries, three worked examples and five practice questions.',
    deliverable: 'Two-page revision sheet (PDF)',
    done: 'Covers every entry type in chapter 3 and each practice question has an answer.',
    category: CAT.prep,
    requested: 'coordinator',
    start: 1,
  },
  'Collect the Business Laws test answer sheets': {
    details:
      'The Monday test sheets are still with the invigilator. Collect them and count them against the attendance list.',
    deliverable: 'Sheets handed to the exam desk with the count',
    done: 'The count matches the attendance list, or the missing names are written down.',
    category: CAT.check,
    requested: 'coordinator',
    note: 'Asked in person in the staff room (sample).',
  },
  'Set the Quant practice paper for Friday': {
    details:
      'A 50-question practice paper for Friday’s class, weighted towards arithmetic. Questions must be new, not from the last two mocks.',
    deliverable: 'Question paper and answer key',
    done: '50 questions, each with a checked answer, none repeated from the last two mocks.',
    category: CAT.prep,
    submitted: 'Paper and key are in the shared folder.',
  },
  'Plan the Legal Reasoning doubt session': {
    details:
      'Students raised doubts on principle-and-fact questions. Plan a 60-minute session, group the doubts and pick two worked passages.',
    deliverable: 'Session plan and the two passages',
    done: 'A room is booked and the plan is shared with the class.',
    category: CAT.prep,
    requested: 'coordinator',
  },
  'Check the Verbal Ability homework': {
    details:
      'Check this week’s reading-comprehension homework for IPMAT batch A and note who has not handed it in.',
    deliverable: 'Checked notebooks and a list of missing names',
    done: 'Every notebook is checked and the list reaches the coordinator.',
    category: CAT.check,
    submitted: 'All 32 notebooks checked; four students had not handed in.',
  },
  'Prepare the integration practice sheet with an answer key': {
    details: 'Twenty integration questions for Class 12, easy to hard, with a full answer key.',
    deliverable: 'Practice sheet (PDF) and its answer key',
    done: 'Twenty questions, answers checked by a second teacher.',
    category: CAT.prep,
    submitted: 'Sheet and key attached; a second teacher checked the answers.',
  },
  'Upload the Logical Reasoning mock answer key': {
    details:
      'Upload the key for the mock so results can be finalised. Two answers were disputed last time: recheck them.',
    deliverable: 'Answer key with the disputed answers rechecked',
    done: 'The key is uploaded and both disputed answers are confirmed.',
    category: CAT.check,
  },
  'Compile the weekly current-affairs notes': {
    details:
      'Collect the week’s national and international news into one page of notes for the CLAT batch.',
    deliverable: 'One page of notes for the week',
    done: 'At least ten items, each with a line on why it may be asked.',
    category: CAT.prep,
    requested: 'coordinator',
  },
  'Re-mark the Quant unit test after the key correction': {
    details:
      'Two answers in the key were wrong. Re-mark the affected questions and update the marks.',
    deliverable: 'Updated marks list',
    done: 'All sheets re-marked; changed marks are listed with the old and new figure.',
    category: CAT.check,
  },
  'Arrange the Economics guest lecture': {
    details:
      'Find a date for a one-hour guest lecture on national income and book the seminar hall.',
    deliverable: 'Confirmed date and hall booking',
    done: 'The speaker and the hall are confirmed in writing.',
    category: CAT.admin,
    requested: 'coordinator',
  },
  'Build the Business Studies case-study pack': {
    details:
      'Pick four short case studies on business environment for Class 12 with two questions each.',
    deliverable: 'Case-study pack (PDF)',
    done: 'Four cases, eight questions, model answers included.',
    category: CAT.prep,
    start: -1,
  },
  'Prepare the Class 12 Accountancy worksheet': {
    details: 'My own worksheet on journal entries and ledgers for next week’s revision.',
    deliverable: 'Worksheet (PDF)',
    done: 'Fifteen entries and three ledgers, with answers.',
    category: CAT.prep,
  },
  'Draft a CUET General Test practice set': {
    details:
      'A practice set covering reasoning, general awareness and arithmetic, in CUET pattern.',
    deliverable: 'Draft practice set',
    done: 'Fifty questions across the three parts, ready for review.',
    category: CAT.prep,
  },
  'Draft the IPMAT webinar reminder message': {
    details:
      'A short reminder for families registered for the IPMAT webinar. In-app draft only; nothing is sent from here.',
    deliverable: 'Reminder text of about 60 words',
    done: 'States date, time and how to join, and the marketing manager has read it.',
    category: CAT.content,
    requested: 'marketing',
  },
  'Collect CLAT quiz questions from the CLAT teacher': {
    details: 'Ask the CLAT teacher for ten quiz questions with answers for the weekly reel.',
    deliverable: 'Ten questions with answers',
    done: 'Ten questions, each checked by the teacher.',
    category: CAT.content,
    requested: 'marketing',
  },
  'Tidy the lead follow-up list': {
    details:
      'Remove duplicates from the follow-up list and mark leads that have asked not to be called.',
    deliverable: 'A clean follow-up list',
    done: 'No duplicate names and every do-not-contact lead is marked.',
    category: CAT.calls,
  },
  'Book the seminar hall for the CLAT session': {
    details: 'Book the hall for the CLAT session and confirm chairs and a projector.',
    deliverable: 'Booking confirmation',
    done: 'The date, the room and the equipment are confirmed.',
    category: CAT.admin,
    requested: 'marketing',
  },
  'Write the CA Foundation open-house post': {
    details:
      'A post inviting families to the CA Foundation open house, with date and what they will see.',
    deliverable: 'Draft text or design file',
    done: 'Fits one post, states date and place, and makes no result claims.',
    category: CAT.content,
    submitted: 'Draft post is in the team folder for review.',
  },
  'Prepare the CLAT current-affairs carousel': {
    details: 'A six-slide carousel on this month’s current affairs for CLAT students.',
    deliverable: 'Draft text or design file',
    done: 'Six slides, every item has a source.',
    category: CAT.content,
    submitted: 'Six slides are ready; sources listed in the notes.',
  },
  'Proofread the IPMAT webinar landing page': {
    details: 'Read the landing page for mistakes in dates, spelling and the registration steps.',
    deliverable: 'List of corrections',
    done: 'Every correction is listed with where it is on the page.',
    category: CAT.content,
    submitted: 'Eleven corrections listed by section.',
  },
  'Send the weekly enquiry summary': {
    details: 'A short weekly summary of enquiries by source for the marketing manager.',
    deliverable: 'Summary table for the week',
    done: 'Counts match the lead list for that week.',
    category: CAT.calls,
  },
  'Share the CA Foundation open-house post on your channels': {
    details:
      'When the post is approved, share it on the channels you handle and note where it went.',
    deliverable: 'A note of where it was shared',
    done: 'Each channel is listed. Sample: no real channel is used.',
    category: CAT.content,
  },
  'Prepare the Percentages worksheet for IPMAT batch B': {
    details: 'Twenty mixed questions on percentages for next week’s Quant class, easy to hard.',
    deliverable: 'Worksheet (PDF) with an answer key',
    done: 'Twenty questions, each with a worked answer, checked once.',
    category: CAT.prep,
    requested: 'coordinator',
    start: 1,
  },
  'Collect the answer sheets of the Ratio and Proportion test': {
    details: 'The invigilator has the sheets. Collect them and count them against the roster.',
    deliverable: 'Sheets with a count',
    done: 'The count matches the roster or missing names are listed.',
    category: CAT.check,
    requested: 'coordinator',
    note: 'Asked at the staff-room meeting (sample).',
  },
  'Set 30 Time and Work questions for the Friday practice': {
    details:
      'New questions for the Friday practice, none from the last two mocks. Mix of two-pipe and three-worker problems.',
    deliverable: 'Thirty questions with worked answers',
    done: 'Thirty questions checked against the IPMAT pattern.',
    category: CAT.prep,
    start: -3,
  },
  'Plan the doubt class on Averages': {
    details:
      'Students keep asking about weighted averages. Plan a 45-minute doubt class and book a room.',
    deliverable: 'A plan with the worked examples',
    done: 'Room booked and the plan shared with batch B.',
    category: CAT.prep,
    requested: 'coordinator',
  },
  'Check the Number Systems homework of batch B': {
    details: 'Check this week’s homework and note the common mistakes for the next class.',
    deliverable: 'A list of who handed in, with common mistakes',
    done: 'Every notebook is checked and mistakes are listed.',
    category: CAT.check,
    submitted: 'All six notebooks checked; three common mistakes noted.',
  },
  'Build the IPMAT Quant formula sheet': {
    details: 'One page with the formulas students need most, grouped by chapter.',
    deliverable: 'A one-page formula sheet (PDF)',
    done: 'One page, every formula checked, includes compound interest.',
    category: CAT.prep,
    submitted: 'First version of the sheet attached.',
  },
  'Upload the answer key of the Arithmetic chapter test': {
    details: 'Upload the key so marking can begin, with a one-line reason for each answer.',
    deliverable: 'Answer key with a one-line reason for each answer',
    done: 'Key uploaded and reviewed.',
    category: CAT.check,
    submitted: 'Key uploaded with reasons for all 25 answers.',
  },
  'Enter the marks of the Quant unit test': {
    details: 'Enter the marks on the test’s marks sheet so results can be finalised.',
    deliverable: 'Marks entered for the whole roster',
    done: 'Every student has a mark or is marked absent.',
    category: CAT.check,
  },
  'Arrange a Saturday revision class for batch B': {
    details: 'Find a Saturday slot for a two-hour revision before the mock.',
    deliverable: 'Confirmed slot and room',
    done: 'Slot and room confirmed with the coordinator.',
    category: CAT.admin,
  },
  'Re-check two answers in the Percentages key': {
    details: 'Two answers were questioned in class. Recheck them and correct the key if needed.',
    deliverable: 'A note on what changed',
    done: 'Each answer is confirmed or corrected, and students are told.',
    category: CAT.check,
  },
  'Write my notes on the Ratio chapter': {
    details: 'My own notes with worked examples for the Ratio chapter.',
    deliverable: 'Notes for my teaching file',
    done: 'Examples written for each type of question.',
    category: CAT.prep,
  },
  'Call back the parents waiting for the fee structure': {
    details:
      'Six families asked for the fee structure after their demo. Call and note what each decides.',
    deliverable: 'A note on each family',
    done: 'Every family has been reached, or the attempts are logged.',
    category: CAT.calls,
  },
  'Publish next week’s timetable for the batches': {
    details: 'Check clashes and publish next week’s timetable for the batches.',
    deliverable: 'Published timetable',
    done: 'No teacher or room clash remains.',
    category: CAT.admin,
  },
  'Reply on the campus visit dates': {
    details: 'Two dates are proposed for the campus visit. Reply through HR with which one works.',
    deliverable: 'A reply through HR',
    done: 'HR has the reply and has told the sender.',
    category: CAT.admin,
    requested: 'hr',
  },
  'Resize the CLAT poster for Instagram stories': {
    details: 'Make story, square and portrait sizes of the CLAT poster.',
    deliverable: 'Three image sizes',
    done: 'All three sizes are in the team folder.',
    category: CAT.content,
    requested: 'marketing',
  },
};

/** [title, how many days later than first agreed, who changed it, why, day it changed]. */
export const DUE_CHANGES: readonly [string, number, 'manager', string, number][] = [
  [
    'Set 30 Time and Work questions for the Friday practice',
    2,
    'manager',
    'The class moved from Wednesday to Friday (sample).',
    -2,
  ],
  [
    'Enter the marks of the Quant unit test',
    1,
    'manager',
    'The answer sheets came a day late from the exam desk (sample).',
    -4,
  ],
  [
    'Build the IPMAT Quant formula sheet',
    3,
    'manager',
    'Changes requested after review; three more days agreed (sample).',
    -1,
  ],
  [
    'Set the Quant practice paper for Friday',
    1,
    'manager',
    'The topic list changed after Monday’s class (sample).',
    -1,
  ],
  [
    'Compile the weekly current-affairs notes',
    2,
    'manager',
    'A public holiday fell in the week (sample).',
    -3,
  ],
];

/** [title, who, day, HH:MM, text]; a reviewer's comment is also a review note. */
export const COMMENTS: readonly [string, 'owner' | 'manager', number, string, string][] = [
  [
    'Set 30 Time and Work questions for the Friday practice',
    'manager',
    -2,
    '11:00',
    'Please keep ten questions at the easy level for the new students (sample).',
  ],
  [
    'Set 30 Time and Work questions for the Friday practice',
    'owner',
    -1,
    '09:40',
    'Done; easy ones are at the start of the paper (sample).',
  ],
  [
    'Check the Number Systems homework of batch B',
    'manager',
    0,
    '10:00',
    'Thanks. Please raise the mistakes in the next class (sample).',
  ],
  [
    'Build the IPMAT Quant formula sheet',
    'owner',
    -1,
    '12:30',
    'Will add compound interest and move the mensuration part to page two of the notes instead (sample).',
  ],
  [
    'Plan the Legal Reasoning doubt session',
    'manager',
    -1,
    '15:30',
    'I have asked the coordinator about the room (sample).',
  ],
  [
    'Prepare the integration practice sheet with an answer key',
    'manager',
    -1,
    '16:10',
    'Answer key received, reading it today (sample).',
  ],
];

/** [title, items, how many are done]. */
export const CHECKLISTS: readonly [string, string[], number][] = [
  [
    'Prepare the Percentages worksheet for IPMAT batch B',
    [
      'Pick the question types',
      'Write twenty questions',
      'Solve all answers',
      'Ask a colleague to check',
    ],
    0,
  ],
  [
    'Set 30 Time and Work questions for the Friday practice',
    [
      'Check the last two mocks for repeats',
      'Write thirty questions',
      'Write worked answers',
      'Check difficulty',
    ],
    2,
  ],
  [
    'Set the Quant practice paper for Friday',
    ['Draft fifty questions', 'Write the answer key', 'Proofread'],
    1,
  ],
  [
    'Upload the answer key of the Arithmetic chapter test',
    ['Write the key', 'Add a reason for each answer', 'Upload'],
    3,
  ],
];

export const NOTES: Readonly<
  Record<string, { result: string; remaining?: string; next?: string; evidence?: string }>
> = {
  'Drafted 20 of the 50 questions (sample).': {
    result: 'Twenty questions drafted.',
    remaining: 'Thirty questions and the key.',
    next: 'Write the next fifteen questions tomorrow.',
  },
  'Checked the answer key of the first 20 questions (sample).': {
    result: 'Two answers corrected.',
    remaining: 'Key for the other thirty.',
    next: 'Finish the key by Thursday.',
  },
  'Listed the doubts students raised this week (sample).': {
    result: 'Eleven doubts, grouped into three topics.',
    remaining: 'Pick the passages; book the room.',
    next: 'Ask the coordinator about a room.',
  },
  'Checked 32 homework notebooks (sample).': {
    result: 'Four students had not handed in.',
    evidence: 'Marked notebook list with the coordinator (sample).',
  },
  'Uploaded the key and checked two disputed answers (sample).': {
    result: 'Both disputed answers were correct as printed.',
    evidence: 'Key on the test record (sample).',
  },
  'Collected the week’s news items (sample).': {
    result: 'Fourteen items collected.',
    remaining: 'Write a line on each.',
    next: 'Finish by the weekend.',
  },
  'Picked four case studies (sample).': {
    result: 'Four cases chosen.',
    remaining: 'Questions and model answers.',
    next: 'Write questions for the first two.',
  },
  'Wrote 15 journal-entry questions (sample).': {
    result: 'Fifteen entries written.',
    remaining: 'Three ledger questions and answers.',
    next: 'Write the ledgers on Monday.',
  },
  'Outlined the reasoning section (sample).': {
    result: 'Outline of eighteen questions.',
    remaining: 'General awareness and arithmetic parts.',
    next: 'Draft the reasoning questions.',
  },
  'Wrote the first 18 questions with worked answers (sample).': {
    result: 'Eighteen questions ready.',
    remaining: 'Twelve more questions.',
    next: 'Write the three-worker problems.',
  },
  'Checked difficulty against the last IPMAT paper (sample).': {
    result: 'Slightly easier than the paper; two made harder.',
    remaining: 'Twelve more questions.',
    next: 'Finish tomorrow.',
  },
  'Listed the seven doubts students asked most (sample).': {
    result: 'Seven doubts in two groups.',
    remaining: 'Worked examples; a room.',
    next: 'Wait for the room, then share the plan.',
  },
  'Checked 6 notebooks and noted three common mistakes (sample).': {
    result: 'All six checked.',
    evidence: 'Mistake list attached to the submission (sample).',
  },
  'Uploaded the key and rechecked questions 12 and 19 (sample).': {
    result: 'Both answers stand.',
    evidence: 'Key on the test record (sample).',
  },
  'Marked half of the answer sheets (sample).': {
    result: 'Three of six sheets marked.',
    remaining: 'Three sheets, then enter the marks.',
    next: 'Finish marking and enter them on the sheet.',
  },
  'Outlined the worked examples (sample).': {
    result: 'Outline of six examples.',
    remaining: 'Write the examples.',
    next: 'Write two examples a day.',
  },
  'Called three of the six families (sample).': {
    result: 'Two want the fee structure by email; one will decide next week.',
    remaining: 'Three families.',
    next: 'Call the other three tomorrow.',
  },
  'Made three sizes and shared them with the team (sample).': {
    result: 'Story, square and portrait sizes ready.',
    evidence: 'Files in the team folder (sample).',
  },
};

/** The marketing employees report to the sample marketing manager; no figure is claimed. */
export const FILL_MARKETING_REPORTS: readonly SampleReport[] = [
  {
    owner: 'pooja',
    day: -1,
    submit: [-1, '18:30'],
    summary: 'Proofread the landing page and called the leads due today.',
    plan: 'Draft the webinar reminder.',
  },
  {
    owner: 'pooja',
    day: -7,
    kind: 'week',
    submit: [-3, '18:00'],
    review: { kind: 'acknowledged', at: [-2, '10:30'] },
    summary: 'Calendar items moved on as planned; follow-ups kept up to date.',
    plan: 'Open-house post and the webinar reminder.',
  },
  {
    owner: 'pooja',
    day: -31,
    kind: 'month',
    submit: [-27, '11:30'],
    summary: 'Webinar campaign started; sample leads followed up. No results to claim.',
    plan: 'Fill the webinar and start the open-house campaign.',
  },
  {
    owner: 'rohit',
    day: -1,
    submit: [-1, '18:45'],
    review: {
      kind: 'revision_requested',
      at: [-1, '20:00'],
      text: 'Say which sources the carousel still needs (sample).',
    },
    summary: 'Worked on the carousel and booked the hall.',
    plan: 'Finish the carousel.',
  },
  {
    owner: 'rohit',
    day: -31,
    kind: 'month',
    submit: [-27, '12:15'],
    summary: 'CLAT series kept to its weekly rhythm. No results to claim.',
    plan: 'Weekly quiz reel and the seminar hall booking.',
  },
];

export const FILL_REPORTS: readonly SampleReport[] = [
  {
    owner: DEMO,
    day: 0,
    summary: 'Took the Quant class for batch B and started the Percentages worksheet.',
    plan: 'Finish the Time and Work questions; enter the unit test marks.',
    notes: 'The unit test marks are late; the sheets came a day late.',
  },
  {
    owner: DEMO,
    day: -1,
    submit: [-1, '18:20'],
    summary: 'Checked the Number Systems homework and sent it for review.',
    plan: 'Start the Percentages worksheet.',
  },
  {
    owner: DEMO,
    day: -2,
    submit: [-2, '18:10'],
    review: { kind: 'acknowledged', at: [-1, '09:05'] },
    summary: 'Wrote eighteen Time and Work questions and answered student doubts.',
    plan: 'Check difficulty against the last paper.',
  },
  {
    owner: DEMO,
    day: -3,
    submit: [-3, '18:40'],
    review: {
      kind: 'revision_requested',
      at: [-3, '20:10'],
      text: 'Please say which sheets are still to be marked (sample).',
    },
    summary: 'Marked half of the unit test sheets.',
    plan: 'Finish marking.',
  },
  {
    owner: DEMO,
    day: -7,
    kind: 'week',
    submit: [-3, '17:30'],
    review: { kind: 'acknowledged', at: [-2, '10:00'] },
    summary: 'A full teaching week; homework and two tests marked.',
    plan: 'Finish the formula sheet and the unit test marks next week.',
  },
  {
    owner: DEMO,
    day: -14,
    kind: 'week',
    submit: [-9, '18:00'],
    summary: 'Quant classes as planned; one doubt class added.',
    plan: 'Start the formula sheet.',
  },
  {
    owner: DEMO,
    day: 0,
    kind: 'week',
    summary: 'Draft: this week so far.',
    plan: 'To be written at the end of the week.',
  },
  {
    owner: DEMO,
    day: -31,
    kind: 'month',
    submit: [-27, '11:00'],
    review: { kind: 'acknowledged', at: [-26, '10:00'] },
    summary: 'Taught the Arithmetic chapters; two tests held; attendance stayed steady.',
    plan: 'Start Algebra and the first mock.',
  },
  {
    owner: 'EMP-T03',
    day: -2,
    submit: [-2, '18:30'],
    review: { kind: 'acknowledged', at: [-1, '09:30'] },
    summary: 'Drafted the Friday paper and checked the first answers.',
    plan: 'Thirty more questions.',
  },
  {
    owner: 'EMP-T03',
    day: -7,
    kind: 'week',
    submit: [-3, '18:00'],
    summary: 'Quant classes and the integration sheet.',
    plan: 'Friday’s paper.',
  },
  {
    owner: 'EMP-T01',
    day: -2,
    submit: [-2, '18:00'],
    summary: 'CA Foundation classes as planned.',
    plan: 'Revision sheet for chapter 3.',
  },
  {
    owner: 'EMP-T01',
    day: -31,
    kind: 'month',
    submit: [-27, '12:00'],
    summary: 'Finished chapters 1 and 2; first test held.',
    plan: 'Chapter 3 and its revision sheet.',
  },
  {
    owner: 'EMP-T07',
    day: -7,
    kind: 'week',
    submit: [-2, '19:00'],
    review: {
      kind: 'revision_requested',
      at: [-1, '11:00'],
      text: 'The current-affairs notes are overdue: please give a new date (sample).',
    },
    summary: 'Classes as planned; notes are behind.',
    plan: 'Finish the notes.',
  },
];
