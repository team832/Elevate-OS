/** Onboarding checklist and KYC document rules (owner brief §8, acceptance 13, 21). Pure functions. */
import { describe, expect, it } from 'vitest';
import {
  OPS_MATERIAL_ISSUE_KINDS,
  OPS_ONBOARDING_ITEM_KINDS,
  OPS_ONBOARDING_STATUSES,
} from '@elevate/database';
import {
  applicableTemplates,
  checklistToAdd,
  isOnboardingOverdue,
  itemStatus,
  latestStatus,
  MATERIAL_MOVES,
  materialMoveError,
  materialsSummary,
  netIssued,
  ONBOARDING_ITEM_KINDS,
  ONBOARDING_STATUSES,
  statusChangeError,
  type OnboardingTemplate,
} from '../../src/domain/onboarding';
import { checkMaskedReference } from '../../src/domain/kyc';
import type { IsoDate } from '../../src/domain/dates';

const tpl = (over: Partial<OnboardingTemplate> & Pick<OnboardingTemplate, 'code'>) => ({
  id: `${over.code}-v${over.version ?? 1}`,
  version: 1,
  programmeCodes: ['CLAT'],
  classCategory: null,
  status: 'active' as const,
  items: [{ key: 'id_card', label: 'ID card issued', kind: 'check' as const }],
  ...over,
});

const COMMON = tpl({
  code: 'common',
  programmeCodes: ['CLAT', 'CLASS_12', 'IPMAT'],
  items: [
    { key: 'id_card', label: 'ID card issued', kind: 'check', dueDays: 7 },
    { key: 'biometric', label: 'Biometric registration', kind: 'biometric', dueDays: 3 },
  ],
});
const CLAT = tpl({
  code: 'clat',
  items: [
    { key: 'clat_books', label: 'CLAT books', kind: 'material', catalogueCode: 'clat_books' },
    { key: 'id_card', label: 'ID card (CLAT copy)', kind: 'check' },
  ],
});
const CLASS_12 = tpl({
  code: 'class_12',
  programmeCodes: ['CLASS_12'],
  classCategory: 'class_12',
  items: [{ key: 'c12_books', label: 'Class 12 books', kind: 'material', catalogueCode: 'c12' }],
});

describe('vocabulary matches the schema', () => {
  it('statuses, item kinds and material moves', () => {
    expect(ONBOARDING_STATUSES).toEqual(OPS_ONBOARDING_STATUSES);
    expect(ONBOARDING_ITEM_KINDS).toEqual(OPS_ONBOARDING_ITEM_KINDS);
    expect(MATERIAL_MOVES).toEqual(OPS_MATERIAL_ISSUE_KINDS);
  });
});

