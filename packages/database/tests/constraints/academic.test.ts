import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACADEMIC_ASSESSMENT_KINDS,
  ACADEMIC_ASSESSMENT_STATUSES,
  ACADEMIC_ATTENDANCE_STATUSES,
  ACADEMIC_BATCH_ROUTES,
  ACADEMIC_BATCH_STATUSES,
  ACADEMIC_ENROLMENT_STATUSES,
  ACADEMIC_EXCLUSION_KINDS,
  ACADEMIC_LABEL_STATUSES,
  ACADEMIC_MODES,
  ACADEMIC_PLAN_STATUSES,
  ACADEMIC_RESULT_STATES,
  ACADEMIC_SESSION_STATUSES,
  ACADEMIC_SESSION_TYPES,
} from '../../src/schema/index';
import {
  NOW,
  insert,
  one,
  rolledBack,
  runCases,
  setup,
  variants,
  vocab,
  type Row,
} from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [ADMISSION, LEAD, REQUEST] = [uid(1), uid(2), uid(3)];
const user = () => ctx.ids.user;

const course = (o: Row = {}): Row => ({
  programme_id: ids.programme,
  code: 'CLAT-T-9',
  family_code: 'CLAT-X',
  name: 'Sample course',
  ...o,
});
const chapter = (o: Row = {}): Row => ({
  course_id: ids.course,
  subject_id: ids.subject,
  code: 'LR-09',
  title: 'Sample chapter',
  ...o,
});
const plan = (o: Row = {}): Row => ({
  course_id: ids.course,
  code: 'P-9',
  title: 'Sample plan',
  ...o,
});
const planItem = (o: Row = {}): Row => ({
  plan_id: ids.plan,
  chapter_id: ids.chapter2,
  sequence: 9,
  lesson_code: 'L-9',
  session_type: 'teaching',
  planned_minutes: 60,
  ...o,
});
const book = (o: Row = {}): Row => ({
  book_code: 'CB',
  book_title: 'Sample book',
  chapter_code: 'CB-09',
  title: 'Sample unit',
  ...o,
});
const batch = (o: Row = {}): Row => ({
  code: 'B9',
  name: 'Sample B9',
  course_id: ids.course,
  programme_id: ids.programme,
  is_sample: true,
  ...o,
});
const assignment = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  subject_id: ids.subject,
  staff_member_id: ctx.ids.staff,
  ...o,
});
const exclusion = (o: Row = {}): Row => ({ kind: 'holiday', label: 'Sample holiday', ...o });
const calendarRule = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  label: 'Sample weekdays',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  weekdays: '{1,3,5}',
  slots_per_day: 2,
  ...o,
});
const session = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  date: '2026-11-02',
  start_time: '09:00',
  duration_minutes: 60,
  ...o,
});
const record = (o: Row = {}): Row => ({
  session_id: ids.session,
  batch_id: ids.batch,
  chapter_id: ids.chapter2,
  teacher_staff_id: ctx.ids.staff,
  completion: 'completed',
  actual_minutes: 60,
  recorded_by_user_id: user(),
  ...o,
});
const enrolment = (o: Row = {}): Row => ({
  student_id: ids.student2,
  programme_id: ids.programme,
  course_id: ids.course,
  batch_id: ids.batch,
  source: 'manual',
  manual_reason: 'Sample reason',
  ...o,
});
const intake = (o: Row = {}): Row => ({
  request_event_id: uid(20),
  admission_id: ADMISSION,
  lead_id: LEAD,
  attempt: 1,
  programme_code: 'CLAT',
  student_name: 'Sample Student',
  outcome: 'rejected',
  reason_code: 'NO_BATCH',
  reply_event_id: uid(21),
  ...o,
});
const attendance = (o: Row = {}): Row => ({
  session_id: ids.session,
  student_id: ids.student2,
  status: 'present',
  recorded_by_user_id: user(),
  ...o,
});
const assessment = (o: Row = {}): Row => ({
  code: 'A9',
  title: 'Sample test',
  kind: 'practice',
  batch_id: ids.batch,
  ...o,
});
const section = (o: Row = {}): Row => ({
  assessment_id: ids.assessment,
  code: 'S9',
  name: 'Sample section',
  question_count: 10,
  ...o,
});
const answerKey = (o: Row = {}): Row => ({
  assessment_id: ids.assessment,
  version: 2,
  answers: '{}',
  created_by_user_id: user(),
  ...o,
});
const run = (o: Row = {}): Row => ({
  assessment_id: ids.assessment,
  version: 2,
  status: 'superseded',
  rule_snapshot: '{}',
  reason: 'Sample rescore',
  students_scored: 1,
  students_absent: 1,
  finalised_by_user_id: user(),
  ...o,
});
const result = (o: Row = {}): Row => ({
  run_id: ids.run,
  assessment_id: ids.assessment,
  attempt_id: ids.attempt2,
  student_id: ids.student2,
  max_score: '20',
  section_scores: '{}',
  total_score: '10',
  ...o,
});
const catchup = (o: Row = {}): Row => ({
  student_id: ids.student,
  enrolment_id: ids.enrolment,
  batch_id: ids.batch,
  session_id: ids.session2,
  reason: 'absent',
  created_by_user_id: user(),
  ...o,
});
const intervention = (o: Row = {}): Row => ({
  student_id: ids.student,
  trigger: 'low_scores',
  description: 'Sample concern',
  responsible_staff_id: ctx.ids.staff,
  action: 'Sample action',
  created_by_user_id: user(),
  ...o,
});

