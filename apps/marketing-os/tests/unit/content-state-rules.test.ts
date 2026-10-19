import { describe, expect, it } from 'vitest';
import {
  CONTENT_ACTIONS,
  CONTENT_STATES,
  allowedContentActions,
  checkContentRules,
  editEffect,
  evaluateApprovalEligibility,
  parseRuleMatcher,
  transitionContent,
  type ContentRule,
  type RuleCheckInput,
} from '../../src/domain';
import { legacy } from '../helpers';

describe('content state machine', () => {
  it('follows the happy path and the changes loop', () => {
    const path: [string, string, string][] = [
      ['draft', 'submit', 'in_review'],
      ['in_review', 'request_changes', 'changes_requested'],
      ['changes_requested', 'submit', 'in_review'],
      ['in_review', 'approve', 'approved'],
      ['approved', 'schedule', 'scheduled'],
      ['scheduled', 'publish', 'published'],
      ['published', 'archive', 'archived'],
    ];
    for (const [from, action, to] of path) {
      expect(transitionContent(from as never, action as never)).toMatchObject({ ok: true, to });
    }
  });
  it('supports withdraw, unschedule and revise-after-approval', () => {
    expect(transitionContent('in_review', 'withdraw')).toMatchObject({ ok: true, to: 'draft' });
    expect(transitionContent('scheduled', 'unschedule')).toMatchObject({
      ok: true,
      to: 'approved',
    });
    expect(transitionContent('scheduled', 'revise')).toMatchObject({ ok: true, to: 'in_review' });
  });
  it('rejects illegal transitions with a reason', () => {
    const r = transitionContent('draft', 'approve');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowed from: in_review/);
    expect(transitionContent('draft', 'publish').ok).toBe(false);
    expect(transitionContent('in_review', 'schedule').ok).toBe(false);
    expect(transitionContent('archived', 'submit').ok).toBe(false);
  });
  it('archived is terminal; every state has a defined set of actions', () => {
    expect(allowedContentActions('archived')).toEqual([]);
    for (const s of CONTENT_STATES)
      for (const a of allowedContentActions(s)) expect(CONTENT_ACTIONS).toContain(a);
  });
  it('defines what an edit does in each state', () => {
    expect(editEffect('draft')).toBe('edit');
    expect(editEffect('approved')).toBe('revise');
    expect(editEffect('in_review')).toBe('blocked');
    expect(editEffect('published')).toBe('blocked');
  });
});

const rules: ContentRule[] = legacy.rules.records.map((r) => ({
  code: r.id,
  kind: r.kind as ContentRule['kind'],
  description: r.description,
  matcher: parseRuleMatcher(r.matcher),
  manualCheck: r.manual_check,
  actionOnMatch: r.action_on_match,
  appliesTo: r.applies_to,
  status: r.status as ContentRule['status'],
}));

const input = (over: Partial<RuleCheckInput>): RuleCheckInput => ({
  title: 'Fictional title',
  body: '',
  format: 'post',
  accountCodes: ['IGC'],
  showsStudents: false,
  consentReference: null,
  assets: [],
  ...over,
});

