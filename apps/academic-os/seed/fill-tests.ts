/**
 * Owner, 31 Oct 2026: marks, results, publications and rank lists. More tests on every batch through
 * the same services as sample-tests.ts, so bounds and competition ranks are the real ones: results
 * published, awaiting publication, in progress, upcoming, cancelled, a publication withdrawn with its
 * reason, a mark corrected into a new result version, a ranking within one batch only, and two
 * marked from an answer key with per-question responses. Every test is is_sample. Each is written once.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicBatches,
  academicBatchPlacements,
  academicEnrolments,
  academicResultPublications,
  academicSubjects,
  users,
  type Database,
} from '@elevate/database';
import { addDays, type SessionId } from '@elevate/shared-types';
import { addAnswerKey, createAssessment, upsertAttempts } from '../src/server/services/assessments';
import {
  internalActor,
  publishInternal,
  recordScores,
  updateAssessmentInternal,
  withdrawInternal,
} from '../src/server/services/assessment-ops';
import { finaliseAssessment } from '../src/server/services/results';
import { sampleAnchorDate } from './samples';
import { writeTests, type SampleTest, type TestOptions } from './sample-tests';

const test = (
  code: string,
  title: string,
  batches: string[],
  subject: string,
  teacher: string,
  day: number,
  maxMarks: string,
  marks: SampleTest['marks'],
  publish = false,
  kind: SampleTest['kind'] = 'chapter_test',
): SampleTest => ({
  code,
  title,
  kind,
  batches,
  subject,
  teacher,
  day,
  rule: { maxMarks },
  marks,
  ...(marks?.length && marks.every((m) => m !== null && m !== '-') ? { finalise: true as const } : {}),
  ...(publish ? { publish: true as const } : {}),
});

export const FILL_TESTS: readonly SampleTest[] = [
  test('IPMAT-A-VERBAL-01', 'IPMAT batch A Verbal test: Reading comprehension', ['IPMAT-A'], 'VERBAL', 'Isha Nair', -20, '50', ['38', '44', '29', '41', 'A', '33', '47'], true),
  test('IPMAT-A-LR-01', 'IPMAT batch A Logical Reasoning test: Arrangements', ['IPMAT-A'], 'LR', 'Raghav Sethi', -13, '40', ['31', '27', '36', '19', '33', 'A', '28'], true),
  test('IPMAT-A-DI-01', 'IPMAT batch A Data Interpretation test: Tables', ['IPMAT-A'], 'DI', 'Nisha Rao', -6, '30', ['22', '25', '18', 'A', '27', '16', '24']),
  test('IPMAT-B-LR-01', 'IPMAT batch B Logical Reasoning test: Syllogisms', ['IPMAT-B'], 'LR', 'Siddharth Rao', -15, '40', ['33', '28', '35', '24', 'A', '30'], true),
  test('IPMAT-B-VERBAL-01', 'IPMAT batch B Verbal test: Vocabulary in context', ['IPMAT-B'], 'VERBAL', 'Isha Nair', -8, '50', ['39', '42', '31', '45', '36', 'A'], true),
  test('CAF-ACC-02', 'CA Foundation Accounting test: Journal entries', ['CAF-A'], 'ACC', 'Aditi Mehra', -18, '100', ['72', '65', '81', '58', 'A', '69'], true),
  test('CAF-ACC-03', 'CA Foundation Accounting test: Ledger and trial balance', ['CAF-A'], 'ACC', 'Neel Shah', -8, '100', ['66', '74', '79', '51', '62', 'A'], true),
  test('CAF-ACC-04', 'CA Foundation Accounting test: Bank reconciliation', ['CAF-A'], 'ACC', 'Tanvi Gokhale', -1, '50', ['41', 'A', '37', null, null, null]),
  test('CLAT-ENG-01', 'CLAT English sectional: Passage reading', ['CLAT-A'], 'ENG', 'Farida Khan', -21, '24', ['18', '20', '15', '22', 'A', '17', '19', '13'], true, 'sectional'),
  test('CLAT-LEG-01', 'CLAT Legal Reasoning sectional: Contracts', ['CLAT-A'], 'LEG', 'Dev Malhotra', -11, '30', ['21', '24', '19', '26', '17', 'A', '23', '20'], true, 'sectional'),
  test('CLAT-LR-01', 'CLAT Logical Reasoning sectional: Assumptions', ['CLAT-A'], 'LR', 'Lalit Bhatt', -4, '26', ['19', '16', '21', '14', '20', '18', 'A', '17'], false, 'sectional'),
  test('CLAT-QT-01', 'CLAT Quantitative Techniques test: Averages and ratios', ['CLAT-A'], 'QT', 'Nisha Rao', 6, '12', undefined, false, 'sectional'),
  test('C11-ACC-01', 'Class 11 Accountancy chapter test: Accounting equation', ['COM-C11-A'], 'ACC', 'Ramesh Chandak', -16, '50', ['39', '44', '31', 'A', '36'], true),
  test('C11-ECO-01', 'Class 11 Economics chapter test: Demand', ['COM-C11-A'], 'ECO', 'Jatin Oberoi', -9, '40', ['28', '33', '25', '30', 'A'], true),
  test('C11-ENG-01', 'Class 11 English test: Writing skills', ['COM-C11-A'], 'ENG', 'Priya Thomas', -2, '30', ['24', '-', '19', null, null]),
  test('C11-BST-01', 'Class 11 Business Studies test: Forms of business', ['COM-C11-A'], 'BST', 'Tara Kapoor', 8, '40', undefined),
  test('C12-ACC-01', 'Class 12 Accountancy chapter test: Partnership', ['COM-C12-A'], 'ACC', 'Ramesh Chandak', -17, '60', ['48', '39', '55', '44'], true),
  test('C12-BST-01', 'Class 12 Business Studies test: Principles of management', ['COM-C12-A'], 'BST', 'Karan Bedi', -10, '40', ['33', '27', '36', 'A'], true),
  test('C12-ECO-01', 'Class 12 Economics chapter test: National income', ['COM-C12-A'], 'ECO', 'Bhavna Soni', -5, '50', ['37', '41', 'A', '29']),
  test('C12-ENG-01', 'Class 12 English test: Flamingo, first three chapters', ['COM-C12-A'], 'ENG', 'Sanya Kulkarni', 4, '30', undefined),
];

/** Cancelled before it was held, with the reason. */
const CANCELLED = test('CLAT-CA-02', 'CLAT current affairs sectional 2', ['CLAT-A'], 'CA', 'Lata Krishnan', 2, '28', undefined, false, 'sectional');
const WITHDRAWN = 'CLAT-LEG-01';
const CORRECTED = 'C11-ACC-01';
const COHORT: SampleTest = {
  code: 'IPMAT-MOCK-02',
  title: 'IPMAT mock 2',
  kind: 'full_mock',
  batches: ['IPMAT-A', 'IPMAT-B'],
  subject: 'QUANT',
  teacher: 'Kunal Vyas',
  day: -3,
  rule: {
    perCorrect: '4',
    perWrong: '-1',
    sections: [{ code: 'QA', name: 'Quantitative Ability', questionCount: 30 }],
  },
  marks: ['88', '76', '104', '92', '60', 'A', '72', '84', '68', '96', '52', 'A', '80'],
  finalise: true,
};
const KEY_TESTS = [
  { code: 'IPMAT-A-KEY-01', batch: 'IPMAT-A', subject: 'QUANT', title: 'IPMAT batch A Quant practice: Percentages (OMR)', day: -11, answers: 'BCADBDACBDCA' },
  { code: 'CLAT-KEY-01', batch: 'CLAT-A', subject: 'LR', title: 'CLAT Logical Reasoning practice (OMR)', day: -7, answers: 'ADCBBACDDCAB' },
];

