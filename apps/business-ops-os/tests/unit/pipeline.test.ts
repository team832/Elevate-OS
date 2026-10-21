import { describe, expect, it } from 'vitest';
import {
  ADMISSION_STATUSES,
  allowedUserTargets,
  checkTransition,
  findTransition,
  hasReached,
  isOpenStatus,
  TRANSITIONS,
  type AdmissionStatus,
} from '../../src/domain';

const user = { actor: 'user' as const };

describe('admission state machine (A-03)', () => {
  it('walks the documented happy path', () => {
    const path: [AdmissionStatus, AdmissionStatus, object][] = [
      ['new', 'contacted', { hasSuccessfulContact: true }],
      ['contacted', 'counselling_scheduled', {}],
      ['counselling_scheduled', 'counselled', {}],
      ['counselled', 'demo_scheduled', {}],
      ['demo_scheduled', 'demo_attended', {}],
      ['demo_attended', 'admission_pending', {}],
      ['admission_pending', 'admitted', { readinessMissing: [] }],
      ['admitted', 'enrolment_requested', { viaEnrolmentHandoff: true }],
    ];
    for (const [from, to, ctx] of path)
      expect(checkTransition(from, to, { ...user, ...ctx }).ok).toBe(true);
    expect(
      checkTransition('enrolment_requested', 'enrolled', {
        actor: 'system',
        viaEnrolmentReply: true,
      }).ok,
    ).toBe(true);
  });

  it('every status is in the table and the table only names known statuses', () => {
    for (const t of TRANSITIONS) {
      expect(ADMISSION_STATUSES).toContain(t.from);
      expect(ADMISSION_STATUSES).toContain(t.to);
    }
    const froms = new Set(TRANSITIONS.map((t) => t.from));
    for (const s of ADMISSION_STATUSES) if (s !== 'enrolled') expect(froms.has(s)).toBe(true);
  });

  it('enrolled leaves only through the student lifecycle; lost only reopens to new', () => {
    expect(
      TRANSITIONS.filter((t) => t.from === 'enrolled').every(
        (t) => t.guard === 'student_lifecycle' || t.guard === 'exit_record',
      ),
    ).toBe(true);
    expect(TRANSITIONS.filter((t) => t.from === 'lost').map((t) => t.to)).toEqual(['new']);
  });

  it('BR-OPS-4: new → contacted needs a successful two-way contact', () => {
    const r = checkTransition('new', 'contacted', { ...user, hasSuccessfulContact: false });
    expect(r).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
  });

  it('illegal: skipping counselling from new, or going backwards arbitrarily', () => {
    expect(checkTransition('new', 'counselled', user)).toMatchObject({
      ok: false,
      code: 'ILLEGAL',
    });
    expect(checkTransition('demo_attended', 'contacted', user)).toMatchObject({
      ok: false,
      code: 'ILLEGAL',
    });
    expect(checkTransition('admitted', 'enrolled', user)).toMatchObject({
      ok: false,
      code: 'ILLEGAL',
    });
  });

  it('no change is reported as NO_CHANGE', () => {
    expect(checkTransition('counselled', 'counselled', user)).toMatchObject({
      ok: false,
      code: 'NO_CHANGE',
    });
  });

  it('demo skip is an explicit, reasoned, switchable proposal', () => {
    const rule = findTransition('counselled', 'admission_pending');
    expect(rule).toMatchObject({ proposal: true, requiresReason: true, guard: 'demo_skip_policy' });
    expect(checkTransition('counselled', 'admission_pending', user)).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(
      checkTransition('counselled', 'admission_pending', {
        ...user,
        reason: 'Joined after counselling',
      }).ok,
    ).toBe(true);
    expect(
      checkTransition('counselled', 'admission_pending', {
        ...user,
        reason: 'x',
        demoSkipAllowed: false,
      }),
    ).toMatchObject({ ok: false, code: 'GUARD_FAILED' });
    expect(allowedUserTargets('counselled', { demoSkipAllowed: false })).not.toContain(
      'admission_pending',
    );
    expect(allowedUserTargets('counselled')).toContain('admission_pending');
  });

  it('confirmation needs readiness evaluated and complete', () => {
    expect(checkTransition('admission_pending', 'admitted', user)).toMatchObject({
      code: 'GUARD_FAILED',
    });
    const r = checkTransition('admission_pending', 'admitted', {
      ...user,
      readinessMissing: ['Documents not verified'],
    });
    expect(r).toMatchObject({ ok: false, missing: ['Documents not verified'] });
  });

  it('the enrolment request is only possible through the handoff service', () => {
    expect(checkTransition('admitted', 'enrolment_requested', user)).toMatchObject({
      code: 'GUARD_FAILED',
    });
  });

  it('replies are system-only', () => {
    expect(
      checkTransition('enrolment_requested', 'enrolled', { ...user, viaEnrolmentReply: true }),
    ).toMatchObject({ code: 'WRONG_ACTOR' });
    expect(
      checkTransition('enrolment_requested', 'admitted', {
        actor: 'system',
        viaEnrolmentReply: true,
      }),
    ).toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('lost and on_hold need a reason; resume returns to the held status only', () => {
    expect(checkTransition('contacted', 'lost', user)).toMatchObject({ code: 'REASON_REQUIRED' });
    expect(checkTransition('contacted', 'lost', { ...user, reason: '  ' })).toMatchObject({
      code: 'REASON_REQUIRED',
    });
    expect(checkTransition('demo_attended', 'on_hold', { ...user, reason: 'Exams' }).ok).toBe(true);
    expect(
      checkTransition('on_hold', 'demo_attended', {
        ...user,
        reason: 'Back',
        heldFromStatus: 'demo_attended',
      }).ok,
    ).toBe(true);
    expect(
      checkTransition('on_hold', 'admitted', {
        ...user,
        reason: 'Back',
        heldFromStatus: 'demo_attended',
      }),
    ).toMatchObject({ code: 'GUARD_FAILED' });
    expect(allowedUserTargets('on_hold', { heldFromStatus: 'counselled' }).sort()).toEqual([
      'counselled',
      'lost',
    ]);
  });

  it('cannot mark lost while awaiting Academic OS', () => {
    expect(checkTransition('enrolment_requested', 'lost', { ...user, reason: 'x' })).toMatchObject({
      code: 'ILLEGAL',
    });
  });

  it('isOpenStatus / hasReached', () => {
    expect(isOpenStatus('on_hold')).toBe(true);
    expect(isOpenStatus('enrolled')).toBe(false);
    expect(isOpenStatus('lost')).toBe(false);
    expect(hasReached('enrolled', 'admitted')).toBe(true);
    expect(hasReached('counselled', 'admitted')).toBe(false);
    expect(hasReached('lost', 'new')).toBe(false);
  });
});
