/**
 * KYC of a student (owner brief §8, acceptance 21; students are mostly minors): identity documents
 * (type from setting `admissions.kyc.id_document_types`, masked reference only, verification),
 * sibling links and the KYC edit history (audit rows, values masked). Reading needs
 * `ops:student_private:read`; recording `ops:guardians:write` + private access; verifying
 * `ops:kyc:verify`. A newly entered document is always unverified.
 */
import { aliasedTable, and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  auditEvents,
  opsGuardians,
  opsKycDocuments,
  opsStudentSiblings,
  students,
  users,
  type Database,
  type OpsKycDocumentId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, NotFoundError } from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { checkMaskedReference } from '../domain/kyc';
import { accessScope, clean, type Actor } from './context';
import { identityAccess } from './guardians';
import { fieldError, opsAudit } from './ops-common';
import type { KycDocumentInput, kycVerifyBody } from './profile-schemas';
import { loadSettings } from './settings';
import type { z } from 'zod';

/** Audit actions that make up the KYC history (all on entity `student`). */
export const KYC_ACTIONS = [
  'guardian.added',
  'guardian.updated',
  'kyc.document_recorded',
  'kyc.document_verified',
  'kyc.document_rejected',
  'sibling.linked',
] as const;

const audit = opsAudit('student');
const sid = (id: string) => id as StudentIdentityId;
const docFacts = (d: typeof opsKycDocuments.$inferSelect) => ({
  documentId: d.id,
  subjectType: d.subjectType,
  guardianId: d.guardianId,
  documentType: d.documentType,
  maskedReference: d.maskedReference,
  verificationStatus: d.verificationStatus,
});

/** GET /students/{id}/kyc — documents (current and replaced), siblings, KYC history. */
export async function getStudentKyc(db: Database, actor: Actor, identityId: string) {
  await identityAccess(db, actor, identityId, 'ops:student_private:read');
  const verifier = aliasedTable(users, 'verifier');
  const sibling = aliasedTable(students, 'sibling');
  const [types, documents, siblings, history] = await Promise.all([
    loadSettings(db).then((s) => s['admissions.kyc.id_document_types']),
    db
      .select({
        d: opsKycDocuments,
        guardianName: opsGuardians.fullName,
        verifiedByName: verifier.displayName,
      })
      .from(opsKycDocuments)
      .leftJoin(opsGuardians, eq(opsGuardians.id, opsKycDocuments.guardianId))
      .leftJoin(verifier, eq(verifier.id, opsKycDocuments.verifiedBy))
      .where(eq(opsKycDocuments.studentId, sid(identityId)))
      .orderBy(desc(opsKycDocuments.createdAt)),
    db
      .select({ link: opsStudentSiblings, other: sibling })
      .from(opsStudentSiblings)
      .innerJoin(
        sibling,
        or(
          and(
            eq(opsStudentSiblings.studentId, sid(identityId)),
            eq(sibling.id, opsStudentSiblings.siblingStudentId),
          ),
          and(
            eq(opsStudentSiblings.siblingStudentId, sid(identityId)),
            eq(sibling.id, opsStudentSiblings.studentId),
          ),
        ),
      ),
    db
      .select({ e: auditEvents, actorName: users.displayName })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(
        and(
          eq(auditEvents.entityType, 'student'),
          eq(auditEvents.entityId, identityId),
          inArray(auditEvents.action, [...KYC_ACTIONS]),
        ),
      )
      .orderBy(desc(auditEvents.at))
      .limit(100),
  ]);
  const typeLabel = new Map(types.value.types.map((t) => [t.code, t.label]));
  return {
    documentTypes: { ...types.value, decisionState: types.decisionState },
    documents: documents.map(({ d, guardianName, verifiedByName }) => ({
      ...d,
      typeLabel: typeLabel.get(d.documentType) ?? d.documentType,
      guardianName,
      verifiedByName,
      current: !d.supersededAt,
    })),
    siblings: siblings.map(({ link, other }) => ({
      id: link.id,
      studentId: other.id,
      fullName: other.fullName,
      note: link.note,
      createdAt: link.createdAt,
    })),
    history: history.map(({ e, actorName }) => ({
      id: e.id,
      at: e.at,
      action: e.action,
      actorName: actorName ?? 'System',
      before: e.before,
      after: e.after,
    })),
  };
}

/**
 * POST /students/{id}/kyc — record a document seen (masked reference only). A document of the
 * same type for the same person replaces the current one (kept, linked) and starts unverified.
 */