beforeAll(async () => {
  ctx = await setup();
  const add = async (name: string, table: string, row: Row) => {
    ids[name] = await insert(ctx.pg, table, row);
  };
  await add('programme', 'core.programmes', { code: 'CLAT', name: 'Sample CLAT' });
  await add('course', 'academic.courses', course({ code: 'CLAT-T-1', family_code: 'CLAT-T' }));
  await add('course2', 'academic.courses', course({ code: 'CLAT-T-2', family_code: 'CLAT-Y' }));
  await add('subject', 'academic.subjects', { course_id: ids.course, code: 'LR', name: 'Logic' });
  await add('chapter', 'academic.chapters', chapter({ code: 'LR-01' }));
  await add('chapter2', 'academic.chapters', chapter({ code: 'LR-02' }));
  const subject2 = await insert(ctx.pg, 'academic.subjects', {
    course_id: ids.course2,
    code: 'QT',
    name: 'Quant',
  });
  await insert(
    ctx.pg,
    'academic.chapters',
    chapter({ course_id: ids.course2, subject_id: subject2 }),
  );
  await add('plan', 'academic.curriculum_plans', plan({ code: 'P-1' }));
  await insert(ctx.pg, 'academic.plan_items', planItem({ sequence: 1, lesson_code: 'L-1' }));
  await insert(ctx.pg, 'academic.concept_book_chapters', book({ chapter_code: 'CB-01' }));
  await add('batch', 'academic.batches', batch({ code: 'B1' }));
  await add('batch2', 'academic.batches', batch({ code: 'B2' }));
  await insert(ctx.pg, 'academic.calendar_rules', calendarRule({ batch_id: ids.batch2 }));
  await insert(
    ctx.pg,
    'academic.calendar_exclusions',
    exclusion({ batch_id: ids.batch2, date: '2026-11-14' }),
  );
  await insert(ctx.pg, 'academic.teacher_assignments', assignment());
  await add('session', 'academic.class_sessions', session());
  await add('session2', 'academic.class_sessions', session({ date: '2026-11-03' }));
  await add('record', 'academic.class_records', record({ chapter_id: ids.chapter }));
  await add('student', 'academic.students', {
    code: 'S1',
    full_name: 'Sample Student',
    source_admission_id: ADMISSION,
    is_sample: true,
  });
  await add('student2', 'academic.students', {
    code: 'S2',
    full_name: 'Sample Two',
    is_sample: true,
  });
  await add(
    'enrolment',
    'academic.enrolments',
    enrolment({ student_id: ids.student, source: 'admission_event', request_event_id: REQUEST }),
  );
  await insert(ctx.pg, 'academic.enrolment_intake_log', intake({ request_event_id: REQUEST }));
  await insert(ctx.pg, 'academic.attendance', attendance({ student_id: ids.student }));
  await add('assessment', 'academic.assessments', assessment({ code: 'A1' }));
  await add('assessment2', 'academic.assessments', assessment({ code: 'A2' }));
  await insert(ctx.pg, 'academic.assessment_sections', section({ code: 'S1' }));
  await insert(ctx.pg, 'academic.assessment_sections', section({ assessment_id: ids.assessment2 }));
  await insert(ctx.pg, 'academic.answer_keys', answerKey({ version: 1 }));
  await insert(ctx.pg, 'academic.answer_keys', answerKey({ assessment_id: ids.assessment2 }));
  const attempt = { assessment_id: ids.assessment, entered_by_user_id: user() };
  await add('attempt', 'academic.attempts', {
    ...attempt,
    student_id: ids.student,
    status: 'submitted',
    manual_score: '10',
  });
  await add('attempt2', 'academic.attempts', {
    ...attempt,
    student_id: ids.student2,
    status: 'absent',
  });
  await add('run', 'academic.result_runs', run({ version: 1, status: 'final', reason: null }));
  await insert(
    ctx.pg,
    'academic.results',
    result({ attempt_id: ids.attempt, student_id: ids.student }),
  );
  await insert(ctx.pg, 'academic.catchup_tasks', catchup({ session_id: ids.session }));
});
afterAll(() => ctx.t.close());

