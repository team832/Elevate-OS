import { describe, expect, it } from 'vitest';
import {
  checkIncidentTransition,
  checkReportingLine,
  formatCode,
  incidentNeedsAuthorisedApproval,
  nextSopStatus,
  nextVersionLabel,
  parseCodeNumber,
  resolveSettings,
  responsibilityGaps,
  riskFlags,
  riskSeverity,
  SETTING_DEFINITIONS,
  sopApprovalProblems,
  sopDecisionState,
  sopSubmissionProblems,
  validateSettingChange,
  type SopApprovalContext,
} from '../../src/domain';

describe('SOP approval requirement rules (A-11)', () => {
  const ok: SopApprovalContext = {
    versionStatus: 'in_review',
    ownerStaffId: 'owner',
    ownerUserId: 'u-owner',
    reviewerStaffId: 'rev',
    reviewerUserId: 'u-rev',
    review: { byUserId: 'u-rev', outcome: 'recommend_approval' },
    deciderUserId: 'u-director',
    submittedHash: 'h1',
    currentHash: 'h1',
  };
  it('normal: reviewed by the assigned reviewer, decided by someone else → no problems', () => {
    expect(sopApprovalProblems(ok)).toEqual([]);
  });
  it('the owner cannot approve their own SOP', () => {
    expect(sopApprovalProblems({ ...ok, deciderUserId: 'u-owner' })).toEqual(['approver_is_owner']);
  });
  it('a reviewer is required, must differ from the owner, and must have recommended it', () => {
    expect(sopApprovalProblems({ ...ok, reviewerStaffId: null, reviewerUserId: null })).toEqual(
      expect.arrayContaining(['reviewer_missing', 'review_not_by_reviewer']),
    );
    expect(sopApprovalProblems({ ...ok, reviewerStaffId: 'owner' })).toContain('reviewer_is_owner');
    expect(sopApprovalProblems({ ...ok, review: null })).toEqual(['review_missing']);
    expect(
      sopApprovalProblems({
        ...ok,
        review: { byUserId: 'u-other', outcome: 'recommend_approval' },
      }),
    ).toEqual(['review_not_by_reviewer']);
    expect(
      sopApprovalProblems({ ...ok, review: { byUserId: 'u-rev', outcome: 'changes_requested' } }),
    ).toEqual(['review_requested_changes']);
  });
  it('content changed after submission or version not in review', () => {
    expect(sopApprovalProblems({ ...ok, currentHash: 'h2' })).toEqual([
      'content_changed_since_submission',
    ]);
    expect(sopApprovalProblems({ ...ok, versionStatus: 'draft' })).toEqual([
      'version_not_in_review',
    ]);
  });
  it('submission rules', () => {
    expect(
      sopSubmissionProblems({ ownerStaffId: 'a', reviewerStaffId: 'b', contentLength: 10 }),
    ).toEqual([]);
    expect(
      sopSubmissionProblems({ ownerStaffId: null, reviewerStaffId: null, contentLength: 0 }),
    ).toEqual(['owner_missing', 'reviewer_missing', 'content_empty']);
    expect(
      sopSubmissionProblems({ ownerStaffId: 'a', reviewerStaffId: 'a', contentLength: 1 }),
    ).toEqual(['reviewer_is_owner']);
  });
  it('status machine keeps an approved SOP in force while a new draft is reviewed', () => {
    expect(nextSopStatus('draft', 'submit', { hasApprovedVersion: false })).toEqual({
      ok: true,
      status: 'in_review',
    });
    expect(nextSopStatus('approved', 'start_draft', { hasApprovedVersion: true })).toEqual({
      ok: true,
      status: 'approved',
    });
    expect(nextSopStatus('approved', 'submit', { hasApprovedVersion: true })).toEqual({
      ok: true,
      status: 'approved',
    });
    expect(nextSopStatus('in_review', 'reject', { hasApprovedVersion: false })).toEqual({
      ok: true,
      status: 'draft',
    });
    expect(nextSopStatus('not_drafted', 'submit', { hasApprovedVersion: false }).ok).toBe(false);
    expect(nextSopStatus('retired', 'start_draft', { hasApprovedVersion: true }).ok).toBe(false);
    expect(nextSopStatus('retired', 'retire', { hasApprovedVersion: true }).ok).toBe(false);
  });
  it('proposed vs approved is explicit', () => {
    expect(sopDecisionState('draft')).toBe('proposed');
    expect(sopDecisionState('not_drafted')).toBe('proposed');
    expect(sopDecisionState('in_review')).toBe('proposed');
    expect(sopDecisionState('approved')).toBe('approved');
  });
  it('version labels', () => {
    expect(nextVersionLabel([], false)).toBe('0.1');
    expect(nextVersionLabel(['0.1', '0.2'], false)).toBe('0.3');
    expect(nextVersionLabel(['0.1', '0.2'], true)).toBe('1.0');
    expect(nextVersionLabel(['0.1', '1.0'], true)).toBe('2.0');
  });
});

