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
import { seedDemoTeacherTests, seedFillTeaching, seedFillTests } from '@elevate/academic-os/seed';
import {
  seedFillAdmissions,
  seedFillAttendance,
  seedFillFeedback,
  seedFillPeople,
  seedFillRequests,
  seedFillTasks,
  seedFillWork,
} from '@elevate/business-ops-os/seed';
import { teacherActivity } from '@elevate/academic-os/server';
import { seedFillContent, seedFillMarketing } from '@elevate/marketing-os/seed';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { seedFillAudit } from './fill-audit';
import { seedFillReports } from './fill-reports';

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
  const opts = { actorEmail: 'operations-manager@example.test', admissionNumbers };
  await seedDemoTeacherTests(db, opts);
  await seedFillTests(db, opts);
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
    .limit(40);
  const WORDS = [
    ['Read; shared with the counsellor.', 'Mention this at the next parent call.'],
    ['Read; nothing to do for now.', null],
    ['Read with the academic manager; the family should hear about the attendance.', 'Call the parent this week.'],
    ['Read; passed to the batch coordinator.', null],
  ] as const;
  if (ops && sent.length && !(await db.$count(opsReviewAcknowledgements, eq(opsReviewAcknowledgements.isSample, true))))
    await db
      .insert(opsReviewAcknowledgements)
      .values(
        sent
          // Not every sent review has been read yet: the rest stay waiting on the screen.
          .filter((_, i) => i % 3 !== 2)
          .map((r, i) => ({
            reviewKey: r.key,
            reviewVersion: r.version,
            acknowledgedByUserId: ops.id,
            note: WORDS[i % WORDS.length]![0],
            followUp: WORDS[i % WORDS.length]![1],
            followUpOn: WORDS[i % WORDS.length]![1] ? addDays(toIsoDate(), 3 + (i % 5)) : null,
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
    'The made-up Schar and the setting, staff details, work schedules, holidays',
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
  [
    'work',
    'Everyone’s tasks in every state, work reports by day, week and month, a tracker import',
    (db, log) => seedFillWork(db, log, (id, window) => teacherActivity(db, id, window)),
  ],
  ['feedback', 'Feedback imports, responses, summaries and development actions', seedFillFeedback],
  [
    'admissions',
    'Lead, guardian and exit details, onboarding, meetings, events, a readmission',
    seedFillAdmissions,
  ],
  ['marketing', 'Campaign, idea, calendar and SEO details', seedFillMarketing],
  [
    'content',
    'Content on sample ideas: versions, reviews, placements, publications, figures, personal settings',
    seedFillContent,
  ],
  ['acknowledgements', 'Ops acknowledgements of sent teacher reviews', acknowledgeReviews],
  ['reports', 'Past student and teacher reports, made and finalised by the real services', seedFillReports],
  ['audit', 'Audit rows for what the fill wrote directly, so the audit screens read as a history', seedFillAudit],
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
