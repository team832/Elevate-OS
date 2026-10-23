/** Policy register: tasks, EOD, HR attendance, work reports, feedback about teachers and AI drafts. */
import { z } from 'zod';
import { codeList, type DefinitionsFor } from './policies-base';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hours = z.number().min(0.5).max(16);
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export const FEEDBACK_TEACHER_VISIBILITY = [
  'approved_summaries',
  'approved_summaries_and_comments',
  'nothing',
] as const;
export const TASK_REOPENERS = [
  'reviewer',
  'hr_manager',
  'operations_manager',
  'line_manager',
] as const;

export const hrSettingSchemas = {
  /** Who closes a task that has no reviewer (owner brief 2 §6). */
  'tasks.completion_without_reviewer': z
    .object({ closedBy: z.enum(['owner', 'manager']) })
    .strict(),
  /** EOD submission deadline, IST `HH:MM`; null = none (brief 2 §9: no invented deadline). */
  'eod.submission_deadline': z
    .object({
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .nullable(),
    })
    .strict(),
  /** Which earlier EOD reports a manager may read (ruling R3; brief 2 §17). */
  'eod.manager_history': z
    .object({ scope: z.enum(['submitted_to_manager', 'current_team_all']) })
    .strict(),
  /** External EOD delivery channel; null = in-app manager inbox only (brief 2 §11). */
  'eod.external_delivery': z.object({ channel: z.enum(['email']).nullable() }).strict(),
  // --- HR, work reports and feedback about teachers (owner brief 23 Oct 2026) ---------------
  /** Departments (core.departments codes) whose staff HR manages; empty = every department. */
  'hr.staff_scope_departments': z
    .object({ departmentCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(40) })
    .strict(),
  'hr.attendance.late_grace_minutes': z.object({ minutes: z.int().min(0).max(240) }).strict(),
  'hr.attendance.half_day_hours': z.object({ hours }).strict(),
  'hr.attendance.full_day_hours': z.object({ hours }).strict(),
  'reports.week_start': z.object({ day: z.enum(WEEKDAYS) }).strict(),
  /** Weekly report due (IST); null = no deadline. */
  'reports.weekly_deadline': z
    .object({
      deadline: z
        .object({ day: z.enum(WEEKDAYS), time: hhmm })
        .strict()
        .nullable(),
    })
    .strict(),
  /** Monthly report due on this day of the next month (IST); null = no deadline. */
  'reports.monthly_deadline': z
    .object({
      deadline: z
        .object({ dayOfNextMonth: z.int().min(1).max(15), time: hhmm })
        .strict()
        .nullable(),
    })
    .strict(),
  /** Only Asia/Kolkata is supported by the date code today. */
  'reports.timezone': z.object({ timezone: z.enum(['Asia/Kolkata']) }).strict(),
  'feedback.categories': z.object({ categories: codeList.min(1) }).strict(),
  'feedback.rating_scale': z.object({ min: z.literal(1), max: z.int().min(2).max(10) }).strict(),
  /** Fewest responses before anonymous aggregates or comments are shown. */
  'feedback.min_group_size': z.object({ size: z.int().min(1).max(100) }).strict(),
  'feedback.teacher_visibility': z.object({ show: z.enum(FEEDBACK_TEACHER_VISIBILITY) }).strict(),
  /** Who may reopen an approved task (reason required, audited). */
  'tasks.reopen_roles': z.object({ who: z.array(z.enum(TASK_REOPENERS)).min(1) }).strict(),
  /** AI draft helpers switched on (owner request 23 Oct 2026); a person always checks and saves. */
  'ai.features': z
    .object({
      feedbackSummary: z.boolean(),
      reportDraft: z.boolean(),
      taskBrief: z.boolean(),
      csvMapping: z.boolean(),
    })
    .strict(),
  'ai.daily_limit_per_user': z.object({ limit: z.int().min(0).max(1000) }).strict(),
} as const;

