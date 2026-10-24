/**
 * Files on Ops records (R6). Who may see or add a file is decided by its parent record through
 * one table, `ATTACHMENT_ACCESS`, checked again on every list, upload, download and delete.
 * A record the caller cannot see answers 404, exactly like a missing one.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createLogger } from '@elevate/configuration';
import {
  OPS_ATTACHMENT_MAX_BYTES,
  OPS_ATTACHMENT_OWNER_KINDS,
  OPS_ATTACHMENT_PURPOSES,
  opsAttachments,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import { attachmentProblem, cleanFileName } from '../domain/attachments';
import {
  ATTACHMENT_ACCESS,
  first,
  type AttachmentOwnerKind,
  type OwnerRule,
} from './attachment-access';
import {
  STORAGE_NOT_SET_UP,
  attachmentStorage,
  type AttachmentStorage,
} from './adapters/attachment-storage';
import { notFound, type Actor } from './context';
import { fieldError, opsAudit } from './ops-common';

export { ATTACHMENT_ACCESS, type AttachmentOwnerKind, type OwnerRule } from './attachment-access';

const audit = opsAudit('attachment');
const log = createLogger({ component: 'attachments' });

/** Remove stored bytes; a failure is logged, never thrown over the error that caused it. */
const discard = (storage: AttachmentStorage, storageKey: string) =>
  storage
    .delete(storageKey)
    .catch((error: unknown) => log.error('attachment file cleanup failed', { error, storageKey }));

type Mode = 'read' | 'write' | 'manage';
/** The caller's rights on one record; a rule with `access` is asked once for every mode. */
const rightsOn = (db: Database, user: Actor, kind: AttachmentOwnerKind, ownerId: string) => {
  const rule = ATTACHMENT_ACCESS[kind];
  let asked: ReturnType<NonNullable<OwnerRule['access']>> | undefined;
  return async (mode: Mode) => {
    if (rule.access) {
      const a = await (asked ??= rule.access(db, user, ownerId));
      return mode === 'read' ? a.canRead : a.canWrite;
    }
    const check =
      mode === 'read'
        ? rule.canRead
        : mode === 'write'
          ? rule.canWrite
          : (rule.canManage ?? rule.canWrite);
    return check(db, user, ownerId);
  };
};

const TASK_KINDS: readonly AttachmentOwnerKind[] = ['task', 'task_submission', 'task_update'];
/** Question papers and answer keys: each upload is a new version; unreleased ones open only for writers. */
const RELEASED_KINDS: readonly string[] = ['assessment_paper', 'assessment_key'];
const released = (r: { releasedAt: Date | null }) => !!r.releasedAt && r.releasedAt <= new Date();
/** X3: the files of a finished or cancelled task stay with it. */
const frozen = async (db: Database, kind: AttachmentOwnerKind, ownerId: string) =>
  TASK_KINDS.includes(kind) && !!(await ATTACHMENT_ACCESS[kind].closed?.(db, ownerId));

/** 404 when the caller cannot see the record; 403 when they see it but may not do `mode`. */
export async function assertAttachmentAccess(
  db: Database,
  user: Actor,
  kind: AttachmentOwnerKind,
  ownerId: string,
  mode: Mode = 'read',
) {
  const may = rightsOn(db, user, kind, ownerId);
  if (await may(mode)) return may;
  if (mode !== 'read' && (await may('read')))
    throw new ForbiddenError('You cannot add or remove files on this record.');
  notFound('Record');
}

