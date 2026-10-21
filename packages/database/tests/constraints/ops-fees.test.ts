import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS_FEE_CHARGE_CATEGORIES, OPS_FEE_RECORD_KINDS } from '../../src/schema/index';
import { NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let plan = '';
beforeAll(async () => {
  ctx = await setup();
  plan = await insert(ctx.pg, 'ops.fee_plans', feePlan());
  await insert(ctx.pg, 'ops.fee_instalments', {
    plan_id: plan,
    sequence: 1,
    due_date: '2026-11-01',
    amount_paise: 5_000_000,
  });
});
afterAll(() => ctx.t.close());

function feePlan(o: Row = {}): Row {
  const { ids } = ctx;
  return {
    admission_id: ids.admission,
    student_id: ids.student,
    label: 'Sample plan',
    total_paise: 10_000_000,
    created_by: ids.user,
    ...o,
  };
}
const fee = (o: Row = {}): Row => {
  const { ids } = ctx;
  return {
    code: 'FEE-000001',
    admission_id: ids.admission,
    lead_id: ids.lead,
    kind: 'received',
    amount_paise: 100_000,
    recorded_by: ids.user,
    ...o,
  };
};
const SELF = '00000000-0000-4000-8000-000000000001';

describe('fee ledger (ops.fee_records)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'ledger kinds (OPS_FEE_RECORD_KINDS)',
        'ops.fee_records',
        OPS_FEE_RECORD_KINDS,
        'fee_records_kind_check',
        (v) => fee({ kind: v, direction: v === 'adjustment' ? 'credit' : null }),
      ),
      vocab(
        'charge categories (OPS_FEE_CHARGE_CATEGORIES)',
        'ops.fee_records',
        OPS_FEE_CHARGE_CATEGORIES,
        'fee_records_category_check',
        (v) => fee({ charge_category: v, demo_id: ctx.ids.demo }),
      ),
      variants(
        'amounts are positive INR paise; codes and methods are fixed formats',
        'ops.fee_records',
        fee,
        {
          'amount 0': [{ amount_paise: 0 }, 'fee_records_amount_positive'],
          'amount -100': [{ amount_paise: -100 }, 'fee_records_amount_positive'],
          'currency USD': [{ currency: 'USD' }, 'fee_records_currency_inr'],
          'code FEE-1': [{ code: 'FEE-1' }, 'fee_records_code_format'],
          'method bogus': [{ method: 'bogus' }, 'fee_records_method_check'],
          'method upi': [{ method: 'upi' }, 'ok'],
        },
      ),
      variants(
        'links: demo charge names its demo, adjustments have a direction, nothing reverses itself',
        'ops.fee_records',
        fee,
        {
          'demo charge without demo': [{ charge_category: 'demo' }, 'fee_records_demo_link'],
          'adjustment without direction': [{ kind: 'adjustment' }, 'fee_records_direction_check'],
          'received with direction': [{ direction: 'credit' }, 'fee_records_direction_check'],
          'reverses itself': [
            { id: SELF, reverses_record_id: SELF },
            'fee_records_not_self_reversal',
          ],
        },
      ),
      variants('verified by a second person; voided with who and why', 'ops.fee_records', fee, {
        'verified without verifier': [{ status: 'verified' }, 'fee_records_verified_check'],
        'verified by the recorder': [
          { status: 'verified', verified_by: () => ctx.ids.user, verified_at: NOW },
          'fee_records_verified_check',
        ],
        'verified by a second person': [
          { status: 'verified', verified_by: () => ctx.ids.user2, verified_at: NOW },
          'ok',
        ],
        'voided without reason': [
          { status: 'voided', voided_by: () => ctx.ids.user, voided_at: NOW },
          'fee_records_voided_check',
        ],
      }),
    ],
  );
});

describe('fee plans and instalments', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'a plan is approved to be active, closed with a reason, versioned, one open per admission',
        'ops.fee_plans',
        feePlan,
        {
          'active without approval': [{ status: 'active' }, 'fee_plans_approved_check'],
          'closed without reason': [{ status: 'closed' }, 'fee_plans_closed_check'],
          'total 0': [{ total_paise: 0 }, 'fee_plans_total_positive'],
          'version 2 without previous plan': [
            { version: 2, adjustment_reason: 'Scholarship' },
            'fee_plans_version_check',
          ],
          'year 2026-2027': [{ academic_year: '2026-2027' }, 'fee_plans_year_format'],
          'second open plan': [{}, 'fee_plans_one_open_per_admission'],
        },
      ),
      variants(
        'instalments: positive amount, sequence ≥ 1 and unique per plan',
        'ops.fee_instalments',
        (o) => ({
          plan_id: plan,
          sequence: 2,
          due_date: '2027-02-01',
          amount_paise: 2_500_000,
          ...o,
        }),
        {
          'sequence taken': [{ sequence: 1 }, 'fee_instalments_plan_sequence_key'],
          'sequence 0': [{ sequence: 0 }, 'fee_instalments_sequence_positive'],
          'amount 0': [{ amount_paise: 0 }, 'fee_instalments_amount_positive'],
          'next sequence': [{}, 'ok'],
        },
      ),
    ],
  );
});

it('stores every *_paise money column as bigint (integer paise, never float)', async () => {
  const result = await ctx.pg.query<{ col: string; data_type: string }>(
    `SELECT table_schema || '.' || table_name || '.' || column_name AS col, data_type FROM information_schema.columns
     WHERE table_schema IN ('core', 'marketing', 'academic', 'ops') AND column_name LIKE '%\\_paise' ORDER BY 1`,
  );
  expect(result.rows.length).toBeGreaterThan(5);
  expect(result.rows.filter((r) => r.data_type !== 'bigint')).toEqual([]);
});
