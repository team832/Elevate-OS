import { describe, expect, it } from 'vitest';
import { computeCoverage, type CoverageRecord } from '../../src/domain';

// R11: coverage = submitted|verified `main` records; a chapter counts once; other activities are evidence only.
const chapters = [
  { id: 'c1', subjectId: 'q', code: 'Q-01', title: 'Numbers' },
  { id: 'c2', subjectId: 'q', code: 'Q-02', title: 'Algebra' },
  { id: 'c3', subjectId: 'v', code: 'V-01', title: 'Grammar' },
];
const subjects = [
  { id: 'q', code: 'QUANT', name: 'Quant' },
  { id: 'v', code: 'VERBAL', name: 'Verbal' },
];
const items = chapters.map((c) => ({ chapterId: c.id, plannedMinutes: 150, plannedClasses: 2, plannedDate: null }));
const rec = (chapterId: string, over: Partial<CoverageRecord> = {}): CoverageRecord => ({ chapterId, actualMinutes: 60, state: 'submitted', activity: 'main', completion: 'completed', ...over });
const run = (records: CoverageRecord[]) => computeCoverage({ items, chapters, subjects, records, asOf: null });

describe('computeCoverage (R11, acceptance tests 11 and 12)', () => {
  it('revision, practice, test and doubt rows never add coverage; they are listed as evidence', () => {
    const r = run([
      rec('c1', { state: 'verified' }),
      rec('c1', { activity: 'revision' }),
      rec('c1', { activity: 'revision', state: 'verified' }),
      rec('c1', { activity: 'practice' }),
      rec('c1', { activity: 'test' }),
      rec('c2', { activity: 'doubt_solving' }),
    ]);
    const c1 = r.chapters.find((c) => c.chapterId === 'c1')!;
    expect(c1).toMatchObject({ taught: 'completed', verifiedMinutes: 60, unverifiedMinutes: 0, evidence: { revision: 2, practice: 1, test: 1 } });
    expect(r.chapters.find((c) => c.chapterId === 'c2')).toMatchObject({ taught: 'not_taught', verifiedMinutes: 0, evidence: { doubt_solving: 1 } });
    expect(r.course).toMatchObject({ chaptersPlanned: 3, chaptersTaught: 1, chaptersCompleted: 1 });
  });

  it('a chapter taught in several sessions counts once; partial only from the completion field', () => {
    const r = run([rec('c1', { completion: 'partial' }), rec('c1', { completion: 'partial' }), rec('c3', { completion: 'partial' }), rec('c3')]);
    expect(r.chapters.map((c) => [c.chapterId, c.taught])).toEqual([['c1', 'partial'], ['c2', 'not_taught'], ['c3', 'completed']]);
    expect(r.course).toMatchObject({ chaptersTaught: 2, chaptersCompleted: 1, unverifiedMinutes: 240 });
    expect(r.subjects.find((s) => s.code === 'QUANT')).toMatchObject({ chaptersPlanned: 2, chaptersTaught: 1, chaptersCompleted: 0 });
  });

  it.each(['draft', 'superseded'] as const)('%s records count for nothing', (state) => {
    const r = run([rec('c1', { state }), rec('c2', { state, activity: 'revision' })]);
    expect(r.course).toMatchObject({ chaptersTaught: 0, verifiedMinutes: 0, unverifiedMinutes: 0 });
    expect(r.chapters.every((c) => Object.keys(c.evidence).length === 0)).toBe(true);
  });

  it('exposes batch exposure only: no mastery, score or per-student field', () => {
    const json = JSON.stringify(run([rec('c1')]));
    expect(json).not.toMatch(/mastery|score|student/i);
  });
});