/** Files on one record, newest first, with whether the caller may remove each. */
export async function listAttachments(
  db: Database,
  user: Actor,
  kind: AttachmentOwnerKind,
  ownerId: string,
) {
  const may = await assertAttachmentAccess(db, user, kind, ownerId);
  const mayWrite = await may('write');
  const mayManage = await may('manage');
  const locked = kind === 'task_submission' || (await frozen(db, kind, ownerId));
  // shortcut: first 100 files per record; page this if a record ever holds more.
  const rows = await db
    .select({
      id: opsAttachments.id,
      name: opsAttachments.originalName,
      purpose: opsAttachments.purpose,
      sizeBytes: opsAttachments.sizeBytes,
      createdAt: opsAttachments.createdAt,
      uploadedByUserId: opsAttachments.uploadedByUserId,
      uploaderName: users.displayName,
      isSample: opsAttachments.isSample,
      version: opsAttachments.version,
      releasedAt: opsAttachments.releasedAt,
      supersedes: opsAttachments.supersedesAttachmentId,
    })
    .from(opsAttachments)
    .leftJoin(users, eq(users.id, opsAttachments.uploadedByUserId))
    .where(
      and(
        eq(opsAttachments.ownerKind, kind),
        eq(opsAttachments.ownerId, ownerId),
        isNull(opsAttachments.deletedAt),
      ),
    )
    .orderBy(desc(opsAttachments.createdAt))
    .limit(100);
  const next = new Map(rows.map((r) => [r.supersedes, r.version]));
  return rows
    .map((r) => ({
      ...r,
      supersededByVersion: next.get(r.id) ?? null,
      canDelete: !locked && (mayManage || (mayWrite && r.uploadedByUserId === user.id)),
    }))
    .filter(
      (r) =>
        mayWrite ||
        !RELEASED_KINDS.includes(kind) ||
        (released(r) && r.supersededByVersion === null),
    );
}
export type AttachmentListRow = Awaited<ReturnType<typeof listAttachments>>[number];

/** 8 MB as base64, plus padding. */
const MAX_BASE64 = Math.ceil(OPS_ATTACHMENT_MAX_BYTES / 3) * 4;
export const uploadAttachmentBody = z.object({
  ownerKind: z.enum(OPS_ATTACHMENT_OWNER_KINDS),
  ownerId: z.uuid(),
  purpose: z.enum(OPS_ATTACHMENT_PURPOSES),
  name: z.string().trim().min(1).max(1000),
  mime: z.string().trim().min(1).max(200),
  dataBase64: z.base64().min(1).max(MAX_BASE64, { error: 'The file is larger than 8 MB.' }),
});
export type UploadAttachmentInput = z.infer<typeof uploadAttachmentBody>;

/**
 * Store a file on a record the caller may change. The bytes are written first under a random
 * key; if the row cannot be written the file is removed again. The same file twice on one
 * record returns the first one's id.
 */
export async function uploadAttachment(
  db: Database,
  user: Actor,
  input: UploadAttachmentInput,
  requestId?: string,
): Promise<{ id: string; duplicate: boolean }> {
  await assertAttachmentAccess(db, user, input.ownerKind, input.ownerId, 'write');
  const closed = await ATTACHMENT_ACCESS[input.ownerKind].closed?.(db, input.ownerId);
  if (closed) throw new ConflictError(closed);
  const storage = attachmentStorage();
  if (!storage) throw new ConflictError(STORAGE_NOT_SET_UP);
  const name = cleanFileName(input.name);
  if (RELEASED_KINDS.includes(input.ownerKind) && !/\.pdf$/i.test(name))
    throw fieldError('file', 'Upload question papers and answer keys as PDF files.');
  const bytes = Buffer.from(input.dataBase64, 'base64');
  const problem = attachmentProblem(name, input.mime, bytes);
  if (problem) throw fieldError('file', problem);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = randomUUID();
  await storage.put(storageKey, bytes);
  try {
    const out = await withTransaction(db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.attachments:${input.ownerId}`}))`,
      );
      const dup = await first(
        tx
          .select({ id: opsAttachments.id })
          .from(opsAttachments)
          .where(
            and(
              eq(opsAttachments.ownerKind, input.ownerKind),
              eq(opsAttachments.ownerId, input.ownerId),
              eq(opsAttachments.sha256, sha256),
              isNull(opsAttachments.deletedAt),
            ),
          )
          .limit(1),
      );
      if (dup) return { id: dup.id as string, duplicate: true };
      const previous = RELEASED_KINDS.includes(input.ownerKind)
        ? await first(
            tx
              .select({ id: opsAttachments.id, version: opsAttachments.version })
              .from(opsAttachments)
              .where(
                and(
                  eq(opsAttachments.ownerKind, input.ownerKind),
                  eq(opsAttachments.ownerId, input.ownerId),
                ),
              )
              .orderBy(desc(opsAttachments.version))
              .limit(1),
          )
        : undefined;
      const [row] = await tx
        .insert(opsAttachments)
        .values({
          ownerKind: input.ownerKind,
          ownerId: input.ownerId,
          purpose: input.purpose,
          originalName: name,
          mime: input.mime,
          sizeBytes: bytes.length,
          sha256,
          storageKey,
          uploadedByUserId: user.id,
          ...(previous
            ? { version: previous.version + 1, supersedesAttachmentId: previous.id }
            : {}),
        })
        .returning();
      await audit(tx, user, row!.id, 'attachment.uploaded', { after: row }, requestId);
      return { id: row!.id as string, duplicate: false };
    });
    if (out.duplicate) await discard(storage, storageKey);
    return out;
  } catch (error) {
    await discard(storage, storageKey);
    throw error;
  }
}

