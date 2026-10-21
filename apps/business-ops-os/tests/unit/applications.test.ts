/** Admission applications (brief §6, acceptance 7): status machine, completeness, signers, payment gate. */
import { describe, expect, it } from 'vitest';
import {
  ageOn,
  applicationActionBlocked,
  canonicalJson,
  changedParts,
  confirmationGaps,
  confirmationTasks,
  DECLARATIONS_MISSING,
  DECLARATIONS_PROPOSED,
  type Gap,
  informationGaps,
  paymentGap,
  requiredSigners,
  statusAfter,
  type ApplicationSnapshot,
  type ApplicationStatus,
} from '../../src/domain/applications';
import type { IsoDate } from '../../src/domain/dates';
import { EMPTY_FORM_FIELDS } from '../../src/domain/admission-form';

const TODAY = '2026-10-21' as IsoDate;
const snapshot = (patch: Partial<ApplicationSnapshot> = {}): ApplicationSnapshot => ({
  student: {
    fullName: 'Sample Student',
    preferredName: null,
    phone: null,
    email: null,
    dateOfBirth: '2010-01-15',
    currentStage: 'class_11',
    schoolBoard: null,
    previousSchool: 'Sample School',
    city: 'Sikar',
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  },
  guardians: [
    {
      id: null,
      fullName: 'Sample Parent',
      relationship: 'mother',
      phone: '+919870000001',
      email: null,
      address: null,
      isPrimary: true,
      isEmergency: false,
    },
  ],
  programmes: [{ admissionId: 'a1', code: 'CLAT', name: 'CLAT' }],
  intendedBatchId: null,
  deliveryMode: 'offline',
  startDate: '2026-11-01',
  academicYear: '2026-27',
  feeAgreement: {
    planId: 'p1',
    version: 1,
    label: 'Sample',
    totalPaise: 100_000_00,
    academicYear: '2026-27',
    instalments: [{ sequence: 1, dueDate: '2026-11-01', amountPaise: 50_000_00 }],
  },
  registrationFeePaise: null,
  declarations: { text: 'Sample declaration text for tests only.', version: 't1' },
  form: EMPTY_FORM_FIELDS,
  counsellorName: 'Sample Counsellor',
  ...patch,
});
const settings = {
  studentFields: ['current_stage', 'previous_school', 'city', 'date_of_birth', 'student_phone'],
  guardianFields: ['full_name', 'relationship', 'phone'],
  signerRule: { student: true, guardian: 'if_under_18' as const },
  mandatoryDocuments: [] as string[],
  paymentRule: 'none' as const,
};
const signed = {
  version: 2,
  formVersion: 2,
  signedOn: TODAY,
  signers: [{ role: 'student' as const }, { role: 'guardian' as const }],
};
const confirmInput = (patch: Partial<Parameters<typeof confirmationGaps>[0]> = {}) => ({
  snapshot: snapshot(),
  settings,
  declarationsProposed: false,
  currentVersion: 2,
  signature: signed,
  verifiedDocuments: [],
  paid: { registrationPaise: 0, tuitionPaise: 0 },
  counsellorAssigned: true,
  today: TODAY,
  ...patch,
});

describe('status machine', () => {
  it.each<[ApplicationStatus, Parameters<typeof applicationActionBlocked>[1], boolean]>([
    ['draft', 'mark_ready', true],
    ['ready_for_review', 'mark_ready', false],
    ['draft', 'generate_form', false],
    ['ready_for_review', 'generate_form', true],
    ['signatures_confirmed', 'generate_form', true],
    ['form_generated', 'confirm_signatures', true],
    ['ready_for_review', 'confirm_signatures', false],
    ['form_generated', 'confirm_admission', false],
    ['signatures_confirmed', 'confirm_admission', true],
    ['admission_confirmed', 'save', false],
    ['admission_confirmed', 'withdraw', false],
    ['withdrawn', 'save', false],
  ])('%s + %s → allowed %s', (status, action, ok) => {
    expect(applicationActionBlocked(status, action) === null).toBe(ok);
  });

  it('a material save goes back to draft; regenerating a signed form keeps the status', () => {
    expect(statusAfter('signatures_confirmed', 'save')).toBe('draft');
    expect(statusAfter('ready_for_review', 'generate_form')).toBe('form_generated');
    expect(statusAfter('signatures_confirmed', 'generate_form')).toBe('signatures_confirmed');
  });
});

describe('content hash input', () => {
  it('ignores key order, sees nested changes', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: null }] })).toBe(
      canonicalJson({ a: [{ x: null, y: 2 }], b: 1 }),
    );
    const fee = snapshot().feeAgreement!;
    expect(changedParts(snapshot(), snapshot({ feeAgreement: { ...fee, totalPaise: 1 } }))).toEqual(
      ['feeAgreement'],
    );
    expect(changedParts(snapshot(), snapshot())).toEqual([]);
  });
});

