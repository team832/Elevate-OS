import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_DEMO_ATTENDANCE,
  OPS_DEMO_MOCK_STATUSES,
  OPS_DEMO_OUTCOMES,
  OPS_DEMO_SESSION_FIELDS,
} from '../../src/schema/index';
import { NOW, insert, one, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let admission2 = '';
let session1 = '';
beforeAll(async () => {
  ctx = await setup();
  const { pg, ids } = ctx;
  admission2 = await insert(pg, 'ops.admissions', {
    code: 'ADM-000002',
    lead_id: ids.lead,
    created_by: ids.user,
    status: 'lost',
  });
  session1 = await insert(pg, 'ops.demo_sessions', session({ session_number: 1 }));
});
afterAll(() => ctx.t.close());

function session(o: Row = {}): Row {
  return { demo_id: ctx.ids.demo, session_number: 2, day_number: 1, starts_at: NOW, ...o };
}
function demo(o: Row = {}): Row {
  const { ids } = ctx;
  return {
    admission_id: admission2,
    lead_id: ids.lead,
    fee_terms_state: 'approved',
    planned_session_count: 3,
    created_by: ids.user,
    ...o,
  };
}
const recorded = () => ({ recorded_at: NOW, recorded_by: ctx.ids.user });

describe('demo sessions', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'attendance values (OPS_DEMO_ATTENDANCE, incl. late and excused)',
        'ops.demo_sessions',
        OPS_DEMO_ATTENDANCE,
        'demo_sessions_attendance_check',
        (v) => session({ attendance: v, ...recorded() }),
      ),
      {
        rule: 'recorded attendance (present, absent, late, excused) needs who and when',
        table: 'ops.demo_sessions',
        values: ['present', 'absent', 'late', 'excused', 'scheduled'],
        build: (v) => session({ attendance: v }),
        expected: {
          present: 'demo_sessions_recorded_has_actor',
          absent: 'demo_sessions_recorded_has_actor',
          late: 'demo_sessions_recorded_has_actor',
          excused: 'demo_sessions_recorded_has_actor',
          scheduled: 'ok',
        },
      },
      {
        rule: 'session number is 1..30',
        table: 'ops.demo_sessions',
        values: ['0', '2', '30', '31'],
        build: (v) => session({ session_number: v }),
        expected: {
          0: 'demo_sessions_number_check',
          2: 'ok',
          30: 'ok',
          31: 'demo_sessions_number_check',
        },
      },
      {
        rule: 'demo day is 1..10',
        table: 'ops.demo_sessions',
        values: ['0', '1', '10', '11'],
        build: (v) => session({ day_number: v }),
        expected: {
          0: 'demo_sessions_day_check',
          1: 'ok',
          10: 'ok',
          11: 'demo_sessions_day_check',
        },
      },
      one(
        'a session number is used once per demo',
        'ops.demo_sessions',
        () => session({ session_number: 1 }),
        'demo_sessions_number_key',
      ),
      one(
        'a session ends after it starts',
        'ops.demo_sessions',
        () => session({ ends_at: NOW }),
        'demo_sessions_ends_after_start',
      ),
      vocab(
        'mock statuses (OPS_DEMO_MOCK_STATUSES)',
        'ops.demo_sessions',
        OPS_DEMO_MOCK_STATUSES,
        'demo_sessions_mock_check',
        (v) => session({ mock_status: v }),
      ),
      vocab(
        'session change fields (OPS_DEMO_SESSION_FIELDS)',
        'ops.demo_session_changes',
        OPS_DEMO_SESSION_FIELDS,
        'demo_session_changes_field_check',
        (v) => ({ session_id: session1, field: v, actor_user_id: ctx.ids.user }),
      ),
    ],
  );
});

describe('demos', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'demo outcomes (OPS_DEMO_OUTCOMES, incl. no_show)',
        'ops.demos',
        OPS_DEMO_OUTCOMES,
        'demos_outcome_check',
        (v) =>
          demo({
            outcome: v,
            outcome_at: v === 'open' ? null : NOW,
            outcome_reason: 'Family decided',
            converted_admission_id: v === 'converted' ? admission2 : null,
          }),
      ),
      variants(
        'a decided outcome records when, why and (converted) which admission',
        'ops.demos',
        demo,
        {
          'converted without admission': [
            { outcome: 'converted', outcome_at: NOW },
            'demos_converted_link',
          ],
          'declined without reason': [
            { outcome: 'declined', outcome_at: NOW },
            'demos_outcome_reason',
          ],
          'declined without time': [
            { outcome: 'declined', outcome_reason: 'Chose another centre' },
            'demos_outcome_recorded',
          ],
        },
      ),
      {
        rule: 'demo fee is integer paise ≥ 0',
        table: 'ops.demos',
        values: ['-1', '0', '150000'],
        build: (v) => demo({ fee_amount_paise: v }),
        expected: { '-1': 'demos_fee_positive', 0: 'ok', 150000: 'ok' },
      },
      variants('planned classes 1..30 and planned days 1..10', 'ops.demos', demo, {
        'sessions 31': [{ planned_session_count: 31 }, 'demos_planned_sessions_check'],
        'days 0': [{ planned_day_count: 0 }, 'demos_planned_days_check'],
        'days 11': [{ planned_day_count: 11 }, 'demos_planned_days_check'],
        'days 10': [{ planned_day_count: 10 }, 'ok'],
      }),
      one(
        'one open demo per admission',
        'ops.demos',
        () => demo({ admission_id: ctx.ids.admission }),
        'demos_one_open_per_admission',
      ),
    ],
  );
});
