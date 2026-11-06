/**
 * OWNER: Business Ops OS — payroll and payslips (F4-14, wave 4). Part of the `ops` Postgres
 * schema, split across ops*.ts; same rules as ops.ts. Money is integer paise (> 0 on every
 * amount). Salaries never go into audit payloads, notifications or logs (amount-free audit).
 *
 * A monthly run is drafted from each staff member's salary structure in force on the 1st, loss-of-
 * pay days, advance recoveries and one-off lines; `draft → submitted → approved` (approver is
 * neither the creator nor the submitter); lines are frozen once submitted; corrections are
 * `adjustment` lines next month. An advance is recovered by `advance_recovery` payslip lines.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  dayCount,
  filled,
  halfDays,
  inList,
  instant,
  isoDate,
  ops,
  paise,
  staffRefRestrict,
  updatedAt,
  userRef,
} from './ops-columns';

export const OPS_PAYROLL_COMPONENT_KINDS = ['earning', 'deduction'] as const;
export const OPS_PAYROLL_COMPONENT_STATUSES = ['active', 'retired'] as const;
export const OPS_PAYROLL_RUN_STATUSES = ['draft', 'submitted', 'approved'] as const;
export const OPS_PAYSLIP_LINE_SOURCES = [
  'structure',
  'loss_of_pay',
  'advance_recovery',
  'one_off',
  'adjustment',
] as const;
export const OPS_PAY_MODES = ['bank_transfer', 'upi', 'cash', 'cheque', 'other'] as const;

const firstOfMonth = (column: AnyPgColumn): SQL => sql`extract(day FROM ${column}) = 1`;

/** Owner-defined earning or deduction (basic, HRA, PF …); no statutory rule is computed. */
export const opsPayrollComponents = ops.table(
  'payroll_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: OPS_PAYROLL_COMPONENT_KINDS }).notNull(),
    status: text('status', { enum: OPS_PAYROLL_COMPONENT_STATUSES }).notNull().default('active'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payroll_components_code_key').on(t.code),
    check('payroll_components_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('payroll_components_name_check', filled(t.name)),
    check(
      'payroll_components_kind_check',
      sql`${t.kind} IN ${inList(OPS_PAYROLL_COMPONENT_KINDS)}`,
    ),
    check(
      'payroll_components_status_check',
      sql`${t.status} IN ${inList(OPS_PAYROLL_COMPONENT_STATUSES)}`,
    ),
  ],
);

/** A staff member's salary from `effective_from`; a change is a new structure, never an edit. */
export const opsSalaryStructures = ops.table(
  'salary_structures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    effectiveFrom: isoDate('effective_from').notNull(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('salary_structures_staff_from_key').on(t.staffId, t.effectiveFrom)],
);

/** Monthly amount of one component in a structure. */
export const opsSalaryStructureLines = ops.table(
  'salary_structure_lines',
  {
    structureId: uuid('structure_id')
      .notNull()
      .references(() => opsSalaryStructures.id, { onDelete: 'restrict' }),
    componentId: uuid('component_id')
      .notNull()
      .references(() => opsPayrollComponents.id, { onDelete: 'restrict' }),
    monthlyAmountPaise: paise('monthly_amount_paise').notNull(),
  },
  (t) => [
    primaryKey({ name: 'salary_structure_lines_pkey', columns: [t.structureId, t.componentId] }),
    index('salary_structure_lines_component_idx').on(t.componentId),
    check('salary_structure_lines_amount_positive', sql`${t.monthlyAmountPaise} > 0`),
  ],
);

/** One payroll run per month (`month` = its 1st day). */
export const opsPayrollRuns = ops.table(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    month: isoDate('month').notNull(),
    status: text('status', { enum: OPS_PAYROLL_RUN_STATUSES }).notNull().default('draft'),
    createdBy: userRef('created_by').notNull(),
    submittedBy: userRef('submitted_by'),
    submittedAt: instant('submitted_at'),
    approvedBy: userRef('approved_by'),
    approvedAt: instant('approved_at'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payroll_runs_month_key').on(t.month),
    check('payroll_runs_month_check', firstOfMonth(t.month)),
    check('payroll_runs_status_check', sql`${t.status} IN ${inList(OPS_PAYROLL_RUN_STATUSES)}`),
    check(
      'payroll_runs_stage_check',
      sql`(${t.status} = 'draft') = (${t.submittedAt} IS NULL) AND (${t.submittedAt} IS NULL) = (${t.submittedBy} IS NULL) AND (${t.status} = 'approved') = (${t.approvedAt} IS NOT NULL) AND (${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`,
    ),
    check(
      'payroll_runs_approver_check',
      sql`${t.approvedBy} IS NULL OR (${t.approvedBy} <> ${t.createdBy} AND ${t.approvedBy} <> ${t.submittedBy})`,
    ),
  ],
);

/** One staff member's payslip in a run; marked paid (date, mode, reference) after approval. */
export const opsPayslips = ops.table(
  'payslips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => opsPayrollRuns.id, { onDelete: 'restrict' }),
    staffId: staffRefRestrict('staff_id').notNull(),
    /** The structure in force on the 1st; null = one-off lines only. */
    structureId: uuid('structure_id').references(() => opsSalaryStructures.id, {
      onDelete: 'restrict',
    }),
    daysInMonth: integer('days_in_month').notNull(),
    /** Loss-of-pay days (Proposed rule: unpaid leave only); per day = monthly gross ÷ days in month. */
    lossOfPayDays: dayCount('loss_of_pay_days').notNull().default(0),
    paidOn: isoDate('paid_on'),
    paidMode: text('paid_mode', { enum: OPS_PAY_MODES }),
    paidReference: text('paid_reference'),
    paidBy: userRef('paid_by'),
    paidAt: instant('paid_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payslips_run_staff_key').on(t.runId, t.staffId),
    index('payslips_staff_idx').on(t.staffId),
    check('payslips_days_check', sql`${t.daysInMonth} BETWEEN 28 AND 31`),
    check(
      'payslips_loss_of_pay_check',
      sql`${t.lossOfPayDays} >= 0 AND ${t.lossOfPayDays} <= ${t.daysInMonth} AND ${halfDays(t.lossOfPayDays)}`,
    ),
    check(
      'payslips_paid_check',
      sql`num_nonnulls(${t.paidOn}, ${t.paidMode}, ${t.paidBy}, ${t.paidAt}) IN (0, 4) AND (${t.paidMode} IS NULL OR ${t.paidMode} IN ${inList(OPS_PAY_MODES)}) AND (${t.paidReference} IS NULL OR ${t.paidOn} IS NOT NULL)`,
    ),
  ],
);

