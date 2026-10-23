/**
 * Configurable academic rules (stored in `academic.settings`). Shipped defaults
 * are `proposed` — they are not owner-approved policy (MODULE_TEAM_BRIEF rule 6).
 */
import { z } from 'zod';
import { DEFAULT_CATCHUP_WEIGHTS } from './catchup';
import { DEFAULT_TREND_OPTIONS } from './progress';

const enforcement = z.enum(['warning', 'hard']);

export const SETTING_DEFINITIONS = {
  'timetable.teacher_workload_cap': {
    description:
      'Teacher workload cap in teaching minutes per day and per week. Null = not configured (not checked). A preference (warning) unless enforcement is "hard".',
    schema: z
      .object({
        maxMinutesPerDay: z.int().min(1).max(1440).nullable(),
        maxMinutesPerWeek: z.int().min(1).max(10080).nullable(),
        enforcement,
      })
      .strict(),
    defaultValue: { maxMinutesPerDay: null, maxMinutesPerWeek: null, enforcement: 'warning' as const },
  },
  'assessments.min_gap_days': {
    description:
      'Minimum days between two assessments of the same batch (0 = no gap rule). A warning unless enforcement is "hard".',
    schema: z.object({ minDays: z.int().min(0).max(60), enforcement }).strict(),
    defaultValue: { minDays: 0, enforcement: 'warning' as const },
  },
  'assessments.provisional_publication': {
    description:
      'Whether results may be published as PROVISIONAL while roster rows are still unmarked, imported (unverified) or present without marks. Off: only complete results are published.',
    schema: z.object({ allowed: z.boolean() }).strict(),
    defaultValue: { allowed: false },
  },
  'catchup.weights': {
    description:
      'Catch-up prioritisation weights: recency, chapter weight, upcoming-assessment urgency, and the horizon in days.',
    schema: z
      .object({
        recency: z.int().min(0).max(10),
        chapter: z.int().min(0).max(10),
        assessment: z.int().min(0).max(10),
        horizonDays: z.int().min(1).max(90),
      })
      .strict(),
    defaultValue: DEFAULT_CATCHUP_WEIGHTS,
  },
  'progress.trend': {
    description:
      'Assessment trend: use the last N results, require at least minPoints, treat |slope| below flatThreshold (percentage points per assessment) as flat.',
    schema: z
      .object({
        lastN: z.int().min(2).max(50),
        minPoints: z.int().min(2).max(50),
        flatThreshold: z.number().min(0).max(50),
      })
      .strict()
      .refine((v) => v.minPoints <= v.lastN, { error: 'minPoints cannot exceed lastN' }),
    defaultValue: DEFAULT_TREND_OPTIONS,
  },
  'attendance.denominator': {
    description:
      'Attendance %: whether a late mark counts as attended, and whether excused sessions are left out of the denominator. Not-recorded sessions are always shown separately, never as absent.',
    schema: z.object({ lateCountsAsAttended: z.boolean(), excludeExcused: z.boolean() }).strict(),
    defaultValue: { lateCountsAsAttended: true, excludeExcused: true },
  },
  'progress.show_rank_percentile': {
    description:
      'Show rank and percentile beside assessment results. Off until the owner approves a ranking policy.',
    schema: z.object({ show: z.boolean() }).strict(),
    defaultValue: { show: false },
  },
  'teaching_log.deadline_hours': {
    description:
      'Hours after a session ends by which its teaching log should be submitted. Null = no deadline (logs are listed as pending, never as late).',
    schema: z.object({ hours: z.int().min(1).max(720).nullable() }).strict(),
    defaultValue: { hours: null },
  },
  'demo.attendees_count_toward_capacity': {
    description:
      'Whether demo students added to a class roster take a seat in the batch capacity check.',
    schema: z.object({ counts: z.boolean() }).strict(),
    defaultValue: { counts: true },
  },
  'reviews.cadence_days': {
    description:
      'How often a periodic progress review is expected per student and subject, in days. Null = no cadence (a missing review is pending, not negative).',
    schema: z.object({ days: z.int().min(1).max(365).nullable() }).strict(),
    defaultValue: { days: null },
  },
  'timetable.substitute_authoriser': {
    description: 'Which role may authorise a substitute teacher for a class session.',
    schema: z.object({ role: z.enum(['academic_coordinator', 'director']) }).strict(),
    defaultValue: { role: 'academic_coordinator' as const },
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}

/** Parse a stored value; fall back to the proposed default when absent or invalid. */
export function readSetting<K extends SettingKey>(key: K, stored: unknown): SettingValue<K> {
  const def = SETTING_DEFINITIONS[key];
  const parsed = def.schema.safeParse(stored);
  return (parsed.success ? parsed.data : def.defaultValue) as SettingValue<K>;
}
