/** Policy register: appointments, admission number, fee split, payment gate, KYC, form and reports. */
import { z } from 'zod';
import { codeList, type DefinitionsFor } from './policies-base';

/** KYC field keys (columns of ops.leads for the student, ops.guardians for a guardian). */
export const KYC_STUDENT_FIELDS = [
  'preferred_name',
  'student_phone',
  'student_email',
  'date_of_birth',
  'current_stage',
  'school_board',
  'previous_school',
  'city',
  'address',
] as const;
export const KYC_GUARDIAN_FIELDS = [
  'full_name',
  'relationship',
  'phone',
  'email',
  'address',
] as const;
export const EVENT_POPULATIONS = ['lead', 'demo', 'active', 'past'] as const;
export const REPORT_AUDIENCES = ['internal', 'guardian', 'student', 'admin_dossier'] as const;

export const admissionSettingSchemas = {
  /** Appointments (brief §11): double-booking buffer and default length. Proposed. */
  'appointments.scheduling': z
    .object({
      bufferMinutes: z.int().min(0).max(120),
      defaultDurationMinutes: z.int().min(5).max(480),
    })
    .strict(),
  /** Admission number format — approved by the owner: 001, 002, 003 … (D-037). */
  'admissions.number.format': z
    .object({
      prefix: z.string().regex(/^[A-Z0-9]{0,8}$/),
      separator: z.enum(['', '-', '/']),
      includeYear: z.boolean(),
      width: z.int().min(3).max(8),
    })
    .strict(),
  /** Annual tuition instalment shares in percent, remainder paise to the last (D-039). */
  'fees.tuition_split': z
    .object({
      sharesPercent: z
        .array(z.int().min(1).max(100))
        .min(1)
        .max(12)
        .refine((a) => a.reduce((s, p) => s + p, 0) === 100, {
          error: 'Shares must add up to 100.',
        }),
    })
    .strict(),
  /** Registration fee, a separate charge outside the tuition split; null = not set. */
  'fees.registration': z
    .object({ amountPaise: z.int().min(1).max(100_000_000).nullable() })
    .strict(),
  /** Whether a paid demo fee is credited against tuition on admission. */
  'fees.demo_credit': z.object({ creditTowardTuition: z.boolean() }).strict(),
  /** Payment required before final admission confirmation. */
  'admission.payment_gate': z
    .object({ rule: z.enum(['none', 'registration_fee', 'first_instalment']) })
    .strict(),
  /** KYC fields that must be filled before an application is ready (brief §5, §8). */
  'admissions.kyc.required_fields': z
    .object({
      student: z.array(z.enum(KYC_STUDENT_FIELDS)).max(KYC_STUDENT_FIELDS.length),
      guardian: z.array(z.enum(KYC_GUARDIAN_FIELDS)).max(KYC_GUARDIAN_FIELDS.length),
    })
    .strict(),
  /** Identity document types staff may record (masked reference only) and which are mandatory. */
  'admissions.kyc.id_document_types': z
    .object({ types: codeList.min(1), mandatory: z.array(z.string()).max(40) })
    .strict()
    .refine((v) => v.mandatory.every((m) => v.types.some((t) => t.code === m)), {
      error: 'A mandatory type must be in the list.',
    }),
  /** Approved declaration / consent text printed on the admission form; null = not set. */
  'admissions.declarations': z
    .object({
      text: z.string().trim().min(20).max(5000).nullable(),
      version: z
        .string()
        .regex(/^[A-Za-z0-9._-]{1,20}$/)
        .nullable(),
    })
    .strict()
    .refine((v) => (v.text === null) === (v.version === null), {
      error: 'Text and version are set together.',
    }),
  /** Physical signatures required on the admission form. */
  'admissions.signatures.required_signers': z
    .object({ student: z.boolean(), guardian: z.enum(['always', 'if_under_18', 'never']) })
    .strict(),
  /** How the approver is re-verified when confirming an admission (D-041). */
  'admissions.confirm.reauth': z.object({ method: z.literal('password') }).strict(),
  /** Who may be invited to events and webinars. */
  'events.eligibility': z
    .object({
      populations: z.array(z.enum(EVENT_POPULATIONS)).min(1),
      includeGuardians: z.boolean(),
    })
    .strict(),
  /** Report audiences offered and whether a report must be reviewed before it is final. */
  'reports.audiences': z
    .object({ enabled: z.array(z.enum(REPORT_AUDIENCES)).min(1), reviewBeforeFinal: z.boolean() })
    .strict(),
} as const;

