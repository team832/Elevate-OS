import { describe, expect, it } from 'vitest';
import {
  calendarConflicts,
  checkPlacementScope,
  checkPublishEligibility,
  decidePublishAttempt,
  detectScheduleConflicts,
  istDate,
  publishingIdempotencyKey,
  validateCollabGroup,
  validateManualPublication,
  weekStart,
  type AccountCadence,
  type CollabAccount,
  type ScheduleCandidate,
  type ScheduledSlot,
} from '../../src/domain';

const at = (iso: string) => new Date(iso);
const slot = (
  id: string,
  account: string,
  iso: string,
  idea: string | null = null,
  group: string | null = null,
): ScheduledSlot => ({
  placementId: id,
  placementCode: id,
  ideaId: idea,
  accountCode: account,
  at: at(iso),
  groupId: group,
});
const cand = (iso: string, over: Partial<ScheduleCandidate> = {}): ScheduleCandidate => ({
  ...slot('new', 'IGC', iso, 'idea-1'),
  approval: { valid: true },
  ...over,
});
const li: AccountCadence = {
  accountCode: 'LI',
  maxPerDay: 1,
  maxPerWeek: 4,
  enforcement: 'block',
  status: 'approved',
};
const igc: AccountCadence = {
  accountCode: 'IGC',
  maxPerDay: null,
  maxPerWeek: 2,
  enforcement: 'warn',
  status: 'proposed',
};
const cfg = { slotWindowMinutes: 60, staggerWarning: true };

describe('IST week helpers', () => {
  it('uses Asia/Kolkata days and Monday weeks', () => {
    expect(istDate(at('2026-10-18T19:00:00Z'))).toBe('2026-10-19'); // 00:30 IST next day
    expect(weekStart('2026-10-18' as never)).toBe('2026-10-12'); // Sunday → previous Monday
    expect(weekStart('2026-10-12' as never)).toBe('2026-10-12');
  });
});

describe('schedule-conflict detection', () => {
  it('passes a clean slot', () => {
    expect(detectScheduleConflicts(cand('2030-01-10T13:30:00Z'), [], [igc], cfg)).toEqual({
      hard: [],
      warnings: [],
    });
  });
  it('hard-blocks publishing before approval and slots in the past', () => {
    const r = detectScheduleConflicts(
      cand('2020-01-10T13:30:00Z', { approval: { valid: false } }),
      [],
      [],
      cfg,
      at('2026-10-18T00:00:00Z'),
    );
    expect(r.hard.map((c) => c.code)).toEqual(['NOT_APPROVED', 'IN_PAST']);
  });
  it('warns on same-account collisions inside the window; the boundary does not collide', () => {
    const existing = [
      slot('a', 'IGC', '2030-01-10T13:00:00Z'),
      slot('b', 'IGC', '2030-01-10T12:30:00Z'),
      slot('c', 'IGU', '2030-01-10T13:30:00Z'),
    ];
    const r = detectScheduleConflicts(cand('2030-01-10T13:30:00Z'), existing, [], cfg);
    expect(r.hard).toEqual([]);
    expect(r.warnings[0]).toMatchObject({ code: 'SLOT_COLLISION', relatedPlacementIds: ['a'] });
  });
  it('treats cadence as hard when enforced (LI) and as a warning when proposed', () => {
    const liDay = detectScheduleConflicts(
      cand('2030-01-10T12:00:00Z', { accountCode: 'LI' }),
      [slot('x', 'LI', '2030-01-10T03:00:00Z')],
      [li],
      cfg,
    );
    expect(liDay.hard.map((c) => c.code)).toEqual(['CADENCE_DAY']);
    const week = [
      slot('a', 'IGC', '2030-01-07T13:30:00Z'),
      slot('b', 'IGC', '2030-01-08T13:30:00Z'),
    ];
    const igcWeek = detectScheduleConflicts(cand('2030-01-12T13:30:00Z'), week, [igc], cfg);
    expect(igcWeek.hard).toEqual([]);
    expect(igcWeek.warnings.map((c) => c.code)).toEqual(['CADENCE_WEEK']);
    // Next Monday is a new week: no warning.
    expect(
      detectScheduleConflicts(cand('2030-01-14T13:30:00Z'), week, [igc], cfg).warnings,
    ).toEqual([]);
  });
  it('warns when one idea lands on several accounts the same IST day, unless in one collab', () => {
    const other = slot('o', 'IGI', '2030-01-10T05:00:00Z', 'idea-1', 'g1');
    expect(
      detectScheduleConflicts(cand('2030-01-10T13:30:00Z'), [other], [], cfg).warnings.map(
        (w) => w.code,
      ),
    ).toEqual(['STAGGER_SAME_DAY']);
    expect(
      detectScheduleConflicts(cand('2030-01-10T13:30:00Z', { groupId: 'g1' }), [other], [], cfg)
        .warnings,
    ).toEqual([]);
    expect(
      detectScheduleConflicts(cand('2030-01-10T13:30:00Z'), [other], [], {
        ...cfg,
        staggerWarning: false,
      }).warnings,
    ).toEqual([]);
  });
  it('rejects invalid input', () => {
    expect(() => detectScheduleConflicts(cand('not-a-date'), [], [], cfg)).toThrow();
    expect(() =>
      detectScheduleConflicts(cand('2030-01-10T13:30:00Z'), [], [], {
        ...cfg,
        slotWindowMinutes: -1,
      }),
    ).toThrow();
  });
  it('flags only the posts over a cadence limit in a calendar view', () => {
    const slots = ['2030-01-10T03:00:00Z', '2030-01-10T08:00:00Z'].map((iso, i) => ({
      ...slot(`p${i}`, 'LI', iso),
      approval: { valid: true },
    }));
    const map = calendarConflicts(slots, [li], cfg);
    expect(map.get('p0')!.hard).toEqual([]);
    expect(map.get('p1')!.hard.map((c) => c.code)).toEqual(['CADENCE_DAY']);
  });
});

