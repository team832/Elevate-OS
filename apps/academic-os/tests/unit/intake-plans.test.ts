import { describe, expect, it } from 'vitest';
import {
  ageOn,
  canEditPlanItems,
  canRequestApproval,
  canTransitionPlan,
  decideIntake,
  isMinor,
  parseResponsesCsv,
  readSetting,
  supersessionProblem,
  type IntakeRefs,
  type IntakeRequest,
} from '../../src/domain';

const today = '2026-10-18';
const programme = { id: 'P', code: 'IPMAT', status: 'active' };
const batch = {
  id: 'B',
  programmeId: 'P',
  courseId: 'C',
  status: 'active',
  startDate: '2026-04-01',
  capacity: 2,
  activeEnrolments: 0,
};
const refs = (over: Partial<IntakeRefs> = {}): IntakeRefs => ({
  programme,
  course: { id: 'C', programmeId: 'P', status: 'active' },
  batch,
  duplicateEnrolment: false,
  ...over,
});
const request = (over: Partial<IntakeRequest> = {}): IntakeRequest => ({
  programmeCode: 'IPMAT',
  intendedCourseId: 'C',
  intendedBatchId: 'B',
  student: { dateOfBirth: '2008-01-01' },
  ...over,
});

describe('decideIntake', () => {
  it('confirms a valid request and flags a late joiner', () => {
    expect(decideIntake(request(), refs(), today)).toEqual({
      decision: 'confirm',
      programmeId: 'P',
      courseId: 'C',
      batchId: 'B',
      startDate: today,
      lateJoiner: true,
    });
  });
  it('confirms without a batch (enrolment waits for allocation)', () => {
    const d = decideIntake(request({ intendedBatchId: undefined, intendedCourseId: undefined }), refs({ batch: null, course: null }), today);
    expect(d).toMatchObject({ decision: 'confirm', batchId: null, courseId: null, lateJoiner: false });
  });
  it.each([
    ['unknown programme', refs({ programme: null }), request(), 'PROGRAMME_NOT_OFFERED'],
    ['paused programme', refs({ programme: { ...programme, status: 'paused' } }), request(), 'PROGRAMME_NOT_OFFERED'],
    ['unknown course', refs({ course: null }), request(), 'COURSE_NOT_FOUND'],
    ['course of another programme', refs({ course: { id: 'C', programmeId: 'X', status: 'active' } }), request(), 'COURSE_NOT_FOUND'],
    ['unknown batch', refs({ batch: null }), request(), 'BATCH_NOT_FOUND'],
    ['batch of another course', refs({ batch: { ...batch, courseId: 'C2' } }), request(), 'BATCH_NOT_FOUND'],
    ['completed batch', refs({ batch: { ...batch, status: 'completed' } }), request(), 'BATCH_NOT_FOUND'],
    ['minor without guardian', refs(), request({ student: { dateOfBirth: '2010-05-05' } }), 'INVALID_REQUEST'],
    ['linked to another person', refs({ identityConflict: true }), request(), 'INVALID_REQUEST'],
    ['duplicate in batch or course', refs({ duplicateEnrolment: true }), request(), 'DUPLICATE_ENROLMENT'],
    ['duplicate course without a batch', refs({ batch: null, duplicateEnrolment: true }), request({ intendedBatchId: undefined }), 'DUPLICATE_ENROLMENT'],
    ['batch full', refs({ batch: { ...batch, activeEnrolments: 2 } }), request(), 'BATCH_FULL'],
  ] as const)('rejects: %s', (_label, r, q, code) => {
    const d = decideIntake(q, r, today);
    expect(d).toMatchObject({ decision: 'reject', reasonCode: code });
  });
  it('a minor with a guardian contact is accepted', () => {
    const d = decideIntake(request({ student: { currentStage: 'class_11' }, guardian: { phone: '+919800000001' } }), refs(), today);
    expect(d.decision).toBe('confirm');
  });
  it('computes age at the boundary (18th birthday)', () => {
    expect(ageOn('2008-10-18', '2026-10-18')).toBe(18);
    expect(ageOn('2008-10-19', '2026-10-18')).toBe(17);
    expect(isMinor({ currentStage: 'graduate' }, today)).toBe(false);
  });
});

describe('plan status rules', () => {
  it('allows only forward transitions; locked plans can only be superseded', () => {
    expect(canTransitionPlan('proposed', 'locked')).toBe(true);
    expect(canTransitionPlan('provisional', 'locked')).toBe(true);
    expect(canTransitionPlan('locked', 'provisional')).toBe(false);
    expect(canTransitionPlan('locked', 'superseded')).toBe(true);
    expect(canTransitionPlan('superseded', 'locked')).toBe(false);
    expect(canRequestApproval('locked', 'locked')).toBe(false);
    expect(canEditPlanItems('proposed')).toBe(true);
    expect(canEditPlanItems('locked')).toBe(false);
  });
  it('supersession needs the same course and batch scope and a current predecessor', () => {
    const base = { id: 'p1', courseId: 'C', batchId: null, status: 'locked' as const };
    expect(supersessionProblem({ ...base, id: 'p2', status: 'proposed' }, base)).toBeNull();
    expect(supersessionProblem({ ...base, id: 'p2', courseId: 'X' }, base)).toMatch(/same course/);
    expect(supersessionProblem({ ...base, id: 'p2', batchId: 'B' }, base)).toMatch(/batch scope/);
    expect(supersessionProblem({ ...base, id: 'p2' }, { ...base, status: 'superseded' })).toMatch(/Only a locked/);
    expect(supersessionProblem(base, base)).toMatch(/itself/);
  });
});

describe('parseResponsesCsv', () => {
  it('groups rows by student, supports ABSENT and empty (unattempted) answers', () => {
    const r = parseResponsesCsv('student_code,key_version,section_code,answers\nS1,1,QA,A|B||D\nS1,1,VA,C|\nS2,,ABSENT,\n');
    expect(r.problems).toEqual([]);
    expect(r.attempts).toEqual([
      { studentCode: 'S1', status: 'submitted', keyVersion: 1, responses: { QA: ['A', 'B', null, 'D'], VA: ['C', null] } },
      { studentCode: 'S2', status: 'absent', keyVersion: null, responses: null },
    ]);
  });
  it('reports duplicates, conflicting versions and malformed lines with line numbers', () => {
    const r = parseResponsesCsv('S1,1,QA,A\nS1,1,QA,B\nS1,2,VA,C\nS2,x,QA,A\nbad line\nS3,,ABSENT,\nS3,1,QA,A');
    expect(r.problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 7]);
  });
});

describe('settings', () => {
  it('falls back to the proposed default for missing or invalid values', () => {
    expect(readSetting('assessments.min_gap_days', undefined)).toEqual({ minDays: 0, enforcement: 'warning' });
    expect(readSetting('assessments.min_gap_days', { minDays: -1, enforcement: 'hard' })).toEqual({ minDays: 0, enforcement: 'warning' });
    expect(readSetting('assessments.min_gap_days', { minDays: 3, enforcement: 'hard' })).toEqual({ minDays: 3, enforcement: 'hard' });
    expect(readSetting('timetable.teacher_workload_cap', null).maxMinutesPerDay).toBeNull();
  });
});
