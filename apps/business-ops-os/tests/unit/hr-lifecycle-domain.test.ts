import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@elevate/shared-types';
import {
  anonymisationEligibility,
  APPLICATION_STAGES,
  applicationTargets,
  checkApplicationTransition,
  checkOfferTransition,
  checkRequisitionTransition,
  feedbackAllowed,
  pipelineByStage,
  retentionStatus,
  type ApplicationStage,
} from '../../src/domain/hr/recruitment';
import {
  checkItemUpdate,
  checkSeparationDates,
  completionGaps,
  generateOffboardingItems,
  generateOnboardingItems,
  isItemOverdue,
  separationDue,
} from '../../src/domain/hr/lifecycle';
import {
  resolveSettings,
  SETTING_DEFINITIONS,
  validateSettingChange,
} from '../../src/domain/policies';

const d = (s: string) => s as IsoDate;

type Ctx = { canDecide: boolean; reason?: string; viaConversion?: boolean };
const DEC: Ctx = { canDecide: true };
const MAN: Ctx = { canDecide: false };
const result = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);

describe('state machines (HL-A1)', () => {
  it.each([
    ['draft', 'open', { ...MAN, actorIsRequester: false }, 'NOT_AUTHORISED'],
    ['draft', 'open', { ...DEC, actorIsRequester: true }, 'SELF_APPROVAL'],
    ['draft', 'open', { ...DEC, actorIsRequester: false }, 'ok'],
    ['draft', 'filled', { ...DEC, actorIsRequester: false }, 'ILLEGAL'],
    ['open', 'on_hold', { ...DEC, actorIsRequester: false }, 'REASON_REQUIRED'],
    ['open', 'on_hold', { ...MAN, actorIsRequester: false, reason: 'Budget' }, 'ok'],
    ['open', 'cancelled', { ...MAN, actorIsRequester: false, reason: 'x' }, 'NOT_AUTHORISED'],
    ['filled', 'open', { ...DEC, actorIsRequester: false }, 'ILLEGAL'],
  ] as const)('requisition %s → %s', (from, to, ctx, expected) => {
    expect(result(checkRequisitionTransition(from, to, ctx))).toBe(expected);
  });

  it.each([
    ['applied', 'screening', MAN, 'ok'],
    ['screening', 'interview', MAN, 'ok'],
    ['interview', 'offer', MAN, 'NOT_AUTHORISED'],
    ['interview', 'offer', DEC, 'ok'],
    ['offer', 'hired', DEC, 'NOT_AUTHORISED'],
    ['offer', 'hired', { ...DEC, viaConversion: true }, 'ok'],
    ['applied', 'offer', DEC, 'ILLEGAL'],
    ['screening', 'withdrawn', MAN, 'REASON_REQUIRED'],
    ['screening', 'rejected', { ...MAN, reason: 'x' }, 'NOT_AUTHORISED'],
    ['offer', 'rejected', { ...DEC, reason: 'Another candidate' }, 'ok'],
    ['interview', 'interview', DEC, 'NO_CHANGE'],
  ] as const)('application %s → %s', (from, to, ctx, expected) => {
    expect(result(checkApplicationTransition(from, to, ctx))).toBe(expected);
  });

  it('closed applications are final; hire is never offered as a button', () => {
    for (const from of ['hired', 'rejected', 'withdrawn'] as ApplicationStage[])
      for (const to of APPLICATION_STAGES)
        expect(
          checkApplicationTransition(from, to, { ...DEC, reason: 'x', viaConversion: true }).ok,
        ).toBe(false);
    expect(applicationTargets('offer', true)).not.toContain('hired');
    expect(applicationTargets('screening', false)).toEqual(['interview', 'withdrawn']);
    expect(applicationTargets('screening', true)).toEqual(['interview', 'rejected', 'withdrawn']);
  });

  it.each([
    ['draft', 'approved', { ...DEC, actorIsPreparer: true }, 'SELF_APPROVAL'],
    ['draft', 'approved', { ...DEC, actorIsPreparer: false }, 'ok'],
    ['draft', 'extended', { ...DEC, actorIsPreparer: false }, 'ILLEGAL'],
    ['approved', 'extended', { ...MAN, actorIsPreparer: true }, 'ok'],
    ['extended', 'accepted', { ...MAN, actorIsPreparer: true }, 'ok'],
    ['extended', 'declined', { ...MAN, actorIsPreparer: true }, 'REASON_REQUIRED'],
    ['accepted', 'withdrawn', { ...DEC, actorIsPreparer: false, reason: 'x' }, 'ILLEGAL'],
  ] as const)('offer %s → %s', (from, to, ctx, expected) => {
    expect(result(checkOfferTransition(from, to, ctx))).toBe(expected);
  });
});

