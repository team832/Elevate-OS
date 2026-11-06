import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate';
import { createTestDb } from '../../src/testing';
import { NOW, insert, seedBase } from './helpers';

const { entries } = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: { idx: number; tag: string }[] };
const pad = (n: number) => String(n).padStart(4, '0');

/** Applies one migration file the way drizzle's migrator does (statement by statement). */
async function apply(pg: PGlite, tag: string) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await pg.exec(statement);
  }
}

const SCHEMAS = `('core', 'marketing', 'academic', 'ops')`;
/** Columns, constraint definitions and index definitions (column order ignored). */
async function shape(pg: PGlite) {
  const result = await pg.query<{ s: string }>(`
    SELECT 'col ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type
      || ' nullable=' || is_nullable || ' default=' || coalesce(column_default, '') AS s
      FROM information_schema.columns WHERE table_schema IN ${SCHEMAS}
    UNION ALL SELECT 'con ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname IN ${SCHEMAS}
    UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname IN ${SCHEMAS}
    ORDER BY 1`);
  return result.rows.map((r) => r.s);
}

describe('migration journal', () => {
  it('numbers entries 0..n in order and each tag starts with its number', () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    expect(entries.map((e) => e.tag.slice(0, 5))).toEqual(entries.map((e) => `${pad(e.idx)}_`));
  });

  it('matches the .sql files and snapshots one to one', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(entries.map((e) => `${e.tag}.sql`)).toEqual(files);
    const snapshots = readdirSync(path.join(MIGRATIONS_DIR, 'meta'))
      .filter((f) => f.endsWith('_snapshot.json'))
      .sort();
    expect(snapshots).toEqual(entries.map((e) => `${pad(e.idx)}_snapshot.json`));
  });
});

describe('migrations apply in order on a fresh database', () => {
  const pg = new PGlite();
  afterAll(() => pg.close());

  it.each(entries)('applies $tag', async ({ tag }) => {
    await expect(apply(pg, tag)).resolves.toBeUndefined();
  });

  it('end in exactly the schema createTestDb builds from the TypeScript files (no drift)', async () => {
    const fresh = await createTestDb();
    try {
      const migrated = await shape(pg);
      expect(migrated.length).toBeGreaterThan(1000); // not vacuous: every column/constraint/index
      expect(migrated).toEqual(await shape(fresh.pglite));
    } finally {
      await fresh.close();
    }
  });
});

describe('0007 backfill', () => {
  const pg = new PGlite();
  const at0007 = entries.findIndex((e) => e.tag === '0007_admissions_lifecycle');
  let demo = '';
  beforeAll(async () => {
    for (const { tag } of entries.slice(0, at0007)) await apply(pg, tag);
    ({ demo } = await seedBase(pg));
    for (const n of [1, 2, 3]) {
      await insert(pg, 'ops.demo_sessions', { demo_id: demo, session_number: n, starts_at: NOW });
    }
    await apply(pg, entries[at0007]!.tag);
  });
  afterAll(() => pg.close());

  it('gives each legacy demo session day_number = session_number and the demo planned_day_count = sessions', async () => {
    const sessions = await pg.query(
      `SELECT session_number, day_number FROM ops.demo_sessions ORDER BY 1`,
    );
    expect(sessions.rows).toEqual([1, 2, 3].map((n) => ({ session_number: n, day_number: n })));
    const demos = await pg.query(`SELECT planned_day_count FROM ops.demos WHERE id = $1`, [demo]);
    expect(demos.rows).toEqual([{ planned_day_count: 3 }]);
  });
});

describe('0019 keeps existing availability records', () => {
  const pg = new PGlite();
  const at0019 = entries.findIndex((e) => e.tag.startsWith('0019_'));
  let record = '';
  beforeAll(async () => {
    for (const { tag } of entries.slice(0, at0019)) await apply(pg, tag);
    const { user, staff } = await seedBase(pg);
    record = await insert(pg, 'academic.teacher_unavailability', {
      staff_id: staff,
      from_date: '2026-11-03',
      to_date: '2026-11-04',
      reason: 'Sample reason',
      entered_by_user_id: user,
    });
    await apply(pg, entries[at0019]!.tag);
  });
  afterAll(() => pg.close());

  it('marks them as coordinator records with no HR leave', async () => {
    const rows = await pg.query(
      `SELECT source, ops_leave_record_id FROM academic.teacher_unavailability WHERE id = $1`,
      [record],
    );
    expect(rows.rows).toEqual([{ source: 'coordinator', ops_leave_record_id: null }]);
  });
});

