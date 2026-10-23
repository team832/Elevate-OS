import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  opsAttachments,
  opsAttendanceCorrections,
  departments,
  opsEodReports,
  opsEodReportVersions,
  opsStaffTasks,
  opsTaskCollaborators,
  staffMembers,
  opsStudentTeacherFeedback,
  opsTaskSubmissions,
  opsTaskUpdates,
  opsTeacherFeedbackImports,
  OPS_ATTACHMENT_MAX_BYTES,
} from '@elevate/database';
import { istToday } from '../../src/domain/dates';
import { ATTACHMENT_MAX_BYTES } from '../../src/domain/attachments';
import { POST as uploadRoute } from '../../src/app/api/v1/attachments/route';
import {
  DELETE as deleteRoute,
  GET as downloadRoute,
} from '../../src/app/api/v1/attachments/[id]/route';
import { ATTACHMENT_ACCESS, listAttachments, uploadAttachment } from '../../src/server/attachments';
import { taskAction } from '../../src/server/task-actions';
import { submissionHistory } from '../../src/server/task-submissions';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const dir = mkdtempSync(path.join(os.tmpdir(), 'elevate-attachments-'));
const today = istToday(new Date());
type Actor = 'owner' | 'colleague' | 'manager' | 'hr' | 'teacher';
type Kind = keyof typeof ATTACHMENT_ACCESS;
let people: Record<Actor, StaffUser>;
const owners = {} as Record<Kind, string>;