describe('curriculum: courses, subjects, chapters, plans, concept books', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'course modes (ACADEMIC_MODES)',
        'academic.courses',
        ACADEMIC_MODES,
        'courses_mode_check',
        (v) => course({ mode: v }),
      ),
      variants('course rules', 'academic.courses', course, {
        'code taken': [{ code: 'CLAT-T-1' }, 'courses_code_key'],
        'family version taken': [{ family_code: 'CLAT-T' }, 'courses_family_version_key'],
        'version 0': [{ version: 0 }, 'courses_version_positive'],
        '14-minute class': [{ class_minutes: 14 }, 'courses_class_minutes_range'],
        '15-minute class': [{ class_minutes: 15 }, 'ok'],
        '300-minute class': [{ class_minutes: 300 }, 'ok'],
        '301-minute class': [{ class_minutes: 301 }, 'courses_class_minutes_range'],
        'unknown minutes label': [
          { class_minutes_status: 'bogus' },
          'courses_class_minutes_status_check',
        ],
        'unknown status': [{ status: 'bogus' }, 'courses_status_check'],
      }),
      one(
        'subject code unique within a course',
        'academic.subjects',
        () => ({ course_id: ids.course, code: 'LR', name: 'Sample again' }),
        'subjects_course_code_key',
      ),
      variants('chapter rules', 'academic.chapters', chapter, {
        'code taken in the course': [{ code: 'LR-01' }, 'chapters_course_code_key'],
        'weight 0': [{ weight: 0 }, 'chapters_weight_range'],
        'weight 10': [{ weight: 10 }, 'ok'],
        'weight 11': [{ weight: 11 }, 'chapters_weight_range'],
        'active with an alias': [{ alias_of_chapter_id: id('chapter') }, 'chapters_alias_rule'],
        'moved with an alias': [{ status: 'moved', alias_of_chapter_id: id('chapter') }, 'ok'],
        'unknown status': [{ status: 'bogus' }, 'chapters_status_check'],
      }),
      vocab(
        'plan statuses (ACADEMIC_PLAN_STATUSES)',
        'academic.curriculum_plans',
        ACADEMIC_PLAN_STATUSES,
        'curriculum_plans_status_check',
        (v) => plan({ status: v }),
      ),
      variants('plan rules', 'academic.curriculum_plans', plan, {
        'code taken': [{ code: 'P-1' }, 'curriculum_plans_code_key'],
        'unknown counts label': [{ counts_status: 'bogus' }, 'curriculum_plans_label_check'],
        'unknown dates label': [{ dates_status: 'bogus' }, 'curriculum_plans_label_check'],
        'version 0': [{ version: 0 }, 'curriculum_plans_version_positive'],
        'pending target proposed': [
          { pending_target_status: 'proposed' },
          'curriculum_plans_pending_target_check',
        ],
        'supersedes itself': [
          { id: uid(50), supersedes_plan_id: uid(50) },
          'curriculum_plans_not_self_superseding',
        ],
        'supersedes an older plan': [{ version: 2, supersedes_plan_id: id('plan') }, 'ok'],
      }),
      variants('plan item rules', 'academic.plan_items', planItem, {
        'sequence taken': [{ sequence: 1 }, 'plan_items_plan_sequence_key'],
        'lesson taken': [{ lesson_code: 'L-1' }, 'plan_items_plan_lesson_key'],
        'test lesson': [{ session_type: 'test' }, 'plan_items_session_type_check'],
        '0 classes': [{ planned_classes: 0 }, 'plan_items_counts_positive'],
        '0 minutes': [{ planned_minutes: 0 }, 'plan_items_counts_positive'],
      }),
      variants('concept-book index rules', 'academic.concept_book_chapters', book, {
        'code taken': [{ chapter_code: 'CB-01' }, 'concept_book_chapters_code_key'],
        'opening unit': [{ status: 'opening_unit' }, 'ok'],
        'unknown status': [{ status: 'bogus' }, 'concept_book_chapters_status_check'],
        'planned counts': [
          { planned_concept_questions: 20, question_count_status: 'planned' },
          'ok',
        ],
        'counts claimed as written': [
          { question_count_status: 'written' },
          'concept_book_chapters_count_label',
        ],
      }),
      vocab(
        'concept-book index statuses (ACADEMIC_LABEL_STATUSES)',
        'academic.concept_book_chapters',
        ACADEMIC_LABEL_STATUSES,
        'concept_book_chapters_index_status_check',
        (v) => book({ index_status: v }),
      ),
    ],
  );
});

