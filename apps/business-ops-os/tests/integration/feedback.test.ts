import { beforeAll, describe, expect, it } from 'vitest';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { existsSync } from 'node:fs';
import { opsTeacherStudentFeedback, students } from '@elevate/database';
import * as aboutStudentRoutes from '../../src/app/api/v1/feedback/about-students/route';
import {
  GET as listAboutTeacher,
  POST as recordAboutTeacher,
} from '../../src/app/api/v1/feedback/about-teachers/route';
import { PATCH as moderate } from '../../src/app/api/v1/feedback/about-teachers/[id]/route';
import { POST as schedule } from '../../src/app/api/v1/appointments/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let otherTeacher: StaffUser;
let taught: string;

const req = (user: StaffUser | null, path: string, method = 'GET', json?: unknown) =>
  user ? authedRequest(user, path, { method, json }) : buildRequest(path, { method, json });
const listAboutStudent = aboutStudentRoutes.GET;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher']);
  otherTeacher = await staffUser(ctx.db, ['teacher']);
  const rows = await ctx.db
    .insert(students)
    .values([{ fullName: 'Taught Student' }, { fullName: 'Other Student' }])
    .returning();
  [taught = ''] = rows.map((r) => r.id);
  const booked = await callRoute(
    schedule,
    req(manager, '/ops/api/v1/appointments', 'POST', {
      type: 'teacher_academic',
      staffId: teacher.staffId,
      studentId: taught,
      startsAt: '2026-10-19T10:00:00.000Z',
      mode: 'online',
    }),
  );
  expect(booked.status).toBe(201);
});

describe('teacher → student reviews recorded in Ops before 21 Oct 2026 (read-only history)', () => {
  it('no Ops route writes or edits them any more (reviews are written in Academic OS)', () => {
    expect('POST' in aboutStudentRoutes).toBe(false);
    expect(
      existsSync(
        new URL('../../src/app/api/v1/feedback/about-students/[id]/route.ts', import.meta.url),
      ),
    ).toBe(false);
  });

  it('lists current and superseded versions; teachers are refused (not Ops members)', async () => {
    const [v1] = await ctx.db
      .insert(opsTeacherStudentFeedback)
      .values({
        studentId: taught as never,
        teacherStaffId: teacher.staffId as never,
        subject: 'Mathematics',
        observedOn: '2026-10-01' as never,
        observations: 'Solves ratio problems quickly.',
        status: 'final',
        createdBy: teacher.id,
      })
      .returning();
    await ctx.db.insert(opsTeacherStudentFeedback).values({
      studentId: taught as never,
      teacherStaffId: teacher.staffId as never,
      subject: 'Mathematics',
      observedOn: '2026-10-02' as never,
      observations: 'Correction.',
      status: 'final',
      version: 2,
      supersedesId: v1!.id,
      createdBy: teacher.id,
    });
    type Row = { version: number; superseded: boolean };
    const list = (user: StaffUser | null) =>
      callRoute<Row[]>(
        listAboutStudent,
        req(user, `/ops/api/v1/feedback/about-students?studentId=${taught}`),
      );
    expect((await list(null)).status).toBe(401);
    expect((await list(manager)).data?.map((r) => [r.version, r.superseded])).toEqual([
      [2, false],
      [1, true],
    ]);
    // Teachers are not Business Ops members (D-072); their reviews live in Academic OS (D-058).
    const asTeacher = await list(teacher);
    expect(asTeacher.status).toBe(403);
    expect(asTeacher.error?.message).toBe('Your roles do not include this workspace.');
    // A draft is never listed to anyone but its author.
    await ctx.db.insert(opsTeacherStudentFeedback).values({
      studentId: taught as never,
      teacherStaffId: otherTeacher.staffId as never,
      subject: 'Logic',
      observedOn: '2026-10-03' as never,
      observations: 'Draft never submitted.',
      createdBy: otherTeacher.id,
    });
    expect((await list(manager)).data).toHaveLength(2);
  });
});

describe('student/guardian → teacher feedback (opposite direction)', () => {
  const record = (user: StaffUser, teacherStaffId: string) =>
    callRoute<{ id: string; moderationStatus: string }>(
      recordAboutTeacher,
      req(user, '/ops/api/v1/feedback/about-teachers', 'POST', {
        teacherStaffId,
        studentId: taught,
        submittedByKind: 'guardian',
        feedbackOn: '2026-10-20',
        rating: 4,
        comment: 'Explains clearly.',
      }),
    );
  const mod = (user: StaffUser, id: string, json: unknown) =>
    callRoute<{ moderationStatus: string }>(
      moderate,
      req(user, `/ops/api/v1/feedback/about-teachers/${id}`, 'PATCH', json),
      { id },
    );
  const about = (user: StaffUser, id: string) =>
    callRoute<{
      rows: unknown[];
      summary: { approved: number; rated: number; averageRating: number | null };
    }>(listAboutTeacher, req(user, `/ops/api/v1/feedback/about-teachers?teacherStaffId=${id}`));

  it('recorded by staff as pending; the teacher can neither record, edit nor moderate it (403)', async () => {
    expect((await record(teacher, teacher.staffId)).status).toBe(403);
    const row = (await record(counsellor, teacher.staffId)).data!;
    expect(row.moderationStatus).toBe('pending');
    expect((await mod(teacher, row.id, { action: 'approve' })).status).toBe(403);
    expect((await about(teacher, teacher.staffId)).status).toBe(403);
    expect(
      (await mod(manager, row.id, { action: 'approve', visibility: 'teacher_and_staff' })).data
        ?.moderationStatus,
    ).toBe('approved');
    const shared = await about(manager, teacher.staffId);
    expect(shared.data?.summary).toEqual({ approved: 1, rated: 1, averageRating: 4 });
    expect((await mod(manager, row.id, { action: 'reject' })).status).toBe(409);
  });

  it('a moderator cannot moderate feedback about themselves', async () => {
    const row = (await record(counsellor, manager.staffId)).data!;
    expect((await mod(manager, row.id, { action: 'approve' })).status).toBe(403);
  });

  it('never appears among feedback about the student', async () => {
    const listed = await callRoute<{ comment?: string }[]>(
      listAboutStudent,
      req(manager, `/ops/api/v1/feedback/about-students?studentId=${taught}`),
    );
    expect(listed.data?.some((r) => 'comment' in r)).toBe(false);
  });
});