const acc = (
  code: string,
  platform: CollabAccount['platform'],
  scope: CollabAccount['scope'],
  exams: string[] = [],
): CollabAccount => ({
  accountCode: code,
  platform,
  scope,
  examPrefixes: exams,
});
const IGC = acc('IGC', 'instagram', 'exam', ['CLAT']);
const IGI = acc('IGI', 'instagram', 'exam', ['IPMAT']);
const IGU = acc('IGU', 'instagram', 'exam', ['CUET', 'COM']);
const IGS = acc('IGS', 'instagram', 'local');
const IGN = acc('IGN', 'instagram', 'founder');
const YTC = acc('YTC', 'youtube', 'exam', ['CLAT']);
const cross = { code: 'GEN-020', scope: 'cross_exam' as const, scopePrefixes: ['CLAT', 'IPMAT'] };

describe('collab rule', () => {
  it('accepts a comparison covering every exam involved', () => {
    expect(validateCollabGroup(cross, 'instagram', [IGC, IGI])).toMatchObject({
      valid: true,
      errors: [],
    });
  });
  it('rejects missing or unrelated exam pages, Sikar, mixed platforms and solo content', () => {
    expect(validateCollabGroup(cross, 'instagram', [IGC, IGU]).errors.map((e) => e.code)).toEqual([
      'MISSING_EXAM_PAGE',
      'UNRELATED_EXAM_PAGE',
    ]);
    expect(
      validateCollabGroup(cross, 'instagram', [IGC, IGI, IGS]).errors.map((e) => e.code),
    ).toContain('SIKAR_NOT_ALLOWED');
    expect(
      validateCollabGroup(cross, 'instagram', [IGC, YTC, IGI]).errors.map((e) => e.code),
    ).toContain('MIXED_PLATFORMS');
    const solo = { code: 'CLAT-001', scope: 'single_exam' as const, scopePrefixes: ['CLAT'] };
    expect(validateCollabGroup(solo, 'instagram', [IGC, IGI]).errors.map((e) => e.code)).toContain(
      'SOLO_CONTENT',
    );
  });
  it('handles boundaries: one member, LinkedIn, duplicates, founder and Sikar scopes', () => {
    expect(validateCollabGroup(cross, 'instagram', [IGC]).errors.map((e) => e.code)).toContain(
      'TOO_FEW_MEMBERS',
    );
    expect(validateCollabGroup(cross, 'linkedin', [IGC, IGI]).errors.map((e) => e.code)).toContain(
      'PLATFORM_NOT_SUPPORTED',
    );
    expect(
      validateCollabGroup(cross, 'instagram', [IGC, IGC, IGI]).errors.map((e) => e.code),
    ).toContain('DUPLICATE_ACCOUNT');
    expect(
      validateCollabGroup({ code: 'GEN-5', scope: 'founder', scopePrefixes: [] }, 'instagram', [
        IGC,
        IGI,
      ]).errors.map((e) => e.code),
    ).toEqual(['FOUNDER_ACCOUNT_REQUIRED']);
    expect(
      validateCollabGroup({ code: 'GEN-5', scope: 'founder', scopePrefixes: [] }, 'instagram', [
        IGN,
        IGC,
      ]).valid,
    ).toBe(true);
    expect(
      validateCollabGroup({ code: 'GEN-9', scope: 'local_sikar', scopePrefixes: [] }, 'instagram', [
        IGS,
        IGC,
      ]).valid,
    ).toBe(true);
  });
  it('checks single placements against the idea scope', () => {
    const clat = { code: 'CLAT-1', scope: 'single_exam' as const, scopePrefixes: ['CLAT'] };
    expect(checkPlacementScope(clat, IGI, false).errors.map((e) => e.code)).toEqual([
      'WRONG_EXAM_PAGE',
    ]);
    expect(checkPlacementScope(clat, IGC, false).valid).toBe(true);
    expect(checkPlacementScope(cross, IGC, false).warnings.map((w) => w.code)).toEqual([
      'COLLAB_EXPECTED',
    ]);
    expect(
      checkPlacementScope({ code: 'G', scope: 'local_sikar', scopePrefixes: [] }, IGC, false).valid,
    ).toBe(false);
  });
});