describe('batches, assignments, calendars, sessions and the teaching log', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'batch routes (ACADEMIC_BATCH_ROUTES)',
        'academic.batches',
        ACADEMIC_BATCH_ROUTES,
        'batches_route_check',
        (v) => batch({ route: v }),
      ),
      vocab(
        'batch statuses (ACADEMIC_BATCH_STATUSES)',
        'academic.batches',
        ACADEMIC_BATCH_STATUSES,
        'batches_status_check',
        (v) => batch({ status: v }),
      ),
      variants('batch rules', 'academic.batches', batch, {
        'code taken': [{ code: 'B1' }, 'batches_code_key'],
        'unknown mode': [{ mode: 'bogus' }, 'batches_mode_check'],
        'ends before it starts': [
          { start_date: '2026-11-02', end_date: '2026-11-01' },
          'batches_dates_order',
        ],
        'capacity 0': [{ capacity: 0 }, 'batches_capacity_positive'],
        'capacity 1': [{ capacity: 1 }, 'ok'],
        'class minutes 0': [{ class_minutes_override: 0 }, 'batches_class_minutes_positive'],
        'unknown exam-date status': [
          { target_exam_date_status: 'bogus' },
          'batches_exam_date_status_check',
        ],
      }),
      variants('teacher assignment rules', 'academic.teacher_assignments', assignment, {
        'second active assignment': [{}, 'teacher_assignments_active_key'],
        'ended duplicate': [{ status: 'ended' }, 'ok'],
        'unknown status': [{ status: 'bogus' }, 'teacher_assignments_status_check'],
        'ends before it starts': [
          { status: 'ended', start_date: '2026-11-02', end_date: '2026-11-01' },
          'teacher_assignments_dates_order',
        ],
      }),
      vocab(
        'teacher employment types',
        'academic.teacher_assignments',
        ['full_time', 'part_time'],
        'teacher_assignments_employment_check',
        (v) => assignment({ status: 'ended', employment_type: v }),
      ),
      one(
        'a room holds at least one person',
        'academic.rooms',
        () => ({ code: 'R9', name: 'Sample room', capacity: 0 }),
        'rooms_capacity_positive',
      ),
      vocab(
        'exclusion kinds (ACADEMIC_EXCLUSION_KINDS)',
        'academic.calendar_exclusions',
        ACADEMIC_EXCLUSION_KINDS,
        'calendar_exclusions_kind_check',
        (v) => exclusion({ kind: v, date: '2026-11-14' }),
      ),
      variants('calendar exclusion shape', 'academic.calendar_exclusions', exclusion, {
        'dated day': [{ date: '2026-11-14' }, 'ok'],
        'undated allowance': [
          { period_start: '2026-04-01', period_end: '2026-04-30', days: 1, slots_per_day: 2 },
          'ok',
        ],
        'neither shape': [{}, 'calendar_exclusions_shape'],
        'both shapes': [
          { date: '2026-04-14', period_start: '2026-04-01', period_end: '2026-04-30', days: 1 },
          'calendar_exclusions_shape',
        ],
        'allowance period reversed': [
          { period_start: '2026-04-30', period_end: '2026-04-01', days: 1, slots_per_day: 2 },
          'calendar_exclusions_shape',
        ],
        'allowance without an end': [
          { period_start: '2026-04-01', days: 1, slots_per_day: 2 },
          'calendar_exclusions_shape',
        ],
        'allowance without days or slots': [
          { period_start: '2026-04-01', period_end: '2026-04-30' },
          'calendar_exclusions_shape',
        ],
        'undated exam blackout': [
          { kind: 'exam_blackout', period_start: '2026-04-01', period_end: '2026-04-30' },
          'ok',
        ],
        'allowance with 0 slots': [
          { period_start: '2026-04-01', period_end: '2026-04-30', days: 1, slots_per_day: 0 },
          'calendar_exclusions_shape',
        ],
        'dated day with a period end and negative slots': [
          { date: '2026-11-14', period_end: '2026-11-30', slots_per_day: -3 },
          'calendar_exclusions_shape',
        ],
        'negative days': [
          { period_start: '2026-04-01', period_end: '2026-04-30', days: -1, slots_per_day: 2 },
          'calendar_exclusions_shape',
        ],
        'unknown status': [
          { date: '2026-11-14', status: 'bogus' },
          'calendar_exclusions_status_check',
        ],
      }),
      variants('calendar rule rules', 'academic.calendar_rules', calendarRule, {
        regular: [{}, 'ok'],
        extra: [{ kind: 'extra' }, 'ok'],
        'period reversed': [{ period_end: '2026-10-31' }, 'calendar_rules_period_order'],
        '0 slots': [{ slots_per_day: 0 }, 'calendar_rules_slots_positive'],
        'unknown kind': [{ kind: 'bogus' }, 'calendar_rules_kind_check'],
        'Monday to Sunday (ISO 1-7)': [{ weekdays: '{1,2,3,4,5,6,7}' }, 'ok'],
        'weekday 0': [{ weekdays: '{0,1}' }, 'calendar_rules_weekdays_range'],
        'weekday 8': [{ weekdays: '{8}' }, 'calendar_rules_weekdays_range'],
      }),
      vocab(
        'calendar rule statuses (ACADEMIC_LABEL_STATUSES)',
        'academic.calendar_rules',
        ACADEMIC_LABEL_STATUSES,
        'calendar_rules_status_check',
        (v) => calendarRule({ status: v }),
      ),
      vocab(
        'session types (ACADEMIC_SESSION_TYPES)',
        'academic.class_sessions',
        ACADEMIC_SESSION_TYPES,
        'class_sessions_type_check',
        (v) => session({ session_type: v }),
      ),
      vocab(
        'session statuses (ACADEMIC_SESSION_STATUSES)',
        'academic.class_sessions',
        ACADEMIC_SESSION_STATUSES,
        'class_sessions_status_check',
        (v) => session({ status: v, status_reason: 'Sample reason' }),
      ),
      variants('session rules', 'academic.class_sessions', session, {
        'cancelled without a reason': [{ status: 'cancelled' }, 'class_sessions_reason_required'],
        'rescheduled without a reason': [
          { status: 'rescheduled' },
          'class_sessions_reason_required',
        ],
        'starts 23:59': [{ start_time: '23:59' }, 'ok'],
        'starts 24:00': [{ start_time: '24:00' }, 'class_sessions_start_time_format'],
        '4 minutes': [{ duration_minutes: 4 }, 'class_sessions_duration_range'],
        '5 minutes': [{ duration_minutes: 5 }, 'ok'],
        '600 minutes': [{ duration_minutes: 600 }, 'ok'],
        '601 minutes': [{ duration_minutes: 601 }, 'class_sessions_duration_range'],
        'regular session as a make-up': [
          { makeup_for_session_id: id('session') },
          'class_sessions_makeup_link',
        ],
        'make-up session': [{ kind: 'makeup', makeup_for_session_id: id('session') }, 'ok'],
      }),
      variants('teaching log rules', 'academic.class_records', record, {
        'second current record for a chapter': [
          { chapter_id: id('chapter') },
          'class_records_current_key',
        ],
        'superseded copy': [{ chapter_id: id('chapter'), state: 'superseded' }, 'ok'],
        '0 minutes': [{ actual_minutes: 0 }, 'class_records_minutes_range'],
        '601 minutes': [{ actual_minutes: 601 }, 'class_records_minutes_range'],
        'draft with a submit time': [
          { state: 'draft', submitted_at: NOW },
          'class_records_draft_unsubmitted',
        ],
        'verifier without a time': [
          { verified_by_user_id: user },
          'class_records_verification_pair',
        ],
        'correction without a reason': [
          { corrects_record_id: id('record') },
          'class_records_correction_reason',
        ],
        'unknown completion': [{ completion: 'bogus' }, 'class_records_completion_check'],
      }),
    ],
  );
});

