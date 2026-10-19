/**
 * Employment document metadata (OPS-035) — `ops:employee_documents:*`.
 * Metadata only in PostgreSQL; bytes behind the DocumentStorage adapter (D-014,
 * default mock = not configured, so `stored` uploads and downloads are refused
 * with 503). Reference-only documents keep the workflow usable today.
 * Identity documents additionally need `ops:employee_private:*` (OD-014).
 * Deletion: request → a DIFFERENT authorised person decides → `deleted`
 * (metadata kept; retention periods are an open owner decision).
 */
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { opsEmployeeDocuments, opsEmployeeRecords, type Database } from '@elevate/database';
import { notify } from '@elevate/notifications';
import { recordAudit, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday } from '../../domain/dates';
import {
  checkDocumentAction,
  DEFAULT_RETENTION_CLASS,
  isExpired,
  isPrivateDocumentKind,
  type DocumentKind,
} from '../../domain/hr/documents';
import { getDocumentStorage } from '../adapters/document-storage';
import { userIdsWithRole, type Actor } from '../context';
import { assertHrScope, assertNotSelf, hrCovers } from '../hr-scope';
import { invalidField, optionalScope, selfOrAllScope } from './access';
import type { AddDocumentInput, documentActionBody } from './schemas';

type DocumentId = typeof opsEmployeeDocuments.$inferSelect.id;
type DocumentRow = typeof opsEmployeeDocuments.$inferSelect;

/** Short-lived download link lifetime (seconds). Technical setting, not a policy. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

async function assertPrivateFor(
  db: Database,
  actor: Actor,
  staffId: string,
  kind: DocumentKind,
  mode: 'read' | 'manage',
) {
  if (!isPrivateDocumentKind(kind)) return;
  const scope = await optionalScope(db, actor, `ops:employee_private:${mode}`, 'self');
  if (!scope || !hrCovers(scope, staffId))
    throw new ForbiddenError('Identity documents need access to private HR records.');
}

function toDto(d: DocumentRow, today: string) {
  return {
    id: d.id,
    staffId: d.staffId,
    kind: d.kind,
    title: d.title,
    storageKind: d.storageKind,
    externalReference: d.externalReference,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    retentionClass: d.retentionClass,
    status: d.status,
    expiresOn: d.expiresOn,
    expired: isExpired(d.expiresOn, today),
    supersededById: d.supersededById,
    uploadedAt: d.createdAt,
    deletionRequestedAt: d.deletionRequestedAt,
    deletionReason: d.deletionReason,
    deletionDecidedAt: d.deletionDecidedAt,
    /** True when the caller requested the pending deletion (they cannot decide it). */
    deletionRequestedBy: d.deletionRequestedBy,
  };
}

/** Documents of one employee visible to the caller (identity kinds filtered out without private access). */
export async function listDocuments(db: Database, actor: Actor, staffId: string) {
  const scope = await selfOrAllScope(db, actor, 'ops:employee_documents:read');
  assertHrScope(scope, staffId, 'this employee’s documents');
  const priv = await optionalScope(db, actor, 'ops:employee_private:read', 'self');
  const seePrivate = priv ? hrCovers(priv, staffId) : false;
  const rows = await db
    .select()
    .from(opsEmployeeDocuments)
    .where(eq(opsEmployeeDocuments.staffId, staffId as StaffMemberId))
    .orderBy(desc(opsEmployeeDocuments.createdAt));
  const today = istToday(new Date());
  const visible = rows.filter((r) => seePrivate || !isPrivateDocumentKind(r.kind));
  return {
    documents: visible.map((r) => toDto(r, today)),
    hiddenPrivateCount: rows.length - visible.length,
    storage: await getDocumentStorage().status(),
  };
}

/**
 * Add a document. `reference` → metadata + location label. `stored` → bytes go
 * to the adapter; with the mock nothing is written and `{ stored: false }` is
 * returned (the route answers 503).
 */
export async function addDocument(
  db: Database,
  actor: Actor,
  staffId: string,
  input: AddDocumentInput,
  requestId?: string,
): Promise<
  | { stored: true; id: string; document: ReturnType<typeof toDto> }
  | { stored: false; connection: string; detail: string }
