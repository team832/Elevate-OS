/**
 * Curriculum coverage (ACD-006, ACD-021, BR-ACD-11) — planned vs completed
 * minutes and hours per chapter, subject and course, from class records.
 *
 * - Planned comes from the plan's items (never overwritten by actuals).
 * - Coverage counts ONLY submitted/verified first-teaching (`main`) records (R11). A chapter
 *   counts once however many sessions it took; partial vs completed comes only from the
 *   records' `completion` field. Revision, practice, test, doubt and other rows are counted
 *   as separate evidence and never add coverage. Drafts and superseded rows count for nothing.
 * - Verified minutes are delivered; submitted-but-unverified minutes are reported separately.
 * - Coverage is what the batch was taught, never what a student has mastered.
 * - Planned-to-date uses the items' planned dates ≤ asOf; when a chapter has
 *   undated items the planned-to-date figure is null (unknown), not zero.
 * - Records for chapters that are not in the plan are listed as `unplanned`.
 * Integer minutes throughout; hours and percentages are rounded for display only.
 */
export interface CoveragePlanItem {
  chapterId: string;
  plannedMinutes: number;
  plannedClasses: number;
  plannedDate: string | null;
}

export interface CoverageChapter {
  id: string;
  subjectId: string;
  code: string;
  title: string;
}

export interface CoverageSubject {
  id: string;
  code: string;
  name: string;
}

export type LogActivity = 'main' | 'practice' | 'catch_up' | 'test' | 'discussion' | 'revision' | 'doubt_solving';

export interface CoverageRecord {
  chapterId: string;
  actualMinutes: number;
  state: 'draft' | 'submitted' | 'verified' | 'superseded';
  activity: LogActivity;
  completion: 'completed' | 'partial';
}

export interface CoverageInput {
  items: readonly CoveragePlanItem[];
  chapters: readonly CoverageChapter[];
  subjects: readonly CoverageSubject[];
  records: readonly CoverageRecord[];
  /** Date for planned-to-date; null = not computed. */
  asOf: string | null;
}

export interface CoverageFigures {
  plannedClasses: number;
  plannedMinutes: number;
  plannedHours: number;
  /** null when any contributing item is undated or asOf is not given. */
  plannedToDateMinutes: number | null;
  verifiedMinutes: number;
  verifiedHours: number;
  unverifiedMinutes: number;
  /** verified ÷ planned × 100 (1 dp); null when nothing is planned. */
  completionPercent: number | null;
  /** verified − planned-to-date; null when planned-to-date is unknown. */
  varianceMinutes: number | null;
  chaptersPlanned: number;
  /** Planned chapters with at least one submitted/verified first-teaching record. */
  chaptersTaught: number;
  /** …of which at least one record says `completed`. */
  chaptersCompleted: number;
}

export interface ChapterCoverage extends CoverageFigures {
  chapterId: string;
  code: string;
  title: string;
  subjectId: string;
  taught: 'not_taught' | 'partial' | 'completed';
  /** Submitted/verified non-first-teaching records by activity (practised, revised, assessed…). */
  evidence: Partial<Record<Exclude<LogActivity, 'main'>, number>>;
}

export interface SubjectCoverage extends CoverageFigures {
  subjectId: string;
  code: string;
  name: string;
}

export interface CoverageResult {
  chapters: ChapterCoverage[];
  subjects: SubjectCoverage[];
  course: CoverageFigures;
  unplanned: { chapterId: string; verifiedMinutes: number; unverifiedMinutes: number }[];
}