describe('interview feedback rule (HL-A3)', () => {
  it('only an assigned interviewer on a live interview of an open application', () => {
    const base = {
      panelStaffIds: ['a', 'b'],
      interviewStatus: 'scheduled' as const,
      applicationStage: 'interview' as const,
    };
    expect(feedbackAllowed({ ...base, actorStaffId: 'a' }).ok).toBe(true);
    expect(feedbackAllowed({ ...base, actorStaffId: 'c' }).ok).toBe(false);
    expect(feedbackAllowed({ ...base, actorStaffId: null }).ok).toBe(false);
    expect(feedbackAllowed({ ...base, actorStaffId: 'a', interviewStatus: 'cancelled' }).ok).toBe(
      false,
    );
    expect(feedbackAllowed({ ...base, actorStaffId: 'a', applicationStage: 'rejected' }).ok).toBe(
      false,
    );
  });
});

describe('data minimisation (HL-A4)', () => {
  it('eligible only when every application closed unsuccessfully and no live offer', () => {
    expect(
      anonymisationEligibility({
        status: 'active',
        stages: ['rejected', 'withdrawn'],
        hasLiveOffer: false,
      }).ok,
    ).toBe(true);
    expect(anonymisationEligibility({ status: 'active', stages: [], hasLiveOffer: false }).ok).toBe(
      false,
    );
    expect(
      anonymisationEligibility({
        status: 'active',
        stages: ['rejected', 'interview'],
        hasLiveOffer: false,
      }).ok,
    ).toBe(false);
    expect(
      anonymisationEligibility({ status: 'active', stages: ['hired'], hasLiveOffer: false }).ok,
    ).toBe(false);
    expect(
      anonymisationEligibility({ status: 'anonymised', stages: ['rejected'], hasLiveOffer: false })
        .ok,
    ).toBe(false);
    expect(
      anonymisationEligibility({ status: 'active', stages: ['rejected'], hasLiveOffer: true }).ok,
    ).toBe(false);
  });
  it('retention is never "due" while the owner has not decided a period', () => {
    expect(retentionStatus(d('2020-01-01'), null, d('2026-10-19'))).toBe('not_decided');
    expect(retentionStatus(d('2026-01-01'), 180, d('2026-10-19'))).toBe('due');
    expect(retentionStatus(d('2026-10-01'), 180, d('2026-10-19'))).toBe('not_due');
    expect(retentionStatus(null, 180, d('2026-10-19'))).toBe('not_closed');
  });
  it('the retention setting is open and the templates are proposed', () => {
    const s = resolveSettings([]);
    expect(s['hr.candidate_retention'].decisionState).toBe('open');
    expect(s['hr.candidate_retention'].value.retainUnsuccessfulDays).toBeNull();
    expect(s['hr.onboarding_template'].decisionState).toBe('proposed');
    expect(s['hr.offboarding_checklist'].decisionState).toBe('proposed');
    expect(validateSettingChange('hr.candidate_retention', { retainUnsuccessfulDays: 5 }).ok).toBe(
      false,
    );
    expect(
      validateSettingChange('hr.candidate_retention', { retainUnsuccessfulDays: 365 }).ok,
    ).toBe(true);
  });
});

describe('pipeline counts', () => {
  it('counts every stage, zeros included', () => {
    const c = pipelineByStage(['applied', 'applied', 'hired']);
    expect(c.applied).toBe(2);
    expect(c.hired).toBe(1);
    expect(c.offer).toBe(0);
  });
});

