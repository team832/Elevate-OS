/** Policy register: fee receipts, certificates and admit cards (F4-01 … F4-03, owner 6 Nov 2026). */
import { z } from 'zod';
import { CERTIFICATE_PLACEHOLDERS, unknownPlaceholders } from './documents';
import type { DefinitionsFor } from './policies-base';

export const RECEIPT_YEAR_FROM = ['payment_date', 'issue_date'] as const;

const numberPrefix = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,5}$/, 'Capital letters and numbers, up to 6');
const wording = z
  .string()
  .trim()
  .min(20)
  .max(1500)
  .refine((t) => !unknownPlaceholders(t).length, {
    message: `Use only these names in braces: ${CERTIFICATE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`,
  });

export const documentSettingSchemas = {
  'fees.receipts': z.object({ numberPrefix, yearFrom: z.enum(RECEIPT_YEAR_FROM) }).strict(),
  'certificates.types': z
    .object({
      numberPrefix,
      types: z
        .array(
          z
            .object({
              code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
              label: z.string().trim().min(1).max(80),
              template: wording,
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .refine((t) => new Set(t.map((x) => x.code)).size === t.length, 'Each code once'),
    })
    .strict(),
  'tests.admit_card_block_defaulters': z.object({ leaveOut: z.boolean() }).strict(),
  'tests.admit_card_instructions': z.object({ text: z.string().trim().min(1).max(600) }).strict(),
} as const;

const PROPOSED = { defaultState: 'proposed', editable: true } as const;

export const DOCUMENT_SETTING_DEFINITIONS: DefinitionsFor<typeof documentSettingSchemas> = {
  'fees.receipts': {
    label: 'Fee receipts',
    description:
      'Every payment gets one receipt, numbered when it is recorded (or with "Issue receipt" for an older payment): prefix / financial year (April–March) / six-digit number, for example ER/2026-27/000001, with no gaps in a year. The year comes from the payment date or the day the receipt is issued.',
    defaultValue: { numberPrefix: 'ER', yearFrom: 'payment_date' },
    ...PROPOSED,
    source: 'owner decision 2026-11-06 (F4-01); the format and the year rule are our proposal.',
    ownerDecision:
      'F4-01: owner to confirm the receipt number format and which date sets the year.',
  },
  'certificates.types': {
    label: 'Certificate types and wording',
    description: `The certificates staff can issue from a student record, each numbered prefix / type / financial year / four digits (EC/BONAFIDE/2026-27/0001). The wording may name ${CERTIFICATE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. Certificates can be issued only after the owner approves this wording.`,
    defaultValue: {
      numberPrefix: 'EC',
      types: [
        {
          code: 'course_completion',
          label: 'Course completion certificate',
          template:
            'This is to certify that {student}, admission number {admission number}, has completed the {programme} programme at {institute} in the academic year {academic year}.',
        },
        {
          code: 'bonafide',
          label: 'Bonafide certificate',
          template:
            'This is to certify that {student}, admission number {admission number}, is a bonafide student of {institute}, enrolled in the {programme} programme for the academic year {academic year}. This certificate is issued on the student’s request on {issue date}.',
        },
      ],
    },
    ...PROPOSED,
    source: 'owner decision 2026-11-06 (F4-02); the types and wording are our proposal.',
    ownerDecision: 'F4-02: owner to approve the wording (and add types) before any is issued.',
  },
  'tests.admit_card_block_defaulters': {
    label: 'Admit cards: leave out students with overdue fees',
    description:
      'Yes: admit cards are not printed for students with a tuition instalment past its due date; they are listed on the test page instead. No: every student on the roster gets a card.',
    defaultValue: { leaveOut: false },
    ...PROPOSED,
    source: 'owner decision 2026-11-06 (F4-03): off until the owner chooses.',
    ownerDecision: 'F4-03: blocking students with overdue fees is the owner’s choice.',
  },
  'tests.admit_card_instructions': {
    label: 'Admit card instructions',
    description:
      'Printed on every admit card unless the test has its own instructions (up to 600 characters).',
    defaultValue: {
      text: 'Bring this admit card and a photo identity card. Reach the venue 15 minutes before the start time. Phones, smart watches and notes are not allowed in the test room. Follow the invigilator’s instructions.',
    },
    ...PROPOSED,
    source: 'owner decision 2026-11-06 (F4-03); the text is our proposal.',
    ownerDecision: 'F4-03: owner to confirm the instructions.',
  },
};
