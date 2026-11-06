/**
 * db:clear-samples and the wave-4 tables (F-SCHEMA2): each loses its sample rows and the rows under a
 * sample parent (student, made-up staff without a login, batch, payment, run), keeps its real rows
 * (also those of a demo login), drops the sample.* number series and never resets a real one. Portal
 * logins of sample students are switched off; real rows that need a sample one stop the command first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '@elevate/database';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { ClearSamplesRefused, clearSamples } from '../../seed';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
type Row = Record<string, string>;
const rowsOf = (r: unknown) => (r as { rows: Row[] }).rows;
const query = async (q: string) => rowsOf(await db().execute(sql.raw(q)));

/** [table, key column]: each gets rows that must go and rows that must stay. */
const TABLES: [string, string][] = [
  ['ops.fee_receipts', 'id'],
  ['ops.document_counters', 'series'],
  ['ops.certificates', 'id'],
  ['ops.absence_calls', 'id'],
  ['core.portal_accounts', 'id'],
  ['core.portal_setup_codes', 'id'],
  ['academic.homework', 'id'],
  ['academic.homework_marks', 'id'],
  ['academic.assessment_roster', 'id'],
  ['ops.payroll_components', 'id'],
  ['ops.payroll_runs', 'id'],
  ['ops.payslips', 'id'],
  ['ops.payslip_lines', 'id'],
  ['ops.salary_structures', 'id'],
  ['ops.salary_structure_lines', 'structure_id'],
  ['ops.salary_advances', 'id'],
  ['ops.leave_allowances', 'id'],
  ['ops.leave_adjustments', 'id'],
  ['ops.staff_checklist_templates', 'id'],
  ['ops.staff_checklists', 'id'],
  ['ops.staff_checklist_items', 'id'],
  ['ops.staff_assets', 'id'],
  ['ops.approval_delegations', 'id'],
  ['ops.lead_assignment_rules', 'id'],
];
const made: Record<string, { gone: string[]; kept: string[] }> = Object.fromEntries(
  TABLES.map(([t]) => [t, { gone: [], kept: [] }]),
);
let refusal: unknown;
const lines: string[] = [];
let ids: Record<string, string>;

/** Insert one row (values as parameters, arrays as '{…}') and note whether the clear must remove it. */
async function put(table: string, fate: 'gone' | 'kept' | null, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  const [row] = rowsOf(
    await db().execute(
      sql`INSERT INTO ${sql.raw(table)} (${sql.raw(cols.join(', '))}) VALUES (${sql.join(
        cols.map((c) => sql`${values[c]}`),
        sql`, `,
      )}) RETURNING *`,
    ),
  );
  const key = TABLES.find(([t]) => t === table)?.[1];
  if (fate && key) made[table]![fate].push(row![key]!);
  return row!;
}

