import { describe, expect, it } from 'vitest';
import { OPS_SYSTEM_LEAD_STAGES } from '@elevate/database';
import {
  admissionConversion,
  callSeconds,
  isConfirmedAdmission,
  stageChangeProblem,
  SYSTEM_LEAD_STAGES,
} from '../../src/domain/lead-stages';

const stage = (
  key: string,
  over: Partial<{
    kind: 'open' | 'won' | 'lost' | 'parked';
    requiresReason: boolean;
    active: boolean;
  }> = {},
) => ({
  key,
  kind: 'open' as const,
  requiresReason: false,
  active: true,
  ...over,
});

describe('stageChangeProblem (brief §11)', () => {
  it.each([
    ['open stage, no reason', null, stage('qualified'), null, false, null],
    ['same stage', 'qualified', stage('qualified'), null, false, 'stageKey'],
    ['switched-off stage', 'new', stage('old', { active: false }), 'x', false, 'stageKey'],
    [
      'lost without reason',
      'new',
      stage('lost', { kind: 'lost', requiresReason: true }),
      null,
      false,
      'reason',
    ],
    [
      'lost with reason',
      'new',
      stage('lost', { kind: 'lost', requiresReason: true }),
      'Joined elsewhere',
      false,
      null,
    ],
    [
      'converted without confirmed admission',
      'admission_in_progress',
      stage('converted', { kind: 'won' }),
      'x',
      false,
      'stageKey',
    ],
    [
      'converted with confirmed admission',
      'admission_in_progress',
      stage('converted', { kind: 'won' }),
      null,
      true,
      null,
    ],
    [
      'leaving do not contact without reason',
      'do_not_contact',
      stage('nurture'),
      null,
      false,
      'reason',
    ],
    [
      'leaving do not contact with reason',
      'do_not_contact',
      stage('nurture'),
      'Parent asked to be called',
      false,
      null,
    ],
  ] as const)('%s', (_, fromKey, to, reason, hasConfirmedAdmission, field) => {
    expect(stageChangeProblem({ fromKey, to, reason, hasConfirmedAdmission })?.field ?? null).toBe(
      field,
    );
  });
});

describe('admissionConversion / isConfirmedAdmission (fix C1)', () => {
  const n = (
    status: string,
    admissionNumber: string | null = '012',
    legacy: string | null = null,
  ) => ({
    admissionNumber,
    legacyVerification: legacy,
    status,
  });
  it.each([
    [n('admission_pending', null), 'none', false],
    [n('admitted', '013', 'required'), 'none', false],
    [n('admitted'), 'confirmed', true],
    [n('enrolment_requested'), 'confirmed', true],
    [n('enrolled', '014', 'verified'), 'confirmed', true],
    [n('on_hold'), 'confirmed', true],
    [n('withdrawn'), 'ended', true],
    [n('transferred'), 'ended', true],
    [n('completed'), 'ended', true],
    [n('other_inactive'), 'ended', true],
    [n('cancelled_before_enrolment'), 'cancelled', false],
    [n('lost'), 'cancelled', false],
  ])('%o → %s', (a, conversion, ok) => {
    expect(admissionConversion(a)).toBe(conversion);
    expect(isConfirmedAdmission(a)).toBe(ok);
  });
});

it('system stages match the schema list in order; Converted is the only won stage', () => {
  expect(SYSTEM_LEAD_STAGES.map((s) => s.key)).toEqual([...OPS_SYSTEM_LEAD_STAGES]);
  expect(SYSTEM_LEAD_STAGES.filter((s) => s.kind === 'won').map((s) => s.key)).toEqual([
    'converted',
  ]);
});

it.each([
  [null, null],
  [undefined, null],
  [0, 0],
  [5, 300],
])('callSeconds(%s) = %s (typed by staff, never measured)', (m, s) =>
  expect(callSeconds(m)).toBe(s),
);
