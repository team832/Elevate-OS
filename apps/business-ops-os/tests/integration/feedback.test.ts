import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { students } from '@elevate/database';
import {
  GET as listAboutStudent,
  POST as writeAboutStudent,
} from '../../src/app/api/v1/feedback/about-students/route';
import { PATCH as editAboutStudent } from '../../src/app/api/v1/feedback/about-students/[id]/route';
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
let notTaught: string;

const req = (user: StaffUser | null, path: string, method = 'GET', json?: unknown) =>
  user ? authedRequest(user, path, { method, json }) : buildRequest(path, { method, json });
type Row = { id: string; version: number; status: string; supersedesId: string | null };
const write = (user: StaffUser | null, over: Record<string, unknown> = {}) =>
  callRoute<Row>(
    writeAboutStudent,
    req(user, '/ops/api/v1/feedback/about-students', 'POST', {
      studentId: taught,
      subject: 'Mathematics',
      observedOn: '2026-10-20',
      observations: 'Solves ratio problems quickly.',
      ...over,
    }),
  );
const edit = (user: StaffUser, id: string, over: Record<string, unknown> = {}) =>
  callRoute<Row>(
    editAboutStudent,
    req(user, `/ops/api/v1/feedback/about-students/${id}`, 'PATCH', {
      subject: 'Mathematics',
      observedOn: '2026-10-20',
      observations: 'Updated observation.',
      ...over,
    }),
    { id },
  );

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
  [taught = '', notTaught = ''] = rows.map((r) => r.id);
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

describe('teacher → student feedback', () => {
  it('401 / 403 / 400', async () => {
    expect((await write(null)).status).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect(
      (
        await callRoute(
          writeAboutStudent,
          authedRequest(auditor, '/ops/api/v1/feedback/about-students', {
            method: 'POST',
            json: {},
          }),
        )
      ).status,
    ).toBe(403);
    expect((await write(teacher, { observations: '' })).status).toBe(400);
    expect((await write(teacher, { studentId: notTaught })).status).toBe(403);
    expect((await write(teacher, { teacherStaffId: otherTeacher.staffId })).status).toBe(403);
  });

  it('a draft is edited in place; a final edit creates version 2; old versions and other teachers are refused', async () => {
    const draft = (await write(teacher)).data!;
    expect(draft).toMatchObject({ version: 1, status: 'draft' });
    const sameRow = await edit(teacher, draft.id, { status: 'final' });
    expect(sameRow.data).toMatchObject({ id: draft.id, version: 1, status: 'final' });
    const v2 = await edit(teacher, draft.id, {
      observations: 'Correction.',
      status: 'final',
    });
    expect(v2.data).toMatchObject({ version: 2, supersedesId: draft.id });
    expect(v2.data!.id).not.toBe(draft.id);
    expect((await edit(teacher, draft.id)).status).toBe(409);
    expect((await edit(otherTeacher, v2.data!.id)).status).toBe(403);
    const listed = await callRoute<(Row & { superseded: boolean })[]>(
      listAboutStudent,
      req(manager, `/ops/api/v1/feedback/about-students?studentId=${taught}`),
    );
    expect(listed.data?.map((r) => [r.version, r.superseded])).toEqual([
      [2, false],
      [1, true],
    ]);
    const ownView = await callRoute<Row[]>(
      listAboutStudent,
      req(otherTeacher, `/ops/api/v1/feedback/about-students?studentId=${taught}`),
    );
    expect(ownView.data).toEqual([]);
  });

  it('a feedback manager may write for any teacher and student', async () => {
    const res = await write(manager, {
      teacherStaffId: otherTeacher.staffId,
      studentId: notTaught,
    });
    expect(res.status).toBe(201);
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
    expect((await about(teacher, teacher.staffId)).data?.rows).toEqual([]);
    expect(
      (await mod(manager, row.id, { action: 'approve', visibility: 'teacher_and_staff' })).data
        ?.moderationStatus,
    ).toBe('approved');
    const shared = await about(teacher, teacher.staffId);
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
