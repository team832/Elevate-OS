/**
 * Migration 0020 (FEATURES-W4, 6 Nov 2026): the portal, homework, admit-card roll numbers and
 * venue, receipts, certificates, website-form consent and lead-sharing rules. One case per new
 * CHECK and unique key; HR and payroll are in wave4-0020-hr.test.ts.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  ACADEMIC_HOMEWORK_STATUSES,
  CORE_PORTAL_ACCOUNT_KINDS,
  OPS_CERTIFICATE_STATUSES,
  OPS_LEAD_ASSIGNMENT_MODES,
} from '../../src/schema/index';
import { LATER, NOW, insert, one, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const by = () => ctx.ids.user;
const staff = () => ctx.ids.staff;
const SHA = 'a'.repeat(64);
const GUARDIAN = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OTHER_GUARDIAN = '8d2f3e4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a';

const portal = (o: Row = {}): Row => ({
  user_id: ids.portalStudent,
  student_id: ctx.ids.student2,
  kind: 'student',
  created_by: by(),
  ...o,
});
const consent = {
  consent_guardian_id: GUARDIAN,
  consent_text_version: 'v1',
  consent_given_at: NOW,
};
const code = (o: Row = {}): Row => ({
  user_id: ids.portalGuardian,
  code_hash: 'b'.repeat(64),
  expires_at: '2026-11-13T04:30:00Z',
  created_by: by(),
  created_at: NOW,
  ...o,
});
const homework = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  title: 'Chapter 3 questions',
  set_on: '2026-11-06',
  due_on: '2026-11-09',
  teacher_staff_id: staff(),
  created_by_user_id: by(),
  ...o,
});
const roster = (o: Row = {}): Row => ({
  assessment_id: ids.assessment,
  student_id: ids.academicStudent2,
  batch_id: ids.batch,
  display_name_snapshot: 'Sample Two',
  ...o,
});
const certificate = (o: Row = {}): Row => ({
  certificate_type: 'bonafide',
  certificate_number: 'EC/BON/2026-27/000002',
  financial_year: '2026-27',
  sequence: 2,
  student_id: ctx.ids.student,
  issue_date: '2026-11-06',
  body: 'This is to certify that Sample Student is a student of the institute.',
  issued_by: by(),
  ...o,
});
const receipt = (o: Row = {}): Row => ({
  fee_record_id: ids.fee2,
  receipt_number: 'ER/2026-27/000002',
  financial_year: '2026-27',
  sequence: 2,
  issued_by: by(),
  ...o,
});
const rule = (o: Row = {}): Row => ({
  programme_id: ids.programme2,
  counsellor_staff_ids: `{${ctx.ids.staff}}`,
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
  await user('portalStudent', 'k7m2p9qx@portal.invalid');
  await user('portalGuardian', 'g4h8j2nw@portal.invalid');
  await add('programme', 'core.programmes', { code: 'SAMPLE_P', name: 'Sample' });
  await add('programme2', 'core.programmes', { code: 'SAMPLE_Q', name: 'Sample two' });
  await add('course', 'academic.courses', {
    programme_id: ids.programme,
    code: 'SAMPLE-C',
    family_code: 'SAMPLE',
    name: 'Sample course',
  });
  await add('batch', 'academic.batches', {
    course_id: ids.course,
    programme_id: ids.programme,
    code: 'SB1',
    name: 'Sample B1',
    is_sample: true,
  });
  await add('room', 'academic.rooms', { code: 'R1', name: 'Sample room' });
  const student = (code: string) => ({ code, full_name: `Sample ${code}`, is_sample: true });
  await add('academicStudent', 'academic.students', student('S1'));
  await add('academicStudent2', 'academic.students', student('S2'));
  await add('assessment', 'academic.assessments', {
    code: 'SAMPLE-M1',
    title: 'Sample mock',
    kind: 'full_mock',
    batch_id: ids.batch,
    is_sample: true,
  });
  await ins('academic.assessment_roster', {
    ...roster({ student_id: ids.academicStudent, display_name_snapshot: 'Sample One' }),
    roll_number: 1,
  });
  await add('homework', 'academic.homework', homework());
  await ins('academic.homework_marks', {
    homework_id: ids.homework,
    student_id: ids.academicStudent,
    status: 'submitted',
    marked_by_user_id: by(),
  });
  await ins('core.portal_accounts', portal({ student_id: ctx.ids.student }));
  await ins(
    'core.portal_accounts',
    portal({ user_id: ids.portalGuardian, kind: 'guardian', guardian_id: GUARDIAN }),
  );
  await ins('core.portal_setup_codes', code({ user_id: ids.portalStudent, code_hash: SHA }));
  await ins(
    'ops.certificates',
    certificate({ certificate_number: 'EC/BON/2026-27/000001', sequence: 1 }),
  );
  const fee = (code: string) => ({
    code,
    admission_id: ctx.ids.admission,
    lead_id: ctx.ids.lead,
    kind: 'received',
    amount_paise: 100_000,
    recorded_by: by(),
  });
  await add('fee', 'ops.fee_records', fee('FEE-000001'));
  await add('fee2', 'ops.fee_records', fee('FEE-000002'));
  await ins(
    'ops.fee_receipts',
    receipt({ fee_record_id: ids.fee, receipt_number: 'ER/2026-27/000001', sequence: 1 }),
  );
  await ins('ops.lead_assignment_rules', rule({ programme_id: null }));
  await ins('ops.lead_assignment_rules', rule());
  await ins('ops.lead_sources', { code: 'WEBSITE_FORM', label: 'Website form' });
});
afterAll(() => ctx.t.close());

describe('0020 portal (F4-13)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'portal login kinds',
        'core.portal_accounts',
        CORE_PORTAL_ACCOUNT_KINDS,
        'portal_accounts_kind_check',
        (v) =>
          portal({
            user_id: ids.user3,
            kind: v,
            guardian_id: v === 'guardian' ? OTHER_GUARDIAN : null,
          }),
      ),
      variants('portal account rules', 'core.portal_accounts', portal, {
        'one login linked twice to a student': [
          { user_id: id('portalGuardian'), kind: 'guardian', guardian_id: OTHER_GUARDIAN },
          'portal_accounts_user_student_key',
        ],
        'a student login for a second student': [
          { student_id: () => ctx.ids.student2 },
          'portal_accounts_one_student_user_key',
        ],
        'a second live student login': [
          { user_id: id('user3'), student_id: () => ctx.ids.student },
          'portal_accounts_live_student_key',
        ],
        'a disabled second student login': [
          {
            user_id: id('user3'),
            student_id: () => ctx.ids.student,
            disabled_at: NOW,
            disabled_by: by,
          },
          'ok',
        ],
        'the same guardian row twice': [
          {
            user_id: id('user3'),
            kind: 'guardian',
            guardian_id: GUARDIAN,
            student_id: () => ctx.ids.student,
          },
          'portal_accounts_live_guardian_key',
        ],
        'guardian login without guardian row': [
          { user_id: id('user3'), kind: 'guardian' },
          'portal_accounts_guardian_check',
        ],
        'student login naming a guardian row': [
          { user_id: id('user3'), guardian_id: GUARDIAN },
          'portal_accounts_guardian_check',
        ],
        'consent recorded in full': [
          { user_id: id('user3'), ...consent, consent_recorded_by: by },
          'ok',
        ],
        'consent without who recorded it': [
          { user_id: id('user3'), ...consent },
          'portal_accounts_consent_check',
        ],
        'consent with a blank text version': [
          { user_id: id('user3'), ...consent, consent_text_version: ' ', consent_recorded_by: by },
          'portal_accounts_consent_check',
        ],
        'disabled without who': [
          { user_id: id('user3'), disabled_at: NOW },
          'portal_accounts_disabled_check',
        ],
      }),
      variants('setup codes', 'core.portal_setup_codes', code, {
        'a live code': [{}, 'ok'],
        'a second live code for one login': [
          { user_id: id('portalStudent') },
          'portal_setup_codes_one_live_key',
        ],
        'a second code once the first is used': [
          { user_id: id('portalStudent'), used_at: LATER },
          'ok',
        ],
        'the same hash again': [{ code_hash: SHA }, 'portal_setup_codes_hash_key'],
        'a raw code instead of a hash': [
          { code_hash: 'ABCD2345' },
          'portal_setup_codes_hash_check',
        ],
        'expiring before it is made': [
          { expires_at: '2026-10-20T00:00:00Z' },
          'portal_setup_codes_expiry_check',
        ],
        'used and revoked': [
          { used_at: LATER, revoked_at: LATER },
          'portal_setup_codes_closed_check',
        ],
      }),
    ],
  );
});

describe('0020 Academic: homework, roll numbers, venue (F4-03, F4-05)', () => {
  runCases(
    () => ctx.pg,
    [
      variants('homework rules', 'academic.homework', homework, {
        'due before it is set': [{ due_on: '2026-11-05' }, 'homework_dates_order'],
        'blank title': [{ title: '  ' }, 'homework_title_check'],
        'cancelled with who and why': [
          { cancelled_at: NOW, cancelled_by_user_id: by, cancel_reason: 'Set twice' },
          'ok',
        ],
        'cancelled without a reason': [
          { cancelled_at: NOW, cancelled_by_user_id: by },
          'homework_cancel_check',
        ],
        'cancelled with a blank reason': [
          { cancelled_at: NOW, cancelled_by_user_id: by, cancel_reason: ' ' },
          'homework_cancel_check',
        ],
      }),
      vocab(
        'homework marks (ACADEMIC_HOMEWORK_STATUSES)',
        'academic.homework_marks',
        ACADEMIC_HOMEWORK_STATUSES,
        'homework_marks_status_check',
        (v) => ({
          homework_id: ids.homework,
          student_id: ids.academicStudent2,
          status: v,
          marked_by_user_id: by(),
        }),
      ),
      one(
        'one mark per student and homework',
        'academic.homework_marks',
        () => ({
          homework_id: ids.homework,
          student_id: ids.academicStudent,
          status: 'late',
          marked_by_user_id: by(),
        }),
        'homework_marks_student_key',
      ),
      variants('roll numbers', 'academic.assessment_roster', roster, {
        'next number': [{ roll_number: 2 }, 'ok'],
        'not given yet': [{}, 'ok'],
        'a number already used': [{ roll_number: 1 }, 'assessment_roster_roll_number_key'],
        zero: [{ roll_number: 0 }, 'assessment_roster_roll_number_check'],
      }),
      variants(
        'test venue',
        'academic.assessments',
        (o) => ({
          code: 'SAMPLE-M2',
          title: 'Sample',
          kind: 'full_mock',
          batch_id: ids.batch,
          ...o,
        }),
        {
          room: [{ venue_room_id: id('room') }, 'ok'],
          online: [{ venue_online: true }, 'ok'],
          'room and online': [
            { venue_room_id: id('room'), venue_online: true },
            'assessments_venue_check',
          ],
        },
      ),
    ],
  );
});

describe('0020 fees and documents (F4-01, F4-02)', () => {
  runCases(
    () => ctx.pg,
    [
      variants('receipts', 'ops.fee_receipts', receipt, {
        'next receipt': [{}, 'ok'],
        'a second receipt for one payment': [
          { fee_record_id: id('fee') },
          'fee_receipts_fee_record_key',
        ],
        'a number already used': [
          { receipt_number: 'ER/2026-27/000001' },
          'fee_receipts_number_key',
        ],
        'a sequence already used': [{ sequence: 1 }, 'fee_receipts_sequence_key'],
        'blank number': [{ receipt_number: ' ' }, 'fee_receipts_number_check'],
        'year not like 2026-27': [{ financial_year: '2026' }, 'fee_receipts_year_format'],
        'sequence zero': [{ sequence: 0 }, 'fee_receipts_sequence_check'],
        'negative print count': [{ print_count: -1 }, 'fee_receipts_print_count_check'],
      }),
      variants(
        'number series',
        'ops.document_counters',
        (o) => ({ series: 'receipt/2026-27', ...o }),
        {
          receipts: [{}, 'ok'],
          certificates: [{ series: 'certificate.bonafide/2026-27' }, 'ok'],
          'no year': [{ series: 'receipt' }, 'document_counters_series_format'],
          'next value zero': [{ next_value: 0 }, 'document_counters_next_check'],
        },
      ),
      vocab(
        'certificate statuses',
        'ops.certificates',
        OPS_CERTIFICATE_STATUSES,
        'certificates_status_check',
        (v) =>
          certificate(
            v === 'revoked'
              ? { status: v, revoked_by: by(), revoked_at: NOW, revoke_reason: 'Issued in error' }
              : { status: v },
          ),
      ),
      variants('certificates', 'ops.certificates', certificate, {
        'a number already used': [
          { certificate_number: 'EC/BON/2026-27/000001' },
          'certificates_number_key',
        ],
        'a sequence already used': [{ sequence: 1 }, 'certificates_sequence_key'],
        'same sequence, other type': [{ sequence: 1, certificate_type: 'course_completion' }, 'ok'],
        'type with spaces': [{ certificate_type: 'Course completion' }, 'certificates_type_format'],
        'blank wording': [{ body: ' ' }, 'certificates_text_check'],
        'year not like 2026-27': [{ financial_year: '26-27' }, 'certificates_year_format'],
        'sequence zero': [{ sequence: 0 }, 'certificates_counts_check'],
        'revoked without a reason': [
          { status: 'revoked', revoked_by: by, revoked_at: NOW },
          'certificates_revoked_check',
        ],
        'revoke stamp on an issued one': [
          { revoked_by: by, revoked_at: NOW },
          'certificates_revoked_check',
        ],
      }),
      variants(
        'discount posted for an approver',
        'ops.fee_records',
        (o) => ({
          code: 'FEE-000009',
          admission_id: ctx.ids.admission,
          lead_id: ctx.ids.lead,
          kind: 'waiver',
          amount_paise: 1_000,
          recorded_by: by(),
          ...o,
        }),
        {
          'on behalf of another': [{ on_behalf_of: () => ctx.ids.user2 }, 'ok'],
          'on behalf of oneself': [{ on_behalf_of: by }, 'fee_records_on_behalf_check'],
        },
      ),
    ],
  );
});

describe('0020 leads (F4-15, F4-16)', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'website-form consent',
        'ops.enquiries',
        (o) => ({
          lead_id: ctx.ids.lead,
          received_at: NOW,
          source_code: 'WEBSITE_FORM',
          created_by: by(),
          ...o,
        }),
        {
          'consent ticked': [{ consent_text_version: 'v1', consent_at: NOW }, 'ok'],
          'no consent recorded': [{}, 'ok'],
          'version without time': [{ consent_text_version: 'v1' }, 'enquiries_consent_check'],
          'blank version': [
            { consent_text_version: ' ', consent_at: NOW },
            'enquiries_consent_check',
          ],
        },
      ),
      vocab(
        'assignment modes',
        'ops.lead_assignment_rules',
        OPS_LEAD_ASSIGNMENT_MODES,
        'lead_assignment_rules_mode_check',
        (v) => rule({ programme_id: ids.programme, mode: v }),
      ),
      variants('assignment rules', 'ops.lead_assignment_rules', rule, {
        'a second default rule': [{ programme_id: null }, 'lead_assignment_rules_programme_key'],
        'a second rule for a programme': [{}, 'lead_assignment_rules_programme_key'],
        'no counsellors': [
          { programme_id: id('programme'), counsellor_staff_ids: '{}' },
          'lead_assignment_rules_counsellors_check',
        ],
        'an empty slot': [
          { programme_id: id('programme'), counsellor_staff_ids: '{NULL}' },
          'lead_assignment_rules_counsellors_check',
        ],
        'cap of zero': [
          { programme_id: id('programme'), daily_cap: 0 },
          'lead_assignment_rules_cap_check',
        ],
      }),
    ],
  );
});
