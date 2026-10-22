import { afterAll, beforeAll, describe } from 'vitest';
import {
  ACADEMIC_ATTEMPT_STATUSES,
  ACADEMIC_DEMO_ATTENDANCE_STATUSES,
  ACADEMIC_RECORD_ACTIVITIES,
  ACADEMIC_RECORD_STATES,
  ACADEMIC_REVIEW_TYPES,
  ACADEMIC_SESSION_KINDS,
  ACADEMIC_TEACHER_ROLES,
} from '../../src/schema/index';
import { NOW, insert, one, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const id: Record<string, string> = {};
const REVIEW_KEY = '7a1c0b52-1f3e-4c55-9d1a-0c2b3a4d5e6f';
const DEMO_SESSION = '8b2d1c63-2a4f-4d66-8e2b-1d3c4b5e6f70';

beforeAll(async () => {
  ctx = await setup();
  const { pg, ids } = ctx;
  const ins = (table: string, row: Row) => insert(pg, table, row);
  id.programme = await ins('core.programmes', { code: 'CLAT', name: 'Sample CLAT' });
  id.course = await ins('academic.courses', {
    programme_id: id.programme,
    code: 'CLAT-T-1',
    family_code: 'CLAT-T',
    name: 'Sample course',
  });
  id.subject = await ins('academic.subjects', { course_id: id.course, code: 'LR', name: 'Logic' });
  id.chapter = await ins('academic.chapters', {
    course_id: id.course,
    subject_id: id.subject,
    code: 'LR-01',
    title: 'Sample chapter',
  });
  const batch = { course_id: id.course, programme_id: id.programme, is_sample: true };
  id.batch = await ins('academic.batches', { ...batch, code: 'B1', name: 'Sample B1' });
  id.batch2 = await ins('academic.batches', { ...batch, code: 'B2', name: 'Sample B2' });
  id.student = await ins('academic.students', {
    code: 'S1',
    full_name: 'Sample Student',
    core_student_id: ids.student,
    is_sample: true,
  });
  id.student2 = await ins('academic.students', { code: 'S2', full_name: 'Sample Two' });
  id.enrolment = await ins('academic.enrolments', enrolment());
  id.staff2 = await ins('core.staff_members', { full_name: 'Sample Substitute' });
  id.pattern = await ins('academic.timetable_patterns', pattern());
  id.session = await ins('academic.class_sessions', classSession({ pattern_id: id.pattern }));
  id.assessment = await ins('academic.assessments', {
    code: 'A1',
    title: 'Sample test',
    kind: 'chapter_test',
    batch_id: id.batch,
  });
  await ins('academic.batch_placements', placement());
  await ins('academic.teacher_reviews', review());
  await ins('academic.session_demo_attendees', demoAttendee());
  await ins('academic.session_teachers', sessionTeacher());
});
afterAll(() => ctx.t.close());

function enrolment(o: Row = {}): Row {
  return {
    student_id: id.student,
    programme_id: id.programme,
    course_id: id.course,
    batch_id: id.batch,
    source: 'manual',
    manual_reason: 'test',
    ...o,
  };
}
function pattern(o: Row = {}): Row {
  return {
    batch_id: id.batch,
    subject_id: id.subject,
    staff_id: ctx.ids.staff,
    weekday: 1,
    start_time: '09:00',
    duration_minutes: 60,
    effective_from: '2026-11-02',
    created_by_user_id: ctx.ids.user,
    ...o,
  };
}
function classSession(o: Row = {}): Row {
  return {
    batch_id: id.batch,
    date: '2026-11-02',
    start_time: '09:00',
    duration_minutes: 60,
    ...o,
  };
}
function placement(o: Row = {}): Row {
  return {
    enrolment_id: id.enrolment,
    batch_id: id.batch,
    start_date: '2026-11-01',
    placed_by_user_id: ctx.ids.user,
    ...o,
  };
}
function review(o: Row = {}): Row {
  return {
    review_key: REVIEW_KEY,
    version: 1,
    author_staff_id: ctx.ids.staff,
    core_student_id: ctx.ids.student,
    review_type: 'periodic_progress',
    created_by_user_id: ctx.ids.user,
    ...o,
  };
}
function demoAttendee(o: Row = {}): Row {
  return {
    session_id: id.session,
    ops_demo_session_id: DEMO_SESSION,
    core_student_id: ctx.ids.student2,
    display_name: 'Sample Sibling',
    demo_day_number: 1,
    added_by_user_id: ctx.ids.user,
    ...o,
  };
}
function sessionTeacher(o: Row = {}): Row {
  return { session_id: id.session, staff_id: ctx.ids.staff, participation: 'planned', ...o };
}
const record = (o: Row = {}): Row => ({
  session_id: id.session,
  batch_id: id.batch,
  chapter_id: id.chapter,
  teacher_staff_id: ctx.ids.staff,
  completion: 'completed',
  actual_minutes: 60,
  recorded_by_user_id: ctx.ids.user,
  ...o,
});
const attemptRow = (o: Row = {}): Row => ({
  assessment_id: id.assessment,
  student_id: id.student2,
  entered_by_user_id: ctx.ids.user,
  ...o,
});
const recorded = () => ({ recorded_by_user_id: ctx.ids.user, recorded_at: NOW });

describe('academic identity and enrolment', () => {
  runCases(
    () => ctx.pg,
    [
      one(
        'one academic student per core student',
        'academic.students',
        () => ({ code: 'S3', full_name: 'Sample Dup', core_student_id: ctx.ids.student }),
        'students_core_student_key',
      ),
      variants('one ACTIVE enrolment per student and course', 'academic.enrolments', enrolment, {
        activeAgain: [{ batch_id: () => id.batch2 }, 'enrolments_active_student_course_key'],
        completedAgain: [{ batch_id: () => id.batch2, status: 'completed' }, 'ok'],
        otherStudent: [{ student_id: () => id.student2 }, 'ok'],
      }),
      variants('one open placement per enrolment', 'academic.batch_placements', placement, {
        secondOpen: [{ batch_id: () => id.batch2 }, 'batch_placements_one_open_key'],
        closed: [{ end_date: '2026-11-30' }, 'ok'],
        endBeforeStart: [{ end_date: '2026-10-01' }, 'batch_placements_dates_order'],
      }),
    ],
  );
});

describe('timetable, delivery and session teachers', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'assignment roles',
        'academic.teacher_assignments',
        ACADEMIC_TEACHER_ROLES,
        'teacher_assignments_role_check',
        (v) => ({
          batch_id: id.batch,
          subject_id: id.subject,
          staff_member_id: ctx.ids.staff,
          role: v,
        }),
      ),
      vocab(
        'session kinds',
        'academic.class_sessions',
        ACADEMIC_SESSION_KINDS,
        'class_sessions_kind_check',
        (v) => classSession({ kind: v }),
      ),
      variants(
        'one generated session per pattern and date',
        'academic.class_sessions',
        classSession,
        {
          sameDay: [{ pattern_id: () => id.pattern }, 'class_sessions_pattern_date_key'],
          nextWeek: [{ pattern_id: () => id.pattern, date: '2026-11-09' }, 'ok'],
          delivererWithoutTime: [
            { delivered_by_user_id: () => ctx.ids.user },
            'class_sessions_delivery_pair',
          ],
        },
      ),
      variants('pattern rules', 'academic.timetable_patterns', pattern, {
        weekday7: [{ weekday: 7 }, 'ok'],
        weekday8: [{ weekday: 8 }, 'timetable_patterns_weekday_range'],
        badTime: [{ start_time: '9:00' }, 'timetable_patterns_start_time_format'],
        endsBeforeStart: [{ effective_to: '2026-11-01' }, 'timetable_patterns_effective_order'],
        publishedUnstamped: [{ status: 'published' }, 'timetable_patterns_published_stamp'],
      }),
      variants('session teacher participation', 'academic.session_teachers', sessionTeacher, {
        duplicate: [{}, 'session_teachers_active_key'],
        actual: [{ participation: 'actual' }, 'ok'],
        removedDuplicate: [{ removed_at: NOW }, 'ok'],
        unauthorisedSubstitute: [
          { staff_id: () => id.staff2, role: 'substitute', replaces_staff_id: () => ctx.ids.staff },
          'session_teachers_substitution_authorised',
        ],
        authorisedSubstitute: [
          {
            staff_id: () => id.staff2,
            role: 'substitute',
            replaces_staff_id: () => ctx.ids.staff,
            reason: 'Sample reason',
            authorised_by_user_id: () => ctx.ids.user,
          },
          'ok',
        ],
      }),
      variants(
        'teacher unavailability',
        'academic.teacher_unavailability',
        (o) => ({
          staff_id: ctx.ids.staff,
          from_date: '2026-11-03',
          to_date: '2026-11-04',
          reason: 'Sample reason',
          entered_by_user_id: ctx.ids.user,
          ...o,
        }),
        {
          ok: [{}, 'ok'],
          reversed: [{ to_date: '2026-11-01' }, 'teacher_unavailability_dates_order'],
        },
      ),
    ],
  );
});

