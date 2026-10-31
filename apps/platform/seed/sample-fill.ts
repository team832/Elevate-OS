/**
 * Owner, 31 Oct 2026: "Fill everything, every detail, with mock data." The fill runs last in
 * `npm run db:seed` and only there (module-only seed runs keep their small sets). Each step fills
 * sample rows or adds its own and skips what exists, so it also completes a database seeded earlier;
 * db:clear-samples removes it all (D-036). Only the platform may touch several modules (D-011.3).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  academicBatches,
  academicTeacherReviews,
  opsAdmissions,
  opsReviewAcknowledgements,
  students,
  users,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { seedDemoTeacherTests, seedFillTeaching } from '@elevate/academic-os/seed';
import {
  seedFillAdmissions,
  seedFillAttendance,
  seedFillFeedback,
  seedFillPeople,
  seedFillRequests,
  seedFillTasks,
} from '@elevate/business-ops-os/seed';
import { seedFillMarketing } from '@elevate/marketing-os/seed';

async function demoTeacherTests(db: Database, log: (m: string) => void) {
  if (!(await db.$count(academicBatches, eq(academicBatches.isSample, true))))
    return log('platform.fill-tests skipped: no sample batches');
  const admissionNumbers = (
    await db
      .select({
        coreStudentId: opsAdmissions.studentId,
        admissionNumber: opsAdmissions.admissionNumber,
      })
      .from(opsAdmissions)
      .innerJoin(students, eq(students.id, opsAdmissions.studentId))
      .where(and(eq(students.isSample, true), isNotNull(opsAdmissions.admissionNumber)))
  ).map((r) => ({ coreStudentId: r.coreStudentId!, admissionNumber: r.admissionNumber! }));
  await seedDemoTeacherTests(db, {
    actorEmail: 'operations-manager@example.test',
    admissionNumbers,
  });
}

/** Ops has read the teachers' sent reviews: its own acknowledgement, in its own words. */
async function acknowledgeReviews(db: Database) {
  const [ops] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'operations-manager@example.test'));
  const sent = await db
    .select({ key: academicTeacherReviews.reviewKey, version: academicTeacherReviews.version })
    .from(academicTeacherReviews)
    .where(
      and(
        eq(academicTeacherReviews.isSample, true),
        inArray(academicTeacherReviews.status, ['submitted']),
      ),
    )
    .limit(2);
  if (ops && sent.length)
    await db
      .insert(opsReviewAcknowledgements)
      .values(
        sent.map((r) => ({
          reviewKey: r.key,
          reviewVersion: r.version,
          acknowledgedByUserId: ops.id,
          note: 'Read; shared with the counsellor (sample).',
          followUp: 'Mention this at the next parent call (sample).',
          isSample: true,
        })),
      )
      .onConflictDoNothing();
}

const STEPS: readonly [
  string,
  string,
  (db: Database, log: (m: string) => void) => Promise<unknown>,
][] = [
  [
    'people',
    'Sample Schar and the setting, staff details, work schedules, holidays',
    (db) => seedFillPeople(db),
  ],
  [
    'attendance',
    'Sample punches, HR decisions, corrections and leave for recent weeks',
    seedFillAttendance,
  ],
  [
    'teaching',
    'Sample classes, attendance, logs at every stage, reviews, catch-up, support, rooms',
    seedFillTeaching,
  ],
  ['tests', 'The demo teacher’s Quant tests: marks to enter, final, upcoming', demoTeacherTests],
  [
    'requests',
    'Requests through HR in every state, with a forward, a reply and a relay',
    seedFillRequests,
  ],
  ['tasks', 'Task briefs, the demo teacher’s tasks in every state, work reports', seedFillTasks],
  ['feedback', 'Feedback imports, responses, summaries and development actions', seedFillFeedback],
  [
    'admissions',
    'Lead, guardian and exit details, onboarding, meetings, events, a readmission',
    seedFillAdmissions,
  ],
  ['marketing', 'Campaign, idea, calendar and SEO details', seedFillMarketing],
  ['acknowledgements', 'Ops acknowledgements of sent teacher reviews', acknowledgeReviews],
];

export const sampleFillSeeds = STEPS.map(([step, description, run], i) =>
  defineSeed({
    name: `platform.fill-${step}`,
    module: 'platform',
    dependsOn: i ? [`platform.fill-${STEPS[i - 1]![0]}`] : ['platform.sample-tests'],
    description,
    run: ({ db, log }) => run(db, log).then(() => undefined),
  }),
);