> {
  const scope = await selfOrAllScope(db, actor, 'ops:employee_documents:manage');
  assertHrScope(scope, staffId, 'this employee’s documents');
  await assertPrivateFor(db, actor, staffId, input.kind, 'manage');
  const [emp] = await db
    .select({ staffId: opsEmployeeRecords.staffId })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, staffId as StaffMemberId));
  if (!emp) throw new NotFoundError('Employee not found.');

  let storageKey: string | null = null;
  if (input.storageKind === 'reference') {
    if (!input.externalReference?.trim())
      throw invalidField(
        'externalReference',
        'Say where the document is kept (reference-only document).',
      );
  } else {
    if (!input.contentType) throw invalidField('contentType', 'Content type is required.');
    if (!input.sha256) throw invalidField('sha256', 'sha256 is required.');
    if (!input.contentBase64) throw invalidField('contentBase64', 'File content is required.');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (
      input.sizeBytes !== undefined &&
      input.sizeBytes !== null &&
      bytes.length !== input.sizeBytes
    )
      throw invalidField('sizeBytes', 'Size does not match the content.');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== input.sha256) throw invalidField('sha256', 'sha256 does not match the content.');
    const put = await getDocumentStorage().put({
      bytes,
      contentType: input.contentType,
      sha256: digest,
    });
    if (!put.ok) return { stored: false, connection: put.connection, detail: put.detail };
    storageKey = put.storageKey;
  }

  return withTransaction(db, async (tx) => {
    let supersedes: DocumentRow | undefined;
    if (input.supersedesId) {
      [supersedes] = await tx
        .select()
        .from(opsEmployeeDocuments)
        .where(eq(opsEmployeeDocuments.id, input.supersedesId as DocumentId))
        .for('update');
      if (!supersedes || supersedes.staffId !== staffId)
        throw invalidField('supersedesId', 'Unknown document for this employee.');
      if (supersedes.status !== 'active')
        throw new InvalidStateTransitionError('Only an active document can be superseded.');
    }
    const [row] = await tx
      .insert(opsEmployeeDocuments)
      .values({
        staffId: staffId as StaffMemberId,
        kind: input.kind,
        title: input.title,
        storageKind: input.storageKind,
        storageKey,
        externalReference:
          input.storageKind === 'reference' ? input.externalReference!.trim() : null,
        contentType: input.storageKind === 'stored' ? (input.contentType ?? null) : null,
        sizeBytes: input.storageKind === 'stored' ? (input.sizeBytes ?? null) : null,
        sha256: input.storageKind === 'stored' ? (input.sha256 ?? null) : null,
        retentionClass: input.retentionClass ?? DEFAULT_RETENTION_CLASS[input.kind],
        expiresOn: input.expiresOn ?? null,
        uploadedBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('document insert returned no row');
    if (supersedes)
      await tx
        .update(opsEmployeeDocuments)
        .set({ status: 'superseded', supersededById: row.id })
        .where(eq(opsEmployeeDocuments.id, supersedes.id));
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'employee_document.added',
      entityType: 'employee_document',
      entityId: row.id,
      after: {
        staffId,
        kind: row.kind,
        storageKind: row.storageKind,
        retentionClass: row.retentionClass,
        supersedesId: supersedes?.id ?? null,
      },
      requestId,
    });
    return { stored: true as const, id: row.id, document: toDto(row, istToday(new Date())) };
  });
}

async function documentRow(db: Database, id: string, lock = false) {
  const q = db
    .select()
    .from(opsEmployeeDocuments)
    .where(eq(opsEmployeeDocuments.id, id as DocumentId));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new NotFoundError('Document not found.');
  return row;
}

/**
 * Permission-checked download: asks the adapter for a SHORT-LIVED URL. Mock →
 * `{ available: false, reason: 'storage_not_configured' }` (route answers 503).
 * Every request is audited (who asked, outcome) without document content.
 */
