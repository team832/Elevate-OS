import { describe, expect, it } from 'vitest';
import {
  checkVerifierSeparation,
  evaluateAdmissionReadiness,
  followUpDueState,
  followUpFlags,
  istToday,
  istWeekContaining,
  nextServiceDay,
  proposeFollowUp,
  selectReminders,
  type CheckState,
  type DueRules,
  type IsoDate,
} from '../../src/domain';

const done = (itemKey: CheckState['itemKey'], recordedBy = 'u1'): CheckState => ({
  itemKey,
  status: 'done',
  recordedBy,
});
const allDone: CheckState[] = [
  done('documents_verified'),
  done('fee_verification_1', 'u1'),
  done('fee_verification_2', 'u2'),
];
const F = 'final_confirmation';

describe('admission readiness (A-04)', () => {
  it('normal: everything recorded and approved → only the password-confirmed approval is left (D-041)', () => {
    expect(
      evaluateAdmissionReadiness({ checks: allDone, feeApproval: 'approved', hasProgramme: true }),
    ).toEqual([F]);
  });

  it('missing: nothing recorded lists every gap in a fixed order', () => {
    expect(
      evaluateAdmissionReadiness({ checks: [], feeApproval: 'none', hasProgramme: false }),
    ).toEqual([
      'programme_missing',
      'documents_verified',
      'fee_verification_1',
      'fee_verification_2',
      'fee_arrangement_approval',
      F,
    ]);
  });

  it('conflicting: both fee verifications by the same person are not enough (BR-OPS-7)', () => {
    const same = allDone.map((c) =>
      c.itemKey === 'fee_verification_2' ? { ...c, recordedBy: 'u1' } : c,
    );
    expect(
      evaluateAdmissionReadiness({ checks: same, feeApproval: 'approved', hasProgramme: true }),
    ).toEqual(['fee_verifiers_not_distinct', F]);
  });

  it('a pending or rejected approval is not an approval', () => {
    for (const state of ['pending', 'rejected', 'withdrawn'] as const)
      expect(
        evaluateAdmissionReadiness({ checks: allDone, feeApproval: state, hasProgramme: true }),
      ).toEqual(['fee_arrangement_approval', F]);
  });

  it('BR-OPS-6 parts are configurable (proposed); BR-OPS-7 parts are not', () => {
    const minimal = [done('fee_verification_1', 'a'), done('fee_verification_2', 'b')];
    expect(
      evaluateAdmissionReadiness({
        checks: minimal,
        feeApproval: 'approved',
        hasProgramme: true,
        config: { requireDocuments: false },
      }),
    ).toEqual([F]);
    expect(
      evaluateAdmissionReadiness({
        checks: minimal,
        feeApproval: 'none',
        hasProgramme: true,
        config: { requireDocuments: false },
      }),
    ).toEqual(['fee_arrangement_approval', F]);
  });

  it('not_done / not_applicable items do not count as done', () => {
    const checks = allDone.map((c) =>
      c.itemKey === 'documents_verified' ? { ...c, status: 'not_applicable' as const } : c,
    );
    expect(
      evaluateAdmissionReadiness({ checks, feeApproval: 'approved', hasProgramme: true }),
    ).toEqual(['documents_verified', F]);
  });

  it('verifier separation is checked at entry time', () => {
    expect(
      checkVerifierSeparation('fee_verification_2', 'u1', [done('fee_verification_1', 'u1')]).ok,
    ).toBe(false);
    expect(
      checkVerifierSeparation('fee_verification_1', 'u2', [done('fee_verification_2', 'u2')]).ok,
    ).toBe(false);
    expect(
      checkVerifierSeparation('fee_verification_2', 'u2', [done('fee_verification_1', 'u1')]).ok,
    ).toBe(true);
    expect(
      checkVerifierSeparation('documents_verified', 'u1', [done('fee_verification_1', 'u1')]).ok,
    ).toBe(true);
  });
});

const rules: DueRules = {
  firstContactDays: 0,
  afterCounsellingDays: 1,
  afterDemoDays: 1,
  upcomingWindowDays: 2,
  closedWeekdays: [0],
};
const d = (s: string) => s as IsoDate;

describe('IST calendar helpers', () => {
  it('istToday uses Asia/Kolkata at the UTC boundary', () => {
    expect(istToday(new Date('2026-10-17T18:29:59Z'))).toBe('2026-10-17');
    expect(istToday(new Date('2026-10-17T18:30:00Z'))).toBe('2026-10-18');
  });
  it('weeks run Monday to Sunday', () => {
    expect(istWeekContaining(d('2026-10-18'))).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(istWeekContaining(d('2026-10-19'))).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });
  it('nextServiceDay skips closed weekdays and never loops when all are closed', () => {
    expect(nextServiceDay(d('2026-10-18'), [0])).toBe('2026-10-19'); // Sunday → Monday
    expect(nextServiceDay(d('2026-10-17'), [0])).toBe('2026-10-17');
    expect(nextServiceDay(d('2026-10-18'), [0, 1, 2, 3, 4, 5, 6])).toBe('2026-10-18');
  });
});