describe('0020 keeps existing rows (rehearsal on top of 0019)', () => {
  const pg = new PGlite();
  const at0020 = entries.findIndex((e) => e.tag.startsWith('0020_'));
  beforeAll(async () => {
    for (const { tag } of entries.slice(0, at0020)) await apply(pg, tag);
    const { user, user2, staff, student, lead, admission } = await seedBase(pg);
    const add = (table: string, row: Record<string, unknown>) => insert(pg, table, row);
    const leave = {
      staff_id: staff,
      kind: 'Casual',
      from_date: '2026-11-03',
      to_date: '2026-11-04',
    };
    const record = await add('ops.leave_records', { ...leave, approved_by: user2 });
    const application = { ...leave, reason: 'Family function', applied_by: user };
    await add('ops.leave_applications', application);
    await add('ops.leave_applications', {
      ...application,
      status: 'approved',
      decided_by: user2,
      decided_at: NOW,
      leave_record_id: record,
    });
    const report = await add('ops.eod_reports', {
      staff_id: staff,
      period_start: '2026-11-05',
      period_end: '2026-11-05',
      report_date: '2026-11-05',
      snapshot: '{}',
      status: 'revision_requested',
      submitted_at: NOW,
      created_by: user,
    });
    await add('ops.eod_review_events', {
      report_id: report,
      kind: 'revision_requested',
      actor_user_id: user2,
      text: 'Add the calls',
    });
    await add('ops.fee_records', {
      code: 'FEE-000001',
      admission_id: admission,
      lead_id: lead,
      kind: 'received',
      amount_paise: 100_000,
      recorded_by: user,
    });
    const plan = await add('ops.fee_plans', {
      admission_id: admission,
      student_id: student,
      label: 'Sample plan',
      total_paise: 100_000,
      created_by: user,
    });
    await add('ops.fee_instalments', {
      plan_id: plan,
      sequence: 1,
      due_date: '2026-11-01',
      amount_paise: 100_000,
    });
    await add('ops.lead_sources', { code: 'SAMPLE_WALK_IN', label: 'Sample walk-in' });
    await add('ops.enquiries', {
      lead_id: lead,
      received_at: NOW,
      source_code: 'SAMPLE_WALK_IN',
      created_by: user,
    });
    const request = await add('ops.hr_requests', {
      sender_staff_id: staff,
      category: 'Leave',
      subject: 'Sample',
      message: 'Sample message',
      created_by: user,
    });
    await add('ops.hr_request_events', {
      request_id: request,
      kind: 'note',
      actor_user_id: user2,
      body: 'Seen',
    });
    const programme = await add('core.programmes', { code: 'SAMPLE_P', name: 'Sample' });
    const course = await add('academic.courses', {
      programme_id: programme,
      code: 'SAMPLE-C',
      family_code: 'SAMPLE',
      name: 'Sample course',
    });
    const batch = await add('academic.batches', {
      course_id: course,
      programme_id: programme,
      code: 'SB1',
      name: 'Sample B1',
      is_sample: true,
    });
    const academicStudent = await add('academic.students', { code: 'S1', full_name: 'Sample One' });
    const assessment = await add('academic.assessments', {
      code: 'SAMPLE-M1',
      title: 'Sample mock',
      kind: 'full_mock',
      batch_id: batch,
    });
    await add('academic.assessment_roster', {
      assessment_id: assessment,
      student_id: academicStudent,
      batch_id: batch,
      display_name_snapshot: 'Sample One',
    });
    await apply(pg, entries[at0020]!.tag);
  });
  afterAll(() => pg.close());

  it.each([
    [
      'SELECT day_part, on_behalf_of FROM ops.leave_applications',
      [
        { day_part: null, on_behalf_of: null },
        { day_part: null, on_behalf_of: null },
      ],
    ],
    ['SELECT day_part FROM ops.leave_records', [{ day_part: null }]],
    ['SELECT status FROM ops.eod_reports', [{ status: 'revision_requested' }]],
    ['SELECT on_behalf_of FROM ops.fee_records', [{ on_behalf_of: null }]],
    [
      'SELECT consent_text_version, consent_at FROM ops.enquiries',
      [{ consent_text_version: null, consent_at: null }],
    ],
    ['SELECT on_behalf_of FROM ops.hr_request_events', [{ on_behalf_of: null }]],
    [
      'SELECT venue_room_id, venue_online, admit_card_instructions FROM academic.assessments',
      [{ venue_room_id: null, venue_online: false, admit_card_instructions: null }],
    ],
    ['SELECT roll_number FROM academic.assessment_roster', [{ roll_number: null }]],
    ['SELECT count(*)::int AS n FROM pg_constraint WHERE NOT convalidated', [{ n: 0 }]],
  ])('%s', async (query, expected) => {
    expect((await pg.query(query)).rows).toEqual(expected);
  });

  it('accepts a portal login afterwards (F4-13)', async () => {
    await expect(
      insert(pg, 'core.users', { email: 'k7m2p9qx@portal.invalid', display_name: 'Sample portal' }),
    ).resolves.toBeTypeOf('string');
  });
});