/** Each actor calls through a workspace it belongs to (D-072). */
const BASE: Record<Actor, string> = {
  owner: '/academic',
  colleague: '/marketing',
  manager: '/ops',
  hr: '/ops',
  teacher: '/academic',
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const b64 = (b: Buffer) => b.toString('base64');

beforeAll(async () => {
  vi.stubEnv('ATTACHMENTS_DIR', dir);
  await setupReference(ctx.db);
  const manager = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
  people = {
    manager,
    owner: await staffUser(ctx.db, ['teacher'], {
      managerId: manager.staffId,
      name: 'Sample Teacher One',
    }),
    colleague: await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' }),
    hr: await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR manager' }),
    teacher: await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Two' }),
  };
  const { owner, hr } = people;
  const [task] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: owner.staffId,
      title: 'Sample practice sheet on integration',
      dueOn: today,
      originalDueOn: today,
      createdBy: hr.id,
      isSample: true,
    })
    .returning();
  const [submission] = await ctx.db
    .insert(opsTaskSubmissions)
    .values({ taskId: task!.id, version: 1, completionNote: 'Done', submittedByUserId: owner.id })
    .returning();
  const [update] = await ctx.db
    .insert(opsTaskUpdates)
    .values({
      taskId: task!.id,
      authorUserId: owner.id,
      authorStaffId: owner.staffId,
      occurredOn: today,
      workPerformed: 'Drafted questions',
    })
    .returning();
  const [correction] = await ctx.db
    .insert(opsAttendanceCorrections)
    .values({
      staffId: owner.staffId,
      workDate: today,
      requestedStatus: 'present',
      reason: 'Forgot to punch out',
      requestedByUserId: owner.id,
      isSample: true,
    })
    .returning();
  const [feedbackImport] = await ctx.db
    .insert(opsTeacherFeedbackImports)
    .values({ sha256: 'a'.repeat(64), originalName: 'sample.csv', mapping: {}, createdBy: hr.id })
    .returning();
  const [feedback] = await ctx.db
    .insert(opsStudentTeacherFeedback)
    .values({
      teacherStaffId: owner.staffId,
      submittedByKind: 'student',
      feedbackOn: today,
      comment: 'Sample comment',
      recordedBy: hr.id,
      isSample: true,
    })
    .returning();
  const [report] = await ctx.db
    .insert(opsEodReports)
    .values({
      staffId: owner.staffId,
      periodStart: today,
      periodEnd: today,
      reportDate: today,
      status: 'submitted',
      submittedAt: new Date(),
      submittedToStaffId: manager.staffId,
      snapshot: {},
      createdBy: owner.id,
      isSample: true,
    })
    .returning();
  await ctx.db.insert(opsEodReportVersions).values({
    reportId: report!.id,
    version: 1,
    snapshot: {},
    narrative: {} as never,
    sourceCutoffAt: new Date(),
    submittedByUserId: owner.id,
    submittedToStaffId: manager.staffId,
  });
  Object.assign(owners, {
    task: task!.id,
    task_submission: submission!.id,
    task_update: update!.id,
    attendance_correction: correction!.id,
    feedback_import: feedbackImport!.id,
    feedback_evidence: feedback!.id,
    work_report: report!.id,
    staff_private: owner.staffId,
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (who: Actor, json: Record<string, unknown>) =>
  callRoute<{ id: string; duplicate: boolean }>(
    uploadRoute,
    authedRequest(people[who], `${BASE[who]}/api/v1/attachments`, {
      method: 'POST',
      json: {
        ownerKind: 'task',
        ownerId: owners.task,
        purpose: 'reference',
        name: 'answer-key.pdf',
        mime: 'application/pdf',
        dataBase64: b64(PDF),
        ...json,
      },
    }),
  );
const download = (who: Actor, id: string) =>
  downloadRoute(authedRequest(people[who], `${BASE[who]}/api/v1/attachments/${id}`), {
    params: Promise.resolve({ id }),
  });
const remove = (who: Actor, id: string) =>
  callRoute(
    deleteRoute,
    authedRequest(people[who], `${BASE[who]}/api/v1/attachments/${id}`, { method: 'DELETE' }),
    { id },
  );

// read / write per owner kind for: owner, unrelated colleague, owner's manager, HR, another teacher.
const R = true;
const MATRIX: [Kind, Record<Actor, [read: boolean, write: boolean]>][] = [
  [
    'task',
    {
      owner: [R, R],
      colleague: [!R, !R],
      manager: [R, R],
      hr: [R, R],
      teacher: [!R, !R],
    },
  ],
  // N1: a submitted version is frozen (files reach it only by submitting); a work update's files
  // are added only by the person who wrote it.
  [
    'task_submission',
    { owner: [R, !R], colleague: [!R, !R], manager: [R, !R], hr: [R, !R], teacher: [!R, !R] },
  ],
  [
    'task_update',
    { owner: [R, R], colleague: [!R, !R], manager: [R, !R], hr: [R, !R], teacher: [!R, !R] },
  ],
  [
    'attendance_correction',
    { owner: [R, R], colleague: [!R, !R], manager: [!R, !R], hr: [R, R], teacher: [!R, !R] },
  ],
  // Raw feedback files: HR only, never the teacher the feedback is about.
  [
    'feedback_import',
    { owner: [!R, !R], colleague: [!R, !R], manager: [!R, !R], hr: [R, R], teacher: [!R, !R] },
  ],
  [
    'feedback_evidence',
    { owner: [!R, !R], colleague: [!R, !R], manager: [!R, !R], hr: [R, R], teacher: [!R, !R] },
  ],
  [
    'work_report',
    { owner: [R, R], colleague: [!R, !R], manager: [R, !R], hr: [R, !R], teacher: [!R, !R] },
  ],
  [
    'staff_private',
    { owner: [!R, !R], colleague: [!R, !R], manager: [!R, !R], hr: [R, R], teacher: [!R, !R] },
  ],
];
const CASES = MATRIX.flatMap(([kind, row]) =>
  (Object.entries(row) as [Actor, [boolean, boolean]][]).map(
    ([who, [read, write]]) => [kind, who, read, write] as const,
  ),
);

describe('attachments: access follows the parent record', () => {
  it('every owner kind has a rule', () => {
    expect(Object.keys(ATTACHMENT_ACCESS).sort()).toEqual(MATRIX.map(([k]) => k).sort());
    expect(ATTACHMENT_MAX_BYTES).toBe(OPS_ATTACHMENT_MAX_BYTES);
  });

  it.each(CASES)('%s × %s: read %s, write %s', async (kind, who, read, write) => {
    const rule = ATTACHMENT_ACCESS[kind];
    expect(await rule.canRead(ctx.db, people[who], owners[kind])).toBe(read);
    expect(await rule.canWrite(ctx.db, people[who], owners[kind])).toBe(write);
  });

  it('an unknown owner id is neither readable nor writable', async () => {
    const id = crypto.randomUUID();
    for (const rule of Object.values(ATTACHMENT_ACCESS)) {
      expect(await rule.canRead(ctx.db, people.hr, id)).toBe(false);
      expect(await rule.canWrite(ctx.db, people.hr, id)).toBe(false);
    }
  });
});

describe('attachments: upload, download, delete', () => {
  it('scenario 14: a direct API download of another teacher’s task file is 404, same as a missing id', async () => {
    const up = await upload('hr', {});
    expect(up.status).toBe(201);
    const id = up.data!.id;
    const own = await download('owner', id);
    expect(own.status).toBe(200);
    expect(Buffer.from(await own.arrayBuffer()).equals(PDF)).toBe(true);
    const other = await download('teacher', id);
    const missing = await download('teacher', crypto.randomUUID());
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: (await missing.json()).error.message },
    });
  });

  it('download headers: stored type, safe UTF-8 file name, nosniff, no caching', async () => {
    const up = await upload('owner', {
      name: 'Integration “answer” key.pdf',
      dataBase64: b64(Buffer.concat([PDF, Buffer.from('2')])),
    });
    const res = await download('owner', up.data!.id);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Integration _answer_ key.pdf"; filename*=UTF-8''Integration%20%E2%80%9Canswer%E2%80%9D%20key.pdf`,
    );
  });

  it('refuses a renamed program, an oversize file and a type that does not match the name', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
    for (const json of [
      { name: 'worksheet.pdf', dataBase64: b64(exe) },
      { name: 'notes.txt', mime: 'text/plain', dataBase64: b64(exe) },
      { name: 'setup.exe', mime: 'application/octet-stream', dataBase64: b64(exe) },
      { name: 'sheet.png', mime: 'application/pdf' },
      {
        name: 'big.pdf',
        dataBase64: b64(Buffer.concat([PDF, Buffer.alloc(OPS_ATTACHMENT_MAX_BYTES)])),
      },
    ]) {
      const res = await upload('owner', json);
      expect(res.status, json.name).toBe(400);
    }
  });

  it('the same file twice on one record returns the existing id; nothing extra is stored', async () => {
    const file = b64(Buffer.concat([PDF, Buffer.from('dup')]));
    const first = await upload('owner', { dataBase64: file });
    const files = readdirSync(dir).length;
    const again = await upload('owner', { dataBase64: file, name: 'copy.pdf' });
    expect(again.status).toBe(200);
    expect(again.data).toEqual({ id: first.data!.id, duplicate: true });
    expect(readdirSync(dir).length).toBe(files);
  });

  it('a path-traversal name is only a display name; the stored key is random', async () => {
    const up = await upload('owner', {
      name: '..\\..\\etc/passwd.txt',
      mime: 'text/plain',
      dataBase64: b64(Buffer.from('plain text')),
    });
    expect(up.status).toBe(201);
    const [row] = await ctx.db
      .select()
      .from(opsAttachments)
      .where(eq(opsAttachments.id, up.data!.id as never));
    expect(row!.originalName).toBe('passwd.txt');
    expect(row!.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(readdirSync(dir)).toContain(row!.storageKey);
  });

  it('upload is audited; others cannot upload to a record they cannot change', async () => {
    const up = await upload('owner', { dataBase64: b64(Buffer.concat([PDF, Buffer.from('a')])) });
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, up.data!.id), eq(auditEvents.action, 'attachment.uploaded')),
      );
    expect(audit).toBeDefined();
    expect((await upload('teacher', {})).status).toBe(404);
    expect(
      (await upload('owner', { ownerKind: 'staff_private', ownerId: people.owner.staffId })).status,
    ).toBe(404);
  });

  it('feedback and staff-private downloads are audited', async () => {
    const up = await upload('hr', {
      ownerKind: 'feedback_evidence',
      ownerId: owners.feedback_evidence,
      purpose: 'evidence',
    });
    expect((await download('hr', up.data!.id)).status).toBe(200);
    expect((await download('owner', up.data!.id)).status).toBe(404);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, up.data!.id), eq(auditEvents.action, 'attachment.downloaded')),
      );
    expect(audits).toHaveLength(1);
  });

  it('delete: the uploader or a manager of the record; a soft-deleted file is 404; submission files stay', async () => {
    const up = await upload('owner', { dataBase64: b64(Buffer.concat([PDF, Buffer.from('d')])) });
    const id = up.data!.id;
    expect((await remove('teacher', id)).status).toBe(404);
    const byHr = await upload('hr', { dataBase64: b64(Buffer.concat([PDF, Buffer.from('h')])) });
    expect((await remove('owner', byHr.data!.id)).status).toBe(403);
    expect((await remove('manager', byHr.data!.id)).status).toBe(200);
    expect((await remove('owner', id)).status).toBe(200);
    expect((await download('owner', id)).status).toBe(404);
    const rows = await listAttachments(ctx.db, people.owner, 'task', owners.task);
    expect(rows.some((r) => r.id === id)).toBe(false);
    expect(rows.every((r) => r.canDelete === (r.uploadedByUserId === people.owner.id))).toBe(true);

    const sub = await upload('owner', {
      ownerKind: 'task_submission',
      ownerId: owners.task_submission,
      purpose: 'deliverable',
    });
    expect(sub.status).toBe(403);
  });

  it('when storage is not configured, upload is refused honestly and nothing is recorded', async () => {
    const before = await ctx.db.select().from(opsAttachments);
    // The service directly: a production NODE_ENV would also change the session cookie name.
    vi.stubEnv('NODE_ENV', 'production');
    const refused = uploadAttachment(ctx.db, people.owner, {
      ownerKind: 'task',
      ownerId: owners.task,
      purpose: 'reference',
      name: 'late.pdf',
      mime: 'application/pdf',
      dataBase64: b64(Buffer.concat([PDF, Buffer.from('n')])),
    });
    await expect(refused).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/^File storage is not set up yet/),
    });
    vi.stubEnv('NODE_ENV', 'test');
    expect(await ctx.db.select().from(opsAttachments)).toHaveLength(before.length);
  });
});

