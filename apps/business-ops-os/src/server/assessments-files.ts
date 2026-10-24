/**
 * Question paper and answer key PDFs of a test (brief §19). Uploaded and downloaded through the
 * shared attachment routes (owner kinds assessment_paper / assessment_key, owner = the Academic
 * test id): PDF only, 8 MB, a new version for each different file, protected downloads. Until released (setting
 * `assessments.paper_release`) a file opens only for people who manage tests (attachments.ts).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { opsAttachments, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError } from '@elevate/shared-contracts';
import { istToday } from '../domain/dates';
import { assertCan, requireTest } from './assessments';
import type { releaseBody } from './assessments-schemas';
import { first } from './attachment-access';
import { listAttachments } from './attachments';
import { notFound, type Actor } from './context';
import { opsAudit } from './ops-common';
import { loadSettings } from './settings';

export const TEST_FILE_KINDS = ['assessment_paper', 'assessment_key'] as const;
const audit = opsAudit('attachment');

/** Live files of both kinds, newest first; unreleased ones only for people who may add them. */
export async function testFiles(db: Database, actor: Actor, assessmentId: string) {
  assertCan(actor, 'ops:assessments:read');
  const [paper, key] = [
    await listAttachments(db, actor, 'assessment_paper', assessmentId),
    await listAttachments(db, actor, 'assessment_key', assessmentId),
  ];
  return { paper, key };
}
export type TestFiles = Awaited<ReturnType<typeof testFiles>>;

/** Release one version (per `assessments.paper_release`); recorded, never undone silently. */
export async function releaseTestFile(
  db: Database,
  actor: Actor,
  assessmentId: string,
  fileId: string,
  body: z.output<typeof releaseBody>,
  requestId?: string,
) {
  assertCan(actor, 'ops:assessments:manage');
  const { releaseFrom } = (await loadSettings(db))['assessments.paper_release'].value;
  if (releaseFrom === 'test_day') {
    const date = (await requireTest(actor, assessmentId)).assessment.scheduledDate;
    if (!date || date > istToday(new Date()))
      throw new ConflictError(
        `Papers and keys can be released from the test date${date ? ` (${date})` : ', and this test has none yet'}. The setting “Releasing question papers and answer keys” decides this.`,
      );
  }
  return withTransaction(db, async (tx) => {
    const row = await first(
      tx
        .select()
        .from(opsAttachments)
        .where(
          and(
            eq(opsAttachments.id, fileId as never),
            eq(opsAttachments.ownerId, assessmentId),
            inArray(opsAttachments.ownerKind, [...TEST_FILE_KINDS] as never),
            isNull(opsAttachments.deletedAt),
          ),
        )
        .for('update'),
    );
    if (!row) notFound('File');
    if (row.releasedAt) throw new ConflictError('This file is already released.');
    const [after] = await tx
      .update(opsAttachments)
      .set({ releasedAt: new Date(), releaseNote: body.note ?? null })
      .where(eq(opsAttachments.id, row.id))
      .returning();
    await audit(tx, actor, row.id, 'attachment.released', { before: row, after }, requestId);
    return { id: row.id as string, releasedAt: after!.releasedAt };
  });
}
