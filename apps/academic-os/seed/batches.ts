/**
 * Planning batches and their calendars (D-016). No class records, attendance, attempts, results
 * or teachers are seeded: nothing here is delivered work, and a real batch never gets a sample
 * teacher (its real Quant teacher is ./owner-assignments.ts). Sample students and sample
 * teaching are in ./samples.ts (D-036).
 */
import { and, eq } from 'drizzle-orm';
import { defineSeed } from '@elevate/database/seed';
import {
  academicBatches,
  academicCalendarExclusions,
  academicCalendarRules,
  academicCourses,
  type Database,
} from '@elevate/database';
import type { BatchId } from '@elevate/shared-types';
import {
  CLASS12_EXCLUSION_PERIODS,
  readLegacy,
  sourceRef,
  type Class12Plan,
  type IpmatBaseline,
} from './legacy';
import { ensure } from './ensure';

type BatchInsert = typeof academicBatches.$inferInsert;

async function courseOf(db: Database, code: string) {
  const [c] = await db.select().from(academicCourses).where(eq(academicCourses.code, code));
  if (!c) throw new Error(`Course ${code} missing — run the curriculum seeds first.`);
  return c;
}

const ensureBatch = (db: Database, values: BatchInsert): Promise<BatchId> =>
  ensure(
    () => db.select({ id: academicBatches.id }).from(academicBatches).where(eq(academicBatches.code, values.code)),
    () => db.insert(academicBatches).values(values).returning({ id: academicBatches.id }),
  );

/** Insert a calendar rule unless one with the same label exists for the batch. */
async function ensureRule(db: Database, values: typeof academicCalendarRules.$inferInsert) {
  const [found] = await db
    .select({ id: academicCalendarRules.id })
    .from(academicCalendarRules)
    .where(
      and(
        eq(academicCalendarRules.batchId, values.batchId),
        eq(academicCalendarRules.label, values.label),
      ),
    );
  if (!found) await db.insert(academicCalendarRules).values(values);
}

async function ensureExclusion(
  db: Database,
  values: typeof academicCalendarExclusions.$inferInsert,
) {
  const [found] = await db
    .select({ id: academicCalendarExclusions.id })
    .from(academicCalendarExclusions)
    .where(
      and(
        eq(academicCalendarExclusions.batchId, values.batchId!),
        eq(academicCalendarExclusions.label, values.label),
      ),
    );
  if (!found) await db.insert(academicCalendarExclusions).values(values);
}

export const batchesSeed = defineSeed({
  name: 'academic.batches',
  module: 'academic',
  dependsOn: ['academic.ipmat-class12', 'academic.ca-foundation'],
  description:
    'Planning batches IPMAT-C12-APR27 (Class 12 calendar rules + 28-slot allowance) and CAF-SEP27-REG',
  async run({ db }) {
    const plan = readLegacy<Class12Plan>('class12-plan.json');
    const base = readLegacy<IpmatBaseline>('ipmat-baseline.json');
    const c12 = await courseOf(db, 'IPMAT-C12-2027');
    const batchId = await ensureBatch(db, {
      code: 'IPMAT-C12-APR27',
      name: 'IPMAT Class 12 — April 2027 (planning)',
      courseId: c12.id,
      programmeId: c12.programmeId,
      route: 'regular',
      mode: 'offline',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
      targetExam: 'IIMB UG-AT (provisional cycle)',
      targetExamDate: base.calendar.iimb_exam_date,
      targetExamDateStatus: 'unverified',
      status: 'planning',
      sourceRef: sourceRef('class12-plan.json', 'planning_controls'),
    });
    // The documented weekly pattern (provisional dates; the cycle itself is OD-015).
    const rules = [
      {
        label: 'Apr–Jun: Mon–Fri × 2 classes',
        periodStart: '2027-04-01',
        periodEnd: '2027-06-30',
        weekdays: [1, 2, 3, 4, 5],
        slotsPerDay: 2,
        kind: 'regular' as const,
      },
      {
        label: '1 Jul–15 Oct: Mon–Sat × 2 classes',
        periodStart: '2027-07-01',
        periodEnd: '2027-10-15',
        weekdays: [1, 2, 3, 4, 5, 6],
        slotsPerDay: 2,
        kind: 'regular' as const,
      },
      {
        label: '1 Jul–15 Oct: third class Tue/Thu',
        periodStart: '2027-07-01',
        periodEnd: '2027-10-15',
        weekdays: [2, 4],
        slotsPerDay: 1,
        kind: 'extra' as const,
      },
    ];
    for (const r of rules)
      await ensureRule(db, {
        batchId,
        ...r,
        status: 'provisional',
        sourceRef: sourceRef('class12-plan.json', 'planning_controls "Weekly pattern"'),
      });
    // The 28-slot exclusion allowance is LOCKED for planning; its dates are provisional (undated).
    for (const e of plan.exclusions) {
      const [periodStart, periodEnd] = CLASS12_EXCLUSION_PERIODS[e.period] ?? [];
      if (!periodStart || !periodEnd) throw new Error(`Unknown exclusion period ${e.period}`);
      for (const [kind, days] of [
        ['holiday', e.holiday_days],
        ['school_exam', e.school_exam_days],
      ] as const) {
        if (days === 0) continue;
        await ensureExclusion(db, {
          batchId,
          kind,
          label: `${e.period} — ${kind === 'holiday' ? 'holiday' : 'school-exam'} allowance (undated)`,
          periodStart,
          periodEnd,
          days,
          slotsPerDay: e.slots_per_excluded_day,
          status: 'locked',
          sourceRef: sourceRef('class12-plan.json', `exclusions[${e.period}]`),
        });
      }
    }
    await ensureExclusion(db, {
      batchId,
      kind: 'exam_blackout',
      label: 'Pre-IIMB mock phase (proposed)',
      periodStart: base.calendar.pre_iimb_mock_phase.start,
      periodEnd: base.calendar.pre_iimb_mock_phase.end,
      status: 'provisional',
      sourceRef: sourceRef('ipmat-baseline.json', 'calendar.pre_iimb_mock_phase'),
    });

    const caf = await courseOf(db, 'CAF-ACC-SEP27');
    await ensureBatch(db, {
      code: 'CAF-SEP27-REG',
      name: 'CA Foundation — September 2027 Regular (planning)',
      courseId: caf.id,
      programmeId: caf.programmeId,
      route: 'regular',
      mode: 'offline',
      targetExam: 'CA Foundation September 2027 attempt',
      status: 'planning',
      sourceRef: sourceRef(
        'ca-foundation-accountancy.json',
        'summary.batch_id (start date unresolved, OD-019)',
      ),
    });
  },
});
