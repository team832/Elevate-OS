import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  EXIT_STATUSES,
  type AdmissionStatus,
  type TransitionContext,
} from '../../src/domain';
import {
  caseState,
  decideIdentity,
  hasStudentRecord,
  lifecycleOptions,
  maskPhone,
  pastOutcomeOf,
  studentPopulation,
} from '../../src/domain/student-lifecycle';

const via = { actor: 'user' as const, reason: 'Family request (test)', viaStudentLifecycle: true };

describe('student lifecycle transitions', () => {
  it.each<[AdmissionStatus, AdmissionStatus, Partial<TransitionContext>, boolean | string]>([
    ['enrolled', 'on_hold', via, true],
    ['enrolled', 'on_hold', { ...via, viaStudentLifecycle: false }, 'GUARD_FAILED'],
    ['enrolled', 'on_hold', { ...via, reason: '' }, 'REASON_REQUIRED'],
    ['on_hold', 'enrolled', { ...via, heldFromStatus: 'enrolled' }, true],
    ['on_hold', 'enrolled', { ...via, heldFromStatus: 'admitted' }, 'GUARD_FAILED'],
    [
      'on_hold',
      'enrolled',
      { ...via, heldFromStatus: 'enrolled', viaStudentLifecycle: false },
      'GUARD_FAILED',
    ],
    ['enrolled', 'withdrawn', via, true],
    ['enrolled', 'completed', via, true],
    ['enrolled', 'transferred', via, true],
    ['enrolled', 'other_inactive', via, true],
    ['on_hold', 'completed', { ...via, heldFromStatus: 'enrolled' }, true],
    ['on_hold', 'completed', { ...via, heldFromStatus: 'counselled' }, 'GUARD_FAILED'],
    ['admitted', 'cancelled_before_enrolment', via, true],
    ['on_hold', 'cancelled_before_enrolment', { ...via, heldFromStatus: 'admitted' }, true],
    ['enrolled', 'cancelled_before_enrolment', via, 'ILLEGAL'],
    ['admitted', 'withdrawn', via, 'ILLEGAL'],
    ['demo_attended', 'completed', via, 'ILLEGAL'],
    ['withdrawn', 'admitted', via, true],
    ['completed', 'admitted', { ...via, viaStudentLifecycle: false }, 'GUARD_FAILED'],
    ['withdrawn', 'enrolled', via, 'ILLEGAL'],
  ])('%s → %s (%o) → %s', (from, to, ctx, expected) => {
    const r = checkTransition(from, to, { actor: 'user', ...ctx });
    if (expected === true) expect(r.ok).toBe(true);
    else expect(r).toMatchObject({ ok: false, code: expected });
  });
});

describe('lifecycle options follow the transition table', () => {
  it.each<[AdmissionStatus, AdmissionStatus | null, boolean, boolean, boolean]>([
    // status, heldFrom, hold, resume, readmit (= reactivate: both offered from an exit status)
    ['enrolled', null, true, false, false],
    ['admitted', null, false, false, false],
    ['on_hold', 'enrolled', false, true, false],
    ['on_hold', 'admitted', false, false, false],
    ['withdrawn', null, false, false, true],
    ['completed', null, false, false, true],
    ['demo_attended', null, false, false, false],
  ])('%s (held from %s)', (status, heldFromStatus, hold, resume, readmit) => {
    const o = lifecycleOptions({ status, heldFromStatus, admittedAt: new Date() });
    expect({
      hold: o.hold,
      resume: o.resume,
      readmit: o.readmit,
      reactivate: o.reactivate,
    }).toEqual({ hold, resume, readmit, reactivate: readmit });
    const legal = EXIT_STATUSES.filter(
      (to) => checkTransition(status, to, { ...via, heldFromStatus }).ok,
    );
    expect(o.exitStatuses).toEqual(legal);
  });

  it('caseState labels a lost-after-admission case as withdrawn and former', () => {
    expect(
      caseState({ status: 'lost', heldFromStatus: null, admittedAt: new Date() }),
    ).toMatchObject({ population: 'former', state: 'withdrawn', statusLabel: expect.any(String) });
  });
});

