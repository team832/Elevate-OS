/**
 * Migration 0020 (FEATURES-W4), HR and payroll: staff checklists and assets, approval cover,
 * EOD "more detail", leave balances and half days (F4-09 … F4-12), payroll (F4-14). One case
 * per new CHECK and unique key; the rest of 0020 is in wave4-0020.test.ts.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_ABSENCE_CALL_OUTCOMES,
  OPS_LEAVE_ADJUSTMENT_KINDS,
  OPS_LEAVE_DAY_PARTS,
  OPS_ONBOARDING_TEMPLATE_STATUSES,
  OPS_PAY_MODES,
  OPS_PAYROLL_COMPONENT_KINDS,
  OPS_PAYROLL_COMPONENT_STATUSES,
  OPS_PAYROLL_RUN_STATUSES,
  OPS_PAYSLIP_LINE_SOURCES,
  OPS_STAFF_CHECKLIST_EVENTS,
  OPS_STAFF_CHECKLIST_ITEM_STATUSES,
} from '../../src/schema/index';
import { LATER, NOW, insert, one, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const by = () => ctx.ids.user;
const staff = () => ctx.ids.staff;

const leave = (o: Row = {}): Row => ({
  staff_id: staff(),
  kind: 'Casual',
  from_date: '2026-12-01',
  to_date: '2026-12-01',
  reason: 'Family function',
  applied_by: by(),
  ...o,
});
const allowance = (o: Row = {}): Row => ({
  staff_id: staff(),
  leave_type: 'Sick',
  year_start: '2026-04-01',
  days: 12,
  created_by: by(),
  ...o,
});
const adjustment = (o: Row = {}): Row => ({
  ...allowance({ leave_type: 'Casual', days: 1.5 }),
  kind: 'adjustment',
  reason: 'Worked on a holiday',
  ...o,
});
const delegation = (o: Row = {}): Row => ({
  approver_user_id: by(),
  cover_user_id: ctx.ids.user2,
  from_date: '2026-11-10',
  to_date: '2026-11-14',
  created_by: by(),
  ...o,
});
const asset = (o: Row = {}): Row => ({
  asset_type: 'Laptop',
  tag: 'LAP-02',
  staff_id: staff(),
  issued_on: '2026-11-01',
  issued_by: by(),
  ...o,
});
const template = (o: Row = {}): Row => ({
  event: 'leaving',
  version: 1,
  items: '[{"key":"id_card_returned","label":"ID card returned"}]',
  created_by: by(),
  ...o,
});
const item = (o: Row = {}): Row => ({
  checklist_id: ids.checklist,
  item_key: 'keys_given',
  label: 'Keys given',
  ...o,
});
const run = (o: Row = {}): Row => ({ month: '2027-01-01', created_by: by(), ...o });
const stage = (status: string): Row => ({
  status,
  ...(status === 'draft' ? {} : { submitted_by: ctx.ids.user2, submitted_at: NOW }),
  ...(status === 'approved' ? { approved_by: ids.user3, approved_at: LATER } : {}),
});
const payslip = (o: Row = {}): Row => ({
  run_id: ids.run2,
  staff_id: staff(),
  days_in_month: 30,
  ...o,
});
const paid = { paid_on: '2026-11-01', paid_mode: 'bank_transfer', paid_by: by, paid_at: NOW };
const line = (o: Row = {}): Row => ({
  payslip_id: ids.payslip2,
  kind: 'deduction',
  source: 'one_off',
  label: 'Canteen',
  amount_paise: 50_000,
  note: 'October canteen bill',
  created_by: by(),
  ...o,
});
const advance = (o: Row = {}): Row => ({
  staff_id: staff(),
  amount_paise: 1_000_000,
  monthly_instalment_paise: 250_000,
  given_on: '2026-10-15',
  recover_from: '2026-11-01',
  reason: 'Medical expense',
  created_by: by(),
  ...o,
});

beforeAll(async () => {
  ctx = await setup();
  const ins = (table: string, row: Row) => insert(ctx.pg, table, row);
  const add = async (name: string, table: string, row: Row) => (ids[name] = await ins(table, row));
  const user = (name: string, email: string) =>
    add(name, 'core.users', { email, display_name: 'Sample (fictional)' });
  await user('user3', 'approver@example.test');
  await add('staff2', 'core.staff_members', { full_name: 'Sample Counsellor' });
  await ins('ops.leave_allowances', allowance());
  await ins('ops.leave_adjustments', adjustment({ kind: 'carry_forward', days: 2 }));
  await ins('ops.staff_assets', asset({ tag: 'LAP-01' }));
  await ins('ops.staff_checklist_templates', template({ status: 'active' }));
  await add(
    'template',
    'ops.staff_checklist_templates',
    template({ event: 'joining', status: 'active' }),
  );
  await add('checklist', 'ops.staff_checklists', {
    staff_id: staff(),
    event: 'joining',
    template_id: ids.template,
    created_by: by(),
  });
  await ins('ops.staff_checklist_items', item());
  await add('basic', 'ops.payroll_components', {
    code: 'basic',
    name: 'Basic',
    kind: 'earning',
    created_by: by(),
  });
  await add('structure', 'ops.salary_structures', {
    staff_id: staff(),
    effective_from: '2026-04-01',
    created_by: by(),
  });
  await ins('ops.salary_structure_lines', {
    structure_id: ids.structure,
    component_id: ids.basic,
    monthly_amount_paise: 3_000_000,
  });
  await add('run', 'ops.payroll_runs', run({ month: '2026-10-01' }));
  await add('run2', 'ops.payroll_runs', run({ month: '2026-11-01' }));
  await add('payslip', 'ops.payslips', payslip({ run_id: ids.run }));
  await add('payslip2', 'ops.payslips', payslip({ run_id: ids.run, staff_id: ids.staff2 }));
  await add('advance', 'ops.salary_advances', advance());
  const onFirst = { payslip_id: ids.payslip, note: null };
  await ins(
    'ops.payslip_lines',
    line({ ...onFirst, kind: 'earning', source: 'structure', component_id: ids.basic }),
  );
  await ins('ops.payslip_lines', line({ ...onFirst, source: 'loss_of_pay' }));
  await ins(
    'ops.payslip_lines',
    line({ ...onFirst, source: 'advance_recovery', advance_id: ids.advance }),
  );
  await add('report', 'ops.eod_reports', {
    staff_id: staff(),
    period_start: '2026-11-05',
    period_end: '2026-11-05',
    report_date: '2026-11-05',
    snapshot: '{}',
    status: 'submitted',
    submitted_at: NOW,
    created_by: by(),
  });
  await add('request', 'ops.hr_requests', {
    sender_staff_id: staff(),
    category: 'Leave',
    subject: 'Leave question',
    message: 'Sample message',
    created_by: by(),
  });
});
afterAll(() => ctx.t.close());

describe('0020 HR: leave, cover, checklists, assets, EOD (F4-09 … F4-12)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'leave day parts (OPS_LEAVE_DAY_PARTS)',
        'ops.leave_applications',
        OPS_LEAVE_DAY_PARTS,
        'leave_applications_day_part_check',
        (v) => leave({ day_part: v }),
      ),
      variants('half-day leave', 'ops.leave_applications', leave, {
        'half of a two-day leave': [
          { day_part: 'first_half', to_date: '2026-12-02' },
          'leave_applications_day_part_check',
        ],
        'decided for an approver': [
          {
            status: 'rejected',
            decided_by: by,
            decided_at: NOW,
            decision_note: 'Exams',
            on_behalf_of: () => ctx.ids.user2,
          },
          'ok',
        ],
        'on behalf without a decision': [
          { on_behalf_of: () => ctx.ids.user2 },
          'leave_applications_on_behalf_check',
        ],
        'decided on behalf of oneself': [
          {
            status: 'rejected',
            decided_by: by,
            decided_at: NOW,
            decision_note: 'Exams',
            on_behalf_of: by,
          },
          'leave_applications_on_behalf_check',
        ],
      }),
      variants(
        'half-day leave records',
        'ops.leave_records',
        (o) => ({
          staff_id: staff(),
          from_date: '2026-12-03',
          to_date: '2026-12-03',
          kind: 'Casual',
          approved_by: by(),
          ...o,
        }),
        {
          'second half of one day': [{ day_part: 'second_half' }, 'ok'],
          'half of a range': [
            { day_part: 'second_half', to_date: '2026-12-04' },
            'leave_records_day_part_check',
          ],
        },
      ),
      variants('leave allowances', 'ops.leave_allowances', allowance, {
        'half days': [{ leave_type: 'Casual', days: 7.5 }, 'ok'],
        'not set by default': [{ leave_type: 'Earned', days: 0 }, 'ok'],
        'a second allowance for the year': [{}, 'leave_allowances_year_key'],
        'a quarter day': [{ leave_type: 'Casual', days: 7.25 }, 'leave_allowances_days_check'],
        negative: [{ leave_type: 'Casual', days: -1 }, 'leave_allowances_days_check'],
        'blank type': [{ leave_type: ' ' }, 'leave_allowances_type_check'],
      }),
      vocab(
        'leave adjustment kinds',
        'ops.leave_adjustments',
        OPS_LEAVE_ADJUSTMENT_KINDS,
        'leave_adjustments_kind_check',
        (v) => adjustment({ kind: v, leave_type: 'Earned' }),
      ),
      variants('leave adjustments', 'ops.leave_adjustments', adjustment, {
        'days taken off': [{ days: -2 }, 'ok'],
        'a second carry-forward': [
          { kind: 'carry_forward', days: 1 },
          'leave_adjustments_one_carry_key',
        ],
        'a negative carry-forward': [
          { kind: 'carry_forward', days: -1, leave_type: 'Earned' },
          'leave_adjustments_days_check',
        ],
        zero: [{ days: 0 }, 'leave_adjustments_days_check'],
        'no reason': [{ reason: ' ' }, 'leave_adjustments_text_check'],
      }),
      variants('approval cover', 'ops.approval_delegations', delegation, {
        'a week of cover': [{}, 'ok'],
        'cover for oneself': [{ cover_user_id: by }, 'approval_delegations_not_self'],
        'ends before it starts': [{ to_date: '2026-11-09' }, 'approval_delegations_dates_check'],
        'revoked without who': [{ revoked_at: NOW }, 'approval_delegations_revoked_check'],
      }),
      variants(
        'HR request decided for HR',
        'ops.hr_request_events',
        (o) => ({
          request_id: ids.request,
          kind: 'reviewed',
          actor_user_id: by(),
          ...o,
        }),
        {
          'on behalf of another': [{ on_behalf_of: () => ctx.ids.user2 }, 'ok'],
          'on behalf of oneself': [{ on_behalf_of: by }, 'hr_request_events_on_behalf_check'],
        },
      ),
      variants(
        'ask for more detail',
        'ops.eod_review_events',
        (o) => ({
          report_id: ids.report,
          kind: 'more_detail_requested',
          actor_user_id: by(),
          ...o,
        }),
        {
          'with a note': [{ text: 'Which leads did you call?' }, 'ok'],
          'without a note': [{}, 'eod_review_events_text_check'],
        },
      ),
      vocab(
        'checklist events',
        'ops.staff_checklists',
        OPS_STAFF_CHECKLIST_EVENTS,
        'staff_checklists_event_check',
        (v) => ({
          staff_id: ids.staff2,
          event: v,
          template_id: ids.template,
          created_by: by(),
        }),
      ),
      one(
        'one checklist per staff per event',
        'ops.staff_checklists',
        () => ({
          staff_id: staff(),
          event: 'joining',
          template_id: ids.template,
          created_by: by(),
        }),
        'staff_checklists_staff_event_key',
      ),
      vocab(
        'template events',
        'ops.staff_checklist_templates',
        OPS_STAFF_CHECKLIST_EVENTS,
        'staff_checklist_templates_event_check',
        (v) => template({ event: v, version: 9 }),
      ),
      // `active` is proven by the two seeded templates (a third would break one-active-per-event).
      vocab(
        'template statuses',
        'ops.staff_checklist_templates',
        OPS_ONBOARDING_TEMPLATE_STATUSES.filter((v) => v !== 'active'),
        'staff_checklist_templates_status_check',
        (v) => template({ status: v, version: 9 }),
      ),
      variants('checklist templates', 'ops.staff_checklist_templates', template, {
        'a second version 1': [{}, 'staff_checklist_templates_version_key'],
        'a second active version': [
          { version: 2, status: 'active' },
          'staff_checklist_templates_one_active_key',
        ],
        'version zero': [{ version: 0 }, 'staff_checklist_templates_version_check'],
        'items not a list': [{ version: 2, items: '{}' }, 'staff_checklist_templates_items_check'],
      }),
      vocab(
        'checklist item statuses',
        'ops.staff_checklist_items',
        OPS_STAFF_CHECKLIST_ITEM_STATUSES,
        'staff_checklist_items_status_check',
        (v) =>
          item({
            item_key: 'devices',
            status: v,
            ...(v === 'pending' ? {} : { done_by: by(), done_at: NOW }),
          }),
      ),
      variants('checklist items', 'ops.staff_checklist_items', item, {
        'an item twice': [{}, 'staff_checklist_items_key'],
        'done without who': [
          { item_key: 'devices', status: 'done', done_at: NOW },
          'staff_checklist_items_done_check',
        ],
        'pending with a stamp': [
          { item_key: 'devices', done_by: by, done_at: NOW },
          'staff_checklist_items_done_check',
        ],
        'key with spaces': [{ item_key: 'Keys given' }, 'staff_checklist_items_key_format'],
        'blank label': [{ item_key: 'devices', label: ' ' }, 'staff_checklist_items_label_check'],
      }),
      variants('staff assets', 'ops.staff_assets', asset, {
        'another item': [{}, 'ok'],
        'a tag already out': [{ tag: 'LAP-01' }, 'staff_assets_tag_out_key'],
        'a returned item with that tag': [
          { tag: 'LAP-01', returned_on: '2026-11-05', returned_by: by },
          'ok',
        ],
        'returned before issued': [
          { returned_on: '2026-10-31', returned_by: by },
          'staff_assets_returned_check',
        ],
        'returned without who': [{ returned_on: '2026-11-05' }, 'staff_assets_returned_check'],
        'blank type': [{ asset_type: ' ' }, 'staff_assets_text_check'],
      }),
      vocab(
        'absence call outcomes',
        'ops.absence_calls',
        OPS_ABSENCE_CALL_OUTCOMES,
        'absence_calls_outcome_check',
        (v) => ({
          student_id: ctx.ids.student,
          outcome: v,
          called_by: by(),
        }),
      ),
    ],
  );
});

describe('0020 payroll (F4-14)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'component kinds',
        'ops.payroll_components',
        OPS_PAYROLL_COMPONENT_KINDS,
        'payroll_components_kind_check',
        (v) => ({ code: 'hra', name: 'HRA', kind: v, created_by: by() }),
      ),
      vocab(
        'component statuses',
        'ops.payroll_components',
        OPS_PAYROLL_COMPONENT_STATUSES,
        'payroll_components_status_check',
        (v) => ({ code: 'hra', name: 'HRA', kind: 'earning', status: v, created_by: by() }),
      ),
      variants(
        'components',
        'ops.payroll_components',
        (o) => ({ code: 'hra', name: 'HRA', kind: 'earning', created_by: by(), ...o }),
        {
          'a code twice': [{ code: 'basic' }, 'payroll_components_code_key'],
          'code with spaces': [{ code: 'House rent' }, 'payroll_components_code_format'],
          'blank name': [{ name: ' ' }, 'payroll_components_name_check'],
        },
      ),
      one(
        'one structure per staff per start day',
        'ops.salary_structures',
        () => ({ staff_id: staff(), effective_from: '2026-04-01', created_by: by() }),
        'salary_structures_staff_from_key',
      ),
      variants(
        'structure lines',
        'ops.salary_structure_lines',
        (o) => ({
          structure_id: ids.structure,
          component_id: ids.basic,
          monthly_amount_paise: 1,
          ...o,
        }),
        {
          'a component twice': [{}, 'salary_structure_lines_pkey'],
          'zero amount': [{ monthly_amount_paise: 0 }, 'salary_structure_lines_amount_positive'],
        },
      ),
      vocab(
        'run statuses',
        'ops.payroll_runs',
        OPS_PAYROLL_RUN_STATUSES,
        'payroll_runs_status_check',
        (v) => run(stage(v)),
      ),
      variants('runs', 'ops.payroll_runs', run, {
        'a second run for a month': [{ month: '2026-10-01' }, 'payroll_runs_month_key'],
        'month not on the 1st': [{ month: '2027-01-15' }, 'payroll_runs_month_check'],
        'submitted without who': [
          { status: 'submitted', submitted_at: NOW },
          'payroll_runs_stage_check',
        ],
        'approved without being submitted': [
          { status: 'approved', approved_by: id('user3'), approved_at: NOW },
          'payroll_runs_stage_check',
        ],
        'approved by its maker': [
          {
            status: 'approved',
            submitted_by: () => ctx.ids.user2,
            submitted_at: NOW,
            approved_by: by,
            approved_at: LATER,
          },
          'payroll_runs_approver_check',
        ],
        'approved by its submitter': [
          {
            status: 'approved',
            submitted_by: () => ctx.ids.user2,
            submitted_at: NOW,
            approved_by: () => ctx.ids.user2,
            approved_at: LATER,
          },
          'payroll_runs_approver_check',
        ],
      }),
      vocab('pay modes', 'ops.payslips', OPS_PAY_MODES, 'payslips_paid_check', (v) =>
        payslip({ ...paid, paid_by: by(), paid_mode: v }),
      ),
      variants('payslips', 'ops.payslips', payslip, {
        'half a day of loss of pay': [{ loss_of_pay_days: 1.5 }, 'ok'],
        'a second payslip in a run': [{ run_id: id('run') }, 'payslips_run_staff_key'],
        '32 days': [{ days_in_month: 32 }, 'payslips_days_check'],
        'more loss of pay than days': [{ loss_of_pay_days: 31 }, 'payslips_loss_of_pay_check'],
        'a quarter day': [{ loss_of_pay_days: 0.25 }, 'payslips_loss_of_pay_check'],
        'paid without a mode': [{ ...paid, paid_mode: null }, 'payslips_paid_check'],
        'a reference but not paid': [{ paid_reference: 'UTR123' }, 'payslips_paid_check'],
      }),
      variants('advances', 'ops.salary_advances', advance, {
        'instalment above the amount': [
          { monthly_instalment_paise: 2_000_000 },
          'salary_advances_amount_check',
        ],
        'zero amount': [{ amount_paise: 0 }, 'salary_advances_amount_check'],
        'recovery not from a 1st': [
          { recover_from: '2026-11-15' },
          'salary_advances_recover_check',
        ],
        'blank reason': [{ reason: ' ' }, 'salary_advances_reason_check'],
        'cancelled without a reason': [
          { cancelled_at: NOW, cancelled_by: by },
          'salary_advances_cancel_check',
        ],
      }),
      vocab(
        'line kinds',
        'ops.payslip_lines',
        OPS_PAYROLL_COMPONENT_KINDS,
        'payslip_lines_kind_check',
        (v) => line({ kind: v }),
      ),
      vocab(
        'line sources',
        'ops.payslip_lines',
        OPS_PAYSLIP_LINE_SOURCES,
        'payslip_lines_source_check',
        (v) =>
          line({
            source: v,
            kind: v === 'structure' ? 'earning' : 'deduction',
            component_id: v === 'structure' ? ids.basic : null,
            advance_id: v === 'advance_recovery' ? ids.advance : null,
          }),
      ),
      variants('payslip lines', 'ops.payslip_lines', line, {
        'a component twice': [
          {
            payslip_id: id('payslip'),
            kind: 'earning',
            source: 'structure',
            component_id: id('basic'),
          },
          'payslip_lines_structure_key',
        ],
        'loss of pay twice': [
          { payslip_id: id('payslip'), source: 'loss_of_pay' },
          'payslip_lines_loss_of_pay_key',
        ],
        'an advance twice': [
          { payslip_id: id('payslip'), source: 'advance_recovery', advance_id: id('advance') },
          'payslip_lines_recovery_key',
        ],
        'structure line without component': [
          { kind: 'earning', source: 'structure' },
          'payslip_lines_shape_check',
        ],
        'loss of pay as earning': [
          { kind: 'earning', source: 'loss_of_pay' },
          'payslip_lines_shape_check',
        ],
        'recovery without advance': [{ source: 'advance_recovery' }, 'payslip_lines_shape_check'],
        'one-off without a note': [{ note: null }, 'payslip_lines_shape_check'],
        'zero amount': [{ amount_paise: 0 }, 'payslip_lines_amount_positive'],
        'blank label': [{ label: ' ' }, 'payslip_lines_label_check'],
      }),
    ],
  );
});