describe('brand-rule checker', () => {
  it('blocks on block-action banned phrases and lists the match', () => {
    const r = checkContentRules(
      input({ body: 'Join the coaching with 100% results and our toppers.' }),
      rules,
    );
    const cr006 = r.blocking.find((b) => b.ruleCode === 'CR-006')!;
    expect(cr006.matches.length).toBeGreaterThan(0);
  });
  it('turns flag-for-review matches into checklist items, not blocks', () => {
    const r = checkContentRules(
      input({ body: 'Prepare after 12th? No — start in Class 11.' }),
      rules,
    );
    expect(r.blocking).toEqual([]);
    expect(r.review.map((f) => f.ruleCode)).toContain('CR-001');
    expect(r.checklist.find((c) => c.ruleCode === 'CR-001')!.reason).toBe('flagged_for_review');
  });
  it('applies account-specific rules only to those accounts (Sikar allowed on IGS)', () => {
    const text = { body: 'A day at the Sikar centre.' };
    expect(
      checkContentRules(input({ ...text, accountCodes: ['IGC'] }), rules).blocking.map(
        (b) => b.ruleCode,
      ),
    ).toContain('CR-005');
    expect(
      checkContentRules(input({ ...text, accountCodes: ['IGS'] }), rules).blocking.map(
        (b) => b.ruleCode,
      ),
    ).not.toContain('CR-005');
  });
  it('uses every account (strictest) when there are no placements yet', () => {
    const r = checkContentRules(input({ body: '#tips', accountCodes: [] }), rules);
    expect(r.assumedAllAccounts).toBe(true);
    expect(r.blocking.map((b) => b.ruleCode)).toContain('CH-001'); // LI hashtag rule
  });
  it('flags a YouTube title that misses the expected pattern (flag_if_no_match)', () => {
    expect(
      checkContentRules(input({ title: 'Exam tips', accountCodes: ['YTC'] }), rules).review.map(
        (f) => f.ruleCode,
      ),
    ).toContain('CH-009');
    expect(
      checkContentRules(
        input({ title: 'CLAT 2027 tips', accountCodes: ['YTC'] }),
        rules,
      ).review.map((f) => f.ruleCode),
    ).not.toContain('CH-009');
  });
  it('makes manual checks into a checklist and skips schedule limits', () => {
    const r = checkContentRules(input({ accountCodes: ['LI'] }), rules);
    expect(r.checklist.map((c) => c.ruleCode)).toEqual(
      expect.arrayContaining(['AP-001', 'CO-001', 'CH-004']),
    );
    expect(r.skipped.map((s) => s.ruleCode)).toContain('CH-005');
  });
  it('enforces consent for students on camera (configurable) and pending rights', () => {
    const shows = input({ showsStudents: true });
    expect(checkContentRules(shows, rules).blocking.map((b) => b.ruleCode)).toContain(
      'SYS-CONSENT',
    );
    expect(
      checkContentRules({ ...shows, consentReference: 'Form 12 (fictional)' }, rules).blocking,
    ).toEqual([]);
    expect(
      checkContentRules(shows, rules, { consentRequiredForStudents: false }).review.map(
        (f) => f.ruleCode,
      ),
    ).toContain('SYS-CONSENT');
    const rights = input({
      assets: [{ fileName: 'clip.mp4', showsStudents: false, rightsState: 'third_party_pending' }],
    });
    expect(checkContentRules(rights, rules).blocking.map((b) => b.ruleCode)).toContain(
      'SYS-RIGHTS',
    );
  });
  it('ignores retired rules and reports broken patterns instead of crashing', () => {
    const broken: ContentRule = {
      ...rules[0]!,
      code: 'T-1',
      matcher: { type: 'regex', pattern: '(', field: 'text' },
      manualCheck: false,
    };
    const retired: ContentRule = { ...rules.find((r) => r.code === 'CR-006')!, status: 'retired' };
    const r = checkContentRules(input({ body: 'our toppers' }), [broken, retired]);
    expect(r.skipped[0]!.ruleCode).toBe('T-1');
    expect(r.blocking).toEqual([]);
  });
  it('approval eligibility needs no blocks and every checklist acknowledgement', () => {
    const clean = checkContentRules(input({ body: 'A fictional explainer.' }), rules);
    const codes = clean.checklist.map((c) => c.ruleCode);
    expect(evaluateApprovalEligibility(clean, codes).eligible).toBe(true);
    const missing = evaluateApprovalEligibility(clean, codes.slice(1));
    expect(missing.eligible).toBe(false);
    expect(missing.missingAcknowledgements).toEqual([codes[0]]);
    expect(
      evaluateApprovalEligibility(clean, [...codes, 'NOPE']).unexpectedAcknowledgements,
    ).toEqual(['NOPE']);
    const blocked = checkContentRules(input({ body: 'our toppers' }), rules);
    expect(
      evaluateApprovalEligibility(
        blocked,
        blocked.checklist.map((c) => c.ruleCode),
      ).eligible,
    ).toBe(false);
  });
  it('parses matchers defensively', () => {
    expect(parseRuleMatcher(null)).toBeNull();
    expect(parseRuleMatcher({ type: 'weird' })).toBeNull();
    expect(parseRuleMatcher({ type: 'literal', pattern: '(confirm)' })).toMatchObject({
      type: 'literal',
      field: 'text',
    });
  });
});