export const HR_SETTING_DEFINITIONS: DefinitionsFor<typeof hrSettingSchemas> = {
  'tasks.completion_without_reviewer': {
    label: 'Closing tasks without a reviewer',
    description:
      'When a task has no review step, who marks it done: the task owner, or their manager. Tasks with a review step are always closed by the reviewer.',
    defaultValue: { closedBy: 'owner' },
    defaultState: 'proposed',
    source: 'owner brief 2 2026-10-21 §6 ("no review gate: approved completion policy").',
    ownerDecision: 'Owner to confirm who closes tasks without a reviewer',
    editable: true,
  },
  'eod.submission_deadline': {
    label: 'End-of-day report deadline',
    description:
      'Time (IST) by which the day’s report should be submitted. Not set: no deadline is shown or enforced, and a late or missing report is never treated as absence.',
    defaultValue: { time: null },
    defaultState: 'open',
    source: 'owner brief 2 2026-10-21 §9 ("no invented fixed deadline").',
    ownerDecision: 'Owner to decide whether there is a deadline',
    editable: true,
  },
  'eod.manager_history': {
    label: 'Manager access to past reports',
    description:
      'Which earlier end-of-day reports a manager may read: only reports submitted to them, or every report of the people who report to them now (including reports sent to an earlier manager).',
    defaultValue: { scope: 'submitted_to_manager' },
    defaultState: 'proposed',
    source: 'owner brief 2 2026-10-21 §17 (a new manager does not automatically get past reports).',
    ownerDecision: 'Owner to confirm manager access to past reports',
    editable: true,
  },
  'eod.external_delivery': {
    label: 'Sending reports outside Elevate OS',
    description:
      'Reports go to the manager’s in-app inbox. No external channel is configured: staff can copy or download the summary, and nothing is sent by email or WhatsApp.',
    defaultValue: { channel: null },
    defaultState: 'proposed',
    source: 'owner brief 2 2026-10-21 §11 (no provider configured; never simulate delivery).',
    ownerDecision: 'Owner to choose an external channel and provider, if any',
    editable: false,
  },
  'hr.staff_scope_departments': {
    label: 'Staff HR manages',
    description:
      'Departments whose staff appear in HR (directory, attendance, tasks, reports). Empty: every department.',
    defaultValue: { departmentCodes: ['ACADEMICS', 'MARKETING_GROWTH'] },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §2, §6.',
    ownerDecision: 'Owner to confirm which departments HR covers',
    editable: true,
  },
  'hr.attendance.late_grace_minutes': {
    label: 'Late arrival grace',
    description:
      'Minutes after the scheduled start before a check-in is marked late. A schedule may set its own.',
    defaultValue: { minutes: 10 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §12.',
    ownerDecision: 'Owner to confirm the grace period',
    editable: true,
  },
  'hr.attendance.half_day_hours': {
    label: 'Half-day hours',
    description:
      'Hours between first check-in and last check-out that count as a half day (a shorter day stays Unmarked until HR decides).',
    defaultValue: { hours: 4 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §12.',
    ownerDecision: 'Owner to confirm half-day hours',
    editable: true,
  },
  'hr.attendance.full_day_hours': {
    label: 'Full-day hours',
    description:
      'Hours between first check-in and last check-out that count as a full day present.',
    defaultValue: { hours: 8 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §12.',
    ownerDecision: 'Owner to confirm full-day hours',
    editable: true,
  },
  'reports.week_start': {
    label: 'Week starts on',
    description: 'First day of a weekly work report and of weekly figures.',
    defaultValue: { day: 'monday' },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §13.',
    ownerDecision: 'Owner to confirm the week start',
    editable: true,
  },
  'reports.weekly_deadline': {
    label: 'Weekly report deadline',
    description:
      'When the weekly report is due (IST). Not set: no deadline is shown and a late report is not flagged.',
    defaultValue: { deadline: null },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §13.',
    ownerDecision: 'Owner to decide whether there is a deadline',
    editable: true,
  },
  'reports.monthly_deadline': {
    label: 'Monthly report deadline',
    description:
      'Day of the next month and time (IST) the monthly report is due. Not set: no deadline is shown.',
    defaultValue: { deadline: null },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §13.',
    ownerDecision: 'Owner to decide whether there is a deadline',
    editable: true,
  },
  'feedback.categories': {
    label: 'Feedback categories',
    description: 'Categories students rate teachers on (imports and entry forms use these codes).',
    defaultValue: {
      categories: [
        { code: 'explanation_clarity', label: 'Explanation clarity' },
        { code: 'pace', label: 'Pace' },
        { code: 'doubt_resolution', label: 'Doubt resolution' },
        { code: 'preparedness', label: 'Preparedness' },
        { code: 'classroom_engagement', label: 'Classroom engagement' },
        { code: 'helpfulness_of_materials', label: 'Helpfulness of materials' },
      ],
    },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §15.',
    ownerDecision: 'Owner to confirm the categories',
    editable: true,
  },
  'feedback.rating_scale': {
    label: 'Feedback rating scale',
    description: 'Rating scale for student feedback about teachers (1 to the maximum).',
    defaultValue: { min: 1, max: 5 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §15.',
    ownerDecision: 'Owner to confirm the rating scale',
    editable: true,
  },
  'feedback.min_group_size': {
    label: 'Smallest feedback group shown',
    description:
      'Fewest responses before anonymous averages or comments are shown to anyone outside HR.',
    defaultValue: { size: 5 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §15.',
    ownerDecision: 'Owner to confirm the minimum group size',
    editable: true,
  },
  'feedback.teacher_visibility': {
    label: 'What teachers see of their feedback',
    description:
      'Approved summaries only (with agreed development actions), summaries with edited comments, or nothing. Raw rows and student identities are never shown to teachers.',
    defaultValue: { show: 'approved_summaries' },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §15.',
    ownerDecision: 'Owner to confirm what teachers see',
    editable: true,
  },
  'tasks.reopen_roles': {
    label: 'Who may reopen an approved task',
    description: 'People who may reopen an approved task. A reason is required and recorded.',
    defaultValue: { who: ['reviewer', 'hr_manager'] },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §10.',
    ownerDecision: 'Owner to confirm who may reopen tasks',
    editable: true,
  },
  'ai.features': {
    label: 'AI draft features',
    description:
      'Which AI draft helpers are on: feedback summaries, work reports, task briefs, CSV column matching. Each sends the data it needs to OpenAI and only suggests text; a person checks, edits and saves it.',
    defaultValue: { feedbackSummary: true, reportDraft: true, taskBrief: true, csvMapping: true },
    defaultState: 'proposed',
    source: 'owner request 2026-10-23 (AI drafting inside the app).',
    ownerDecision:
      'Owner asked for these four AI draft features on 23 Oct 2026; confirm data sharing with OpenAI (DPDP). Names, contacts and codes are masked before sending, but a name the system does not know, written in lower case, can still get through in feedback comments or task titles.',
    editable: true,
  },
  'ai.daily_limit_per_user': {
    label: 'AI drafts per person per day',
    description:
      'How many AI drafts one person can ask for in a day (IST). 0 turns AI drafting off.',
    defaultValue: { limit: 50 },
    defaultState: 'proposed',
    source: 'owner request 2026-10-23 (AI drafting inside the app).',
    ownerDecision: 'Owner to confirm the daily limit',
    editable: true,
  },
  'reports.timezone': {
    label: 'Report time zone',
    description:
      'Time zone for report periods, deadlines and day boundaries. Only Asia/Kolkata is supported today.',
    defaultValue: { timezone: 'Asia/Kolkata' },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-23 §13 (default Asia/Kolkata).',
    ownerDecision: 'Owner to confirm',
    editable: false,
  },
};