describe('applicableTemplates / checklistToAdd', () => {
  const all = [COMMON, CLAT, CLASS_12];
  it.each([
    ['CLAT only', ['CLAT'], 'class_11', ['clat', 'common']],
    ['Class 12 + CLAT, class 12', ['CLASS_12', 'CLAT'], 'class_12', ['class_12', 'clat', 'common']],
    ['Class 12 programme but category not class_12', ['CLASS_12'], 'gap_year', ['common']],
    ['programme with no template', ['CUET'], null, []],
  ])('%s', (_, programmeCodes, classCategory, codes) => {
    expect(applicableTemplates(all, { programmeCodes, classCategory }).map((t) => t.code)).toEqual(
      codes,
    );
  });

  it('uses only the latest ACTIVE version of each code', () => {
    const v2 = tpl({ code: 'clat', version: 2, items: [] });
    const v3draft = tpl({ code: 'clat', version: 3, status: 'draft' });
    const found = applicableTemplates([CLAT, v2, v3draft], {
      programmeCodes: ['CLAT'],
      classCategory: null,
    });
    expect(found.map((t) => t.version)).toEqual([2]);
  });

  it('multi-programme: union of items, one row per key (first template by code wins), due from the start date', () => {
    const items = checklistToAdd(
      all,
      { programmeCodes: ['CLASS_12', 'CLAT'], classCategory: 'class_12' },
      [],
      '2026-11-01' as IsoDate,
    );
    expect(items.map((i) => [i.itemKey, i.templateId, i.dueDate])).toEqual([
      ['c12_books', 'class_12-v1', null],
      ['clat_books', 'clat-v1', null],
      ['id_card', 'clat-v1', null],
      ['biometric', 'common-v1', '2026-11-04'],
    ]);
  });

  it('per-programme material sets: only the student’s programmes, one set each', () => {
    const shared = tpl({
      code: 'shared',
      programmeCodes: ['CLAT', 'CLASS_12', 'IPMAT'],
      items: [
        { key: 'id_card', label: 'ID card', kind: 'check' },
        {
          key: 'clat_set',
          label: 'CLAT set',
          kind: 'material',
          programmeCode: 'CLAT',
          requiredQuantity: 4,
        },
        { key: 'c12_set', label: 'Class 12 set', kind: 'material', programmeCode: 'CLASS_12' },
        { key: 'ipmat_set', label: 'IPMAT set', kind: 'material', programmeCode: 'IPMAT' },
      ],
    });
    const items = checklistToAdd(
      [shared],
      { programmeCodes: ['CLAT', 'CLASS_12'], classCategory: null },
      [],
      '2026-11-01' as IsoDate,
    );
    expect(items.map((i) => i.itemKey)).toEqual(['id_card', 'clat_set', 'c12_set']);
  });

  it('never re-adds or rewrites keys already on the checklist (a template change is explicit)', () => {
    const v2 = tpl({
      code: 'clat',
      version: 2,
      items: [
        { key: 'clat_books', label: 'CLAT books (2nd ed.)', kind: 'material' },
        { key: 'mock_kit', label: 'Mock test kit', kind: 'material' },
      ],
    });
    const items = checklistToAdd(
      [CLAT, v2],
      { programmeCodes: ['CLAT'], classCategory: null },
      ['clat_books', 'id_card'],
      '2026-11-01' as IsoDate,
    );
    expect(items.map((i) => [i.itemKey, i.templateVersion])).toEqual([['mock_kit', 2]]);
  });
});

describe('item status (append-only, latest wins)', () => {
  const ev = (status: string, at: string) => ({ status, at: new Date(at) }) as never;
  it('latest by time; ties go to the later row; none = null', () => {
    expect(latestStatus([])).toBeNull();
    expect(
      latestStatus([
        ev('completed', '2026-10-03T10:00:00Z'),
        ev('in_progress', '2026-10-01T10:00:00Z'),
      ]),
    ).toBe('completed');
    expect(
      latestStatus([
        ev('blocked', '2026-10-03T10:00:00Z'),
        ev('not_applicable', '2026-10-03T10:00:00Z'),
      ]),
    ).toBe('not_applicable');
  });

  it.each([
    ['check, no events', 'check', [], 0, 'not_started'],
    [
      'check, latest wins',
      'check',
      [ev('blocked', '2026-10-01'), ev('completed', '2026-10-02')],
      0,
      'completed',
    ],
    ['material, nothing issued', 'material', [], 0, 'not_started'],
    ['material, fully issued', 'material', [], 1, 'completed'],
    ['material, 2 of 3 books issued (one book is not all)', 'material', [], 2, 'in_progress', 3],
    ['material, 3 of 3 books issued', 'material', [], 3, 'completed', 3],
    [
      'material, started, nothing issued yet',
      'material',
      [ev('in_progress', '2026-10-01')],
      0,
      'in_progress',
    ],
    [
      'material, not applicable overrides',
      'material',
      [ev('not_applicable', '2026-10-01')],
      1,
      'not_applicable',
    ],
    ['material, blocked overrides', 'material', [ev('blocked', '2026-10-01')], 0, 'blocked'],
  ])('%s', (_, kind, events, net, expected, required = 1) => {
    expect(itemStatus(kind as never, events as never, net, required)).toBe(expected);
  });

  it.each([
    ['material completed by hand without issue', 'material', 'completed', 0, 1, null, true],
    ['material completed with 1 of 2 issued', 'material', 'completed', 1, 2, null, true],
    ['material completed after full issue', 'material', 'completed', 2, 2, null, false],
    ['check completed', 'check', 'completed', 0, 1, null, false],
    ['biometric completed without a reference', 'biometric', 'completed', 0, 1, null, true],
    ['biometric completed with a reference', 'biometric', 'completed', 0, 1, 'BIO-42', false],
    ['biometric in progress without a reference', 'biometric', 'in_progress', 0, 1, null, false],
  ])('statusChangeError: %s', (_, kind, status, net, required, ref, refused) => {
    expect(Boolean(statusChangeError(kind as never, status as never, net, required, ref))).toBe(
      refused,
    );
  });
});

