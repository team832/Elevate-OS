import { afterAll, beforeAll, describe } from 'vitest';
import { OPS_TEACHER_REPORT_KINDS } from '../../src/schema/index';
import { insert, runCases, setup, variants, vocab, type Row } from './helpers';

const TABLE = 'ops.teacher_report_exports';
let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
  await insert(ctx.pg, TABLE, report({ reference_code: 'TR-0000000001' }));
});
afterAll(() => ctx.t.close());

const report = (o: Row = {}): Row => ({
  staff_id: ctx.ids.staff,
  reference_code: 'TR-ABCDEFGHJ2',
  period_from: '2026-09-21',
  period_to: '2026-10-20',
  template_version: 'teacher-report/1',
  snapshot: '{}',
  snapshot_sha256: 'a'.repeat(64),
  generated_by: ctx.ids.user,
  ...o,
});

describe('teacher report exports', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'kind is internal only',
        TABLE,
        OPS_TEACHER_REPORT_KINDS,
        'teacher_report_exports_kind_check',
        (kind) => report({ kind }),
      ),
      variants('reference, period, hash and teacher are checked', TABLE, report, {
        ok: [{}, 'ok'],
        'student-style reference': [
          { reference_code: 'SR-ABCDEFGHJ2' },
          'teacher_report_exports_reference_format',
        ],
        'reused reference': [
          { reference_code: 'TR-0000000001' },
          'teacher_report_exports_reference_key',
        ],
        'period reversed': [{ period_from: '2026-10-21' }, 'teacher_report_exports_period_check'],
        'hash not hex': [
          { snapshot_sha256: 'x'.repeat(64) },
          'teacher_report_exports_sha256_format',
        ],
        'unknown teacher': [
          { staff_id: '00000000-0000-4000-8000-000000000000' },
          'teacher_report_exports_staff_id_staff_members_id_fk',
        ],
      }),
    ],
  );
});