beforeAll(async () => {
  const real = (await createTestUser(db(), { email: 'real.hr@elevateeducation.in' })).id;
  const real2 = (await createTestUser(db(), { email: 'real.director@elevateeducation.in' })).id;
  const sampleLogin = (await createTestUser(db(), { email: 'hr-manager@example.test' })).id;
  const by = { created_by: real };
  const staff = async (fullName: string, isSample: boolean, userId: string | null = null) => {
    const m = await put('core.staff_members', null, { full_name: fullName, user_id: userId });
    await put('ops.staff_profiles', null, { staff_id: m.id, is_sample: isSample });
    return m.id!;
  };
  const realStaff = await staff('Real Teacher', false);
  const sampleStaff = await staff('Made Up Teacher', true);
  // A demo login: made-up, but kept (other records point at it), so its real rows stay too.
  const demoLogin = (await createTestUser(db(), { email: 'teacher@example.test' })).id;
  const demoStaff = await staff('Demo Teacher', true, demoLogin);
  const student = async (isSample: boolean) =>
    (await put('core.students', null, { full_name: 'A Student', is_sample: isSample })).id!;
  const sampleStudent = await student(true);
  const realStudent = await student(false);

  // Receipts on a sample payment and a real one, with their series and certificates'.
  const payment = async (n: number, isSample: boolean) => {
    const lead = await put('ops.leads', null, {
      code: `LEAD-00090${n}`,
      student_name: 'A Student',
      student_email: `student.${n}@example.test`,
      first_received_at: '2026-04-01T05:00:00Z',
      is_sample: isSample,
      ...by,
    });
    const admission = await put('ops.admissions', null, {
      code: `ADM-00090${n}`,
      lead_id: lead.id,
      ...by,
    });
    return put('ops.fee_records', null, {
      code: `FEE-00090${n}`,
      admission_id: admission.id,
      lead_id: lead.id,
      kind: 'received',
      amount_paise: 100_000,
      method: 'cash',
      payment_date: '2026-04-10',
      recorded_by: real,
    });
  };
  for (const [n, fate, year] of [
    [1, 'gone', '2025-26'],
    [2, 'kept', '2026-27'],
  ] as const) {
    const fee = await payment(n, fate === 'gone');
    // Sample documents use their own numbers and series (FX-DOCS).
    const [prefix, series] = fate === 'gone' ? ['SAMPLE-', 'sample.'] : ['', ''];
    await put('ops.fee_receipts', fate, {
      fee_record_id: fee.id,
      receipt_number: `${prefix}R/${year}/000001`,
      financial_year: year,
      sequence: 1,
      issued_by: real,
    });
    await put('ops.document_counters', fate, { series: `${series}receipt/${year}`, next_value: 2 });
    await put('ops.document_counters', fate, {
      series: `${series}certificate.course_completion/${year}`,
      next_value: 2,
    });
    await put('ops.certificates', fate, {
      certificate_type: 'course_completion',
      certificate_number: `${prefix}C/${year}/0001`,
      financial_year: year,
      sequence: 1,
      student_id: fate === 'gone' ? sampleStudent : realStudent,
      issue_date: '2026-06-01',
      body: 'Certified.',
      issued_by: real,
    });
  }
  // A real series is never reset, even with no document left.
  await put('ops.document_counters', 'kept', { series: 'receipt/2024-25', next_value: 9 });
  await put('ops.document_counters', 'kept', { series: 'admit_card/2026-27', next_value: 5 });

  for (const [fate, studentId] of [
    ['gone', sampleStudent],
    ['kept', realStudent],
  ] as const) {
    await put('ops.absence_calls', fate, {
      student_id: studentId,
      outcome: 'no_answer',
      called_by: real,
    });
    const login = await put('core.users', null, {
      email: `pupil.${fate}@portal.invalid`,
      display_name: 'A Student',
    });
    await put('core.portal_accounts', fate, {
      user_id: login.id,
      student_id: studentId,
      kind: 'student',
      ...by,
    });
    await put('core.portal_setup_codes', fate, {
      user_id: login.id,
      code_hash: (fate === 'gone' ? 'a' : 'b').repeat(64),
      expires_at: '2099-01-01T00:00:00Z',
      ...by,
    });
    await put('core.sessions', null, {
      user_id: login.id,
      token_hash: `token-${fate}`,
      expires_at: '2099-01-01T00:00:00Z',
    });
  }

  // Homework and roll numbers: sample batch, flagged rows, sample students and teachers.
  const programme = await put('core.programmes', null, { code: 'ZZP', name: 'Test programme' });
  const programme2 = await put('core.programmes', null, { code: 'ZZQ', name: 'Other programme' });
  const course = await put('academic.courses', null, {
    programme_id: programme.id,
    code: 'ZZ-C',
    family_code: 'ZZ',
    name: 'Test course',
  });
  const batch = async (code: string, isSample: boolean) =>
    (
      await put('academic.batches', null, {
        code,
        name: code,
        course_id: course.id,
        programme_id: programme.id,
        is_sample: isSample,
      })
    ).id!;
  const sampleBatch = await batch('SAMPLE-ZZ', true);
  const realBatch = await batch('REAL-ZZ', false);
  const pupil = async (code: string, isSample: boolean) =>
    (await put('academic.students', null, { code, full_name: 'A Student', is_sample: isSample }))
      .id!;
  const samplePupil = await pupil('STU-ZZ1', true);
  const realPupil = await pupil('STU-ZZ2', false);
  const homework = (fate: 'gone' | 'kept', values: Record<string, unknown>) =>
    put('academic.homework', fate, {
      batch_id: realBatch,
      teacher_staff_id: realStaff,
      title: 'Read chapter 1',
      set_on: '2026-11-01',
      due_on: '2026-11-03',
      created_by_user_id: real,
      ...values,
    });
  const realHomework = await homework('kept', {});
  const demoHomework = await homework('kept', { teacher_staff_id: demoStaff });
  const flaggedHomework = await homework('gone', { is_sample: true });
  await homework('gone', { teacher_staff_id: sampleStaff });
  for (const [fate, homeworkId, studentId] of [
    ['kept', realHomework.id, realPupil],
    ['kept', demoHomework.id, realPupil],
    ['gone', realHomework.id, samplePupil],
    ['gone', flaggedHomework.id, realPupil],
  ] as const)
    await put('academic.homework_marks', fate, {
      homework_id: homeworkId,
      student_id: studentId,
      status: 'submitted',
      marked_by_user_id: real,
    });
  const sampleRoom = await put('academic.rooms', null, {
    code: 'SAMPLE-R1',
    name: 'Sample Room 1 (fictional)',
  });
  for (const [fate, batchId, studentId] of [
    ['gone', sampleBatch, samplePupil],
    ['kept', realBatch, realPupil],
  ] as const) {
    const test = await put('academic.assessments', null, {
      code: `ZZ-${fate}`,
      title: 'Chapter test',
      kind: 'chapter_test',
      batch_id: batchId,
      is_sample: fate === 'gone',
      venue_room_id: fate === 'kept' ? sampleRoom.id : null,
    });
    if (fate === 'kept') ids = { realTest: test.id! };
    await put('academic.assessment_roster', fate, {
      assessment_id: test.id,
      student_id: studentId,
      batch_id: batchId,
      display_name_snapshot: 'A Student',
      roll_number: 1,
    });
  }

  // Payroll: components stay; sample runs, made-up staff and their structures/advances go.
  const component = await put('ops.payroll_components', 'kept', {
    code: 'basic',
    name: 'Basic',
    kind: 'earning',
    ...by,
  });
  const realRun = await put('ops.payroll_runs', 'kept', { month: '2026-10-01', ...by });
  const sampleRun = await put('ops.payroll_runs', 'gone', {
    month: '2026-09-01',
    is_sample: true,
    ...by,
  });
  const structure = (fate: 'gone' | 'kept', staffId: string, extra = {}) =>
    put('ops.salary_structures', fate, {
      staff_id: staffId,
      effective_from: '2026-04-01',
      ...by,
      ...extra,
    });
  for (const [fate, s] of [
    ['kept', await structure('kept', realStaff)],
    ['kept', await structure('kept', demoStaff)],
    ['gone', await structure('gone', sampleStaff)],
    ['gone', await structure('gone', realStaff, { effective_from: '2026-05-01', is_sample: true })],
  ] as const)
    await put('ops.salary_structure_lines', fate, {
      structure_id: s.id,
      component_id: component.id,
      monthly_amount_paise: 100,
    });
  const advance = (fate: 'gone' | 'kept', staffId: string) =>
    put('ops.salary_advances', fate, {
      staff_id: staffId,
      amount_paise: 1_000,
      monthly_instalment_paise: 100,
      given_on: '2026-04-01',
      recover_from: '2026-05-01',
      reason: 'Advance',
      ...by,
    });
  await advance('kept', realStaff);
  await advance('kept', demoStaff);
  const sampleAdvance = await advance('gone', sampleStaff);
  const payslip = (fate: 'gone' | 'kept', runId: string, staffId: string) =>
    put('ops.payslips', fate, { run_id: runId, staff_id: staffId, days_in_month: 30 });
  const line = (fate: 'gone' | 'kept', payslipId: string, extra = {}) =>
    put('ops.payslip_lines', fate, {
      payslip_id: payslipId,
      kind: 'earning',
      source: 'structure',
      component_id: component.id,
      label: 'Basic',
      amount_paise: 100,
      ...by,
      ...extra,
    });
  const realPayslip = await payslip('kept', realRun.id!, realStaff);
  const recovery = {
    kind: 'deduction',
    source: 'advance_recovery',
    component_id: null,
    advance_id: sampleAdvance.id,
    label: 'Advance recovery',
    amount_paise: 100,
  };
  await line('kept', realPayslip.id!);
  await line('kept', (await payslip('kept', realRun.id!, demoStaff)).id!);
  await line('gone', (await payslip('gone', realRun.id!, sampleStaff)).id!, recovery);
  await line('gone', (await payslip('gone', sampleRun.id!, realStaff)).id!);

  // Leave balances, checklists, assets: flagged rows and made-up staff go.
  for (const [fate, staffId, extra] of [
    ['kept', realStaff, {}],
    ['kept', demoStaff, {}],
    ['gone', sampleStaff, {}],
    ['gone', realStaff, { is_sample: true, leave_type: 'sick' }],
  ] as const) {
    const leave = {
      staff_id: staffId,
      leave_type: 'casual',
      year_start: '2026-04-01',
      ...by,
      ...extra,
    };
    await put('ops.leave_allowances', fate, { days: 12, ...leave });
    await put('ops.leave_adjustments', fate, {
      kind: 'adjustment',
      days: 1,
      reason: 'Extra day',
      ...leave,
    });
    await put('ops.staff_assets', fate, {
      asset_type: 'Laptop',
      staff_id: staffId,
      issued_on: '2026-04-01',
      issued_by: real,
      is_sample: 'is_sample' in extra,
    });
  }
  const template = await put('ops.staff_checklist_templates', 'kept', {
    event: 'joining',
    version: 1,
    items: '[]',
    status: 'active',
    ...by,
  });
  for (const [fate, staffId, extra] of [
    ['kept', realStaff, {}],
    ['kept', demoStaff, {}],
    ['gone', sampleStaff, {}],
    ['gone', realStaff, { event: 'leaving', is_sample: true }],
  ] as const) {
    const list = await put('ops.staff_checklists', fate, {
      staff_id: staffId,
      event: 'joining',
      template_id: template.id,
      ...by,
      ...extra,
    });
    await put('ops.staff_checklist_items', fate, {
      checklist_id: list.id,
      item_key: 'laptop',
      label: 'Laptop',
    });
  }

  // Approval cover: only flagged rows go (logins are never deleted).
  for (const [fate, cover, extra] of [
    ['kept', real2, {}],
    ['kept', sampleLogin, {}],
    ['gone', real2, { is_sample: true }],
  ] as const)
    await put('ops.approval_delegations', fate, {
      approver_user_id: real,
      cover_user_id: cover,
      from_date: '2026-11-01',
      to_date: '2026-11-30',
      ...by,
      ...extra,
    });

  // Lead sharing: a real rule loses its made-up counsellor; a sample rule goes.
  const mixed = await put('ops.lead_assignment_rules', 'kept', {
    counsellor_staff_ids: `{${realStaff},${sampleStaff}}`,
    last_assigned_staff_id: sampleStaff,
    ...by,
  });
  await put('ops.lead_assignment_rules', 'gone', {
    programme_id: programme.id,
    counsellor_staff_ids: `{${sampleStaff}}`,
    is_sample: true,
    ...by,
  });
  ids = { ...ids, mixed: mixed.id!, realStaff };

  // Real rows that need a sample one stop the clear; the owner removes them, then it runs.
  const blockers = [
    [
      'ops.lead_assignment_rules',
      { programme_id: programme2.id, counsellor_staff_ids: `{${sampleStaff}}`, ...by },
    ],
    [
      'academic.homework',
      {
        batch_id: sampleBatch,
        teacher_staff_id: realStaff,
        title: 'Real homework',
        set_on: '2026-11-01',
        due_on: '2026-11-03',
        created_by_user_id: real,
      },
    ],
    ['ops.payslip_lines', { payslip_id: realPayslip.id, ...recovery, ...by }],
  ] as const;
  const blocking = [];
  for (const [table, values] of blockers)
    blocking.push([table, (await put(table, null, values)).id]);
  refusal = await clearSamples(db()).catch((e: unknown) => e);
  for (const [table, id] of blocking) await query(`DELETE FROM ${table} WHERE id = '${id}'`);
  await clearSamples(db(), (l) => lines.push(l));
}, 120_000);