describe('students, enrolments, intake log and attendance', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'student rules',
        'academic.students',
        (o) => ({ code: 'S9', full_name: 'Sample Nine', ...o }),
        {
          'code taken': [{ code: 'S1' }, 'students_code_key'],
          'admission already has a student': [
            { source_admission_id: ADMISSION },
            'students_source_admission_key',
          ],
          'unknown status': [{ status: 'bogus' }, 'students_status_check'],
        },
      ),
      vocab(
        'enrolment statuses (ACADEMIC_ENROLMENT_STATUSES)',
        'academic.enrolments',
        ACADEMIC_ENROLMENT_STATUSES,
        'enrolments_status_check',
        (v) => enrolment({ status: v }),
      ),
      variants('enrolment rules', 'academic.enrolments', enrolment, {
        'manual with a reason': [{}, 'ok'],
        'manual without a reason': [{ manual_reason: null }, 'enrolments_manual_reason'],
        'event without its request': [
          { source: 'admission_event' },
          'enrolments_event_has_request',
        ],
        'request answered twice': [
          { source: 'admission_event', request_event_id: REQUEST },
          'enrolments_request_event_key',
        ],
        'second active place in a batch': [
          { student_id: id('student'), course_id: null },
          'enrolments_active_student_batch_key',
        ],
        'unknown source': [{ source: 'bogus' }, 'enrolments_source_check'],
      }),
      variants('intake log rules', 'academic.enrolment_intake_log', intake, {
        'rejected with a code': [{}, 'ok'],
        'rejected without a code': [{ reason_code: null }, 'enrolment_intake_log_outcome_shape'],
        'confirmed without its records': [
          { outcome: 'confirmed' },
          'enrolment_intake_log_outcome_shape',
        ],
        'confirmed with its records': [
          { outcome: 'confirmed', student_id: id('student'), enrolment_id: id('enrolment') },
          'ok',
        ],
        'request logged twice': [{ request_event_id: REQUEST }, 'enrolment_intake_log_request_key'],
        'unknown outcome': [{ outcome: 'bogus' }, 'enrolment_intake_log_outcome_check'],
      }),
      vocab(
        'attendance statuses (ACADEMIC_ATTENDANCE_STATUSES)',
        'academic.attendance',
        ACADEMIC_ATTENDANCE_STATUSES,
        'attendance_status_check',
        (v) => attendance({ status: v }),
      ),
      variants('attendance rules', 'academic.attendance', attendance, {
        'second mark for a student': [
          { student_id: id('student') },
          'attendance_session_student_key',
        ],
        '0 minutes present': [{ minutes_present: 0 }, 'ok'],
        '600 minutes present': [{ minutes_present: 600 }, 'ok'],
        '601 minutes present': [{ minutes_present: 601 }, 'attendance_minutes_range'],
      }),
    ],
  );
});