describe('past outcomes (brief §11: withdrawn early vs completed)', () => {
  it.each([
    [{ status: 'withdrawn' }, 'withdrawn_early', 'Withdrawn early'],
    [{ status: 'completed' }, 'completed', 'Completed'],
    [{ status: 'transferred' }, 'other', 'Transferred'],
    [{ status: 'lost', admittedAt: '2026-01-01' }, 'other', 'Lost'],
    [{ status: 'enrolled' }, null, 'Enrolled'],
    [{ status: 'on_hold', heldFromStatus: 'enrolled' }, null, 'On hold'],
  ] as const)('%o → %s', (input, outcome, label) => {
    expect(pastOutcomeOf(input)).toBe(outcome);
    expect(caseState({ heldFromStatus: null, admittedAt: null, ...input }).statusLabel).toBe(label);
  });
});

describe('populations', () => {
  it.each([
    [{ status: 'enrolled' }, 'active'],
    [{ status: 'on_hold', heldFromStatus: 'enrolled' }, 'on_hold'],
    [{ status: 'on_hold', heldFromStatus: 'counselled' }, 'in_admission'],
    [{ status: 'withdrawn' }, 'former'],
    [{ status: 'cancelled_before_enrolment' }, 'former'],
    [{ status: 'lost', admittedAt: '2026-01-01' }, 'former'],
    [{ status: 'lost', admittedAt: null }, 'in_admission'],
    [{ status: 'admitted' }, 'in_admission'],
  ] as const)('%o → %s', (input, expected) => {
    expect(studentPopulation(input)).toBe(expected);
  });
});

describe('a student record exists only after admission or once the case left the pipeline', () => {
  it.each([
    ['admission_pending', null, false],
    ['demo_scheduled', null, false],
    ['admitted', '2026-01-01', true],
    ['enrolled', '2026-01-01', true],
    ['withdrawn', null, true],
  ] as const)('%s (admitted %s) → %s', (status, admittedAt, expected) => {
    expect(hasStudentRecord({ status, heldFromStatus: null, admittedAt })).toBe(expected);
  });
});

describe('privacy helpers', () => {
  it.each([
    ['+919876512345', '+91 •••• ••23 45'],
    ['+447700900123', '+•• •••• ••01 23'],
    [null, null],
  ])('maskPhone(%s) → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe('identity decision (never auto-merge)', () => {
  it.each([
    [
      { sameLeadIdentityId: 'S1', contactCandidateIds: ['S2'] },
      { kind: 'link', studentId: 'S1', why: 'same_lead' },
    ],
    [{ sameLeadIdentityId: null, contactCandidateIds: [] }, { kind: 'create' }],
    [
      { sameLeadIdentityId: null, contactCandidateIds: ['S2'] },
      { kind: 'review', candidateIds: ['S2'] },
    ],
    [
      { sameLeadIdentityId: null, contactCandidateIds: ['S2', 'S3', 'S2'] },
      { kind: 'review', candidateIds: ['S2', 'S3'] },
    ],
    [
      { sameLeadIdentityId: null, contactCandidateIds: ['S2'], chosenId: 'S2' },
      { kind: 'link', studentId: 'S2', why: 'chosen' },
    ],
    [
      { sameLeadIdentityId: null, contactCandidateIds: ['S2'], createNew: true },
      { kind: 'create' },
    ],
    [
      { sameLeadIdentityId: null, contactCandidateIds: ['S2'], chosenId: 'S9' },
      { kind: 'invalid' },
    ],
  ])('%o → %o', (input, expected) => {
    expect(decideIdentity(input)).toMatchObject(expected);
  });
});