const round = (value: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

function figures(
  items: readonly CoveragePlanItem[],
  records: readonly CoverageRecord[],
  asOf: string | null,
): CoverageFigures {
  const plannedMinutes = items.reduce((a, i) => a + i.plannedMinutes, 0);
  const plannedClasses = items.reduce((a, i) => a + i.plannedClasses, 0);
  const undated = items.some((i) => i.plannedDate === null);
  const plannedToDateMinutes =
    asOf === null || undated
      ? null
      : items.filter((i) => i.plannedDate! <= asOf).reduce((a, i) => a + i.plannedMinutes, 0);
  const verifiedMinutes = records
    .filter((r) => r.state === 'verified')
    .reduce((a, r) => a + r.actualMinutes, 0);
  const unverifiedMinutes = records
    .filter((r) => r.state === 'submitted')
    .reduce((a, r) => a + r.actualMinutes, 0);
  return {
    plannedClasses,
    plannedMinutes,
    plannedHours: round(plannedMinutes / 60, 2),
    plannedToDateMinutes,
    verifiedMinutes,
    verifiedHours: round(verifiedMinutes / 60, 2),
    unverifiedMinutes,
    completionPercent: plannedMinutes === 0 ? null : round((verifiedMinutes / plannedMinutes) * 100, 1),
    varianceMinutes: plannedToDateMinutes === null ? null : verifiedMinutes - plannedToDateMinutes,
    chaptersPlanned: new Set(items.map((i) => i.chapterId)).size,
    chaptersTaught: new Set(records.map((r) => r.chapterId)).size,
    chaptersCompleted: new Set(records.filter((r) => r.completion === 'completed').map((r) => r.chapterId)).size,
  };
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const chapterById = new Map(input.chapters.map((c) => [c.id, c]));
  const itemsByChapter = new Map<string, CoveragePlanItem[]>();
  for (const item of input.items) {
    const list = itemsByChapter.get(item.chapterId) ?? [];
    list.push(item);
    itemsByChapter.set(item.chapterId, list);
  }
  const recordsByChapter = new Map<string, CoverageRecord[]>();
  const evidenceByChapter = new Map<string, ChapterCoverage['evidence']>();
  for (const r of input.records) {
    if (r.state !== 'submitted' && r.state !== 'verified') continue;
    if (r.activity !== 'main') {
      const evidence = evidenceByChapter.get(r.chapterId) ?? {};
      evidence[r.activity] = (evidence[r.activity] ?? 0) + 1;
      evidenceByChapter.set(r.chapterId, evidence);
      continue;
    }
    const list = recordsByChapter.get(r.chapterId) ?? [];
    list.push(r);
    recordsByChapter.set(r.chapterId, list);
  }

  const chapters: ChapterCoverage[] = [];
  for (const [chapterId, items] of itemsByChapter) {
    const ch = chapterById.get(chapterId);
    const f = figures(items, recordsByChapter.get(chapterId) ?? [], input.asOf);
    chapters.push({
      chapterId,
      code: ch?.code ?? chapterId,
      title: ch?.title ?? '(unknown chapter)',
      subjectId: ch?.subjectId ?? '',
      ...f,
      taught: f.chaptersCompleted ? 'completed' : f.chaptersTaught ? 'partial' : 'not_taught',
      evidence: evidenceByChapter.get(chapterId) ?? {},
    });
  }
  chapters.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

  const subjects: SubjectCoverage[] = input.subjects
    .map((s) => {
      const chapterIds = new Set(input.chapters.filter((c) => c.subjectId === s.id).map((c) => c.id));
      const items = input.items.filter((i) => chapterIds.has(i.chapterId));
      const records = [...chapterIds].flatMap((id) =>
        itemsByChapter.has(id) ? (recordsByChapter.get(id) ?? []) : [],
      );
      return { subjectId: s.id, code: s.code, name: s.name, ...figures(items, records, input.asOf) };
    })
    .filter((s) => s.plannedMinutes > 0);

  const plannedRecords = [...recordsByChapter.entries()]
    .filter(([id]) => itemsByChapter.has(id))
    .flatMap(([, list]) => list);
  const unplanned = [...recordsByChapter.entries()]
    .filter(([id]) => !itemsByChapter.has(id))
    .map(([chapterId, list]) => ({
      chapterId,
      verifiedMinutes: list.filter((r) => r.state === 'verified').reduce((a, r) => a + r.actualMinutes, 0),
      unverifiedMinutes: list.filter((r) => r.state === 'submitted').reduce((a, r) => a + r.actualMinutes, 0),
    }));

  return {
    chapters,
    subjects,
    course: figures(input.items, plannedRecords, input.asOf),
    unplanned,
  };
}
