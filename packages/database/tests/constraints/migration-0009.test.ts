/**
 * Migration 0009 on a database that already holds 0008-shaped rows: ids are kept and the
 * hand-written backfills set only facts already on record (BRIEF test 24).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate';
import { NOW, insert, seedBase } from './helpers';

const { entries } = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: { tag: string }[] };
const apply = async (pg: PGlite, tag: string) => {
  for (const s of readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  ))
    if (s.trim()) await pg.exec(s);
};
const one = async <T>(pg: PGlite, sql: string) => (await pg.query<T>(sql)).rows;

describe('0009 backfills on 0008 data', () => {
  const pg = new PGlite();
  const ids: Record<string, string> = {};
  afterAll(() => pg.close());

  beforeAll(async () => {
    for (const { tag } of entries.slice(0, 9)) await apply(pg, tag);
    const user = await insert(pg, 'core.users', {
      email: 'migrator@example.test',
      display_name: 'Migrator (fictional)',
    });
    const manager = await insert(pg, 'core.staff_members', { full_name: 'Sample Manager' });
    const staff = await insert(pg, 'core.staff_members', { full_name: 'Sample Teacher' });
    const programme = await insert(pg, 'core.programmes', {
      code: 'SAMPLE_P',
      name: 'Sample programme',
    });
    const course = await insert(pg, 'academic.courses', {
      code: 'SAMPLE-C',
      name: 'Sample course',
      family_code: 'SAMPLE',
      programme_id: programme,
    });
    const subject = await insert(pg, 'academic.subjects', {
      course_id: course,
      code: 'S1',
      name: 'Sample subject',
    });
    const batch = await insert(pg, 'academic.batches', {
      code: 'SAMPLE-B',
      name: 'Sample batch',
      programme_id: programme,
      course_id: course,
    });
    const student = await insert(pg, 'academic.students', {
      code: 'SAMPLE-1',
      full_name: 'Sample Student',
    });
    const enrol = (status: string, start: string | null) =>
      insert(pg, 'academic.enrolments', {
        student_id: student,
        programme_id: programme,
        course_id: null,
        batch_id: batch,
        status,
        start_date: start,
        source: 'manual',
        manual_reason: 'test',
        created_by_user_id: user,
      });
    ids.active = await enrol('active', '2026-06-01');
    ids.withdrawn = await enrol('withdrawn', '2026-05-01');
    // Created by the admission intake: no creating user on record.
    const student2 = await insert(pg, 'academic.students', {
      code: 'SAMPLE-2',
      full_name: 'Sample Second',
    });
    ids.intake = await insert(pg, 'academic.enrolments', {
      student_id: student2,
      programme_id: programme,
      batch_id: batch,
      status: 'active',
      source: 'admission_event',
      request_event_id: '00000000-0000-4000-8000-000000000009',
    });
    ids.ended = await insert(pg, 'academic.teacher_assignments', {
      batch_id: batch,
      subject_id: subject,
      staff_member_id: staff,
      start_date: '2026-06-01',
      end_date: '2026-09-30',
      status: 'active',
    });
    const assessment = await insert(pg, 'academic.assessments', {
      batch_id: batch,
      code: 'SAMPLE-T1',
      title: 'Sample test',
      kind: 'practice',
    });
    const key = await insert(pg, 'academic.answer_keys', {
      assessment_id: assessment,
      version: 1,
      answers: '{}',
      created_by_user_id: user,
    });
    const run = await insert(pg, 'academic.result_runs', {
      assessment_id: assessment,
      version: 1,
      answer_key_id: key,
      status: 'final',
      rule_snapshot: '{}',
      students_scored: 0,
      students_absent: 1,
      finalised_by_user_id: user,
    });
    const attempt = await insert(pg, 'academic.attempts', {
      assessment_id: assessment,
      student_id: student,
      status: 'absent',
      entered_by_user_id: user,
    });
    ids.result = await insert(pg, 'academic.results', {
      run_id: run,
      assessment_id: assessment,
      attempt_id: attempt,
      student_id: student,
      max_score: 10,
      section_scores: '[]',
      absent: true,
    });
    ids.assigned = await insert(pg, 'ops.staff_tasks', {
      staff_id: staff,
      assigned_by_staff_id: manager,
      title: 'Sample assigned',
      due_on: '2026-10-20',
      created_by: user,
    });
    ids.self = await insert(pg, 'ops.staff_tasks', {
      staff_id: staff,
      title: 'Sample self-logged',
      due_on: '2026-10-20',
      created_by: user,
    });
    ids.eod = await insert(pg, 'ops.eod_reports', {
      staff_id: staff,
      report_date: '2026-10-20',
      snapshot: '{"done":[]}',
      summary: 'Sample summary',
      status: 'submitted',
      submitted_at: NOW,
      created_by: user,
    });
    ids.draft = await insert(pg, 'ops.eod_reports', {
      staff_id: staff,
      report_date: '2026-10-21',
      snapshot: '{}',
      created_by: user,
    });
    await apply(pg, entries[9]!.tag);
  }, 60_000);

  it('absent results get state absent', async () => {
    expect(await one(pg, `SELECT id, state FROM academic.results`)).toEqual([
      { id: ids.result, state: 'absent' },
    ]);
  });

  it('an assignment with a stored end date is ended', async () => {
    expect(
      await one(pg, `SELECT status FROM academic.teacher_assignments WHERE id = '${ids.ended}'`),
    ).toEqual([{ status: 'ended' }]);
  });

  it('active enrolments get an open placement (system-created ones with no placer); the withdrawn one gets none', async () => {
    const rows = await one<{
      enrolment_id: string;
      placed_by_user_id: string | null;
      end_date: null;
    }>(pg, `SELECT enrolment_id, placed_by_user_id, end_date FROM academic.batch_placements`);
    expect(
      Object.fromEntries(rows.map((r) => [r.enrolment_id, r.placed_by_user_id === null])),
    ).toEqual({
      [ids.active!]: false,
      [ids.intake!]: true,
    });
    expect(rows.every((r) => r.end_date === null)).toBe(true);
  });

  it('task source comes from the assigner already on the row', async () => {
    const rows = await one<{ id: string; source: string }>(
      pg,
      `SELECT id, source FROM ops.staff_tasks ORDER BY title`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.source]))).toEqual({
      [ids.assigned!]: 'manager',
      [ids.self!]: 'self',
    });
  });

  it('a submitted EOD becomes version 1 of itself; drafts get no version', async () => {
    expect(
      await one(
        pg,
        `SELECT report_id, version, narrative->>'summary' AS summary FROM ops.eod_report_versions`,
      ),
    ).toEqual([{ report_id: ids.eod, version: 1, summary: 'Sample summary' }]);
    expect(
      await one(pg, `SELECT id, current_version FROM ops.eod_reports ORDER BY report_date`),
    ).toEqual([
      { id: ids.eod, current_version: 1 },
      { id: ids.draft, current_version: 0 },
    ]);
  });
});

describe('0010 links Academic students to core students only where unambiguous; 0011 copies the sample flag', () => {
  const pg = new PGlite();
  afterAll(() => pg.close());

  it('links the clean pair and leaves duplicate rows of one child unlinked', async () => {
    for (const { tag } of entries.slice(0, 10)) await apply(pg, tag);
    const { user, lead, student, student2, admission } = await seedBase(pg);
    const linked = await insert(pg, 'academic.students', {
      code: 'SAMPLE-L',
      full_name: 'Sample Linked',
    });
    const dupA = await insert(pg, 'academic.students', {
      code: 'SAMPLE-D1',
      full_name: 'Sample Twin',
    });
    const dupB = await insert(pg, 'academic.students', {
      code: 'SAMPLE-D2',
      full_name: 'Sample Twin',
    });
    await pg.query(`UPDATE ops.admissions SET academic_student_id = $1 WHERE id = $2`, [
      linked,
      admission,
    ]);
    for (const [code, academic] of [
      ['ADM-000002', dupA],
      ['ADM-000003', dupB],
    ] as const)
      await insert(pg, 'ops.admissions', {
        code,
        lead_id: lead,
        student_id: student2,
        academic_student_id: academic,
        created_by: user,
        status: 'lost',
      });
    await apply(pg, entries[10]!.tag);
    const rows = await one<{ id: string; core: string | null }>(
      pg,
      `SELECT id, core_student_id AS core FROM academic.students`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.core]))).toEqual({
      [linked]: student,
      [dupA]: null,
      [dupB]: null,
    });
    // 0011: a linked student of a sample core student becomes is_sample; unlinked ones stay as they were.
    await apply(pg, entries[11]!.tag);
    const flags = await one<{ id: string; is_sample: boolean }>(
      pg,
      `SELECT id, is_sample FROM academic.students`,
    );
    expect(Object.fromEntries(flags.map((r) => [r.id, r.is_sample]))).toEqual({
      [linked]: true,
      [dupA]: false,
      [dupB]: false,
    });
  }, 60_000);
});