const coordinator = async (db: Database) => {
  const [u] = await db.select().from(users).where(eq(users.email, 'academic-coordinator@example.test'));
  return u
    ? {
        user: {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          roles: ['academic_coordinator'],
          sessionId: '' as SessionId,
        } as unknown as AuthenticatedUser,
      }
    : null;
};

const idOf = async (db: Database, code: string) =>
  (await db.select({ id: academicAssessments.id }).from(academicAssessments).where(eq(academicAssessments.code, code)))[0]?.id;

/** Tests marked question by question: the key (version 2 replaced a wrong answer), responses, results. */
async function keyTests(db: Database) {
  const actor = await coordinator(db);
  if (!actor) return;
  const today = sampleAnchorDate();
  for (const k of KEY_TESTS) {
    if (await idOf(db, k.code)) continue;
    const [batch] = await db.select().from(academicBatches).where(eq(academicBatches.code, k.batch));
    if (!batch) continue;
    const [subject] = await db
      .select({ id: academicSubjects.id })
      .from(academicSubjects)
      .where(and(eq(academicSubjects.courseId, batch.courseId), eq(academicSubjects.code, k.subject)));
    const a = await createAssessment(db, actor, {
      code: k.code,
      title: k.title,
      kind: 'practice',
      batchId: batch.id,
      subjectId: subject?.id,
      chapterIds: [],
      scheduledDate: addDays(today, k.day),
      startTime: '11:00',
      durationMinutes: 30,
      discussionMinutes: 15,
      patternRef: 'Twelve questions, four marks each, one mark off for a wrong answer',
      marksPerCorrect: '4',
      marksPerWrong: '-1',
      marksUnattempted: '0',
      sections: [
        {
          code: 'MAIN',
          name: 'All questions',
          questionCount: 12,
          answerFormat: 'choice',
          options: ['A', 'B', 'C', 'D'],
          timeLimitMinutes: 30,
          marksPerCorrect: null,
          marksPerWrong: null,
          marksUnattempted: null,
          capMarks: null,
        },
      ],
    } as never);
    await db.update(academicAssessments).set({ isSample: true }).where(eq(academicAssessments.id, a.id));
    const key = [...k.answers];
    await addAnswerKey(db, actor, a.id, {
      answers: { MAIN: key.map((x, i) => (i === 3 ? 'A' : x)) },
      note: 'First key from the paper setter.',
    } as never);
    const v2 = await addAnswerKey(db, actor, a.id, {
      answers: { MAIN: key },
      note: 'Question 4 corrected after a student pointed out the printing error.',
    } as never);
    const placed = await db
      .select({ id: academicEnrolments.studentId })
      .from(academicBatchPlacements)
      .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
      .where(and(eq(academicBatchPlacements.batchId, batch.id), isNull(academicBatchPlacements.endDate)));
    await upsertAttempts(db, actor, a.id, {
      attempts: placed.map((p, i) =>
        i === placed.length - 1
          ? { studentId: p.id, status: 'absent', keyVersion: null, responses: null }
          : {
              studentId: p.id,
              status: 'submitted',
              keyVersion: v2.version,
              // Each student has their own wrong and skipped questions.
              responses: {
                MAIN: key.map((x, q) => ((q + i) % 5 === 0 ? 'A' : (q * 2 + i) % 7 === 0 ? null : x)),
              },
            },
      ),
    } as never);
    await finaliseAssessment(db, actor, a.id);
  }
}

