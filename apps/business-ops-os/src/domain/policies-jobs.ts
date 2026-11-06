/**
 * Policy register: background jobs (owner, 6 Nov 2026, D-133). Every job is off until someone who
 * runs jobs switches it on; how often each runs is our proposal. Keys are `jobs.<job>`, one per
 * job in OPS_JOBS (server/schemas.ts), plus the fee reminder days (`fees.reminders`).
 */
import { z } from 'zod';
import { addDays, daysBetween, type IsoDate } from './dates';
import type { DefinitionsFor } from './policies-base';

/** Minutes that divide a day, so a job runs at the same IST times every day (REV-3 M3). */
export const JOB_INTERVALS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440];
export const JOB_INTERVALS_TEXT = `${JOB_INTERVALS.slice(0, -1).join(', ')} or 1440`;

const schedule = z
  .object({
    enabled: z.boolean(),
    everyMinutes: z
      .int()
      .refine(
        (n) => JOB_INTERVALS.includes(n),
        `Every (minutes) must be one of ${JOB_INTERVALS_TEXT}.`,
      ),
  })
  .strict();

/** Name, what it does, proposed minutes between runs. */
const JOBS = {
  'enrolment-replies': [
    'Apply Academic replies',
    'Moves confirmed admissions to enrolled, or back to admitted with the reason Academic gave.',
    15,
  ],
  'enrolment-exits': [
    'Send exits to Academic',
    'Ends the Academic enrolment of every student whose exit was recorded here, and passes on corrected student names.',
    60,
  ],
  'follow-up-reminders': [
    'Send follow-up reminders',
    'Reminds owners of follow-ups due today or overdue.',
    60,
  ],
  'task-reminders': [
    'Send task reminders',
    'Reminds people of tasks due soon, overdue or not yet acknowledged, and of the end-of-day report shortly before its deadline.',
    60,
  ],
  'demo-academic-marks': [
    'Read demo attendance from Academic',
    'Reads the marks teachers made in Academic for open demos. A demo with every class recorded shows as all classes recorded and, if the student attended, its case moves to Demo attended. Nothing is copied.',
    30,
  ],
  housekeeping: [
    'Clear expired sign-ins',
    'Deletes sign-in sessions that ended over 30 days ago, expired form keys and old counts of failed sign-in attempts. The audit trail and event history stay.',
    1440,
  ],
  'fee-reminders': [
    'Send fee reminders',
    'Tells the counsellor of the case and every finance officer, inside Elevate OS, about tuition instalments coming due or overdue, on the days set in Fees → Fee reminder days. Families are not messaged.',
    1440,
  ],
} as const;
type JobName = keyof typeof JOBS;
/** The "Send fee reminders" job's days (F4-04): from the due date, minus = before. */
const feeReminders = z
  .object({ reminderDays: z.array(z.int().min(-30).max(90)).min(1).max(8) })
  .strict();
type JobSchemas = { [J in JobName as `jobs.${J}`]: typeof schedule } & {
  'fees.reminders': typeof feeReminders;
};

const entries = Object.entries(JOBS) as [JobName, (typeof JOBS)[JobName]][];

export const jobSettingSchemas = {
  ...Object.fromEntries(entries.map(([job]) => [`jobs.${job}`, schedule])),
  'fees.reminders': feeReminders,
} as JobSchemas;

export const JOB_SETTING_DEFINITIONS = {
  ...Object.fromEntries(
    entries.map(([job, [label, description, everyMinutes]]) => [
      `jobs.${job}`,
      {
        label,
        description,
        defaultValue: { enabled: false, everyMinutes },
        defaultState: 'proposed',
        source: 'owner decision 2026-11-06 (D-133); how often is our proposal.',
        ownerDecision: 'D-133: off until switched on. Owner to confirm how often each runs.',
        editable: true,
      },
    ]),
  ),
  'fees.reminders': {
    label: 'Fee reminder days',
    description:
      'Days from each tuition instalment’s due date on which the "Send fee reminders" job tells the counsellor and finance: minus is before (-3 = three days before), 0 = on the due date. A day the job did not run is caught up on its next run, until the next reminder day; the last one up to a week late.',
    defaultValue: { reminderDays: [-3, 0, 7, 15] },
    defaultState: 'proposed',
    source: 'owner decision 2026-11-06 (F4-04); the days are our proposal.',
    ownerDecision: 'F4-04: owner to confirm the reminder days.',
    editable: true,
  },
} as DefinitionsFor<JobSchemas>;

/** A missed last reminder (job off, office closed) still goes out this many days late. */
const LAST_REMINDER_LATE_DAYS = 7;

/**
 * The fee reminder due `today` for an instalment due on `dueDate`: the latest of `reminderDays`
 * reached, sendable until the next one's day (`until`, so its claim can expire then), else null.
 */
export function feeReminderDue(dueDate: IsoDate, today: IsoDate, reminderDays: readonly number[]) {
  const days = [...new Set(reminderDays)].sort((a, b) => a - b);
  const since = daysBetween(dueDate, today);
  const reached = days.filter((d) => d <= since);
  const offset = reached.at(-1);
  if (offset === undefined) return null;
  const until = days[reached.length] ?? offset + LAST_REMINDER_LATE_DAYS;
  return since < until ? { offset, until: addDays(dueDate, until) } : null;
}

const IST_OFFSET_MS = 330 * 60_000;

/** Start of the slot `now` falls in. A job runs once per slot; with JOB_INTERVALS, slots start at midnight IST. */
export function jobSlot(now: Date, everyMinutes: number): Date {
  const every = everyMinutes * 60_000;
  return new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / every) * every - IST_OFFSET_MS);
}