describe('attachments: the owning module decides (review round 1)', () => {
  const pdf = (tag: string) => b64(Buffer.concat([PDF, Buffer.from(tag)]));
  const newTask = async (values: Partial<typeof opsStaffTasks.$inferInsert>, staffId: string) =>
    (
      await ctx.db
        .insert(opsStaffTasks)
        .values({
          staffId: staffId as never,
          title: 'Sample task',
          dueOn: today,
          originalDueOn: today,
          createdBy: people.manager.id,
          isSample: true,
          ...values,
        })
        .returning()
    )[0]!.id as string;
  const post = (user: StaffUser, base: string, json: Record<string, unknown>) =>
    callRoute(
      uploadRoute,
      authedRequest(user, `${base}/api/v1/attachments`, {
        method: 'POST',
        json: { purpose: 'reference', name: 'a.pdf', mime: 'application/pdf', ...json },
      }),
    );

  it('a department colleague who can only see a task cannot attach to it (the rule for logging work)', async () => {
    const [dept] = await ctx.db.select().from(departments).limit(1);
    const owner = await staffUser(ctx.db, ['teacher'], { name: 'Sample Dept Owner' });
    const peer = await staffUser(ctx.db, ['teacher'], { name: 'Sample Dept Peer' });
    for (const s of [owner, peer])
      await ctx.db
        .update(staffMembers)
        .set({ departmentId: dept!.id })
        .where(eq(staffMembers.id, s.staffId));
    const id = await newTask({ visibility: 'department', departmentId: dept!.id }, owner.staffId);
    expect(await ATTACHMENT_ACCESS.task.canRead(ctx.db, peer, id)).toBe(true);
    const res = await post(peer, '/academic', {
      ownerKind: 'task',
      ownerId: id,
      dataBase64: pdf('p'),
    });
    expect(res.status).toBe(403);
  });

  it('a collaborator who can open a task can read its files', async () => {
    const collab = await staffUser(ctx.db, ['teacher'], { name: 'Sample Collaborator' });
    const id = await newTask({ visibility: 'collaborators' }, people.owner.staffId);
    await ctx.db
      .insert(opsTaskCollaborators)
      .values({ taskId: id as never, staffId: collab.staffId, addedBy: people.manager.id });
    expect(await ATTACHMENT_ACCESS.task.canRead(ctx.db, collab, id)).toBe(true);
    // Adding files follows mayLogWork: a collaborator only reads; the backup may add.
    expect(await ATTACHMENT_ACCESS.task.canWrite(ctx.db, collab, id)).toBe(false);
    const backup = await staffUser(ctx.db, ['teacher'], { name: 'Sample Backup' });
    const backed = await newTask({ backupStaffId: backup.staffId }, people.owner.staffId);
    expect(await ATTACHMENT_ACCESS.task.canWrite(ctx.db, backup, backed)).toBe(true);
  });

  it("a draft report's files are hidden from its recipient, as the report itself is", async () => {
    const author = await staffUser(ctx.db, ['teacher'], {
      name: 'Sample Report Author',
      managerId: people.manager.staffId,
    });
    const [draft] = await ctx.db
      .insert(opsEodReports)
      .values({
        staffId: author.staffId,
        periodStart: today,
        periodEnd: today,
        reportDate: today,
        submittedToStaffId: people.manager.staffId,
        snapshot: {},
        createdBy: author.id,
        isSample: true,
      })
      .returning();
    expect(await ATTACHMENT_ACCESS.work_report.canRead(ctx.db, people.manager, draft!.id)).toBe(
      false,
    );
    expect(await ATTACHMENT_ACCESS.work_report.canRead(ctx.db, author, draft!.id)).toBe(true);
  });

  it('finished records take no new files: cancelled or approved task, decided correction, submitted report', async () => {
    const { owner, hr } = people;
    const cancelled = await newTask({ status: 'cancelled', reason: 'Sample' }, owner.staffId);
    const approved = await newTask(
      { status: 'done', completedAt: new Date(), progressPercent: 100 },
      owner.staffId,
    );
    const [decided] = await ctx.db
      .insert(opsAttendanceCorrections)
      .values({
        staffId: owner.staffId,
        workDate: '2026-01-05',
        requestedStatus: 'present',
        reason: 'Sample reason',
        requestedByUserId: owner.id,
        status: 'rejected',
        decidedBy: hr.id,
        decidedAt: new Date(),
        decisionNote: 'Sample note',
        isSample: true,
      })
      .returning();
    for (const [ownerKind, ownerId] of [
      ['task', cancelled],
      ['task', approved],
      ['attendance_correction', decided!.id],
      ['work_report', owners.work_report],
    ] as const) {
      const res = await post(owner, '/academic', { ownerKind, ownerId, dataBase64: pdf(ownerId) });
      expect(res.status, ownerKind).toBe(409);
    }
  });

  it('an upload body over 12 MB is refused with 413 before it is parsed', async () => {
    const res = await post(people.owner, '/academic', {
      ownerKind: 'task',
      ownerId: owners.task,
      dataBase64: 'A'.repeat(13 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('X3: deliverables go with the submitted version; no task file is removed once the task is closed', async () => {
    const { owner, manager } = people;
    const id = await newTask(
      {
        status: 'in_progress',
        reviewRequired: true,
        reviewerStaffId: manager.staffId,
        expectedDeliverable: 'Practice sheet (PDF)',
        acknowledgedAt: new Date(),
        acknowledgedByUserId: people.owner.id,
      },
      owner.staffId,
    );
    const add = async (who: StaffUser, base: string, purpose: string, tag: string) =>
      (
        (await post(who, base, { ownerKind: 'task', ownerId: id, purpose, dataBase64: pdf(tag) }))
          .data as { id: string }
      ).id;
    const reference = await add(manager, '/ops', 'reference', 'x3-ref');
    const deliverable = await add(owner, '/academic', 'deliverable', 'x3-del');
    await taskAction(ctx.db, owner, id, 'submit', { expectedVersion: 1, completionNote: 'Done' });
    const v1 = await submissionHistory(ctx.db, id);
    expect(v1.submissions[0]!.files.map((f) => f.id)).toEqual([deliverable]);
    expect(v1.pendingFiles).toEqual([]);
    await taskAction(ctx.db, manager, id, 'approve', { expectedVersion: 2 });
    for (const [who, base, fileId] of [
      [owner, '/academic', deliverable],
      [manager, '/ops', reference],
    ] as const)
      expect(
        (
          await callRoute(
            deleteRoute,
            authedRequest(who, `${base}/api/v1/attachments/${fileId}`, { method: 'DELETE' }),
            { id: fileId },
          )
        ).status,
      ).toBe(409);
    expect((await submissionHistory(ctx.db, id)).submissions[0]!.files).toHaveLength(1);
    expect((await listAttachments(ctx.db, manager, 'task', id)).every((f) => !f.canDelete)).toBe(
      true,
    );
  });

  it("a reviewer or a creator cannot remove someone else's file by that role alone", async () => {
    const reviewer = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Reviewer' });
    const creator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Creator' });
    const id = await newTask(
      { reviewerStaffId: reviewer.staffId, createdBy: creator.id },
      people.owner.staffId,
    );
    const up = await post(people.owner, '/academic', {
      ownerKind: 'task',
      ownerId: id,
      dataBase64: pdf('r'),
    });
    const fileId = (up.data as { id: string }).id;
    for (const who of [reviewer, creator])
      expect(
        (
          await callRoute(
            deleteRoute,
            authedRequest(who, `/ops/api/v1/attachments/${fileId}`, { method: 'DELETE' }),
            { id: fileId },
          )
        ).status,
      ).toBe(403);
  });
});