export const ADMISSION_SETTING_DEFINITIONS: DefinitionsFor<typeof admissionSettingSchemas> = {
  'admissions.number.format': {
    label: 'Admission number format',
    description:
      'Admission numbers run 001, 002, 003 … (1000 follows 999). A number is given only at final admission confirmation, is never changed afterwards and is never reused. Proposed alternative, NOT active: ELEV-{YYYY}-{CC}-{DDMM}-{NNN} (year, class code, day and month, sequence); it needs an owner decision and a class-code mapping.',
    defaultValue: { prefix: '', separator: '-', includeYear: false, width: 3 },
    defaultState: 'approved',
    source:
      'Owner, 21 Oct 2026: admission numbers run 001, 002, 003 … (sequence only, three digits, no prefix or year; 1000 follows 999). Structured format from the owner brief 2026-10-21 §7, offered as a proposal only.',
    ownerDecision: 'D-037, D-040',
    editable: false,
  },
  'appointments.scheduling': {
    label: 'Appointment scheduling',
    description:
      'Minutes kept free between two appointments of the same teacher or counsellor (0 = back-to-back allowed; touching times never clash), and the length used when no end time is given.',
    defaultValue: { bufferMinutes: 0, defaultDurationMinutes: 60 },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-20 §11 (double-booking prevention); values are our proposal.',
    ownerDecision: 'Owner to confirm the buffer between appointments and the default length',
    editable: true,
  },
  'fees.tuition_split': {
    label: 'Annual tuition instalments',
    description:
      'Annual tuition is split into instalments of these percentages: 50 %, 25 %, 25 %. Each share is rounded down to the paisa and the remainder goes to the last instalment (₹1,00,000 → 50,000 / 25,000 / 25,000). Registration and demo fees are separate and never part of the split. Due dates are entered per student.',
    defaultValue: { sharesPercent: [50, 25, 25] },
    defaultState: 'approved',
    source:
      'owner brief 2026-10-21 §9 (annual tuition in three instalments of 50 %, 25 % and 25 %).',
    ownerDecision: 'D-039',
    editable: false,
  },
  'fees.registration': {
    label: 'Registration fee',
    description:
      'One-time registration fee, charged once per student and separately from tuition. Not set: no registration charge is created and none is assumed.',
    defaultValue: { amountPaise: 5_000_00 },
    defaultState: 'approved',
    source:
      'Owner approved in session, 21 Oct 2026 (D-044): ₹5,000, charged once per student. Whether it is charged again each academic year is still open.',
    ownerDecision: 'D-044',
    editable: true,
  },
  'fees.demo_credit': {
    label: 'Demo fee credit on admission',
    description:
      'On: a paid demo fee is credited against the first tuition instalment when the student is admitted (a linked ledger entry, never assumed without a recorded payment). Off: the demo fee stays a separate charge. Follows the approved demo terms ("adjusted against fees on joining").',
    defaultValue: { creditTowardTuition: true },
    defaultState: 'approved',
    source:
      'Legacy decisions LEGACY-OPSWB-D-003 and D-004 ("Confirmed"), recorded in demo.terms (adjustedAgainstFeesOnJoining); owner brief 2026-10-21 §5 keeps the credit configurable.',
    ownerDecision: null,
    editable: true,
  },
  'admission.payment_gate': {
    label: 'Payment before admission',
    description:
      'Payment that must be recorded before an admission can be confirmed: none, the registration fee, or the first tuition instalment. Only the chosen rule is enforced.',
    defaultValue: { rule: 'none' },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-21 §6 ("first payment before admission is a policy decision").',
    ownerDecision: 'Owner to decide whether a payment is required before confirmation',
    editable: true,
  },
  'admissions.kyc.required_fields': {
    label: 'Required KYC fields',
    description:
      'Student and guardian details that must be filled before an application is ready for review. A child does not need their own phone or email when a guardian contact is recorded.',
    // The owner's paper form: what a counsellor can always fill (course, mode and start date are
    // always required by the application itself); the rest prints as blank lines.
    defaultValue: {
      student: ['date_of_birth', 'student_phone', 'address'],
      guardian: ['full_name', 'relationship', 'phone'],
    },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-21 §5, §8 (required KYC fields are a proposed choice).',
    ownerDecision: 'Owner to confirm the required KYC fields',
    editable: true,
  },
  'admissions.kyc.id_document_types': {
    label: 'Identity document types',
    description:
      'Identity documents staff may record for a student or guardian: type, a masked reference (at most 4 digits shown) and verification. Full numbers and scans are never stored. None is mandatory.',
    defaultValue: {
      types: [
        { code: 'aadhaar', label: 'Aadhaar' },
        { code: 'pan', label: 'PAN card' },
        { code: 'passport', label: 'Passport' },
        { code: 'driving_licence', label: 'Driving licence' },
        { code: 'voter_id', label: 'Voter ID' },
        { code: 'school_id', label: 'School ID card' },
        // The owner's paper form, section 05 "Document check".
        { code: 'photograph', label: 'Photograph' },
        { code: 'previous_marksheet', label: 'Previous marksheet / qualification' },
        { code: 'address_proof', label: 'Address proof' },
        { code: 'other', label: 'Other document' },
      ],
      mandatory: [],
    },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-21 §8 ("no mandatory government ID assumed").',
    ownerDecision: 'Owner to confirm the document list and whether any is mandatory',
    editable: true,
  },
  'admissions.declarations': {
    label: 'Admission declarations',
    description:
      'Declaration and consent text printed on the admission form, with its version. Not set: forms print no declaration and admissions cannot be confirmed until the owner supplies approved text (Elevate OS never writes legal wording).',
    // Version 2 = the owner's paper form (D-046); version 1 (a draft) was never printed.
    defaultValue: {
      text: [
        'Student / parent declaration',
        'I/We confirm that the information provided above is true and correct. I/We understand the applicable fee schedule and agree to follow the admission and fee policies communicated by Elevate Education.',
        'Fee acknowledgement',
        'I/We confirm that the fee amount, payment schedule and balance payable shown on this page have been explained to me/us. I/We acknowledge the payments recorded above and understand that official receipts will be issued for payments received.',
        'Terms & Conditions — applicable to student admission, coaching services and fee payment',
        '1. Fees are non-refundable. All admission, registration, course, material and other fees paid to Elevate Education are non-refundable, except where a written exception is expressly approved by Elevate Education.',
        '2. Timely payment. The agreed fee and instalment schedule must be paid on or before the respective due dates. Outstanding amounts remain payable until fully settled.',
        '3. Attendance and regularity. Students are expected to maintain regular attendance, attend classes on time, complete assigned work and participate sincerely. Irregular attendance may affect academic progress.',
        '4. Discipline and conduct. Students must maintain respectful behaviour towards faculty, staff and other students and follow institute rules. Misconduct or disruption may lead to appropriate action.',
        '5. Property damage or loss. Damage to furniture, equipment, premises, study material or other institute property caused by negligence, misuse or intentional action may attract applicable recovery or replacement charges payable by the student/parent/guardian.',
        '6. Documents and information. All information and documents supplied at admission must be accurate and complete. Changes in contact details should be communicated promptly.',
        '7. Result information and verification. After declaration of results, the student/parent/guardian agrees to provide relevant result details, marks, rank, scorecard or other reasonable information requested by Elevate Education for record and result verification.',
        "8. Result publicity and consent. Where consent is provided, Elevate Education may use the student's name, course, achievement, rank or result details for genuine institute records, testimonials and promotional purposes. Sensitive personal information will not be published without appropriate consent.",
        '9. Communication. Important academic, fee and administrative communication may be sent through the mobile number, WhatsApp, email or other details provided in the form. The student/parent/guardian is responsible for keeping these details updated.',
        "10. Course material and institute property. Books, printed study material, notes, tests and other resources supplied are for the student's academic use. Unauthorised copying, distribution or commercial use is not permitted.",
        '11. Schedule and batch changes. Class timings, faculty, batch arrangements or academic schedules may be changed by the institute when reasonably required for academic or administrative purposes.',
        '12. Final acknowledgement. By signing this admission form, the student and parent/guardian confirm that they have read, understood and accepted these Terms & Conditions.',
      ].join('\n'),
      version: '2',
    },
    defaultState: 'approved',
    source:
      "Owner's admission form (Student Admission & Fee Record), approved in session 21 Oct 2026 (D-046).",
    ownerDecision: 'D-046',
    editable: true,
  },
  'admissions.signatures.required_signers': {
    label: 'Required signatures',
    description:
      'Who must sign the printed admission form: the student, and a guardian always, only when the student is under 18 on the signing day, or never. With no date of birth on record a guardian signature is required.',
    defaultValue: { student: true, guardian: 'if_under_18' },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-21 §6 (signature rules by student age are a proposed choice).',
    ownerDecision: 'Owner to confirm the signature rule',
    editable: true,
  },
  'admissions.confirm.reauth': {
    label: 'Re-check at admission confirmation',
    description:
      'The approver re-enters their account password in the confirmation request; it is checked on the server and never stored or logged. Accounts that sign in only with Google have no password and cannot confirm until a Google re-authentication is approved.',
    defaultValue: { method: 'password' },
    defaultState: 'approved',
    source:
      'owner brief 2026-10-21 §6 (account-password confirmation by an authorised staff member).',
    ownerDecision: 'D-041 (open: Google re-authentication for admission confirmation)',
    editable: false,
  },
  'events.eligibility': {
    label: 'Event and webinar audience',
    description:
      'Which people may be added to events and webinars (leads, demo students, active or past students) and whether their guardians are invited too. Contact preferences always apply.',
    defaultValue: { populations: ['demo', 'active'], includeGuardians: true },
    defaultState: 'proposed',
    source: 'owner brief 2026-10-21 §12 (event eligibility is a proposed choice).',
    ownerDecision: 'Owner to confirm who may be invited to events',
    editable: true,
  },
  'reports.audiences': {
    label: 'Student report kinds',
    description:
      'Report kinds staff may produce: the PTM report (for parents: scores, attendance, the teachers’ shareable notes and an affirmative summary — never KYC, guardians, internal remarks, history or payment details) and the internal report (KYC, student details, every score and review). Student and administration-dossier kinds can be enabled too. With review on, a second person must review a report before it is final.',
    defaultValue: { enabled: ['internal', 'guardian'], reviewBeforeFinal: true },
    defaultState: 'approved',
    source:
      'Owner, 23 Oct 2026 (D-078): two kinds of student report, PTM and internal; owner brief 2026-10-21 §10 (draft / reviewed / final).',
    ownerDecision: 'D-078',
    editable: true,
  },
};