/** A salary advance, recovered in monthly instalments from `recover_from` (a month's 1st). */
export const opsSalaryAdvances = ops.table(
  'salary_advances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: staffRefRestrict('staff_id').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    monthlyInstalmentPaise: paise('monthly_instalment_paise').notNull(),
    givenOn: isoDate('given_on').notNull(),
    recoverFrom: isoDate('recover_from').notNull(),
    reason: text('reason').notNull(),
    reference: text('reference'),
    createdBy: userRef('created_by').notNull(),
    cancelledAt: instant('cancelled_at'),
    cancelledBy: userRef('cancelled_by'),
    cancelReason: text('cancel_reason'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('salary_advances_staff_idx').on(t.staffId, t.givenOn),
    check(
      'salary_advances_amount_check',
      sql`${t.amountPaise} > 0 AND ${t.monthlyInstalmentPaise} > 0 AND ${t.monthlyInstalmentPaise} <= ${t.amountPaise}`,
    ),
    check('salary_advances_recover_check', firstOfMonth(t.recoverFrom)),
    check('salary_advances_reason_check', filled(t.reason)),
    check(
      'salary_advances_cancel_check',
      sql`num_nonnulls(${t.cancelledAt}, ${t.cancelledBy}, ${t.cancelReason}) IN (0, 3) AND length(trim(coalesce(${t.cancelReason}, 'x'))) > 0`,
    ),
  ],
);

/** One line of a payslip: an earning or a deduction, from a structure, LOP, an advance or by hand. */
export const opsPayslipLines = ops.table(
  'payslip_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payslipId: uuid('payslip_id')
      .notNull()
      .references(() => opsPayslips.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: OPS_PAYROLL_COMPONENT_KINDS }).notNull(),
    source: text('source', { enum: OPS_PAYSLIP_LINE_SOURCES }).notNull(),
    componentId: uuid('component_id').references(() => opsPayrollComponents.id, {
      onDelete: 'restrict',
    }),
    advanceId: uuid('advance_id').references(() => opsSalaryAdvances.id, { onDelete: 'restrict' }),
    /** As printed on the payslip. */
    label: text('label').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payslip_lines_payslip_idx').on(t.payslipId),
    index('payslip_lines_advance_idx').on(t.advanceId),
    uniqueIndex('payslip_lines_structure_key')
      .on(t.payslipId, t.componentId)
      .where(sql`${t.source} = 'structure'`),
    uniqueIndex('payslip_lines_loss_of_pay_key')
      .on(t.payslipId)
      .where(sql`${t.source} = 'loss_of_pay'`),
    uniqueIndex('payslip_lines_recovery_key')
      .on(t.payslipId, t.advanceId)
      .where(sql`${t.advanceId} IS NOT NULL`),
    check('payslip_lines_kind_check', sql`${t.kind} IN ${inList(OPS_PAYROLL_COMPONENT_KINDS)}`),
    check('payslip_lines_source_check', sql`${t.source} IN ${inList(OPS_PAYSLIP_LINE_SOURCES)}`),
    check('payslip_lines_amount_positive', sql`${t.amountPaise} > 0`),
    check('payslip_lines_label_check', filled(t.label)),
    check(
      'payslip_lines_shape_check',
      sql`(${t.source} <> 'structure' OR ${t.componentId} IS NOT NULL) AND (${t.source} = 'advance_recovery') = (${t.advanceId} IS NOT NULL) AND (${t.source} NOT IN ('loss_of_pay', 'advance_recovery') OR ${t.kind} = 'deduction') AND (${t.source} NOT IN ('one_off', 'adjustment') OR ${filled(t.note)})`,
    ),
  ],
);
