/**
 * Admission applications (owner brief 21 Oct 2026 §6): draft → ready for review → form generated →
 * signatures confirmed → (admission confirmed, server/applications-confirm.ts). Every save that
 * changes what the form prints (KYC, guardians, programmes, fee agreement, declarations) adds an
 * `application_versions` row, sends the application back to draft and invalidates the live
 * signature confirmation. The content is read from its sources (lead KYC, guardians, the bundle's
 * admission cases, the active fee plan, settings) — never typed twice.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsApplications,
  opsApplicationVersions,
  opsDemos,
  opsLeads,
  opsSignatureConfirmations,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { AdmissionId, BatchId, StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import { informationGaps, statusAfter, type ApplicationSnapshot } from '../domain/applications';
import { EMPTY_FORM_FIELDS } from '../domain/admission-form';
import { normalisePhone } from '../domain/contacts';
import { leadOwnerOf, lockAccessible } from './admissions';
import {
  currentState,
  gapSettings,
  hashOf,
  liveSnapshot,
  lockApplication,
  setStatus,
  versionRow,
  type ApplicationRow,
} from './applications-state';
import type { SaveApplicationInput } from './applications-schemas';
import { accessScope, type Actor } from './context';
import { resolveStudent } from './conversion';
import { fieldError, opsAudit } from './ops-common';
import type { AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

export {
  confirmationCheck,
  currentState,
  gapSettings,
  liveSnapshot,
  lockApplication,
  sha256,
} from './applications-state';
export { confirmSignatures, generateForm, withdrawApplication } from './applications-signing';

const audit = opsAudit('application');

/**
 * A new application with version 1 (conversion, direct admission, readmission). Runs in the
 * caller's transaction on a locked admission case; `bundleAdmissionIds` = the extra programme
 * cases opened with it. Reference APP-nnnnnn mirrors the case code (one application per case).
 */
export async function createApplication(
  tx: Database,
  actor: Actor,
  input: {
    admission: AdmissionRow;
    studentId: StudentIdentityId;
    origin: 'demo' | 'direct' | 'readmission';
    demoId?: string | null;
    previousAdmissionId?: string | null;
    academicYear?: string | null;
    bundleAdmissionIds?: readonly AdmissionId[];
    requestId?: string;
  },
) {
  const [app] = await tx
    .insert(opsApplications)
    .values({
      reference: `APP-${input.admission.code.slice(4)}`,
      studentId: input.studentId,
      admissionId: input.admission.id,
      origin: input.origin,
      demoId: (input.demoId ?? null) as never,
      previousAdmissionId: (input.previousAdmissionId ?? null) as AdmissionId | null,
      academicYear: input.academicYear ?? null,
      createdBy: actor.id,
    })
    .returning()
    .catch((e: unknown) => {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err?.code === '23505' || err?.cause?.code === '23505')
        throw new ConflictError('This admission case already has an application.');
      throw e;
    });
  // Every case of the application (its own and the bundle's) points at it.
  await tx
    .update(opsAdmissions)
    .set({ applicationId: app!.id })
    .where(inArray(opsAdmissions.id, [input.admission.id, ...(input.bundleAdmissionIds ?? [])]));
  const snapshot = await liveSnapshot(tx, app!, await loadSettings(tx));
  await tx.insert(opsApplicationVersions).values({
    applicationId: app!.id,
    version: 1,
    snapshot: snapshot as never,
    contentHash: hashOf(snapshot),
    createdBy: actor.id,
  });
  await audit(
    tx,
    actor,
    app!.id,
    'application.created',
    {
      after: { reference: app!.reference, status: app!.status, version: 1 },
      metadata: {
        admissionId: input.admission.id,
        origin: input.origin,
        demoId: input.demoId ?? null,
      },
    },
    input.requestId,
  );
  return app!;
}

/** POST /applications — "New direct admission": the same application and confirmation gate as a demo. */
export async function startDirectApplication(
  db: Database,
  actor: Actor,
  input: {
    admissionId: string;
    academicYear?: string | null;
    existingStudentIdentityId?: string | null;
    createNewStudent?: boolean;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, input.admissionId);
    if (admission.status !== 'admission_pending')
      throw new InvalidStateTransitionError(
        'Move the case to "Admission pending" first (with a reason when the demo is skipped).',
      );
    if (
      await tx.$count(
        opsDemos,
        and(eq(opsDemos.admissionId, admission.id), eq(opsDemos.outcome, 'open')),
      )
    )
      throw new ConflictError(
        'This case has an open demo: use "Convert to admission" on the demo.',
      );
    if (admission.applicationId)
      throw new ConflictError('This case is part of another application’s programme bundle.');
    const [lead] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
    const { studentId } = admission.studentId
      ? { studentId: admission.studentId }
      : await resolveStudent(tx, admission.id, lead!, input);
    if (!admission.studentId)
      await tx.update(opsAdmissions).set({ studentId }).where(eq(opsAdmissions.id, admission.id));
    return createApplication(tx, actor, {
      admission: { ...admission, studentId },
      studentId,
      origin: 'direct',
      academicYear: input.academicYear,
      requestId,
    });
  });
}

const STUDENT_COLUMNS = {
  preferredName: opsLeads.preferredName,
  dateOfBirth: opsLeads.dateOfBirth,
  currentStage: opsLeads.currentStage,
  schoolBoard: opsLeads.schoolBoard,
  previousSchool: opsLeads.previousSchool,
  city: opsLeads.city,
  address: opsLeads.address,
  emergencyContactName: opsLeads.emergencyContactName,
  emergencyContactPhone: opsLeads.emergencyContactPhone,
} as const;

