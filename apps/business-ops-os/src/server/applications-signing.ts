/**
 * Admission-form printing and signing (server/applications.ts): generate the form PDF of the
 * current version, confirm the signatures on it, or withdraw the application.
 */
import { and, eq } from 'drizzle-orm';
import { opsApplicationForms, opsSignatureConfirmations, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError } from '@elevate/shared-contracts';
import { istToday } from '../domain';
import { requiredSigners, statusAfter } from '../domain/applications';
import { accessScope, type Actor } from './context';
import { fieldError } from './ops-common';
import { admissionRecord } from './application-record';
import { currentState, lockApplication, setStatus, sha256 } from './applications-state';
import { admissionFormPdf, FORM_TEMPLATE_VERSION } from './pdf/admission-documents';
import { loadSettings } from './settings';

/**
 * POST /applications/{id}/form — generate the admission-form PDF of the current version, store
 * its record (version, template version, SHA-256) and return the PDF. Before signatures are
 * confirmed it is marked "Application — admission pending"; it carries the application
 * reference, never an admission number. The form shows KYC, so it needs ops:student_private:read.
 */
export async function generateForm(db: Database, actor: Actor, id: string, requestId?: string) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  await accessScope(db, actor, 'ops:student_private:read');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'generate_form');
    const { saved, stale, changed } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        `Details changed since version ${app.currentVersion} (${changed.join(', ')}). Save the application before printing the form.`,
      );
    const generatedAt = new Date();
    const bytes = await admissionFormPdf(
      await admissionRecord(tx, app, saved, app.currentVersion, generatedAt),
    );
    const [form] = await tx
      .insert(opsApplicationForms)
      .values({
        applicationId: app.id,
        version: app.currentVersion,
        templateVersion: FORM_TEMPLATE_VERSION,
        pdfSha256: sha256(bytes),
        generatedBy: actor.id,
        generatedAt,
      })
      .returning();
    await setStatus(
      tx,
      actor,
      app,
      statusAfter(app.status, 'generate_form'),
      'application.form_generated',
      { formId: form!.id, pdfSha256: form!.pdfSha256, templateVersion: FORM_TEMPLATE_VERSION },
      requestId,
    );
    return { bytes, filename: `admission-form-${app.reference}-v${app.currentVersion}.pdf` };
  });
}

/**
 * POST /applications/{id}/signatures — a staff member confirms that the required people signed
 * the printed form of the CURRENT version (signers per setting, by age on the signing day).
 */
export async function confirmSignatures(
  db: Database,
  actor: Actor,
  id: string,
  input: {
    version: number;
    formId: string;
    signedOn: string;
    studentSigned: boolean;
    guardianSigned: boolean;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'confirm_signatures', input.version);
    const [form] = await tx
      .select()
      .from(opsApplicationForms)
      .where(
        and(
          eq(opsApplicationForms.id, input.formId as never),
          eq(opsApplicationForms.applicationId, app.id),
        ),
      );
    if (!form) throw fieldError('formId', 'Unknown form for this application.');
    if (form.version !== app.currentVersion)
      throw fieldError(
        'formId',
        `That form shows version ${form.version}; print and sign version ${app.currentVersion}.`,
      );
    const today = istToday(new Date());
    if (input.signedOn > today)
      throw fieldError('signedOn', 'The signing day cannot be in the future.');
    if (input.signedOn < istToday(form.generatedAt))
      throw fieldError('signedOn', 'The form was printed after that day.');
    const { saved, stale } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        'Details changed since this form was printed. Save the application and print the new version.',
      );
    const need = requiredSigners(
      settings['admissions.signatures.required_signers'].value,
      saved.student.dateOfBirth,
      input.signedOn as never,
    );
    const guardian = saved.guardians.find((g) => g.isPrimary) ?? saved.guardians[0];
    if (need.student && !input.studentSigned)
      throw fieldError('studentSigned', 'The student must sign the form.');
    if (need.guardian && !input.guardianSigned)
      throw fieldError(
        'guardianSigned',
        'A guardian must sign the form (student under 18 or date of birth not recorded).',
      );
    if (input.guardianSigned && !guardian)
      throw fieldError('guardianSigned', 'No guardian is recorded on this version.');
    const signers = [
      ...(input.studentSigned ? [{ role: 'student' as const, name: saved.student.fullName }] : []),
      ...(input.guardianSigned && guardian
        ? [
            {
              role: 'guardian' as const,
              name: guardian.fullName,
              ...(guardian.id ? { guardianId: guardian.id } : {}),
            },
          ]
        : []),
    ];
    if (!signers.length) throw fieldError('studentSigned', 'Record who signed the form.');
    const [row] = await tx
      .insert(opsSignatureConfirmations)
      .values({
        applicationId: app.id,
        version: app.currentVersion,
        formId: form.id,
        signers,
        signedOn: input.signedOn,
        confirmedBy: actor.id,
      })
      .returning();
    await setStatus(
      tx,
      actor,
      app,
      'signatures_confirmed',
      'application.signatures_confirmed',
      { formId: form.id, signers: signers.map((s) => s.role), signedOn: input.signedOn },
      requestId,
    );
    return row!;
  });
}

/** POST /applications/{id}/withdraw — the family does not go ahead (history kept). */
export async function withdrawApplication(
  db: Database,
  actor: Actor,
  id: string,
  input: { reason: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'withdraw');
    return setStatus(
      tx,
      actor,
      app,
      'withdrawn',
      'application.withdrawn',
      { reason: input.reason },
      requestId,
    );
  });
}