/** Downloads of these are audited: raw feedback and staff-private files. */
const AUDITED_DOWNLOADS: readonly AttachmentOwnerKind[] = [
  'feedback_import',
  'feedback_evidence',
  'staff_private',
];

/** A live file the caller may read, with its bytes; 404 otherwise. */
export async function attachmentDownload(db: Database, user: Actor, id: string) {
  const row = await first(
    db
      .select()
      .from(opsAttachments)
      .where(and(eq(opsAttachments.id, id as never), isNull(opsAttachments.deletedAt)))
      .limit(1),
  );
  const may = row && rightsOn(db, user, row.ownerKind, row.ownerId);
  if (!row || !may || !(await may('read'))) notFound('File');
  // Readers get a paper or key only once released, and never a replaced version.
  if (
    RELEASED_KINDS.includes(row.ownerKind) &&
    !(await may('write')) &&
    (!released(row) ||
      (await first(
        db
          .select({ id: opsAttachments.id })
          .from(opsAttachments)
          .where(
            and(
              eq(opsAttachments.supersedesAttachmentId, row.id),
              isNull(opsAttachments.deletedAt),
            ),
          ),
      )))
  )
    notFound('File');
  const storage = attachmentStorage();
  if (!storage) throw new ConflictError(STORAGE_NOT_SET_UP);
  const bytes = await storage.get(row.storageKey).catch(() => notFound('File'));
  if (AUDITED_DOWNLOADS.includes(row.ownerKind))
    await audit(db, user, row.id, 'attachment.downloaded', {
      metadata: { ownerKind: row.ownerKind, ownerId: row.ownerId },
    });
  return { row, bytes };
}

/** Hide a file (the bytes are kept): its uploader while they may still change the record, or its manager. */
export async function deleteAttachment(
  db: Database,
  user: Actor,
  id: string,
  requestId?: string,
): Promise<{ id: string }> {
  return withTransaction(db, async (tx) => {
    const row = await first(
      tx
        .select()
        .from(opsAttachments)
        .where(and(eq(opsAttachments.id, id as never), isNull(opsAttachments.deletedAt)))
        .limit(1)
        .for('update'),
    );
    if (!row) notFound('File');
    const may = rightsOn(tx, user, row.ownerKind, row.ownerId);
    if (!(await may('read'))) notFound('File');
    if (row.ownerKind === 'task_submission')
      throw new ConflictError('Files on a submitted version stay with it.');
    if (await frozen(tx, row.ownerKind, row.ownerId))
      throw new ConflictError('This task is finished or cancelled, so its files stay with it.');
    const mayDelete =
      (row.uploadedByUserId === user.id && (await may('write'))) || (await may('manage'));
    if (!mayDelete)
      throw new ForbiddenError(
        'Only the person who added this file or someone who manages the record can remove it.',
      );
    const [after] = await tx
      .update(opsAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(opsAttachments.id, row.id))
      .returning();
    await audit(tx, user, row.id, 'attachment.deleted', { before: row, after }, requestId);
    return { id: row.id as string };
  });
}