/**
 * PATCH /applications/{id} — save the fields the application owns (student KYC on the lead,
 * start date, mode, batch, academic year) and re-read the rest. A material change → version + 1,
 * back to draft, live signature confirmation invalidated. No change → nothing written.
 */
export async function saveApplication(
  db: Database,
  actor: Actor,
  id: string,
  input: SaveApplicationInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  if (
    !can(actor, 'ops:student_private:read') &&
    (input.student || input.form || input.resultPublicityConsent !== undefined)
  )
    throw new ForbiddenError(
      'Editing student KYC, paper-form answers or consent needs permission ops:student_private:read.',
    );
  const settings = await loadSettings(db);
  const student = { ...input.student };
  const paper = { ...input.form };
  for (const [target, path] of [
    [student, 'student.emergencyContactPhone'],
    [paper, 'form.whatsapp'],
    [paper, 'form.guardianAlternateContact'],
  ] as const) {
    const key = path.split('.')[1] as keyof typeof target;
    const raw = target[key] as string | null | undefined;
    if (!raw) continue;
    const phone = normalisePhone(raw);
    if (!phone.ok) throw fieldError(path, 'Enter a valid phone number.');
    (target as Record<string, unknown>)[key] = phone.e164;
  }
  return withTransaction(db, async (tx) => {
    const { app, admission } = await lockApplication(tx, access, id, 'save', input.version);
    const leadPatch = Object.fromEntries(
      Object.entries(student)
        .filter(([k, v]) => v !== undefined && k in STUDENT_COLUMNS)
        .map(([k, v]) => [k, v || null]),
    );
    if (Object.keys(leadPatch).length) {
      const [before] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
      await tx.update(opsLeads).set(leadPatch).where(eq(opsLeads.id, admission.leadId));
      await opsAudit('lead')(
        tx,
        actor,
        admission.leadId,
        'lead.kyc_updated',
        {
          before: Object.fromEntries(
            Object.keys(leadPatch).map((k) => [k, before?.[k as keyof typeof before] ?? null]),
          ),
          after: leadPatch,
          metadata: { applicationId: app.id },
        },
        requestId,
      );
    }
    const casePatch: Partial<typeof opsAdmissions.$inferInsert> = {};
    if (input.intendedStartDate !== undefined)
      casePatch.intendedStartDate = input.intendedStartDate;
    if (input.deliveryMode !== undefined) casePatch.deliveryMode = input.deliveryMode;
    if (input.intendedBatchId !== undefined)
      casePatch.intendedBatchId = (input.intendedBatchId ?? null) as BatchId | null;
    if (Object.keys(casePatch).length)
      await tx.update(opsAdmissions).set(casePatch).where(eq(opsAdmissions.id, admission.id));
    let row = app;
    if (input.academicYear !== undefined)
      [row] = (await tx
        .update(opsApplications)
        .set({ academicYear: input.academicYear ?? null })
        .where(eq(opsApplications.id, app.id))
        .returning()) as [ApplicationRow];
    const saved = (await versionRow(tx, row)).snapshot as unknown as ApplicationSnapshot;
    const form = { ...EMPTY_FORM_FIELDS, ...saved.form, ...paper };
    const consent = form.resultPublicityConsent;
    if (
      input.resultPublicityConsent !== undefined &&
      input.resultPublicityConsent !== (consent?.given ?? false)
    )
      form.resultPublicityConsent = {
        given: input.resultPublicityConsent,
        recordedBy: actor.id,
        recordedAt: new Date().toISOString(),
      };
    const { live, stale, changed } = await currentState(tx, row, settings, form);
    if (!stale) return { id: app.id, version: app.currentVersion, status: app.status, changed: [] };
    const version = app.currentVersion + 1;
    await tx.insert(opsApplicationVersions).values({
      applicationId: app.id,
      version,
      snapshot: live as never,
      contentHash: hashOf(live),
      createdBy: actor.id,
    });
    const status = statusAfter(app.status, 'save');
    await tx
      .update(opsApplications)
      .set({ currentVersion: version, status, updatedAt: new Date() })
      .where(eq(opsApplications.id, app.id));
    const invalidated = await tx
      .update(opsSignatureConfirmations)
      .set({
        invalidatedAt: new Date(),
        invalidatedBy: actor.id,
        invalidatedReason: `Material change in version ${version}: ${changed.join(', ')}`,
      })
      .where(
        and(
          eq(opsSignatureConfirmations.applicationId, app.id),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      )
      .returning({ id: opsSignatureConfirmations.id });
    await audit(
      tx,
      actor,
      app.id,
      'application.version_created',
      {
        before: { version: app.currentVersion, status: app.status },
        after: { version, status },
        metadata: { changed, signaturesInvalidated: invalidated.length },
      },
      requestId,
    );
    return { id: app.id, version, status, changed };
  });
}

/** POST /applications/{id}/ready — the reviewed version is complete (declarations come at confirmation). */
export async function markReady(
  db: Database,
  actor: Actor,
  id: string,
  input: { version: number },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app, admission } = await lockApplication(tx, access, id, 'mark_ready', input.version);
    const { live, stale, changed } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        `Details changed since version ${app.currentVersion} (${changed.join(', ')}). Save the application, then review the new version.`,
      );
    const gaps = informationGaps(live, gapSettings(settings), {
      counsellorAssigned: Boolean(
        admission.counsellorStaffId ?? (await leadOwnerOf(tx, admission)),
      ),
      today: istToday(new Date()),
    }).map((g) => g.message);
    if (gaps.length)
      throw new InvalidStateTransitionError('The application is not complete yet.', {
        details: { missing: gaps },
      });
    return setStatus(tx, actor, app, 'ready_for_review', 'application.ready', {}, requestId);
  });
}