describe('assessments, answer keys, result runs and results', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'assessment kinds (ACADEMIC_ASSESSMENT_KINDS)',
        'academic.assessments',
        ACADEMIC_ASSESSMENT_KINDS,
        'assessments_kind_check',
        (v) => assessment({ kind: v }),
      ),
      vocab(
        'assessment statuses (ACADEMIC_ASSESSMENT_STATUSES)',
        'academic.assessments',
        ACADEMIC_ASSESSMENT_STATUSES,
        'assessments_status_check',
        (v) => assessment({ status: v }),
      ),
      variants('assessment rules', 'academic.assessments', assessment, {
        'code taken': [{ code: 'A1' }, 'assessments_code_key'],
        '0-minute test': [{ duration_minutes: 0 }, 'assessments_minutes_positive'],
        'no discussion time': [{ discussion_minutes: 0 }, 'ok'],
        'negative discussion time': [{ discussion_minutes: -1 }, 'assessments_minutes_positive'],
        'starts 09:00': [{ start_time: '09:00' }, 'ok'],
        'starts 9:00': [{ start_time: '9:00' }, 'assessments_start_time_format'],
      }),
      variants('section rules', 'academic.assessment_sections', section, {
        'code taken': [{ code: 'S1' }, 'assessment_sections_code_key'],
        '0 questions': [{ question_count: 0 }, 'assessment_sections_questions_range'],
        '500 questions': [{ question_count: 500 }, 'ok'],
        '501 questions': [{ question_count: 501 }, 'assessment_sections_questions_range'],
        'unknown answer format': [{ answer_format: 'bogus' }, 'assessment_sections_format_check'],
      }),
      variants('answer key versions', 'academic.answer_keys', answerKey, {
        'version 2': [{}, 'ok'],
        'version 1 again': [{ version: 1 }, 'answer_keys_version_key'],
        'version 0': [{ version: 0 }, 'answer_keys_version_positive'],
      }),
      variants('result run rules', 'academic.result_runs', run, {
        'rescore with a reason': [{}, 'ok'],
        'second final run': [{ status: 'final' }, 'result_runs_one_final_key'],
        'version 1 again': [{ version: 1, reason: null }, 'result_runs_version_key'],
        'rescore without a reason': [{ reason: null }, 'result_runs_rescore_reason'],
        'unknown status': [{ status: 'bogus' }, 'result_runs_status_check'],
      }),
      vocab(
        'result states (ACADEMIC_RESULT_STATES)',
        'academic.results',
        ACADEMIC_RESULT_STATES,
        'results_state_check',
        (v) => result(v === 'scored' ? {} : { state: v, total_score: null, absent: true }),
      ),
      variants('result rules', 'academic.results', result, {
        'attempt scored twice in a run': [
          { attempt_id: id('attempt'), student_id: id('student') },
          'results_run_attempt_key',
        ],
        'scored but flagged absent': [{ total_score: null, absent: true }, 'results_state_shape'],
        'withheld with a score': [{ state: 'withheld' }, 'results_state_shape'],
        'absent with a score': [{ state: 'absent', absent: true }, 'results_absent_shape'],
        'percentile 100': [{ percentile: '100' }, 'ok'],
        'percentile 101': [{ percentile: '101' }, 'results_percentile_range'],
        'percentile -1': [{ percentile: '-1' }, 'results_percentile_range'],
      }),
    ],
  );
});

