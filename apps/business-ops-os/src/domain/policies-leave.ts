/** Policy register: leave balances (owner, 6 Nov 2026, F4-12). Every value is Proposed. */
import { z } from 'zod';
import { MONTHS, OVER_BALANCE_RULES } from './leave-balance';
import type { DefinitionsFor } from './policies-base';

const SOURCE = 'owner answers 2026-11-06 (F4-12 leave balances and half days; numbers Proposed).';

export const leaveSettingSchemas = {
  'hr.leave_balances': z
    .object({
      yearStartMonth: z.enum(MONTHS),
      carryForwardCapDays: z
        .number()
        .min(0)
        .max(366)
        .refine((n) => Number.isInteger(n * 2), 'Carry forward cap days must be whole or half days.'),
      overBalance: z.enum(OVER_BALANCE_RULES),
    })
    .strict(),
  'hr.leave_unpaid_types': z
    .object({ types: z.array(z.string().trim().min(1).max(40)).max(20) })
    .strict(),
} as const;

export const LEAVE_SETTING_DEFINITIONS: DefinitionsFor<typeof leaveSettingSchemas> = {
  'hr.leave_balances': {
    label: 'Leave balances',
    description:
      'The leave year (its first month), the most days HR may carry into a new year, and what happens when someone applies for more than their balance: warn (HR sees it and decides) or refuse. A person with no allowance for a type has no balance, and nothing is checked. Days are calendar days and a half day counts 0.5; the whole allowance is there from the first day of the year.',
    defaultValue: { yearStartMonth: 'april', carryForwardCapDays: 0, overBalance: 'warn' },
    defaultState: 'proposed',
    source: SOURCE,
    ownerDecision:
      'Owner to confirm the leave year, the carry-forward cap, warn or refuse, and calendar or working days',
    editable: true,
  },
  'hr.leave_unpaid_types': {
    label: 'Leave types without a balance',
    description:
      'Leave types that never use a balance and take no allowance, such as unpaid leave. Use the names in "Leave types".',
    defaultValue: { types: ['Unpaid'] },
    defaultState: 'proposed',
    source: SOURCE,
    ownerDecision: 'Owner to confirm which leave types never use a balance',
    editable: true,
  },
};
