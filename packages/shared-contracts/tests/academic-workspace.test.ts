import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  academicDemoAttendanceV1Schema,
  academicStudentReviewsV1Schema,
  academicStudentSummaryV1Schema,
  academicTeacherActivityV1Schema,
  enrolmentRequestedV1Payload,
  opsDemoSessionsForDayV1Schema,
} from '../src/index';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-21T04:30:00Z';
const window = { from: '2026-10-01', to: '2026-10-31' };
const ok = (value: number) => ({
  status: 'ok',
  value,
  definition: 'Sample',
  window,
  unit: 'count',
});

const review = {
  reviewKey: uuid(1),
  coreStudentId: uuid(4),
  academicStudentId: null,
  studentName: 'Sample Student',
  opsDemoSessionId: null,
  version: 2,
  status: 'submitted',
  superseded: false,
  authorStaffId: uuid(2),
  authorName: 'Sample Teacher',
  subjectName: 'Logical Reasoning',
  reviewType: 'periodic_progress',
  sessionDate: null,
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  strengths: 'Sample strengths',
  areasForSupport: null,
  attendanceEvidence: null,
  homeworkEvidence: null,
  academicConcerns: null,
  suggestedAction: null,
  followUpOn: null,
  visibility: 'internal',
  submittedAt: AT,
  withdrawnAt: null,
  sourcePath: `/academic/students/${uuid(3)}/reviews/${uuid(1)}`,
};
const reviews = {
  contract: 'academic.student_reviews',
  version: 1,
  generatedAt: AT,
  student: { coreStudentId: uuid(4), academicStudentId: null },
  reviews: [review],
};
const activity = {
  contract: 'academic.teacher_activity',
  version: 1,
  generatedAt: AT,
  staffId: uuid(2),
  window,
  assignments: [
    { batchCode: 'B1', subjectName: 'LR', role: 'primary', startDate: '2026-06-01', endDate: null },
  ],
  sessions: { planned: ok(10), delivered: ok(8), cancelled: ok(1), substituted: ok(1) },
  logsPending: ok(2),
  attendancePending: ok(0),
  markingPending: {
    status: 'missing',
    value: null,
    definition: 'x',
    window,
    unit: 'count',
    reason: 'No assessments',
  },
  reviews: { submitted: ok(3), draft: ok(1) },
  unavailability: [{ from: '2026-10-05', to: '2026-10-06' }],
};
const demo = {
  items: [
    {
      opsDemoSessionId: uuid(5),
      academicSessionId: uuid(6),
      status: 'present',
      recordedAt: AT,
      teacherStaffIds: [uuid(2)],
      teacherNames: ['Sample Teacher'],
    },
  ],
};
const opsDay = {
  items: [
    {
      demoSessionId: uuid(5),
      coreStudentId: uuid(4),
      displayName: 'Sample Student',
      dayNumber: 1,
      subject: null,
      startsAt: AT,
      isSample: true,
    },
  ],
};
const request = {
  admissionId: uuid(7),
  leadId: uuid(8),
  attempt: 1,
  programmeCode: 'CLAT',
  student: { fullName: 'Sample Student', email: 'sample@example.test' },
  counsellorStaffId: uuid(2),
  requestedByUserId: uuid(9),
};

const withReview = (o: object) => ({ ...reviews, reviews: [{ ...review, ...o }] });
const studentSummary = {
  contract: 'academic.student_summary',
  version: 1,
  generatedAt: AT,
  studentId: uuid(3),
  window,
  enrolments: [],
  attendance: { held: 4, present: 3, partial: 0, late: 0, absent: 1, excused: 0 },
  results: [],
};
const withAttendance = (o: object) => ({
  ...studentSummary,
  attendance: { ...studentSummary.attendance, ...o },
});

describe('teacher workspace contracts', () => {
  it.each<[string, z.ZodType, unknown, boolean]>([
    ['reviews: valid', academicStudentReviewsV1Schema, reviews, true],
    [
      'reviews: drafts are never shared',
      academicStudentReviewsV1Schema,
      withReview({ status: 'draft' }),
      false,
    ],
    [
      'reviews: withdrawn needs withdrawnAt',
      academicStudentReviewsV1Schema,
      withReview({ status: 'withdrawn' }),
      false,
    ],
    [
      'reviews: withdrawn with time',
      academicStudentReviewsV1Schema,
      withReview({ status: 'withdrawn', withdrawnAt: AT }),
      true,
    ],
    ['reviews: no rating field', academicStudentReviewsV1Schema, withReview({ rating: 5 }), false],
    [
      'reviews: needs a student ref',
      academicStudentReviewsV1Schema,
      { ...reviews, student: { coreStudentId: null, academicStudentId: null } },
      false,
    ],
    [
      'student summary: without the rate (older producer)',
      academicStudentSummaryV1Schema,
      studentSummary,
      true,
    ],
    [
      'student summary: with rate and definition',
      academicStudentSummaryV1Schema,
      withAttendance({ ratePercent: 75, definition: 'Present + partial over held' }),
      true,
    ],
    [
      'student summary: rate null when nothing held',
      academicStudentSummaryV1Schema,
      withAttendance({ held: 0, present: 0, absent: 0, ratePercent: null, definition: 'x' }),
      true,
    ],
    [
      'student summary: rate is a percentage',
      academicStudentSummaryV1Schema,
      withAttendance({ ratePercent: 101, definition: 'x' }),
      false,
    ],
    ['activity: valid', academicTeacherActivityV1Schema, activity, true],
    [
      'activity: missing is null, not 0',
      academicTeacherActivityV1Schema,
      { ...activity, logsPending: { ...ok(0), status: 'missing', value: 0 } },
      false,
    ],
    [
      'activity: unknown role',
      academicTeacherActivityV1Schema,
      { ...activity, assignments: [{ ...activity.assignments[0], role: 'lead' }] },
      false,
    ],
    ['demo attendance: valid', academicDemoAttendanceV1Schema, demo, true],
    [
      'demo attendance: bad status',
      academicDemoAttendanceV1Schema,
      { items: [{ ...demo.items[0], status: 'attended' }] },
      false,
    ],
    ['ops demo day: valid', opsDemoSessionsForDayV1Schema, opsDay, true],
    [
      'ops demo day: day 11',
      opsDemoSessionsForDayV1Schema,
      { items: [{ ...opsDay.items[0], dayNumber: 11 }] },
      false,
    ],
    ['enrolment request: without the new fields', enrolmentRequestedV1Payload, request, true],
    [
      'enrolment request: coreStudentId + academicYear',
      enrolmentRequestedV1Payload,
      { ...request, coreStudentId: uuid(4), academicYear: '2026-27' },
      true,
    ],
    [
      'enrolment request: coreStudentId must be a uuid',
      enrolmentRequestedV1Payload,
      { ...request, coreStudentId: 'S-1' },
      false,
    ],
  ])('%s', (_name, schema, value, valid) => {
    expect(schema.safeParse(value).success).toBe(valid);
  });
});