describe('staff rules (A-10)', () => {
  const manager: Record<string, string | null> = { a: 'b', b: 'c', c: null };
  const of = (id: string) => manager[id];
  it('rejects self-management and reporting loops; accepts a valid line', () => {
    expect(checkReportingLine('c', 'a', of)).toMatchObject({
      ok: false,
      path: ['c', 'a', 'b', 'c'],
    });
    expect(checkReportingLine('a', 'a', of).ok).toBe(false);
    expect(checkReportingLine('d', 'a', of)).toEqual({ ok: true });
    expect(checkReportingLine('a', null, of)).toEqual({ ok: true });
  });
  it('responsibility gap report (OPS-015), critical first', () => {
    const active = (id: string) => id !== 'gone';
    const gaps = responsibilityGaps(
      [
        {
          code: 'R2',
          title: 'b',
          holderStaffId: null,
          backupStaffId: null,
          critical: false,
          status: 'active',
        },
        {
          code: 'R1',
          title: 'a',
          holderStaffId: 'x',
          backupStaffId: 'x',
          critical: true,
          status: 'active',
        },
        {
          code: 'R3',
          title: 'c',
          holderStaffId: 'x',
          backupStaffId: 'y',
          critical: true,
          status: 'active',
        },
        {
          code: 'R4',
          title: 'd',
          holderStaffId: 'gone',
          backupStaffId: 'y',
          critical: false,
          status: 'active',
        },
        {
          code: 'R5',
          title: 'e',
          holderStaffId: null,
          backupStaffId: null,
          critical: false,
          status: 'retired',
        },
      ],
      active,
    );
    expect(gaps.map((g) => [g.code, g.gaps])).toEqual([
      ['R1', ['holder_is_backup']],
      ['R2', ['no_holder', 'no_backup']],
      ['R4', ['holder_inactive']],
    ]);
  });
});

describe('settings / policy register (OPS-022)', () => {
  it('defaults carry their decision states; demo fee is NOT approved policy', () => {
    const s = resolveSettings([]);
    expect(s['demo.terms']).toMatchObject({ decisionState: 'approved', value: { days: 2 } });
    expect(s['demo.fee']).toMatchObject({
      decisionState: 'pending_verification',
      ownerDecision: 'OD-013',
      value: { amountInr: 1000 },
    });
    expect(s['demo.limits']).toMatchObject({
      decisionState: 'open',
      ownerDecision: 'OD-012',
      value: { maxConsecutiveDays: null },
    });
    expect(s['pipeline.demo_skip'].decisionState).toBe('proposed');
    expect(s['tasks.escalation'].decisionState).toBe('proposed');
  });
  it('stored values override; invalid stored values fall back to defaults', () => {
    const s = resolveSettings([
      {
        key: 'pipeline.demo_skip',
        value: { allowed: false },
        decisionState: 'proposed',
        source: null,
        ownerDecision: null,
      },
      {
        key: 'tasks.escalation',
        value: { overdueDaysL2: 'soon' },
        decisionState: 'proposed',
        source: null,
        ownerDecision: null,
      },
    ]);
    expect(s['pipeline.demo_skip']).toMatchObject({ value: { allowed: false }, origin: 'stored' });
    expect(s['tasks.escalation']).toMatchObject({
      origin: 'invalid_stored',
      value: SETTING_DEFINITIONS['tasks.escalation'].defaultValue,
    });
  });
  it('changes are validated, stay proposed, and legacy-approved records are read-only', () => {
    expect(validateSettingChange('demo.terms', { days: 3 })).toMatchObject({ ok: false });
    expect(validateSettingChange('nope', {})).toMatchObject({ ok: false });
    expect(
      validateSettingChange('tasks.escalation', {
        overdueDaysL2: 5,
        overdueDaysL3: 3,
        overdueDaysL4: 10,
        blockedDaysL2: 3,
        responseDays: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(validateSettingChange('demo.fee', { amountInr: 1500 })).toEqual({
      ok: true,
      key: 'demo.fee',
      value: { amountInr: 1500 },
      decisionState: 'proposed',
    });
  });
});

describe('registers', () => {
  it('codes are padded, parsed, and legacy codes never parse as new codes', () => {
    expect(formatCode('lead', 7)).toBe('LEAD-000007');
    expect(formatCode('task', 12)).toBe('TSK-00012');
    expect(parseCodeNumber('decision', 'DEC-0042')).toBe(42);
    expect(parseCodeNumber('decision', 'LEGACY-OPSWB-D-003')).toBeNull();
    expect(() => formatCode('sop', 0)).toThrow();
  });
  it('risk severity and flags', () => {
    expect(riskSeverity('low', 'high')).toBe('high');
    expect(riskSeverity(null, 'high')).toBe('unrated');
    expect(
      riskFlags({ status: 'open', likelihood: 'high', impact: 'medium', ownerStaffId: null }),
    ).toEqual(['high_severity', 'no_owner']);
    expect(
      riskFlags({ status: 'closed', likelihood: 'high', impact: 'high', ownerStaffId: null }),
    ).toEqual([]);
  });
  it('incident rules', () => {
    expect(incidentNeedsAuthorisedApproval('fee_waiver')).toBe(true);
    expect(incidentNeedsAuthorisedApproval('class_disruption')).toBe(false);
    expect(checkIncidentTransition('open', 'resolved', '')).toMatchObject({ ok: false });
    expect(checkIncidentTransition('open', 'resolved', 'Fixed')).toEqual({ ok: true });
    expect(checkIncidentTransition('closed', 'open', 'x')).toMatchObject({ ok: false });
  });
});
