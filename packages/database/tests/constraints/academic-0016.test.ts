/**
 * Migration 0016 (Academic): assessment admin fields, eligible batches, roster snapshot and
 * result publication versions (brief §17–21), review observation date and batch (§16).
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  ACADEMIC_PUBLICATION_STATUSES,
  ACADEMIC_RANKING_SCOPES,
  ACADEMIC_ROSTER_ATTENDANCE,
  ACADEMIC_ROSTER_MARKS_STATES,
} from '../../src/schema/index';
import { NOW, insert, one, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const id: Record<string, string> = {};

beforeAll(async () => {
  ctx = await setup();
  const ins = (table: string, row: Row) => insert(ctx.pg, table, row);
  id.programme = await ins('core.programmes', { code: 'IPMAT', name: 'Sample IPMAT' });
  id.course = await ins('academic.courses', {
    programme_id: id.programme,
    code: 'IPM-1',
    family_code: 'IPM',
    name: 'Sample course',
  });
  const batch = { course_id: id.course, programme_id: id.programme, is_sample: true };
  id.batch = await ins('academic.batches', { ...batch, code: 'B1', name: 'Sample B1' });
  id.batch2 = await ins('academic.batches', { ...batch, code: 'B2', name: 'Sample B2' });
  id.student = await ins('academic.students', {
    code: 'S1',
    full_name: 'Sample One',
    is_sample: true,
  });
  id.student2 = await ins('academic.students', {
    code: 'S2',
    full_name: 'Sample Two',
    is_sample: true,
  });
  id.assessment = await ins('academic.assessments', assessment());
  id.assessment2 = await ins('academic.assessments', assessment({ code: 'IPM-M0' }));
  await ins('academic.assessment_batches', { assessment_id: id.assessment, batch_id: id.batch });
  await ins('academic.assessment_roster', roster());
  id.run = await ins('academic.result_runs', {
    assessment_id: id.assessment,
    version: 1,
    status: 'final',
    rule_snapshot: '{}',
    students_scored: 1,
    students_absent: 0,
    finalised_by_user_id: ctx.ids.user,
  });
  await ins('academic.result_publications', publication());
});
afterAll(() => ctx.t.close());

function assessment(o: Row = {}): Row {
  return {
    code: 'IPM-M1',
    title: 'Sample mock',
    kind: 'full_mock',
    batch_id: id.batch,
    academic_year: '2026-27',
    responsible_teacher_staff_id: ctx.ids.staff,
    evaluator_staff_id: ctx.ids.staff,
    max_marks: '120',
    roster_snapshot_at: NOW,
    is_sample: true,
    ...o,
  };
}
function roster(o: Row = {}): Row {
  return {
    assessment_id: id.assessment,
    student_id: id.student,
    batch_id: id.batch,
    admission_number_snapshot: 'ADM-2026-001',
    display_name_snapshot: 'Sample One',
    is_sample: true,
    ...o,
  };
}
const verified = () => ({
  attendance: 'present',
  marks_state: 'verified',
  verified_at: NOW,
  verified_by_user_id: () => ctx.ids.user,
});
function publication(o: Row = {}): Row {
  return {
    assessment_id: id.assessment,
    version: 1,
    result_run_id: id.run,
    completeness: '{}',
    published_by_user_id: ctx.ids.user,
    ...o,
  };
}

describe('assessment admin fields and eligible batches', () => {
  runCases(
    () => ctx.pg,
    [
      variants('academic year, max marks', 'academic.assessments', assessment, {
        valid: [{ code: 'IPM-M2' }, 'ok'],
        legacyBlank: [
          {
            code: 'IPM-M3',
            academic_year: null,
            responsible_teacher_staff_id: null,
            evaluator_staff_id: null,
            max_marks: null,
            roster_snapshot_at: null,
          },
          'ok',
        ],
        badYear: [{ code: 'IPM-M4', academic_year: '2026' }, 'assessments_academic_year_format'],
        zeroMax: [{ code: 'IPM-M5', max_marks: '0' }, 'assessments_max_marks_positive'],
      }),
      variants(
        'each eligible batch once',
        'academic.assessment_batches',
        (o) => ({ assessment_id: id.assessment, ...o }),
        {
          again: [{ batch_id: () => id.batch }, 'assessment_batches_pkey'],
          second: [{ batch_id: () => id.batch2 }, 'ok'],
        },
      ),
    ],
  );
});

describe('roster snapshot: present 0 is not absent, missing is not 0', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'attendance',
        'academic.assessment_roster',
        ACADEMIC_ROSTER_ATTENDANCE,
        'assessment_roster_attendance_check',
        (v) => roster({ student_id: id.student2, attendance: v }),
      ),
      vocab(
        'marks state',
        'academic.assessment_roster',
        ACADEMIC_ROSTER_MARKS_STATES,
        'assessment_roster_marks_state_check',
        (v) =>
          roster({
            student_id: id.student2,
            attendance: 'present',
            marks_state: v,
            score: v === 'not_entered' ? null : '1',
            ...(v === 'verified' ? { verified_at: NOW, verified_by_user_id: ctx.ids.user } : {}),
          }),
      ),
      variants(
        'row shape',
        'academic.assessment_roster',
        (o) => roster({ student_id: id.student2, ...o }),
        {
          presentZeroVerified: [{ ...verified(), score: '0' }, 'ok'],
          absentNoScore: [{ attendance: 'absent' }, 'ok'],
          importedUnmarked: [{ marks_state: 'imported', score: '12.5' }, 'ok'],
          absentWithScore: [
            { attendance: 'absent', marks_state: 'imported', score: '0' },
            'assessment_roster_absent_no_score',
          ],
          scoreNotEntered: [{ attendance: 'present', score: '0' }, 'assessment_roster_score_shape'],
          importedNoScore: [{ marks_state: 'imported' }, 'assessment_roster_score_shape'],
          verifiedUnmarked: [
            { ...verified(), attendance: 'unmarked', score: '4' },
            'assessment_roster_verified_present',
          ],
          verifiedNoStamp: [
            { attendance: 'present', marks_state: 'verified', score: '4' },
            'assessment_roster_verified_stamp',
          ],
          rankedVerified: [{ ...verified(), score: '4', rank: 1 }, 'ok'],
          rankedImported: [
            { marks_state: 'imported', score: '4', rank: 1 },
            'assessment_roster_rank_shape',
          ],
          rankedRemoved: [
            { ...verified(), score: '4', rank: 1, removed_at: NOW, removed_reason: 'Left' },
            'assessment_roster_rank_shape',
          ],
          removedNoReason: [{ removed_at: NOW }, 'assessment_roster_removed_pair'],
          correctionAdd: [{ added_reason: 'Joined from B2' }, 'ok'],
          sameStudentTwice: [{ student_id: () => id.student }, 'assessment_roster_student_key'],
        },
      ),
    ],
  );
});

describe('result publication versions', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'ranking scope',
        'academic.result_publications',
        ACADEMIC_RANKING_SCOPES,
        'result_publications_scope_check',
        (v) =>
          publication({
            version: 2,
            status: 'superseded',
            ranking_scope: v,
            cohort_batch_ids: v === 'cohort' ? `{${id.batch}}` : null,
          }),
      ),
      vocab(
        'status',
        'academic.result_publications',
        ACADEMIC_PUBLICATION_STATUSES,
        'result_publications_status_check',
        (v) =>
          publication({
            version: 2,
            status: v,
            ...(v === 'current' ? { assessment_id: id.assessment2 } : {}),
            ...(v === 'withdrawn'
              ? {
                  withdrawn_at: NOW,
                  withdrawn_by_user_id: ctx.ids.user,
                  withdrawn_reason: 'Wrong key',
                }
              : {}),
          }),
      ),
      variants(
        'publication shape',
        'academic.result_publications',
        (o) => publication({ version: 2, status: 'superseded', ...o }),
        {
          secondCurrent: [{ status: 'current' }, 'result_publications_one_current_key'],
          sameVersion: [{ version: 1 }, 'result_publications_version_key'],
          cohortWithoutBatches: [{ ranking_scope: 'cohort' }, 'result_publications_cohort_shape'],
          cohortEmpty: [
            { ranking_scope: 'cohort', cohort_batch_ids: '{}' },
            'result_publications_cohort_shape',
          ],
          rosterWithBatches: [
            { cohort_batch_ids: () => `{${id.batch}}` },
            'result_publications_cohort_shape',
          ],
          withdrawnNoReason: [
            { status: 'withdrawn', withdrawn_at: NOW, withdrawn_by_user_id: () => ctx.ids.user },
            'result_publications_withdrawn_shape',
          ],
          stampWithoutWithdrawn: [
            { withdrawn_at: NOW, withdrawn_by_user_id: () => ctx.ids.user, withdrawn_reason: 'x' },
            'result_publications_withdrawn_shape',
          ],
          otherTie: [{ tie_policy: 'dense' }, 'result_publications_tie_policy_check'],
          zeroVersion: [{ version: 0 }, 'result_publications_version_positive'],
        },
      ),
    ],
  );
});

describe('teacher reviews: observation date and batch (§16)', () => {
  runCases(
    () => ctx.pg,
    [
      one(
        'observation date and batch are stored',
        'academic.teacher_reviews',
        () => ({
          review_key: '7a1c0b52-1f3e-4c55-9d1a-0c2b3a4d5e70',
          author_staff_id: ctx.ids.staff,
          academic_student_id: id.student,
          review_type: 'periodic_progress',
          observation_on: '2026-10-20',
          batch_id: id.batch,
          created_by_user_id: ctx.ids.user,
        }),
        'ok',
      ),
    ],
  );
});