describe('signers', () => {
  it.each([
    ['2008-10-21', true, false], // 18 today
    ['2008-10-22', true, true], // 18 tomorrow
    [null, true, true], // unknown age ⇒ guardian
  ])('dob %s', (dob, student, guardian) => {
    expect(requiredSigners({ student: true, guardian: 'if_under_18' }, dob, TODAY)).toEqual({
      student,
      guardian,
    });
  });
  it('age is whole years on the day', () => {
    expect(ageOn('2010-10-22', TODAY)).toBe(15);
    expect(ageOn('2010-10-21', TODAY)).toBe(16);
  });
});

describe('information gaps', () => {
  it('complete snapshot has none; a guardian phone stands in for the child’s own', () => {
    expect(
      informationGaps(snapshot(), settings, { counsellorAssigned: true, today: TODAY }),
    ).toEqual([]);
  });
  it('academic year is required and must match the fee agreement', () => {
    const fee = snapshot().feeAgreement!;
    const gaps = (s: ApplicationSnapshot) =>
      informationGaps(s, settings, { counsellorAssigned: true, today: TODAY }).map(
        (g) => g.message,
      );
    expect(gaps(snapshot({ academicYear: null }))).toEqual(['No academic year']);
    expect(gaps(snapshot({ feeAgreement: { ...fee, academicYear: '2027-28' } }))).toEqual([
      'The fee agreement is for 2027-28; the application is for 2026-27',
    ]);
  });
  it('names each missing item', () => {
    const s = snapshot({ guardians: [], feeAgreement: null, programmes: [] });
    s.student.city = null;
    expect(
      informationGaps(s, settings, { counsellorAssigned: false, today: TODAY }).map((g) => [
        g.message,
        g.fix,
      ]),
    ).toEqual([
      ['Student city is missing', undefined],
      ['Student phone is missing', 'contact'],
      ['No guardian recorded', 'contact'],
      ['No programme chosen', undefined],
      ['No counsellor assigned (Academic OS needs one)', 'counsellor'],
      ['No approved annual fee agreement (an active fee plan) for this admission', undefined],
    ]);
  });
});

describe('confirmation gaps (acceptance 7)', () => {
  it('passes when everything matches', () => {
    expect(confirmationGaps(confirmInput())).toEqual([]);
  });
  it.each([
    ['declarations not set', { snapshot: snapshot({ declarations: null }) }, DECLARATIONS_MISSING],
    [
      'declarations entered but not approved',
      { snapshot: snapshot({ declarations: null }), declarationsProposed: true },
      DECLARATIONS_PROPOSED,
    ],
    ['no signature', { signature: null }, 'Physical signatures not confirmed'],
    [
      'stale signed version',
      { currentVersion: 3 },
      'The signed form is version 2; the application is now version 3. Generate and sign the new form.',
    ],
    [
      'guardian missing for a minor',
      { signature: { ...signed, signers: [{ role: 'student' as const }] } },
      "The guardian's signature is required",
    ],
    [
      'mandatory document not verified',
      { settings: { ...settings, mandatoryDocuments: ['aadhaar'] } },
      'Identity document "aadhaar" not verified',
    ],
    [
      'payment gate',
      { settings: { ...settings, paymentRule: 'first_instalment' as const } },
      'First tuition instalment not recorded as received',
    ],
  ])('%s', (_, patch, gap) => {
    expect(confirmationGaps(confirmInput(patch)).map((g) => g.message)).toContain(gap);
  });
});

describe('task list (rendered from the server gaps only)', () => {
  const state = (status: Parameters<typeof confirmationTasks>[0], gaps: Gap[], printed: boolean) =>
    Object.fromEntries(confirmationTasks(status, gaps, printed).map((t) => [t.task, t.state]));
  it('a draft: details incomplete; printing and signing cannot start yet', () => {
    expect(
      state(
        'draft',
        [
          { task: 'details', message: 'No academic year' },
          { task: 'signatures', message: 'Physical signatures not confirmed' },
        ],
        false,
      ),
    ).toMatchObject({
      details: 'incomplete',
      fee_agreement: 'completed',
      form: 'cannot_start',
      signatures: 'cannot_start',
    });
  });
  it('a printed form awaiting signatures: signing is incomplete, printing completed', () => {
    expect(
      state(
        'form_generated',
        [{ task: 'signatures', message: 'Physical signatures not confirmed' }],
        true,
      ),
    ).toMatchObject({ form: 'completed', signatures: 'incomplete' });
  });
});

describe('payment gate (only the configured rule)', () => {
  const s = snapshot({ registrationFeePaise: 1_000_00 });
  it.each([
    ['none', 0, 0, null],
    ['registration_fee', 99_999, 0, 'Registration fee not recorded as received'],
    ['registration_fee', 1_000_00, 0, null],
    ['first_instalment', 0, 49_999_99, 'First tuition instalment not recorded as received'],
    ['first_instalment', 0, 50_000_00, null],
  ] as const)('%s reg=%i tuition=%i', (rule, registrationPaise, tuitionPaise, gap) => {
    expect(paymentGap(rule, s, { registrationPaise, tuitionPaise })).toBe(gap);
  });
  it('registration rule with no amount configured is a configuration gap, never "paid"', () => {
    expect(
      paymentGap('registration_fee', snapshot(), { registrationPaise: 0, tuitionPaise: 0 }),
    ).toMatch(/not set/);
  });
});
