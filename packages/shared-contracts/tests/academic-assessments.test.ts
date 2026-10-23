import { describe, expect, it } from 'vitest';
import {
  academicTeacherActivityV1Schema,
  createAssessmentInternalBody,
  publishResultsBody,
  recordScoresBody,
  rosterCorrectionBody,
  rosterFactsProblem,
  updateAssessmentInternalBody,
} from '../src/index';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('roster rules: missing is not zero, absent is not zero', () => {
  it.each([
    [
      'present with 0 verified',
      { attendance: 'present', marksState: 'verified', score: '0' },
      true,
    ],
    ['absent, no score', { attendance: 'absent', marksState: 'not_entered', score: null }, true],
    ['imported, attendance not stated', { marksState: 'imported', score: '12.5' }, true],
    ['absent with a score', { attendance: 'absent', marksState: 'imported', score: '0' }, false],
    ['excused with a score', { attendance: 'excused', marksState: 'imported', score: '3' }, false],
    [
      'verified without a score',
      { attendance: 'present', marksState: 'verified', score: null },
      false,
    ],
    [
      'not entered with a score',
      { attendance: 'present', marksState: 'not_entered', score: '0' },
      false,
    ],
    [
      'verified but unmarked',
      { attendance: 'unmarked', marksState: 'verified', score: '4' },
      false,
    ],
  ] as const)('%s', (_name, facts, ok) => {
    expect(rosterFactsProblem(facts) === null).toBe(ok);
  });
});

const row = {
  studentId: uuid(1),
  version: 1,
  marksState: 'verified',
  score: '12.25',
  attendance: 'present',
};
const scores = (o: object) =>
  recordScoresBody.safeParse({ source: 'csv', rows: [row], ...o }).success;

describe('write bodies', () => {
  it.each([
    ['valid rows', {}, true],
    ['float-like mark with 5 decimals', { rows: [{ ...row, score: '1.00001' }] }, false],
    ['numeric score (not text)', { rows: [{ ...row, score: 12 }] }, false],
    ['duplicate student', { rows: [row, row] }, false],
    ['contradictory row', { rows: [{ ...row, attendance: 'absent' }] }, false],
    ['overwrite without reason', { overwriteVerified: true }, false],
    ['overwrite with reason', { overwriteVerified: true, reason: 'Re-checked sheet' }, true],
  ])('recordScoresBody: %s', (_name, o, ok) => {
    expect(scores(o)).toBe(ok);
  });

  it.each([
    ['roster scope', { version: 1, provisional: false }, true],
    [
      'cohort with batches',
      { version: 2, provisional: true, rankingScope: 'cohort', cohortBatchIds: [uuid(3)] },
      true,
    ],
    ['cohort without batches', { version: 1, provisional: false, rankingScope: 'cohort' }, false],
    [
      'batches without cohort',
      { version: 1, provisional: false, cohortBatchIds: [uuid(3)] },
      false,
    ],
  ])('publishResultsBody: %s', (_name, body, ok) => {
    expect(publishResultsBody.safeParse(body).success).toBe(ok);
  });

  it.each([
    [rosterCorrectionBody, { action: 'add', studentId: uuid(1), reason: 'Joined late' }, false],
    [
      rosterCorrectionBody,
      { action: 'add', studentId: uuid(1), batchId: uuid(2), reason: 'Joined late' },
      true,
    ],
    [rosterCorrectionBody, { action: 'remove', studentId: uuid(1), reason: '' }, false],
    [updateAssessmentInternalBody, { status: 'cancelled' }, false],
    [updateAssessmentInternalBody, { status: 'cancelled', reason: 'Centre closed' }, true],
    [
      createAssessmentInternalBody,
      {
        code: 'IPM-M1',
        kind: 'full_mock',
        title: 'Mock 1',
        academicYear: '2026-27',
        batchIds: [uuid(2), uuid(2)],
      },
      false,
    ],
    [
      createAssessmentInternalBody,
      {
        code: 'IPM-M1',
        kind: 'full_mock',
        title: 'Mock 1',
        academicYear: '2026',
        batchIds: [uuid(2)],
      },
      false,
    ],
    [
      createAssessmentInternalBody,
      {
        code: 'IPM-M1',
        kind: 'full_mock',
        title: 'Mock 1',
        academicYear: '2026-27',
        batchIds: [uuid(2), uuid(3)],
      },
      true,
    ],
  ])('body %#', (schema, body, ok) => {
    expect(schema.safeParse(body).success).toBe(ok);
  });
});

it('teacher activity v1 stays valid without the new assessment counts', () => {
  const window = { from: '2026-10-01', to: '2026-10-31' };
  const m = {
    status: 'missing',
    value: null,
    reason: 'No roster',
    definition: 'Sample',
    window,
    unit: 'count',
  };
  const base = {
    contract: 'academic.teacher_activity',
    version: 1,
    generatedAt: '2026-10-23T04:30:00Z',
    staffId: uuid(9),
    window,
    assignments: [],
    sessions: { planned: m, delivered: m, cancelled: m, substituted: m },
    logsPending: m,
    attendancePending: m,
    markingPending: m,
    reviews: { submitted: m, draft: m },
    unavailability: [],
  };
  expect(
    academicTeacherActivityV1Schema.safeParse({ ...base, assessments: { prepared: m, marked: m } })
      .success,
  ).toBe(true);
  expect(
    academicTeacherActivityV1Schema.safeParse({
      ...base,
      assessments: { prepared: m, marked: m, assigned: m, published: m },
    }).success,
  ).toBe(true);
});
