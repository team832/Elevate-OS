/**
 * Read-only access to the legacy planning extracts in data/legacy/academic
 * (Legacy Data agent, wave 1c). Status labels are preserved by the seeds;
 * nothing in these files is delivery evidence (data/legacy/README.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LEGACY_DIR = 'data/legacy/academic';

export function readLegacy<T>(file: string): T {
  const url = new URL(`../../../${LEGACY_DIR}/${file}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

export const sourceRef = (file: string, locator?: string) =>
  `${LEGACY_DIR}/${file}${locator ? ` ${locator}` : ''}`;

// --- shapes of the parts the seeds use ----------------------------------------------------

export interface Class12Plan {
  chapters: { subject: string; chapter: string }[];
  lessons: {
    lesson_id: string;
    subject: string;
    session: 'teaching' | 'practice';
    chapter: string;
    coverage: string | null;
    planned_minutes: number;
    planned_date: string | null;
  }[];
  exclusions: {
    period: string;
    holiday_days: number;
    school_exam_days: number;
    slots_per_excluded_day: number;
  }[];
}

export interface IpmatBaseline {
  locked_teaching_baseline: { approved_on: string };
  quant_teaching_blocks: { block: string; teaching_classes: number }[];
  quant_higher_maths: { topic: string; teaching_classes: number }[];
  verbal_teaching_blocks: { block: string; teaching_classes: number }[];
  lr_teaching_topics: { topic: string; teaching_classes: number }[];
  di_teaching_topics: { topic: string; teaching_classes: number }[];
  calendar: { iimb_exam_date: string; pre_iimb_mock_phase: { start: string; end: string } };
}

export interface CaAccountancy {
  records: {
    chapter_no: number;
    title: string;
    topics: { topic_id: string; topic: string; total_hours: number }[];
  }[];
}

export interface OnlineAccountancy {
  records: { seq: number; chapter: string; chapter_note: string | null; classes: number; class_minutes: number }[];
}

export interface ConceptBooks {
  records: {
    book_id: string;
    title: string;
    opening_unit: ConceptChapter | null;
    chapters: ConceptChapter[];
  }[];
}

export interface ConceptChapter {
  chapter_id: string;
  chapter_number: number | null;
  section: string | null;
  title: string;
  subtopics: string[];
  content_status: string;
  planned_questions?: { concept_building: number; practice_application: number; rankers_zone: number };
}

/** Month labels in class12-plan.json `exclusions` → their period (provisional 2027 cycle). */
export const CLASS12_EXCLUSION_PERIODS: Record<string, [string, string]> = {
  April: ['2027-04-01', '2027-04-30'],
  May: ['2027-05-01', '2027-05-31'],
  June: ['2027-06-01', '2027-06-30'],
  July: ['2027-07-01', '2027-07-31'],
  August: ['2027-08-01', '2027-08-31'],
  September: ['2027-09-01', '2027-09-30'],
  'October: 1–15': ['2027-10-01', '2027-10-15'],
};

/** Subject labels in the IPMAT extracts → subject codes. */
export const IPMAT_SUBJECTS = [
  { label: 'Quant', code: 'QUANT', name: 'Quantitative Ability', prefix: 'Q' },
  { label: 'Verbal', code: 'VERBAL', name: 'Verbal Ability', prefix: 'V' },
  { label: 'LR', code: 'LR', name: 'Logical Reasoning', prefix: 'LR' },
  { label: 'DI', code: 'DI', name: 'Data Interpretation', prefix: 'DI' },
] as const;

export const pad2 = (n: number) => String(n).padStart(2, '0');