describe('catch-up tasks and interventions', () => {
  runCases(
    () => ctx.pg,
    [
      variants('catch-up rules', 'academic.catchup_tasks', catchup, {
        'late joiner': [{ reason: 'late_joiner' }, 'ok'],
        'same session twice': [
          { session_id: id('session') },
          'catchup_tasks_enrolment_session_key',
        ],
        'unknown reason': [{ reason: 'bogus' }, 'catchup_tasks_reason_check'],
        'unknown status': [{ status: 'bogus' }, 'catchup_tasks_status_check'],
      }),
      variants('intervention rules', 'academic.interventions', intervention, {
        'resolved without an outcome': [{ status: 'resolved' }, 'interventions_outcome_on_resolve'],
        'closed with an outcome': [{ status: 'closed', outcome: 'Sample outcome' }, 'ok'],
        'unknown status': [{ status: 'bogus' }, 'interventions_status_check'],
      }),
      vocab(
        'intervention triggers',
        'academic.interventions',
        [
          'repeated_absence',
          'declining_scores',
          'low_scores',
          'missed_assessments',
          'overdue_catch_up',
          'other',
        ],
        'interventions_trigger_check',
        (v) => intervention({ trigger: v }),
      ),
      vocab(
        'intervention parent-contact statuses',
        'academic.interventions',
        ['not_contacted', 'contacted', 'unreachable', 'not_required'],
        'interventions_parent_contact_check',
        (v) => intervention({ parent_contact_status: v }),
      ),
    ],
  );
});

describe('on-delete behaviour', () => {
  it.each([
    ['a course takes its subjects and chapters with it', 'courses', 'course2', 'ok'],
    ['a plan takes its items with it', 'curriculum_plans', 'plan', 'ok'],
    ['a chapter in a plan is kept', 'chapters', 'chapter2', 'plan_items_chapter_id_chapters_id_fk'],
    ['a batch takes its calendar with it', 'batches', 'batch2', 'ok'],
    ['an assessment takes its sections and keys with it', 'assessments', 'assessment2', 'ok'],
    ['a scored attempt is kept', 'attempts', 'attempt', 'results_attempt_id_attempts_id_fk'],
  ])('%s', async (_, table, name, expected) => {
    const outcome = await rolledBack(ctx.pg, async () => {
      const { affectedRows } = await ctx.pg.query(`DELETE FROM academic.${table} WHERE id = $1`, [
        ids[name],
      ]);
      return affectedRows === 1 ? 'ok' : 'not deleted';
    });
    expect(outcome).toBe(expected);
  });
});