describe('db:clear-samples and the wave-4 tables', () => {
  it('refuses first while real rows need sample ones, naming them', () => {
    expect(refusal).toBeInstanceOf(ClearSamplesRefused);
    expect((refusal as ClearSamplesRefused).problems).toEqual([
      'Lead sharing rule for Other programme shares leads only with sample staff; add a real counsellor or delete the rule first.',
      'Homework "Real homework" is real but set for sample batch SAMPLE-ZZ; delete it or mark it as sample first.',
      'Payslip of Real Teacher for Oct 2026 uses a sample salary structure or recovers a sample advance; remove that from the payroll first.',
    ]);
  });

  it.each(TABLES)('%s loses its sample rows and keeps its real ones', async (table, key) => {
    const left = (await query(`SELECT ${key}::text AS k FROM ${table}`)).map((r) => r.k);
    const { gone, kept } = made[table]!;
    expect(gone.length + kept.length).toBeGreaterThan(0);
    for (const k of gone) expect(left).not.toContain(k);
    for (const k of kept) expect(left).toContain(k);
  });

  it('empties real rows’ links to sample counsellors and rooms, and says so', async () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        'Unlinked 1 real lead sharing rule(s) from sample counsellors',
        'Unlinked 1 real test venue(s) from sample rooms',
      ]),
    );
    const [rule] = await query(
      `SELECT counsellor_staff_ids::text AS c, last_assigned_staff_id AS l FROM ops.lead_assignment_rules WHERE id = '${ids.mixed}'`,
    );
    expect(rule).toEqual({ c: `{${ids.realStaff}}`, l: null });
    const [test] = await query(
      `SELECT venue_room_id AS v FROM academic.assessments WHERE id = '${ids.realTest}'`,
    );
    expect(test!.v).toBeNull();
  });

  it('switches off a sample student’s portal login and ends its sessions; a real one stays', async () => {
    const logins = await query(
      `SELECT u.email, u.status, bool_and(s.revoked_at IS NOT NULL)::text AS ended
       FROM core.users u JOIN core.sessions s ON s.user_id = u.id
       WHERE u.email LIKE '%@portal.invalid' GROUP BY u.email, u.status ORDER BY u.email`,
    );
    expect(logins).toEqual([
      { email: 'pupil.gone@portal.invalid', status: 'disabled', ended: 'true' },
      { email: 'pupil.kept@portal.invalid', status: 'active', ended: 'false' },
    ]);
  });

  it('a second run finds nothing left to do', async () => {
    expect(await clearSamples(db())).toEqual({});
  });
});
