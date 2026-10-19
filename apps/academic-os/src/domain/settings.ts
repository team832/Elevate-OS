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