export async function requestDocumentDownload(
  db: Database,
  actor: Actor,
  documentId: string,
  requestId?: string,
) {
  const doc = await documentRow(db, documentId);
  const scope = await selfOrAllScope(db, actor, 'ops:employee_documents:read');
  assertHrScope(scope, doc.staffId, 'this document');
  await assertPrivateFor(db, actor, doc.staffId, doc.kind, 'read');
  if (doc.status === 'deleted') throw new ConflictError('The document has been deleted.');
  let result:
    | { available: true; url: string; expiresAt: string }
    | {
        available: false;
        reason: 'reference_only' | 'storage_not_configured';
        detail: string;
        externalReference?: string | null;
      };
  if (doc.storageKind === 'reference' || !doc.storageKey) {
    result = {
      available: false,
      reason: 'reference_only',
      detail: 'This is a reference-only document; no file is stored in Elevate OS.',
      externalReference: doc.externalReference,
    };
  } else {
    const url = await getDocumentStorage().downloadUrl(doc.storageKey, DOWNLOAD_URL_TTL_SECONDS);
    result = url.ok
      ? { available: true, url: url.url, expiresAt: url.expiresAt }
      : { available: false, reason: 'storage_not_configured', detail: url.detail };
  }
  await withTransaction(db, (tx) =>
    recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'employee_document.download_requested',
      entityType: 'employee_document',
      entityId: doc.id,
      metadata: { outcome: result.available ? 'url_issued' : result.reason },
      requestId,
    }),
  );
  return result;
}

/** hold · release_hold · request_deletion · approve_deletion · reject_deletion. */
export async function changeDocumentStatus(
  db: Database,
  actor: Actor,
  documentId: string,
  input: z.output<typeof documentActionBody>,
  requestId?: string,
) {
  const scope = await selfOrAllScope(db, actor, 'ops:employee_documents:manage');
  const result = await withTransaction(db, async (tx) => {
    const doc = await documentRow(tx, documentId, true);
    assertHrScope(scope, doc.staffId, 'this document');
    await assertPrivateFor(tx, actor, doc.staffId, doc.kind, 'manage');
    const check = checkDocumentAction(doc.status, input.action, {
      actorUserId: actor.id,
      requestedBy: doc.deletionRequestedBy,
      reason: input.reason,
    });
    if (!check.ok) {
      if (check.code === 'SELF_DECISION') throw new ForbiddenError(check.message);
      if (check.code === 'REASON_REQUIRED') throw invalidField('reason', check.message);
      throw new InvalidStateTransitionError(check.message);
    }
    if (input.action === 'approve_deletion' || input.action === 'reject_deletion')
      assertNotSelf(scope.staffId, doc.staffId, 'the deletion of your own document');
    if (input.action === 'approve_deletion' && input.confirm !== true)
      throw invalidField('confirm', 'Tick the box to confirm the deletion.');
    const now = new Date();
    const patch: Partial<typeof opsEmployeeDocuments.$inferInsert> = { status: check.to };
    if (input.action === 'request_deletion') {
      patch.deletionRequestedBy = actor.id;
      patch.deletionRequestedAt = now;
      patch.deletionReason = input.reason ?? null;
      patch.deletionDecidedBy = null;
      patch.deletionDecidedAt = null;
    }
    if (input.action === 'approve_deletion' || input.action === 'reject_deletion') {
      patch.deletionDecidedBy = actor.id;
      patch.deletionDecidedAt = now;
    }
    const [after] = await tx
      .update(opsEmployeeDocuments)
      .set(patch)
      .where(and(eq(opsEmployeeDocuments.id, doc.id)))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: `employee_document.${input.action}`,
      entityType: 'employee_document',
      entityId: doc.id,
      before: { status: doc.status },
      after: { status: check.to },
      metadata: { reason: input.reason ?? null },
      requestId,
    });
    if (input.action === 'request_deletion') {
      const deciders = (await userIdsWithRole(tx, 'hr_manager')).filter((u) => u !== actor.id);
      await notify(tx, {
        userIds: deciders,
        module: 'ops',
        kind: 'hr.document_deletion_requested',
        title: 'Document deletion awaiting a decision',
        body: 'An employment document deletion was requested; a different HR manager must decide it.',
        link: `/ops/hr/employees/${doc.staffId}`,
      });
    }
    return after;
  });
  return toDto(result!, istToday(new Date()));
}