describe('checklists (HL-A5, HL-A6)', () => {
  it('onboarding items come from the template with due offsets', () => {
    const items = generateOnboardingItems(
      SETTING_DEFINITIONS['hr.onboarding_template'].defaultValue,
      d('2026-11-02'),
    );
    expect(items.map((i) => i.itemKey)).toContain('template:system_access');
    expect(items.find((i) => i.kind === 'induction')?.dueDate).toBe('2026-11-09');
    expect(items.every((i) => i.itemKey.startsWith('template:'))).toBe(true);
  });
  it('offboarding: one return per open assignment, one transfer per owned record, access + settlement', () => {
    const items = generateOffboardingItems({
      lastWorkingDay: d('2026-10-30'),
      openAssignments: [
        { id: 'a1', assetCode: 'AST-00001', assetName: 'Laptop' },
        { id: 'a2', assetCode: 'AST-00002', assetName: 'Phone' },
      ],
      ownedWork: [{ type: 'task', id: 't1', label: 'TSK-00001 Prepare timetable' }],
      config: { exitInterview: false, finalSettlementRequired: true, transferDueDaysBeforeLwd: 2 },
    });
    expect(items.filter((i) => i.kind === 'asset_return')).toHaveLength(2);
    expect(items.find((i) => i.kind === 'ownership_transfer')?.dueDate).toBe('2026-10-28');
    expect(items.find((i) => i.kind === 'access_revocation')?.dueDate).toBe('2026-10-31');
    expect(items.some((i) => i.kind === 'exit_interview')).toBe(false);
    expect(new Set(items.map((i) => i.itemKey)).size).toBe(items.length);
  });
});

describe('item rules and gating (HL-A7, HL-A8)', () => {
  it('system items cannot be marked done by hand; n/a and blocked need a note', () => {
    expect(checkItemUpdate({ kind: 'asset_return', from: 'pending', to: 'done' }).ok).toBe(false);
    expect(checkItemUpdate({ kind: 'access_revocation', from: 'pending', to: 'done' }).ok).toBe(
      false,
    );
    expect(checkItemUpdate({ kind: 'ownership_transfer', from: 'pending', to: 'done' }).ok).toBe(
      false,
    );
    expect(checkItemUpdate({ kind: 'document', from: 'pending', to: 'not_applicable' }).ok).toBe(
      false,
    );
    expect(
      checkItemUpdate({
        kind: 'document',
        from: 'pending',
        to: 'not_applicable',
        notes: 'Not needed',
      }).ok,
    ).toBe(true);
    expect(checkItemUpdate({ kind: 'final_settlement', from: 'pending', to: 'done' }).ok).toBe(
      false,
    );
    expect(
      checkItemUpdate({
        kind: 'final_settlement',
        from: 'pending',
        to: 'done',
        evidence: 'FS-REF-1',
      }).ok,
    ).toBe(true);
    expect(checkItemUpdate({ kind: 'induction', from: 'pending', to: 'done' }).ok).toBe(true);
  });
  it('gaps list unresolved required items; offboarding ignores access revocation', () => {
    const items = [
      { title: 'Docs', kind: 'document' as const, required: true, status: 'done' as const },
      { title: 'Optional', kind: 'custom' as const, required: false, status: 'pending' as const },
      {
        title: 'Access',
        kind: 'access_revocation' as const,
        required: true,
        status: 'pending' as const,
      },
      {
        title: 'Induction',
        kind: 'induction' as const,
        required: true,
        status: 'blocked' as const,
      },
    ];
    expect(completionGaps('onboarding', items)).toEqual(['Access', 'Induction']);
    expect(completionGaps('offboarding', items)).toEqual(['Induction']);
  });
  it('separation is due the day after the last working day; overdue excludes resolved items', () => {
    expect(separationDue(d('2026-10-19'), d('2026-10-19'))).toBe(false);
    expect(separationDue(d('2026-10-19'), d('2026-10-20'))).toBe(true);
    expect(isItemOverdue({ status: 'pending', dueDate: d('2026-10-18') }, d('2026-10-19'))).toBe(
      true,
    );
    expect(isItemOverdue({ status: 'done', dueDate: d('2026-10-18') }, d('2026-10-19'))).toBe(
      false,
    );
    expect(isItemOverdue({ status: 'pending', dueDate: null }, d('2026-10-19'))).toBe(false);
    expect(checkSeparationDates(d('2026-10-20'), d('2026-10-19')).ok).toBe(false);
  });
});
