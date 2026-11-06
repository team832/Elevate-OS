/**
 * db:clear-samples removes the files on sample records with their bytes kept in the database
 * (D-135): a flagged file, and an unflagged one on a sample parent of each kind the seeds make.
 * A real file on a real record stays, bytes and all.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  opsAttachmentFiles,
  opsAttachments,
  opsLeaveApplications,
  opsStaffProfiles,
  opsStudentTeacherFeedback,
  opsTeacherFeedbackImports,
  staffMembers,
  type Database,
} from '@elevate/database';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { clearSamples } from '../../seed';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const DAY = '2026-11-02';
const files: Record<string, { id: string; key: string }> = {};

beforeAll(async () => {
  const login = await createTestUser(db(), {
    email: 'real.hr@elevateeducation.in',
    displayName: 'Real Colleague',
    roles: ['hr_manager'],
  });
  const by = login.id as never;
  const [sampleStaff, realStaff] = await db()
    .insert(staffMembers)
    .values([{ fullName: 'Sample Teacher Nisha' }, { fullName: 'Real Teacher' }])
    .returning();
  await db()
    .insert(opsStaffProfiles)
    .values([{ staffId: sampleStaff!.id, isSample: true }, { staffId: realStaff!.id }]);
  const leave = async (staffId: string, isSample: boolean) =>
    (
      await db()
        .insert(opsLeaveApplications)
        .values({
          staffId: staffId as never,
          kind: 'Sick',
          fromDate: DAY,
          toDate: DAY,
          reason: 'Fever',
          appliedBy: by,
          isSample,
        })
        .returning()
    )[0]!.id;
  const [feedbackImport] = await db()
    .insert(opsTeacherFeedbackImports)
    .values({
      sha256: 'c'.repeat(64),
      originalName: 'f.csv',
      mapping: {},
      createdBy: by,
      isSample: true,
    })
    .returning();
  const [feedback] = await db()
    .insert(opsStudentTeacherFeedback)
    .values({
      teacherStaffId: realStaff!.id,
      submittedByKind: 'student',
      feedbackOn: DAY,
      comment: 'Clear explanations',
      recordedBy: by,
      isSample: true,
    })
    .returning();
  const owners: [string, string, string, boolean][] = [
    ['flagged', 'task', crypto.randomUUID(), true],
    ['sample application', 'leave_application', await leave(realStaff!.id, true), false],
    ['sample staff member', 'leave_application', await leave(sampleStaff!.id, false), false],
    ['sample feedback import', 'feedback_import', feedbackImport!.id, false],
    ['sample feedback', 'feedback_evidence', feedback!.id, false],
    ['sample staff private', 'staff_private', sampleStaff!.id, false],
    ['real', 'leave_application', await leave(realStaff!.id, false), false],
  ];
  for (const [label, ownerKind, ownerId, isSample] of owners) {
    const key = crypto.randomUUID();
    const bytes = Buffer.from(`%PDF-1.7 ${label}`);
    await db().insert(opsAttachmentFiles).values({ key, bytes, sizeBytes: bytes.length });
    const [row] = await db()
      .insert(opsAttachments)
      .values({
        ownerKind: ownerKind as never,
        ownerId,
        purpose: 'evidence',
        originalName: `${label}.pdf`,
        mime: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey: key,
        uploadedByUserId: by,
        isSample,
      })
      .returning();
    files[label] = { id: row!.id, key };
  }
  await clearSamples(db());
});

describe('db:clear-samples: files kept in the database', () => {
  it.each([
    ['flagged', false],
    ['sample application', false],
    ['sample staff member', false],
    ['sample feedback import', false],
    ['sample feedback', false],
    ['sample staff private', false],
    ['real', true],
  ])('%s file: kept %s, with its bytes', async (label, kept) => {
    const { id, key } = files[label]!;
    const row = await db()
      .select()
      .from(opsAttachments)
      .where(eq(opsAttachments.id, id as never));
    const bytes = await db()
      .select()
      .from(opsAttachmentFiles)
      .where(eq(opsAttachmentFiles.key, key));
    expect(row.length).toBe(kept ? 1 : 0);
    expect(bytes.length).toBe(kept ? 1 : 0);
  });
});