describe('publishing rules', () => {
  const gate = {
    placementStatus: 'scheduled' as const,
    contentState: 'scheduled' as const,
    approvalApproved: true,
    approvedVersionId: 'v1',
    currentVersionId: 'v1',
  };
  it('allows only approved, scheduled placements of the approved version', () => {
    expect(checkPublishEligibility(gate)).toEqual({ ok: true });
    expect(checkPublishEligibility({ ...gate, placementStatus: 'planned' })).toMatchObject({
      code: 'NOT_SCHEDULED',
    });
    expect(checkPublishEligibility({ ...gate, approvalApproved: false })).toMatchObject({
      code: 'NOT_APPROVED',
    });
    expect(checkPublishEligibility({ ...gate, currentVersionId: 'v2' })).toMatchObject({
      code: 'VERSION_NOT_APPROVED',
    });
    expect(checkPublishEligibility({ ...gate, placementStatus: 'published' })).toMatchObject({
      code: 'ALREADY_PUBLISHED',
    });
    expect(checkPublishEligibility({ ...gate, placementStatus: 'cancelled' })).toMatchObject({
      code: 'CANCELLED',
    });
  });
  it('decides create / retry / duplicate / exhausted deterministically', () => {
    expect(decidePublishAttempt(null)).toEqual({ action: 'create' });
    expect(decidePublishAttempt({ status: 'succeeded', attempts: 1, maxAttempts: 3 })).toEqual({
      action: 'already_published',
    });
    expect(decidePublishAttempt({ status: 'failed', attempts: 2, maxAttempts: 3 })).toEqual({
      action: 'retry',
      attemptNumber: 3,
    });
    expect(decidePublishAttempt({ status: 'failed', attempts: 3, maxAttempts: 3 })).toEqual({
      action: 'exhausted',
      attempts: 3,
    });
    expect(decidePublishAttempt({ status: 'pending', attempts: 0, maxAttempts: 3 })).toEqual({
      action: 'in_progress',
    });
    expect(publishingIdempotencyKey('p', 'v')).toBe('placement:p:version:v');
  });
  it('validates manual publications', () => {
    const now = at('2026-10-18T10:00:00Z');
    expect(
      validateManualPublication(
        { publishedAt: at('2026-10-17T10:00:00Z'), url: 'https://x.test/p/1' },
        now,
      ),
    ).toEqual([]);
    expect(
      validateManualPublication(
        { publishedAt: at('2026-10-19T10:00:00Z'), url: 'https://x.test/p/1' },
        now,
      ),
    ).toHaveLength(1);
    expect(
      validateManualPublication({ publishedAt: at('2026-10-17T10:00:00Z'), url: 'ftp://x' }, now),
    ).toHaveLength(1);
    expect(validateManualPublication({ publishedAt: at('bad'), url: 'nope' }, now)).toHaveLength(2);
  });
});