describe('materials (one book is not all materials)', () => {
  const m = (kind: string, quantity: number) => ({ kind, quantity }) as never;
  it.each([
    ['nothing', [], 0],
    ['issue 1', [m('issue', 1)], 1],
    ['issue then return', [m('issue', 1), m('return', 1)], 0],
    ['issue, return, issue again', [m('issue', 1), m('return', 1), m('issue', 1)], 1],
    ['replacement keeps the count', [m('issue', 2), m('replacement', 1)], 2],
  ])('netIssued: %s', (_, moves, net) => {
    expect(netIssued(moves as never)).toBe(net);
  });

  it.each([
    ['return more than issued', 'return', 2, 1, true],
    ['replace what was never issued', 'replacement', 1, 0, true],
    ['return what was issued', 'return', 1, 1, false],
    ['issue', 'issue', 3, 0, false],
  ])('materialMoveError: %s', (_, kind, qty, net, refused) => {
    expect(Boolean(materialMoveError(kind as never, qty, net))).toBe(refused);
  });

  it('partial: two sets required, one issued → incomplete; not-applicable sets are not required', () => {
    const set = (status: string) => ({ kind: 'material', status }) as never;
    expect(materialsSummary([set('completed'), set('not_started')])).toEqual({
      required: 2,
      issued: 1,
      complete: false,
    });
    expect(materialsSummary([set('completed'), set('not_applicable')])).toEqual({
      required: 1,
      issued: 1,
      complete: true,
    });
    expect(materialsSummary([{ kind: 'check', status: 'completed' } as never])).toEqual({
      required: 0,
      issued: 0,
      complete: null,
    });
  });
});

describe('isOnboardingOverdue (overview KPI)', () => {
  it.each([
    ['due yesterday, open', '2026-10-20', 'in_progress', true],
    ['due yesterday, blocked', '2026-10-20', 'blocked', true],
    ['due today', '2026-10-21', 'not_started', false],
    ['due yesterday, completed', '2026-10-20', 'completed', false],
    ['due yesterday, not applicable', '2026-10-20', 'not_applicable', false],
    ['no due date', null, 'not_started', false],
  ])('%s', (_, dueDate, status, overdue) => {
    expect(isOnboardingOverdue({ dueDate, status } as never, '2026-10-21' as IsoDate)).toBe(
      overdue,
    );
  });
});

describe('checkMaskedReference (identity documents: masked only)', () => {
  it.each([
    ['XXXX-XXXX-1234', null],
    ['xxxxx1234f', null],
    ['****5678', null],
    ['123456789012', 'full'],
    ['1234 5678 9012', 'full'],
    ['ABCDE1234F', 'mask'],
    ['XXXX12345', 'full'],
    ['X', 'length'],
  ])('%s', (value, problem) => {
    const r = checkMaskedReference(value);
    expect(r === null ? null : r.reason).toBe(problem);
  });
});