describe('follow-up due rules (A-05)', () => {
  it('a lead received late on Saturday evening IST is due Saturday', () => {
    expect(proposeFollowUp('lead_received', new Date('2026-10-17T12:00:00Z'), rules)).toMatchObject(
      { kind: 'first_contact', dueDate: '2026-10-17' },
    );
  });
  it('a lead received at 00:10 IST Sunday (18:40 UTC Saturday) is due Monday (Sunday closed)', () => {
    expect(proposeFollowUp('lead_received', new Date('2026-10-17T18:40:00Z'), rules).dueDate).toBe(
      '2026-10-19',
    );
  });
  it('counselling on Friday → follow-up Saturday; demo on Saturday → Monday', () => {
    expect(
      proposeFollowUp('counselling_completed', new Date('2026-10-16T08:00:00Z'), rules),
    ).toMatchObject({ kind: 'counselling_followup', dueDate: '2026-10-17' });
    expect(proposeFollowUp('demo_attended', new Date('2026-10-17T08:00:00Z'), rules)).toMatchObject(
      { kind: 'demo_followup', dueDate: '2026-10-19' },
    );
  });
});

describe('overdue computation (A-06)', () => {
  const f = { status: 'open' as const, dueDate: d('2026-10-17') };
  it('timezone boundary: not overdue at 23:59:59 IST on the due date, overdue from 00:00 IST next day', () => {
    expect(followUpDueState(f, new Date('2026-10-17T18:29:59Z'), 2)).toEqual({
      state: 'due_today',
      daysOverdue: 0,
    });
    expect(followUpDueState(f, new Date('2026-10-17T18:30:00Z'), 2)).toEqual({
      state: 'overdue',
      daysOverdue: 1,
    });
  });
  it('a UTC-midnight reading would be wrong: 2026-10-17T20:00Z is already the 18th in IST', () => {
    expect(followUpDueState(f, new Date('2026-10-17T20:00:00Z'), 2).state).toBe('overdue');
  });
  it('upcoming within the window, later beyond it; closed items are never overdue', () => {
    expect(
      followUpDueState({ ...f, dueDate: d('2026-10-19') }, new Date('2026-10-17T06:00:00Z'), 2)
        .state,
    ).toBe('upcoming');
    expect(
      followUpDueState({ ...f, dueDate: d('2026-10-20') }, new Date('2026-10-17T06:00:00Z'), 2)
        .state,
    ).toBe('later');
    expect(followUpDueState({ ...f, status: 'done' }, new Date('2026-12-01T00:00:00Z'), 2)).toEqual(
      { state: 'closed', daysOverdue: 0 },
    );
  });
  it('flags: missing next action when nothing is open', () => {
    const now = new Date('2026-10-18T06:00:00Z');
    expect(followUpFlags([], now, 2).missingNextAction).toBe(true);
    expect(
      followUpFlags([{ status: 'done', dueDate: d('2026-10-10') }], now, 2).missingNextAction,
    ).toBe(true);
    expect(followUpFlags([f], now, 2)).toMatchObject({ missingNextAction: false, overdue: true });
  });
});

describe('reminder selection', () => {
  const now = new Date('2026-10-18T04:00:00Z'); // 09:30 IST on the 18th
  const base = { status: 'open' as const, ownerUserId: 'u1', lastReminderOn: null };
  it('due today and overdue are reminded once per IST day; future and closed are not', () => {
    const picks = selectReminders(
      [
        { ...base, id: 'a', dueDate: d('2026-10-18') },
        { ...base, id: 'b', dueDate: d('2026-10-15') },
        { ...base, id: 'c', dueDate: d('2026-10-19') },
        { ...base, id: 'd', dueDate: d('2026-10-15'), status: 'done' },
        { ...base, id: 'e', dueDate: d('2026-10-16'), lastReminderOn: d('2026-10-18') },
      ],
      now,
    );
    expect(picks.map((p) => [p.id, p.kind, p.daysOverdue])).toEqual([
      ['b', 'followup.overdue', 3],
      ['a', 'followup.due_today', 0],
    ]);
  });
  it('owners without a login are returned with ownerUserId null (reported unreachable)', () => {
    expect(
      selectReminders([{ ...base, id: 'x', dueDate: d('2026-10-18'), ownerUserId: null }], now)[0]
        ?.ownerUserId,
    ).toBeNull();
  });
});