export async function seedFillTests(db: Database, opts: TestOptions) {
  const known = await db
    .select({ code: academicAssessments.code })
    .from(academicAssessments)
    .where(
      inArray(
        academicAssessments.code,
        FILL_TESTS.map((t) => t.code),
      ),
    );
  const missing = FILL_TESTS.filter((t) => !known.some((k) => k.code === t.code));
  if (missing.length) await writeTests(db, missing, opts);
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, opts.actorEmail));
  if (!u) return;
  const actor = await internalActor(db, u.id, 'sample-seed');
  if (missing.some((t) => t.code === CORRECTED)) {
    // A mark corrected after publication: a new result version, published automatically.
    const id = (await idOf(db, CORRECTED))!;
    const [row] = await db
      .select()
      .from(academicAssessmentRoster)
      .where(and(eq(academicAssessmentRoster.assessmentId, id), eq(academicAssessmentRoster.marksState, 'verified')))
      .orderBy(academicAssessmentRoster.displayNameSnapshot);
    await recordScores(db, actor, id, {
      source: 'manual',
      rows: [{ studentId: row!.studentId, version: row!.version, attendance: 'present', marksState: 'verified', score: '41' }],
      overwriteVerified: true,
      reason: 'A two-mark question was left uncounted on the first marking.',
    } as never);
  }
  if (missing.some((t) => t.code === WITHDRAWN)) {
    const id = (await idOf(db, WITHDRAWN))!;
    const [pub] = await db.select().from(academicResultPublications).where(eq(academicResultPublications.assessmentId, id));
    await withdrawInternal(db, actor, id, pub!.version, 'Two papers were marked against the wrong key; results will be published again after re-marking.');
  }
  if (!(await idOf(db, CANCELLED.code))) {
    const ids = await writeTests(db, [CANCELLED], opts);
    await updateAssessmentInternal(db, actor, ids!.get(CANCELLED.code)!, {
      status: 'cancelled',
      reason: 'The date clashed with the school’s half-yearly exam.',
    } as never);
  }
  // A mock across both IPMAT batches, ranked within batch A only.
  if (!(await idOf(db, COHORT.code))) {
    const ids = await writeTests(db, [COHORT], opts);
    const [batchA] = await db.select({ id: academicBatches.id }).from(academicBatches).where(eq(academicBatches.code, 'IPMAT-A'));
    await publishInternal(db, actor, ids!.get(COHORT.code)!, {
      version: 1,
      rankingScope: 'cohort',
      cohortBatchIds: [batchA!.id],
      provisional: false,
      note: 'Batch B has its own rank list; ranks here are for batch A.',
    } as never);
  }
  await keyTests(db);
}
