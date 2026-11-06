/** zod bodies for payroll (F4-14). Amounts arrive as typed rupees and leave as integer paise. */
import { z } from 'zod';
import {
  OPS_PAY_MODES,
  OPS_PAYROLL_COMPONENT_KINDS,
  OPS_PAYROLL_COMPONENT_STATUSES,
} from '@elevate/database';
import { isoDateSchema, optText } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { MAX_FEE_PAISE, parseRupeesToPaise } from '../domain/fees';
import { MANUAL_SOURCES, RUN_ACTIONS, type RunAction } from '../domain/payroll';

const text = (max: number) => z.string().trim().max(max);
const staffId = z.uuid('Choose a staff member.').transform((s) => s as StaffMemberId);

const rupees = z
  .string()
  .trim()
  .max(20)
  .transform((s, ctx) => {
    const paise = parseRupeesToPaise(s);
    if (paise && paise <= MAX_FEE_PAISE) return paise;
    ctx.addIssue({ code: 'custom', message: 'Enter rupees above zero, e.g. 25,000 or 25,000.50.' });
    return z.NEVER;
  });

const firstOfMonth = isoDateSchema.refine(
  (d) => d.endsWith('-01'),
  'Choose the 1st of a month: pay changes from the start of a month.',
);

export const componentBody = z
  .object({
    code: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9_]{1,39}$/,
        'Use 2 to 40 lower-case letters, digits or _, starting with a letter (e.g. basic, hra).',
      ),
    name: text(80).min(1, 'Required'),
    kind: z.enum(OPS_PAYROLL_COMPONENT_KINDS),
  })
  .strict();

export const componentStatusBody = z
  .object({ status: z.enum(OPS_PAYROLL_COMPONENT_STATUSES) })
  .strict();

export const structureBody = z
  .object({
    staffId,
    effectiveFrom: firstOfMonth,
    note: optText(500),
    /** Component id → monthly amount; components left blank are not part of this salary. */
    lines: z
      .record(z.uuid(), rupees)
      .default({})
      .refine((l) => Object.keys(l).length > 0, 'Enter at least one monthly amount.'),
  })
  .strict();

export const advanceBody = z
  .object({
    staffId,
    amount: rupees,
    monthlyInstalment: rupees,
    givenOn: isoDateSchema,
    recoverFrom: firstOfMonth,
    reason: text(500).min(1, 'Required'),
    reference: optText(120),
  })
  .strict()
  .refine((b) => b.monthlyInstalment <= b.amount, {
    message: 'The monthly instalment cannot be more than the advance.',
    path: ['monthlyInstalment'],
  });

export const reasonBody = z.object({ reason: text(500).min(1, 'Required') }).strict();

export const runBody = z
  .object({
    month: z
      .string()
      .trim()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter the month as YYYY-MM, e.g. 2026-11.'),
  })
  .strict();

export const runActionBody = z
  .object({ action: z.enum(Object.keys(RUN_ACTIONS) as [RunAction, ...RunAction[]]) })
  .strict();

export const lineBody = z
  .object({
    staffId,
    kind: z.enum(OPS_PAYROLL_COMPONENT_KINDS),
    source: z.enum(MANUAL_SOURCES),
    label: text(120).min(1, 'Required'),
    amount: rupees,
    note: text(500).min(1, 'Say what this line is for.'),
  })
  .strict();

export const paidBody = z
  .object({
    paidOn: isoDateSchema,
    paidMode: z.enum(OPS_PAY_MODES),
    paidReference: optText(120),
  })
  .strict();
