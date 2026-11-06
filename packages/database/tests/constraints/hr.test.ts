/**
 * Migration 0015 tables and columns (owner brief 23 Oct 2026): employee records, teaching
 * assignments, attachments, staff attendance, student feedback about teachers, campaign members.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  ACADEMIC_ASSIGNMENT_STATUSES,
  MARKETING_CAMPAIGN_MEMBER_ROLES,
  OPS_ATTACHMENT_0019_OWNER_KINDS,
  OPS_ATTACHMENT_OWNER_KINDS,
  OPS_ATTACHMENT_PURPOSES,
  OPS_CORRECTION_STATUSES,
  OPS_DAILY_ATTENDANCE_STATUSES,
  OPS_DEVELOPMENT_ACTION_STATUSES,
  OPS_FEEDBACK_COLLECTION_METHODS,
  OPS_FEEDBACK_IMPORT_OUTCOMES,
  OPS_FEEDBACK_IMPORT_STATUSES,
  OPS_FEEDBACK_SUMMARY_STATUSES,
  OPS_LEAVE_APPLICATION_STATUSES,
  OPS_LEAVE_STATUSES,
  OPS_PUNCH_SOURCES,
} from '../../src/schema/index';
import { LATER, NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const FILE_KEY = '5d1f3c2a-7b4e-4f60-9a8b-1c2d3e4f5a6b';
const MB8 = 8 * 1024 * 1024;
let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const by = () => ctx.ids.user;
const staff = () => ctx.ids.staff;

const assignment = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  subject_id: ids.subject,
  staff_member_id: staff(),
  ...o,
});
const attachment = (o: Row = {}): Row => ({
  owner_kind: 'task',
  owner_id: ids.batch,
  purpose: 'reference',
  original_name: 'worksheet.pdf',
  mime: 'application/pdf',
  size_bytes: 1024,
  sha256: SHA,
  storage_key: `k-${Math.random()}`,
  uploaded_by_user_id: by(),
  ...o,
});
const file = (o: Row = {}): Row => ({
  key: crypto.randomUUID(),
  bytes: new Uint8Array([1, 2, 3]),
  size_bytes: 3,
  ...o,
});
const punch = (o: Row = {}): Row => ({
  staff_id: staff(),
  punched_at: NOW,
  direction: 'in',
  source: 'manual',
  entered_by: by(),
  ...o,
});
const day = (o: Row = {}): Row => ({ staff_id: staff(), work_date: '2026-10-22', ...o });
const correction = (o: Row = {}): Row => ({
  staff_id: staff(),
  work_date: '2026-10-21',
  requested_status: 'present',
  reason: 'Forgot to check out',
  requested_by_user_id: by(),
  ...o,
});
const leaveApplication = (o: Row = {}): Row => ({
  staff_id: staff(),
  kind: 'Casual',
  from_date: '2026-11-10',
  to_date: '2026-11-11',
  reason: 'Family function',
  applied_by: by(),
  ...o,
});
const decided = (status: string, o: Row = {}): Row => ({
  status,
  decided_by: by,
  decided_at: NOW,
  decision_note: 'Checked',
  ...o,
});
const attendanceImport = (o: Row = {}): Row => ({
  sha256: SHA2,
  source_label: 'Sample register export',
  rows: '[]',
  created_by: by(),
  ...o,
});
const feedback = (o: Row = {}): Row => ({
  teacher_staff_id: staff(),
  submitted_by_kind: 'student',
  feedback_on: '2026-10-21',
  comment: 'Explains clearly',
  recorded_by: by(),
  ...o,
});
const feedbackImport = (o: Row = {}): Row => ({
  sha256: SHA2,
  original_name: 'feedback.csv',
  mapping: '{}',
  created_by: by(),
  ...o,
});
const summary = (o: Row = {}): Row => ({
  teacher_staff_id: staff(),
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  response_count: 6,
  rating_scale_max: 5,
  category_means: '{}',
  created_by: by(),
  ...o,
});
const member = (o: Row = {}): Row => ({
  campaign_id: ids.campaign,
  staff_id: staff(),
  from_date: '2026-10-01',
  added_by: by(),
  ...o,
});

beforeAll(async () => {
  ctx = await setup();
  const ins = (table: string, row: Row) => insert(ctx.pg, table, row);
  const programme = await ins('core.programmes', { code: 'SAMPLE_P', name: 'Sample' });
  ids.course = await ins('academic.courses', {
    programme_id: programme,
    code: 'SAMPLE-C',
    family_code: 'SAMPLE',
    name: 'Sample course',
  });
  ids.subject = await ins('academic.subjects', { course_id: ids.course, code: 'M', name: 'Maths' });
  ids.batch = await ins('academic.batches', {
    course_id: ids.course,
    programme_id: programme,
    code: 'SB1',
    name: 'Sample B1',
    is_sample: true,
  });
  await ins('academic.teacher_assignments', assignment({ status: 'pending', batch_id: null }));
  ids.department = await ins('core.departments', { code: 'SAMPLE_D', name: 'Sample' });
  ids.department2 = await ins('core.departments', { code: 'SAMPLE_E', name: 'Sample two' });
  await ins('ops.staff_departments', {
    staff_id: staff(),
    department_id: ids.department,
    is_primary: true,
    created_by: by(),
  });
  ids.manager = await ins('core.staff_members', { full_name: 'Sample Manager' });
  await ins('ops.staff_manager_history', {
    staff_id: staff(),
    manager_staff_id: ids.manager,
    changed_by: by(),
  });
  await ins('ops.attachments', attachment({ storage_key: 'taken' }));
  await ins('ops.attachment_files', file({ key: FILE_KEY }));
  await ins('ops.work_schedules', {
    name: 'Default',
    weekly_pattern: '{}',
    is_default: true,
    created_by: by(),
  });
  await ins('ops.holidays', { holiday_on: '2026-11-08', name: 'Sample holiday', created_by: by() });
  ids.attendanceImport = await ins('ops.attendance_imports', attendanceImport({ sha256: SHA }));
  await ins('ops.attendance_punches', punch());
  ids.leaveRecord2 = await ins('ops.leave_records', {
    staff_id: staff(),
    from_date: '2026-11-22',
    to_date: '2026-11-23',
    kind: 'Casual',
    approved_by: by(),
  });
  await ins('ops.daily_attendance', day());
  await ins('ops.attendance_corrections', correction());
  ids.leaveRecord = await ins('ops.leave_records', {
    staff_id: staff(),
    from_date: '2026-11-20',
    to_date: '2026-11-21',
    kind: 'Casual',
    approved_by: by(),
  });
  await ins(
    'ops.leave_applications',
    leaveApplication({
      status: 'approved',
      decided_by: by(),
      decided_at: NOW,
      leave_record_id: ids.leaveRecord,
    }),
  );
  ids.feedbackImport = await ins('ops.teacher_feedback_imports', feedbackImport({ sha256: SHA }));
  await ins('ops.teacher_feedback_import_rows', {
    import_id: ids.feedbackImport,
    row_number: 1,
    raw: '{}',
    outcome: 'invalid',
  });
  await ins(
    'ops.student_teacher_feedback',
    feedback({ import_id: ids.feedbackImport, import_row: 1 }),
  );
  await ins('ops.teacher_feedback_summaries', summary());
  ids.campaign = await ins('marketing.campaigns', { code: 'SAMPLE-CMP', name: 'Sample campaign' });
  await ins('marketing.campaign_members', member());
});
afterAll(() => ctx.t.close());

describe('teaching assignments and employee records', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'assignment statuses (ACADEMIC_ASSIGNMENT_STATUSES)',
        'academic.teacher_assignments',
        ACADEMIC_ASSIGNMENT_STATUSES,
        'teacher_assignments_status_check',
        (v) => assignment({ status: v }),
      ),
      variants('assignment rules (R9)', 'academic.teacher_assignments', assignment, {
        'active without a batch': [{ batch_id: null }, 'teacher_assignments_batch_check'],
        'pending without a batch twice': [
          { status: 'pending', batch_id: null },
          'teacher_assignments_pending_key',
        ],
        'academic year 2026-27': [{ academic_year: '2026-27', course_id: id('course') }, 'ok'],
        'academic year 2026/27': [{ academic_year: '2026/27' }, 'teacher_assignments_year_check'],
        'academic year 2026': [{ academic_year: '2026' }, 'teacher_assignments_year_check'],
      }),
      variants(
        'staff department rules',
        'ops.staff_departments',
        (o) => ({ staff_id: staff(), department_id: ids.department, created_by: by(), ...o }),
        {
          'same current department twice': [{}, 'staff_departments_current_key'],
          'same department, closed period': [
            { from_date: '2025-01-01', to_date: '2025-12-31' },
            'ok',
          ],
          'second current primary': [
            { is_primary: true, department_id: id('department2') },
            'staff_departments_one_primary_key',
          ],
          'second department, not primary': [{ department_id: id('department2') }, 'ok'],
          'ends before it starts': [
            { from_date: '2026-02-01', to_date: '2026-01-01' },
            'staff_departments_dates_check',
          ],
        },
      ),
      variants(
        'manager history rules',
        'ops.staff_manager_history',
        (o) => ({ staff_id: staff(), changed_by: by(), ...o }),
        {
          'second open period': [
            { manager_staff_id: id('manager') },
            'staff_manager_history_current_key',
          ],
          'closed period': [{ manager_staff_id: id('manager'), to_date: '2026-01-01' }, 'ok'],
          'own manager': [
            { manager_staff_id: () => staff(), to_date: '2026-01-01' },
            'staff_manager_history_not_self',
          ],
          'without who changed it': [{ to_date: '2026-01-01', changed_by: null }, '23502'],
        },
      ),
    ],
  );
});

describe('attachments', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'owner kinds (OPS_ATTACHMENT_OWNER_KINDS)',
        'ops.attachments',
        OPS_ATTACHMENT_OWNER_KINDS,
        'attachments_owner_kind_check',
        (v) => attachment({ owner_kind: v }),
      ),
      vocab(
        'purposes (OPS_ATTACHMENT_PURPOSES)',
        'ops.attachments',
        OPS_ATTACHMENT_PURPOSES,
        'attachments_purpose_check',
        (v) => attachment({ purpose: v }),
      ),
      variants('attachment rules (R6)', 'ops.attachments', attachment, {
        '8 MB exactly': [{ size_bytes: 8 * 1024 * 1024 }, 'ok'],
        'over 8 MB': [{ size_bytes: 8 * 1024 * 1024 + 1 }, 'attachments_size_check'],
        empty: [{ size_bytes: 0 }, 'attachments_size_check'],
        'not a sha-256': [{ sha256: 'abc' }, 'attachments_sha_check'],
        'blank name': [{ original_name: ' ' }, 'attachments_name_check'],
        'storage key reused': [{ storage_key: 'taken' }, 'attachments_storage_key_key'],
      }),
      vocab(
        'owner kinds added in 0019 (OPS_ATTACHMENT_0019_OWNER_KINDS)',
        'ops.attachments',
        OPS_ATTACHMENT_0019_OWNER_KINDS,
        'attachments_owner_kind_check',
        (v) => attachment({ owner_kind: v }),
      ),
      variants('files kept in the database (D-135)', 'ops.attachment_files', file, {
        small: [{}, 'ok'],
        '8 MB exactly': [{ bytes: () => new Uint8Array(MB8), size_bytes: MB8 }, 'ok'],
        'over 8 MB': [
          { bytes: () => new Uint8Array(MB8 + 1), size_bytes: MB8 + 1 },
          'attachment_files_size_check',
        ],
        empty: [{ bytes: new Uint8Array(0), size_bytes: 0 }, 'attachment_files_size_check'],
        'size does not match the bytes': [{ size_bytes: 4 }, 'attachment_files_size_check'],
        'same key twice': [{ key: FILE_KEY }, 'attachment_files_pkey'],
      }),
    ],
  );
});

describe('staff attendance (§12)', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'schedules and holidays',
        'ops.work_schedules',
        (o) => ({ name: 'Part-time', weekly_pattern: '{}', created_by: by(), ...o }),
        {
          'second default': [{ is_default: true }, 'work_schedules_one_default_key'],
          'pattern not an object': [{ weekly_pattern: '[]' }, 'work_schedules_pattern_check'],
          'grace over 4 hours': [{ grace_minutes: 241 }, 'work_schedules_grace_check'],
        },
      ),
      variants(
        'holiday rules',
        'ops.holidays',
        (o) => ({ holiday_on: '2026-11-08', name: 'Sample holiday', created_by: by(), ...o }),
        {
          'same day, every branch, twice': [{}, 'holidays_day_branch_key'],
          'decision state bogus': [
            { holiday_on: '2026-11-09', decision_state: 'bogus' },
            'holidays_decision_state_check',
          ],
        },
      ),
      vocab(
        'leave statuses (OPS_LEAVE_STATUSES)',
        'ops.leave_records',
        OPS_LEAVE_STATUSES,
        'leave_records_status_check',
        (v) => ({
          staff_id: staff(),
          from_date: '2026-11-02',
          to_date: '2026-11-03',
          kind: 'Casual',
          status: v,
          approved_by: by(),
        }),
      ),
      variants(
        'leave rules',
        'ops.leave_records',
        (o) => ({
          staff_id: staff(),
          from_date: '2026-11-02',
          to_date: '2026-11-03',
          kind: 'Casual',
          approved_by: by(),
          ...o,
        }),
        {
          'ends before it starts': [{ to_date: '2026-11-01' }, 'leave_records_dates_check'],
          'blank kind': [{ kind: ' ' }, 'leave_records_kind_check'],
        },
      ),
      vocab(
        'leave application statuses (OPS_LEAVE_APPLICATION_STATUSES)',
        'ops.leave_applications',
        OPS_LEAVE_APPLICATION_STATUSES,
        'leave_applications_status_check',
        (v) =>
          leaveApplication(
            v === 'pending'
              ? {}
              : v === 'cancelled'
                ? { status: v, cancelled_by: by(), cancelled_at: NOW }
                : {
                    status: v,
                    decided_by: by(),
                    decided_at: NOW,
                    decision_note: 'Checked',
                    leave_record_id: v === 'approved' ? ids.leaveRecord2 : null,
                  },
          ),
      ),
      variants('leave application rules', 'ops.leave_applications', leaveApplication, {
        'waiting for a decision': [{}, 'ok'],
        'ends before it starts': [{ to_date: '2026-11-09' }, 'leave_applications_dates_check'],
        'one day': [{ to_date: '2026-11-10' }, 'ok'],
        'blank reason': [{ reason: ' ' }, 'leave_applications_reason_check'],
        'blank kind': [{ kind: ' ' }, 'leave_applications_kind_check'],
        'no reason at all': [{ reason: null }, '23502'],
        'version zero': [{ version: 0 }, 'leave_applications_version_check'],
        'rejected without a reason': [
          decided('rejected', { decision_note: ' ' }),
          'leave_applications_decided_check',
        ],
        'rejected with a reason': [decided('rejected'), 'ok'],
        'approved without who': [
          { status: 'approved', leave_record_id: id('leaveRecord2') },
          'leave_applications_decided_check',
        ],
        'approved without a leave record': [decided('approved'), 'leave_applications_record_check'],
        'pending with a leave record': [
          { leave_record_id: id('leaveRecord2') },
          'leave_applications_record_check',
        ],
        'rejected with a leave record': [
          decided('rejected', { leave_record_id: id('leaveRecord2') }),
          'leave_applications_record_check',
        ],
        'pending but marked decided': [
          { decided_by: by, decided_at: NOW },
          'leave_applications_decided_check',
        ],
        'cancelled without who': [
          { status: 'cancelled', cancelled_at: NOW },
          'leave_applications_cancelled_check',
        ],
        'pending but marked cancelled': [
          { cancelled_by: by, cancelled_at: NOW },
          'leave_applications_cancelled_check',
        ],
        'cancelled while pending, no reason needed': [
          { status: 'cancelled', cancelled_by: by, cancelled_at: NOW },
          'ok',
        ],
        'approved leave cancelled with no reason': [
          decided('cancelled', {
            leave_record_id: id('leaveRecord2'),
            cancelled_by: by,
            cancelled_at: NOW,
          }),
          'leave_applications_cancelled_check',
        ],
        'approved leave cancelled with a reason': [
          decided('cancelled', {
            leave_record_id: id('leaveRecord2'),
            cancelled_by: by,
            cancelled_at: NOW,
            cancel_reason: 'Came back early',
          }),
          'ok',
        ],
        'second application on the same leave record': [
          decided('approved', { leave_record_id: id('leaveRecord') }),
          'leave_applications_leave_record_key',
        ],
      }),
      variants('import rules', 'ops.attendance_imports', attendanceImport, {
        'same file again': [{ sha256: SHA }, 'attendance_imports_sha256_key'],
        'committed without a time': [{ status: 'committed' }, 'attendance_imports_committed_check'],
        committed: [{ status: 'committed', committed_at: NOW, committed_by: by }, 'ok'],
        'more valid rows than rows': [
          { rows_total: 1, rows_valid: 2 },
          'attendance_imports_counts_check',
        ],
      }),
      vocab(
        'punch sources (OPS_PUNCH_SOURCES)',
        'ops.attendance_punches',
        OPS_PUNCH_SOURCES,
        'attendance_punches_source_check',
        (v) =>
          punch({
            punched_at: LATER,
            source: v,
            import_id: v === 'import' ? ids.attendanceImport : null,
          }),
      ),
      variants('punch rules', 'ops.attendance_punches', punch, {
        'duplicate punch': [{}, 'attendance_punches_staff_time_key'],
        'same time, other direction': [{ direction: 'out' }, 'ok'],
        'direction bogus': [{ direction: 'bogus' }, 'attendance_punches_direction_check'],
        'import without its file': [
          { punched_at: LATER, source: 'import' },
          'attendance_punches_import_check',
        ],
      }),
      vocab(
        'daily statuses (OPS_DAILY_ATTENDANCE_STATUSES)',
        'ops.daily_attendance',
        OPS_DAILY_ATTENDANCE_STATUSES,
        'daily_attendance_status_check',
        (v) => day({ work_date: '2026-10-23', status: v }),
      ),
      variants('daily attendance rules', 'ops.daily_attendance', day, {
        'second row for the day': [{}, 'daily_attendance_staff_date_key'],
        'HR decision without who': [
          { work_date: '2026-10-23', basis: 'hr_decision' },
          'daily_attendance_decided_check',
        ],
        'HR decision': [
          { work_date: '2026-10-23', basis: 'hr_decision', decided_by_user_id: by },
          'ok',
        ],
        'out before in': [
          { work_date: '2026-10-23', first_in: LATER, last_out: NOW },
          'daily_attendance_times_check',
        ],
        'negative lateness': [
          { work_date: '2026-10-23', late_minutes: -1 },
          'daily_attendance_late_check',
        ],
        'basis bogus': [
          { work_date: '2026-10-23', basis: 'bogus' },
          'daily_attendance_basis_check',
        ],
      }),
      vocab(
        'correction statuses (OPS_CORRECTION_STATUSES)',
        'ops.attendance_corrections',
        OPS_CORRECTION_STATUSES,
        'attendance_corrections_status_check',
        (v) =>
          correction({
            work_date: '2026-10-20',
            status: v,
            ...(v === 'pending'
              ? {}
              : { decided_by: by(), decided_at: NOW, decision_note: 'Checked' }),
          }),
      ),
      variants('correction rules', 'ops.attendance_corrections', correction, {
        'second open request for the day': [{}, 'attendance_corrections_one_pending_key'],
        'nothing requested': [
          { work_date: '2026-10-20', requested_status: null },
          'attendance_corrections_something_check',
        ],
        'blank reason': [
          { work_date: '2026-10-20', reason: ' ' },
          'attendance_corrections_reason_check',
        ],
        'rejected without a note': [
          { work_date: '2026-10-20', status: 'rejected', decided_by: by, decided_at: NOW },
          'attendance_corrections_decided_check',
        ],
        'approved without who': [
          { work_date: '2026-10-20', status: 'approved' },
          'attendance_corrections_decided_check',
        ],
        'requested status bogus': [
          { work_date: '2026-10-20', requested_status: 'bogus' },
          'attendance_corrections_requested_status_check',
        ],
      }),
    ],
  );
});

describe('student feedback about teachers (§15)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'collection methods (OPS_FEEDBACK_COLLECTION_METHODS)',
        'ops.student_teacher_feedback',
        OPS_FEEDBACK_COLLECTION_METHODS,
        'student_teacher_feedback_method_check',
        (v) => feedback({ collection_method: v }),
      ),
      variants('feedback rules', 'ops.student_teacher_feedback', feedback, {
        'rating 7 of 10': [{ rating: 7, rating_scale_max: 10 }, 'ok'],
        'rating 6 of 5': [{ rating: 6 }, 'student_teacher_feedback_rating_check'],
        'scale of 1': [{ rating_scale_max: 1 }, 'student_teacher_feedback_scale_check'],
        'category ratings as a list': [
          { category_ratings: '[]' },
          'student_teacher_feedback_category_check',
        ],
        'period end before start': [
          { period_start: '2026-11-01', period_end: '2026-10-01' },
          'student_teacher_feedback_period_check',
        ],
        'period start alone': [
          { period_start: '2026-11-01' },
          'student_teacher_feedback_period_check',
        ],
        'import row twice': [
          { import_id: id('feedbackImport'), import_row: 1 },
          'student_teacher_feedback_import_row_key',
        ],
        'import without a row': [
          { import_id: id('feedbackImport') },
          'student_teacher_feedback_import_check',
        ],
        'anonymous with a student': [
          { is_anonymous: true, student_id: () => ctx.ids.student },
          'student_teacher_feedback_anonymous_check',
        ],
        'named student marked unidentifiable': [
          { student_id: () => ctx.ids.student, respondent_identifiable: false },
          'student_teacher_feedback_identifiable_check',
        ],
        'reviewed without who': [{ reviewed_at: NOW }, 'student_teacher_feedback_reviewed_check'],
      }),
      vocab(
        'import statuses (OPS_FEEDBACK_IMPORT_STATUSES)',
        'ops.teacher_feedback_imports',
        OPS_FEEDBACK_IMPORT_STATUSES,
        'teacher_feedback_imports_status_check',
        (v) => feedbackImport({ status: v, committed_at: v === 'committed' ? NOW : null }),
      ),
      variants('feedback import rules', 'ops.teacher_feedback_imports', feedbackImport, {
        'same file again': [{ sha256: SHA }, 'teacher_feedback_imports_sha256_key'],
        'same file after a discard': [{ sha256: SHA, status: 'discarded' }, 'ok'],
        'committed without a time': [
          { status: 'committed' },
          'teacher_feedback_imports_committed_check',
        ],
      }),
      vocab(
        'import row outcomes (OPS_FEEDBACK_IMPORT_OUTCOMES)',
        'ops.teacher_feedback_import_rows',
        OPS_FEEDBACK_IMPORT_OUTCOMES,
        'teacher_feedback_import_rows_outcome_check',
        (v) => ({ import_id: ids.feedbackImport, row_number: 2, raw: '{}', outcome: v }),
      ),
      variants(
        'import row rules',
        'ops.teacher_feedback_import_rows',
        (o) => ({
          import_id: ids.feedbackImport,
          row_number: 2,
          raw: '{}',
          outcome: 'valid',
          ...o,
        }),
        {
          'row number taken': [{ row_number: 1 }, 'teacher_feedback_import_rows_row_key'],
          'row 0': [{ row_number: 0 }, 'teacher_feedback_import_rows_number_check'],
        },
      ),
      vocab(
        'summary statuses (OPS_FEEDBACK_SUMMARY_STATUSES)',
        'ops.teacher_feedback_summaries',
        OPS_FEEDBACK_SUMMARY_STATUSES,
        'teacher_feedback_summaries_status_check',
        (v) =>
          summary({
            period_start: '2026-12-01',
            period_end: '2026-12-31',
            status: v,
            ...(v === 'approved' ? { approved_by: by(), approved_at: NOW } : {}),
          }),
      ),
      variants('summary rules', 'ops.teacher_feedback_summaries', summary, {
        'second live summary for the period': [{}, 'teacher_feedback_summaries_period_key'],
        'a withdrawn one beside it': [{ status: 'withdrawn' }, 'ok'],
        'approved without who': [
          { period_start: '2027-01-01', period_end: '2027-01-31', status: 'approved' },
          'teacher_feedback_summaries_approved_check',
        ],
        'more responses than students': [
          { period_start: '2027-01-01', period_end: '2027-01-31', eligible_population: 5 },
          'teacher_feedback_summaries_counts_check',
        ],
      }),
      vocab(
        'development action statuses (OPS_DEVELOPMENT_ACTION_STATUSES)',
        'ops.teacher_development_actions',
        OPS_DEVELOPMENT_ACTION_STATUSES,
        'teacher_development_actions_status_check',
        (v) => ({
          teacher_staff_id: staff(),
          action: 'Share worked examples',
          status: v,
          created_by: by(),
        }),
      ),
    ],
  );
});

describe('campaign members (§16)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'member roles (MARKETING_CAMPAIGN_MEMBER_ROLES)',
        'marketing.campaign_members',
        MARKETING_CAMPAIGN_MEMBER_ROLES,
        'campaign_members_role_check',
        (v) => member({ role: v, to_date: '2026-10-31' }),
      ),
      variants('member rules', 'marketing.campaign_members', member, {
        'same person, open twice': [{}, 'campaign_members_active_key'],
        'ends before it starts': [{ to_date: '2026-09-01' }, 'campaign_members_dates_order'],
      }),
    ],
  );
});
