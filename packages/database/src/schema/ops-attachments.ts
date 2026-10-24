/**
 * OWNER: Business Ops OS — uploaded files (owner brief 23 Oct 2026 §8–§15, ruling R6). Metadata
 * only; the bytes sit in the storage adapter under `storage_key`. Access is decided by the parent
 * record (`owner_kind` + `owner_id`, no FK: parents live in several tables), re-checked on every
 * download. Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import { createdAt, filled, inList, instant, ops, userRef } from './ops-columns';

export type OpsAttachmentId = Brand<string, 'OpsAttachmentId'>;

/** Added in 0016: HR requests, question papers, answer keys, score files. */
export const OPS_ATTACHMENT_0016_OWNER_KINDS = [
  'hr_request',
  'assessment_paper',
  'assessment_key',
  'score_import',
] as const;
export const OPS_ATTACHMENT_OWNER_KINDS = [
  'task',
  'task_submission',
  'task_update',
  'attendance_correction',
  'feedback_import',
  'feedback_evidence',
  'work_report',
  'staff_private',
  ...OPS_ATTACHMENT_0016_OWNER_KINDS,
] as const;
export const OPS_ATTACHMENT_PURPOSES = [
  'reference',
  'evidence',
  'deliverable',
  'source_file',
  'preview',
  'import_source',
  'photo',
] as const;
/** 8 MB upload limit (R6). */
export const OPS_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export const opsAttachments = ops.table(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsAttachmentId>(),
    ownerKind: text('owner_kind', { enum: OPS_ATTACHMENT_OWNER_KINDS }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    purpose: text('purpose', { enum: OPS_ATTACHMENT_PURPOSES }).notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedByUserId: userRef('uploaded_by_user_id').notNull(),
    createdAt: createdAt(),
    /** Hidden from lists; the bytes are kept (history). */
    deletedAt: instant('deleted_at'),
    isSample: boolean('is_sample').notNull().default(false),
    /** 1 = first upload; a later version names the one it replaces (one successor each). */
    version: integer('version').notNull().default(1),
    supersedesAttachmentId: uuid('supersedes_attachment_id')
      .references((): AnyPgColumn => opsAttachments.id, { onDelete: 'restrict' })
      .$type<OpsAttachmentId>(),
    /** Release (question papers, answer keys): null = not released yet. */
    releasedAt: instant('released_at'),
    releaseNote: text('release_note'),
  },
  (t) => [
    index('attachments_owner_idx').on(t.ownerKind, t.ownerId),
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    uniqueIndex('attachments_supersedes_key')
      .on(t.supersedesAttachmentId)
      .where(sql`${t.supersedesAttachmentId} IS NOT NULL`),
    check(
      'attachments_owner_kind_check',
      sql`${t.ownerKind} IN ${inList(OPS_ATTACHMENT_OWNER_KINDS)}`,
    ),
    check(
      'attachments_version_check',
      sql`${t.version} >= 1 AND (${t.version} = 1) = (${t.supersedesAttachmentId} IS NULL) AND ${t.supersedesAttachmentId} IS DISTINCT FROM ${t.id}`,
    ),
    check(
      'attachments_release_check',
      sql`${t.releaseNote} IS NULL OR ${t.releasedAt} IS NOT NULL`,
    ),
    check('attachments_purpose_check', sql`${t.purpose} IN ${inList(OPS_ATTACHMENT_PURPOSES)}`),
    check(
      'attachments_size_check',
      sql`${t.sizeBytes} BETWEEN 1 AND ${sql.raw(String(OPS_ATTACHMENT_MAX_BYTES))}`,
    ),
    check('attachments_sha_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'attachments_name_check',
      sql`${filled(t.originalName)} AND length(${t.originalName}) <= 255`,
    ),
    check('attachments_mime_check', filled(t.mime)),
    check('attachments_storage_key_check', filled(t.storageKey)),
  ],
);
