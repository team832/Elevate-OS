import { describe, expect, it } from 'vitest';
import {
  buildPlacementCode,
  detectDuplicateIdeas,
  formatIdeaCode,
  highestReservedNumber,
  jaccard,
  normalizeTitle,
  parseIdeaCode,
  parsePlacementCode,
  titleTokens,
  type ExistingIdea,
} from '../../src/domain';

describe('idea codes', () => {
  it('formats with at least three digits', () => {
    expect(formatIdeaCode('CLAT', 7)).toBe('CLAT-007');
    expect(formatIdeaCode('GEN', 1234)).toBe('GEN-1234');
  });
  it('rejects invalid numbers and prefixes', () => {
    expect(() => formatIdeaCode('CLAT', 0)).toThrow();
    expect(() => formatIdeaCode('CLAT', 1.5)).toThrow();
    expect(() => formatIdeaCode('MBA' as never, 1)).toThrow();
  });
  it('parses valid codes, rejects malformed or missing', () => {
    expect(parseIdeaCode('CLAT-028')).toEqual({ prefix: 'CLAT', number: 28 });
    expect(parseIdeaCode('CLAT-28')).toBeNull();
    expect(parseIdeaCode('clat-028')).toBeNull();
    expect(parseIdeaCode(null)).toBeNull();
  });
  it('reserves the highest live, legacy or proposed number per prefix', () => {
    expect(highestReservedNumber('CLAT', ['CLAT-027', 'CLAT-028', 'GEN-099', null, 'junk'])).toBe(
      28,
    );
    expect(highestReservedNumber('IPMAT', [])).toBe(0);
  });
});

describe('placement codes', () => {
  it('builds <IDEA>-<ACCOUNT> and YouTube S/L variants', () => {
    expect(
      buildPlacementCode({
        ideaCode: 'CLAT-005',
        accountCode: 'YTC',
        platform: 'youtube',
        variant: 'long',
      }),
    ).toBe('CLAT-005-YTCL');
    expect(
      buildPlacementCode({ ideaCode: 'GEN-001', accountCode: 'LI', platform: 'linkedin' }),
    ).toBe('GEN-001-LI');
  });
  it('refuses variants off YouTube and bad codes', () => {
    expect(() =>
      buildPlacementCode({
        ideaCode: 'CLAT-005',
        accountCode: 'IGC',
        platform: 'instagram',
        variant: 'short',
      }),
    ).toThrow();
    expect(() =>
      buildPlacementCode({ ideaCode: 'X-1', accountCode: 'IGC', platform: 'instagram' }),
    ).toThrow();
  });
  it('parses legacy version ids against registered accounts', () => {
    const accounts = ['IGC', 'YTC', 'LI', 'LIP', 'YTI'];
    expect(parsePlacementCode('CLAT-025-YTCS', accounts)).toEqual({
      ideaCode: 'CLAT-025',
      accountCode: 'YTC',
      variant: 'short',
    });
    expect(parsePlacementCode('IPMAT-001-LIP', accounts)).toEqual({
      ideaCode: 'IPMAT-001',
      accountCode: 'LIP',
      variant: null,
    });
    expect(parsePlacementCode('CLAT-025-ZZZ', accounts)).toBeNull();
    expect(parsePlacementCode('CLAT-025-LIS', accounts)).toBeNull(); // S only for YouTube
  });
});

describe('title normalisation', () => {
  it('is deterministic over case, punctuation, accents and &', () => {
    expect(normalizeTitle('  DU Colleges: Commerce & Eco!! ')).toBe('du colleges commerce and eco');
    expect(normalizeTitle('Café · résumé')).toBe('cafe resume');
    expect(normalizeTitle('')).toBe('');
  });
  it('tokenises without stop words and with light plural stripping', () => {
    expect(titleTokens('What parents should know about NLU fees')).toEqual([
      'about',
      'fee',
      'know',
      'nlu',
      'parent',
      'should',
    ]);
  });
  it('computes Jaccard including empty sets', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
  });
});