export async function recordKycDocument(
  db: Database,
  actor: Actor,
  identityId: string,
  input: KycDocumentInput,
  requestId?: string,
) {
  await identityAccess(db, actor, identityId);
  const types = (await loadSettings(db))['admissions.kyc.id_document_types'].value.types;
  if (!types.some((t) => t.code === input.documentType))
    throw fieldError('documentType', 'Not a document type in Identity document types settings.');
  const masked = checkMaskedReference(input.maskedReference);
  if (masked) throw fieldError('maskedReference', masked.message);
  const guardianId = input.subjectType === 'guardian' ? (input.guardianId ?? null) : null;
  return withTransaction(db, async (tx) => {
    if (guardianId) {
      const [g] = await tx
        .select({ id: opsGuardians.id })
        .from(opsGuardians)
        .where(
          and(
            eq(opsGuardians.id, guardianId as never),
            eq(opsGuardians.studentId, sid(identityId)),
            isNull(opsGuardians.archivedAt),
          ),
        );
      if (!g) throw fieldError('guardianId', 'Not a current guardian of this student.');
    }
    const [old] = await tx
      .select()
      .from(opsKycDocuments)
      .where(
        and(
          eq(opsKycDocuments.studentId, sid(identityId)),
          eq(opsKycDocuments.documentType, input.documentType),
          guardianId
            ? eq(opsKycDocuments.guardianId, guardianId as never)
            : isNull(opsKycDocuments.guardianId),
          isNull(opsKycDocuments.supersededAt),
        ),
      )
      .for('update');
    const now = new Date();
    // One live row per person and type: retire the old row first (pointing at itself), then
    // insert the new one and point the old row at it.
    if (old)
      await tx
        .update(opsKycDocuments)
        .set({ supersededAt: now, supersededById: old.id })
        .where(eq(opsKycDocuments.id, old.id));
    const [row] = await tx
      .insert(opsKycDocuments)
      .values({
        studentId: sid(identityId),
        subjectType: input.subjectType,
        guardianId: guardianId as never,
        documentType: input.documentType,
        maskedReference: input.maskedReference.trim(),
        createdBy: actor.id,
      })
      .returning();
    if (old)
      await tx
        .update(opsKycDocuments)
        .set({ supersededById: row!.id })
        .where(eq(opsKycDocuments.id, old.id));
    await audit(
      tx,
      actor,
      identityId,
      'kyc.document_recorded',
      { before: old ? docFacts(old) : null, after: docFacts(row!) },
      requestId,
    );
    return row!;
  });
}

/** POST /students/{id}/kyc/{documentId} — verify or reject the current document (ops:kyc:verify). */
export async function verifyKycDocument(
  db: Database,
  actor: Actor,
  identityId: string,
  documentId: string,
  input: z.output<typeof kycVerifyBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:kyc:verify');
  await identityAccess(db, actor, identityId, 'ops:student_private:read');
  return withTransaction(db, async (tx) => {
    const [before] = await tx
      .select()
      .from(opsKycDocuments)
      .where(
        and(
          eq(opsKycDocuments.id, documentId as OpsKycDocumentId),
          eq(opsKycDocuments.studentId, sid(identityId)),
        ),
      )
      .for('update');
    if (!before) throw new NotFoundError('Document not found.');
    if (before.supersededAt)
      throw new ConflictError('A newer document replaced this one; check the current one.');
    if (before.verificationStatus !== 'unverified')
      throw new ConflictError(
        `Already ${before.verificationStatus}. Record the document again to re-check it.`,
      );
    const [after] = await tx
      .update(opsKycDocuments)
      .set({
        verificationStatus: input.status,
        verifiedBy: actor.id,
        verifiedAt: new Date(),
        verificationNote: clean(input.note),
      })
      .where(eq(opsKycDocuments.id, before.id))
      .returning();
    await audit(
      tx,
      actor,
      identityId,
      input.status === 'verified' ? 'kyc.document_verified' : 'kyc.document_rejected',
      { before: docFacts(before), after: { ...docFacts(after!), note: after!.verificationNote } },
      requestId,
    );
    return after!;
  });
}

/** POST /students/{id}/siblings — link two student records (ordered pair); never merges them. */
export async function linkSibling(
  db: Database,
  actor: Actor,
  identityId: string,
  input: { siblingStudentId: string; note?: string | null },
  requestId?: string,
) {
  await identityAccess(db, actor, identityId);
  if (input.siblingStudentId === identityId)
    throw fieldError('siblingStudentId', 'A student cannot be their own sibling.');
  // The same write + private-data check on the sibling; a refusal looks like "not found" so an
  // own-scope caller learns nothing about students outside their scope.
  await identityAccess(db, actor, input.siblingStudentId).catch((e: unknown) => {
    if (e instanceof ForbiddenError || e instanceof NotFoundError)
      throw new NotFoundError('No student you can work on has this record ID.');
    throw e;
  });
  const [lo, hi] = [identityId, input.siblingStudentId].sort() as [string, string];
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsStudentSiblings)
      .values({
        studentId: sid(lo),
        siblingStudentId: sid(hi),
        note: clean(input.note),
        createdBy: actor.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('These students are already linked as siblings.');
    for (const [me, them] of [
      [identityId, input.siblingStudentId],
      [input.siblingStudentId, identityId],
    ] as const)
      await audit(
        tx,
        actor,
        me,
        'sibling.linked',
        { after: { siblingStudentId: them } },
        requestId,
      );
    return row;
  });
}