describe('demo attendees, teaching log, reviews, assessments', () => {
  runCases(
    () => ctx.pg,
    [
      variants('demo attendee rules', 'academic.session_demo_attendees', demoAttendee, {
        duplicate: [{}, 'session_demo_attendees_session_demo_key'],
        day11: [
          { ops_demo_session_id: '9c3e2d74-3b50-4e77-9f3c-2e4d5c6f7081', demo_day_number: 11 },
          'session_demo_attendees_day_range',
        ],
        unrecordedPresent: [
          { ops_demo_session_id: '9c3e2d74-3b50-4e77-9f3c-2e4d5c6f7081', status: 'present' },
          'session_demo_attendees_recorded_has_actor',
        ],
      }),
      vocab(
        'demo attendance values',
        'academic.session_demo_attendees',
        ACADEMIC_DEMO_ATTENDANCE_STATUSES,
        'session_demo_attendees_status_check',
        (v) =>
          demoAttendee({
            ops_demo_session_id: 'ad4f3e85-4c61-4f88-8a4d-3f5e6d708192',
            status: v,
            ...recorded(),
          }),
      ),
      vocab(
        'log states incl. draft',
        'academic.class_records',
        ACADEMIC_RECORD_STATES,
        'class_records_state_check',
        (v) => record({ state: v }),
      ),
      vocab(
        'log activities incl. revision and doubt solving',
        'academic.class_records',
        ACADEMIC_RECORD_ACTIVITIES,
        'class_records_activity_check',
        (v) => record({ activity: v }),
      ),
      vocab(
        'review types',
        'academic.teacher_reviews',
        ACADEMIC_REVIEW_TYPES,
        'teacher_reviews_type_check',
        (v) => review({ review_key: 'be5a4f96-5d72-4a99-9b5e-4a6f7e8192a3', review_type: v }),
      ),
      variants('review versions', 'academic.teacher_reviews', review, {
        secondDraft: [{ version: 2 }, 'teacher_reviews_one_draft_key'],
        submittedV2: [{ version: 2, status: 'submitted', submitted_at: NOW }, 'ok'],
        sameVersion: [{ status: 'submitted', submitted_at: NOW }, 'teacher_reviews_version_key'],
        noStudent: [{ version: 3, core_student_id: null }, 'teacher_reviews_student_ref'],
        submittedUnstamped: [{ version: 3, status: 'submitted' }, 'teacher_reviews_status_stamps'],
        withdrawnNoReason: [
          { version: 3, status: 'withdrawn', withdrawn_at: NOW },
          'teacher_reviews_status_stamps',
        ],
      }),
      vocab(
        'attempt statuses',
        'academic.attempts',
        ACADEMIC_ATTEMPT_STATUSES,
        'attempts_status_check',
        (v) => attemptRow({ status: v, ...(v === 'submitted' ? { manual_score: '12.5' } : {}) }),
      ),
      variants('attempt shape', 'academic.attempts', attemptRow, {
        submittedEmpty: [{ status: 'submitted' }, 'attempts_shape'],
        exemptWithScore: [{ status: 'exempt', manual_score: '3' }, 'attempts_shape'],
      }),
      one(
        'publication needs who and when',
        'academic.assessments',
        () => ({
          code: 'A2',
          title: 'Sample',
          kind: 'practice',
          batch_id: id.batch,
          published_at: NOW,
        }),
        'assessments_publication_pair',
      ),
    ],
  );
});