const existing: ExistingIdea[] = [
  {
    id: '1',
    code: 'CLAT-015',
    title: 'NLU fees: the real total cost (parents)',
    coursePrefix: 'CLAT',
    status: 'idea',
  },
  {
    id: '2',
    code: 'CLAT-001',
    title: 'CLAT explained to a parent in 60 seconds',
    coursePrefix: 'CLAT',
    status: 'scripted',
  },
  {
    id: '3',
    code: 'IPMAT-002',
    title: 'IPMAT explained to a parent in 60 seconds',
    coursePrefix: 'IPMAT',
    status: 'scripted',
  },
  {
    id: '4',
    code: null,
    title: 'Mock test day at Elevate (classroom proof)',
    coursePrefix: 'GEN',
    status: 'idea',
  },
];

describe('duplicate detection', () => {
  it('blocks an exact normalised match in the same course', () => {
    const r = detectDuplicateIdeas(
      { title: 'NLU FEES — the real total cost (Parents)!', coursePrefix: 'CLAT' },
      existing,
    );
    expect(r.decision).toBe('block');
    expect(r.candidates[0]).toMatchObject({ id: '1', kind: 'exact_same_course', score: 1 });
  });
  it('only warns for an exact title in another course', () => {
    const r = detectDuplicateIdeas(
      { title: 'NLU fees: the real total cost (parents)', coursePrefix: 'GEN' },
      existing,
    );
    expect(r.decision).toBe('warn');
    expect(r.candidates[0]!.kind).toBe('exact_other_course');
  });
  it('warns for similar titles in the same course with a reason, sorted deterministically', () => {
    const r = detectDuplicateIdeas(
      { title: 'CLAT explained to parents in 90 seconds', coursePrefix: 'CLAT' },
      existing,
    );
    expect(r.decision).toBe('warn');
    expect(r.candidates[0]).toMatchObject({ id: '2', kind: 'similar_same_course' });
    expect(r.candidates[0]!.reason).toMatch(/title words shared with CLAT-001/);
    expect(
      detectDuplicateIdeas(
        { title: 'CLAT explained to parents in 90 seconds', coursePrefix: 'CLAT' },
        existing,
      ),
    ).toEqual(r);
  });
  it('needs a higher score across courses (boundary at the threshold)', () => {
    const title = 'IPMAT or CLAT explained to a parent in 60 seconds';
    // 6 tokens; each existing 60-seconds idea shares 5 → 5/6 ≈ 0.83
    const at = detectDuplicateIdeas({ title, coursePrefix: 'GEN' }, existing, {
      crossCourseThreshold: 0.83,
    });
    expect(at.candidates.map((c) => [c.id, c.kind])).toEqual([
      ['2', 'similar_other_course'],
      ['3', 'similar_other_course'],
    ]);
    const above = detectDuplicateIdeas({ title, coursePrefix: 'GEN' }, existing, {
      crossCourseThreshold: 0.84,
    });
    expect(above.decision).toBe('clear');
  });
  it('clears unrelated or empty titles and honours excludeId and limit', () => {
    expect(
      detectDuplicateIdeas(
        { title: 'Quant shortcuts for percentages', coursePrefix: 'CLAT' },
        existing,
      ).decision,
    ).toBe('clear');
    expect(detectDuplicateIdeas({ title: '!!!', coursePrefix: 'CLAT' }, existing).decision).toBe(
      'clear',
    );
    const r = detectDuplicateIdeas({ title: existing[0]!.title, coursePrefix: 'CLAT' }, existing, {
      excludeId: '1',
    });
    expect(r.decision).not.toBe('block');
    expect(
      detectDuplicateIdeas({ title: existing[0]!.title, coursePrefix: 'CLAT' }, existing, {
        limit: 0,
      }).candidates,
    ).toEqual([]);
  });
  it('rejects invalid thresholds', () => {
    expect(() =>
      detectDuplicateIdeas({ title: 'x y', coursePrefix: 'CLAT' }, existing, {
        sameCourseThreshold: 0,
      }),
    ).toThrow();
  });
});
