/**
 * Final admission confirmation (owner brief §6 "password-confirmed final approval", §7, D-040,
 * D-041) and the documents that need it: acknowledgement and ID card; plus the audited
 * reconciliation of legacy admissions (brief §14).
 *
 * confirmAdmission, ONE transaction: lock the application and its case → if an approval exists,
 * replay it (retries and concurrent clicks give one approval) → re-validate everything on the
 * server (version = current, live content = the signed version, signatures, KYC, documents,
 * declarations, fee agreement, payment gate) → re-check the approver's password (D-041; on
 * failure only an audit row without secrets is kept) → number from the locked counter, written
 * to the admission first → approval row with the accepted snapshot → admitted (bundle too) →
 * application confirmed → enrolment requested from Academic OS (outbox) → audit.
 *
 * Not `defineRoute({ idempotency })`: its stored request hash would be an unsalted SHA-256 of a
 * body holding the password, and its rollback would drop the failed-attempt audit. The approval
 * row (unique per admission) is the idempotency key instead.
 */
import { and, eq } from 'drizzle-orm';
import { verifyCurrentUserPassword } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import {
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplications,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  RateLimitedError,
} from '@elevate/shared-contracts';
import type { AdmissionId } from '@elevate/shared-types';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../domain';
import { applicationActionBlocked, type ApplicationSnapshot } from '../domain/applications';
import { isExitStatus } from '../domain/student-lifecycle';
import { deriveHandoffView } from '../domain/students';
import {
  academicDeliveryOf,
  admissionRow,
  assertAdmissionAccess,
  handoffInputOf,
  lockAccessible,
  namesOf,
} from './admissions';
import { confirmationCheck, gapSettings } from './applications';
import { applicationOfAdmission } from './applications-read';
import { accessScope, type Actor } from './context';
import { assignAdmissionNumber } from './conversion';
import { publishEnrolmentRequest } from './enrolment';
import { admissionRecord } from './application-record';
import { opsAudit, rowById } from './ops-common';
import { acknowledgementPdf, idCardPdf } from './pdf/admission-documents';
import { pdfResponse } from './pdf/document';
import { applyTransition, lockAdmission } from './pipeline';
import { loadSettings } from './settings';

const audit = opsAudit('application');
const OWNER_DECISION =
  'Your account signs in with Google only and has no password, so it cannot confirm admissions. Owner decision open: Google re-authentication for admission confirmation. Until it is decided, an approver needs an account with a password.';

type Approval = typeof opsAdmissionApprovals.$inferSelect;
const result = (a: Approval, replayed: boolean) => ({
  applicationId: a.applicationId,
  admissionId: a.admissionId,
  admissionNumber: a.admissionNumber,
  applicationVersion: a.applicationVersion,
  approvedAt: a.approvedAt,
  replayed,
});

/** POST /applications/{id}/confirm — see the file comment. Throws on every refusal. */
export async function confirmAdmission(
  db: Database,
  actor: Actor,
  applicationId: string,
  input: { password: string; applicationVersion: number },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:confirm');
  const settings = await loadSettings(db);
  const outcome = await withTransaction(db, async (tx) => {
    // The application row lock serialises concurrent confirmations; the later one replays.
    const app = await rowById(tx, opsApplications, applicationId, 'Application', true);
    const admission = await lockAccessible(tx, access, app.admissionId);
    // The approver's own password, re-checked on the server (never logged, stored or returned).
    // A failure keeps only an audit row with the reason (the caller's transaction commits it).
    const reauthorise = async () => {
      const r = await verifyCurrentUserPassword(tx, actor.id, input.password);
      if (!r.ok)
        await audit(
          tx,
          actor,
          app.id,
          'admission.confirm_failed',
          {
            metadata: {
              reason: r.reason,
              applicationVersion: app.currentVersion,
              admissionId: admission.id,
            },
          },
          requestId,
        );
      return r;
    };
    const [done] = await tx
      .select()
      .from(opsAdmissionApprovals)
      .where(eq(opsAdmissionApprovals.applicationId, app.id));
    if (done) {
      // A replay (retry, double click) only for the same approver and version, after the password.
      if (done.applicationVersion !== input.applicationVersion || done.approvedBy !== actor.id)
        throw new ConflictError(
          'This admission was already confirmed by another approver or on another version.',
        );
      const again = await reauthorise();
      return again.ok ? result(done, true) : { failed: again };
    }
    const blocked = applicationActionBlocked(app.status, 'confirm_admission');
    if (blocked) throw new InvalidStateTransitionError(blocked);
    if (input.applicationVersion !== app.currentVersion)
      throw new ConflictError(
        `You reviewed version ${input.applicationVersion}; the application is now version ${app.currentVersion}. Reload and review it again.`,
        { details: { code: 'STALE_VERSION', currentVersion: app.currentVersion } },
      );
    if (admission.status !== 'admission_pending')
      throw new InvalidStateTransitionError(
        `The admission case is "${admission.status}"; only a pending admission can be confirmed.`,
      );
    const check = await confirmationCheck(tx, app, admission, settings);
    if (check.gaps.length)
      throw new InvalidStateTransitionError('This admission cannot be confirmed yet.', {
        details: { missing: check.gaps },
      });

    const reauth = await reauthorise();
    if (!reauth.ok) return { failed: reauth };

    // A legacy case keeps the number it already has (never renumbered, D-040), whether or not
    // its paper evidence was reconciled first.
    const legacyNumber = admission.legacyVerification ? admission.admissionNumber : null;
    const admissionNumber =
      legacyNumber ??
      (await assignAdmissionNumber(
        tx,
        actor,
        admission,
        settings['admissions.number.format'].value,
        requestId,
      ));
    if (admission.legacyVerification === 'required') {
      await tx
        .update(opsAdmissions)
        .set({
          legacyVerification: 'verified',
          legacyVerifiedBy: actor.id,
          legacyVerifiedAt: new Date(),
        })
        .where(eq(opsAdmissions.id, admission.id));
      await opsAudit('admission')(
        tx,
        actor,
        admission.id,
        'admission.legacy_verified',
        {
          before: { legacyVerification: 'required' },
          after: { legacyVerification: 'verified' },
          metadata: { via: 'final_confirmation', applicationId: app.id },
        },
        requestId,
      );
    }
    const accepted = {
      application: check.saved,
      version: app.currentVersion,
      contentHash: check.current.contentHash,
      signature: check.signature,
      paymentGate: settings['admission.payment_gate'].value.rule,
      paid: check.paid,
      gapSettings: gapSettings(settings),
    };
    const [approval] = await tx
      .insert(opsAdmissionApprovals)
      .values({
        admissionId: admission.id,
        applicationId: app.id,
        applicationVersion: app.currentVersion,
        approvedBy: actor.id,
        reauthMethod: reauth.method,
        reauthVerifiedAt: reauth.verifiedAt,
        acceptedSnapshot: accepted as never,
        admissionNumber,
      })
      .returning();

    // The case and the bundle's other programme cases: admitted, then handed to Academic OS.
    const bundleIds = check.saved.programmes.map((p) => p.admissionId as AdmissionId);
    for (const id of [admission.id, ...bundleIds.filter((b) => b !== admission.id)]) {
      const row =
        id === admission.id ? { ...admission, admissionNumber } : await lockAdmission(tx, id);
      // The gap check refused non-pending cases; nothing is skipped silently.
      if (row?.status !== 'admission_pending')
        throw new InvalidStateTransitionError(`Programme case ${id} is not pending.`);
      const admitted = await applyTransition(tx, {
        admission: row,
        to: 'admitted',
        actorUserId: actor.id,
        reason: `Admission confirmed (${app.reference} v${app.currentVersion}, number ${admissionNumber})`,
        context: { readinessMissing: [] },
        requestId,
        settings,
      });
      await publishEnrolmentRequest(tx, actor, admitted, { requestId, settings });
    }
    await tx
      .update(opsApplications)
      .set({ status: 'admission_confirmed', updatedAt: new Date() })
      .where(eq(opsApplications.id, app.id));
    await audit(
      tx,
      actor,
      app.id,
      'admission.confirmed',
      {
        before: { status: app.status },
        after: { status: 'admission_confirmed', admissionNumber },
        metadata: {
          admissionId: admission.id,
          applicationVersion: app.currentVersion,
          reauthMethod: reauth.method,
          bundle: bundleIds,
          legacyNumberKept: Boolean(legacyNumber),
        },
      },
      requestId,
    );
    return result(approval!, false);
  });
  if (!('failed' in outcome)) return outcome;
  const f = outcome.failed;
  if (f.reason === 'locked')
    throw new RateLimitedError('Too many wrong passwords. Try again later.', {
      details: { retryAfterSeconds: Math.ceil((f.retryAfterMs ?? 0) / 1000) },
    });
  if (f.reason === 'no_password')
    throw new ForbiddenError(OWNER_DECISION, { details: { reason: f.reason } });
  if (f.reason === 'inactive')
    throw new ForbiddenError('Your account cannot confirm admissions.', {
      details: { reason: f.reason },
    });
  throw new ForbiddenError('The password is not correct. Nothing was confirmed.', {
    details: [{ location: 'body', path: ['password'], message: 'The password is not correct.' }],
  });
}

// --- after confirmation ------------------------------------------------------------------------------

/** "Admission confirmed — academic setup pending" until Academic OS confirms the enrolment. */
export function academicSetupLabel(status: AdmissionStatus, handoffLabel: string) {
  if (status === 'enrolled') return 'Enrolled — Academic OS confirmed the setup';
  if (isExitStatus(status) || status === 'on_hold')
    return `Admission confirmed — now ${ADMISSION_STATUS_LABELS[status]}`;
  return `Admission confirmed — academic setup pending (${handoffLabel})`;
}

/** The approval of an admission case with its accepted snapshot, scope-checked; 409 before confirmation. */
async function confirmedAdmission(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, admissionId);
  await assertAdmissionAccess(db, access, admission);
  const [approval] = await db
    .select()
    .from(opsAdmissionApprovals)
    .where(eq(opsAdmissionApprovals.admissionId, admission.id));
  if (!approval)
    throw new InvalidStateTransitionError(
      'This admission has no final approval of its own (not confirmed yet, or an extra programme case of a bundle: open the primary admission). No acknowledgement or ID card exists for it.',
    );
  const accepted = approval.acceptedSnapshot as {
    application: ApplicationSnapshot;
    signature: { signedOn: string; signers: { role: string; name: string }[] } | null;
  };
  return { admission, approval, accepted };
}

/** GET /admissions/{id}/acknowledgement — final number + the signed version kept on record. */
export async function acknowledgementDocument(db: Database, actor: Actor, admissionId: string) {
  const { admission, approval, accepted } = await confirmedAdmission(db, actor, admissionId);
  const [delivery, [app]] = await Promise.all([
    academicDeliveryOf(db, admission.lastRequestEventId),
    db.select().from(opsApplications).where(eq(opsApplications.id, approval.applicationId)),
  ]);
  const record = await admissionRecord(
    db,
    app!,
    accepted.application,
    approval.applicationVersion,
    new Date(),
  );
  const bytes = await acknowledgementPdf({
    record: { ...record, admission: record.admission! },
    approvedAt: approval.approvedAt,
    signedOn: accepted.signature?.signedOn ?? null,
    // Signer names are KYC: roles only without ops:student_private:read.
    signers:
      accepted.signature?.signers.map((s) =>
        can(actor, 'ops:student_private:read') ? `${s.name} (${s.role})` : s.role,
      ) ?? [],
    academicSetup: academicSetupLabel(
      admission.status,
      deriveHandoffView(handoffInputOf(admission, delivery)).label,
    ),
    showFees: can(actor, 'ops:fees:read'),
  });
  return pdfResponse(bytes, `admission-acknowledgement-${approval.admissionNumber}.pdf`);
}

/** GET /admissions/{id}/id-card — CR80 card: name, number, programme, academic year. */
export async function idCardDocument(db: Database, actor: Actor, admissionId: string) {
  const { approval, accepted } = await confirmedAdmission(db, actor, admissionId);
  const s = accepted.application;
  const bytes = await idCardPdf({
    fullName: s.student.fullName,
    admissionNumber: approval.admissionNumber,
    programmes: s.programmes.map((p) => p.name).join(' + '),
    academicYear: s.academicYear,
  });
  return pdfResponse(bytes, `id-card-${approval.admissionNumber}.pdf`);
}

/** The confirmation facts shown on the admission page. */
export async function admissionConfirmation(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, admissionId);
  await assertAdmissionAccess(db, access, admission);
  const [application, [approval], delivery] = await Promise.all([
    applicationOfAdmission(db, admission),
    db
      .select()
      .from(opsAdmissionApprovals)
      .where(eq(opsAdmissionApprovals.admissionId, admission.id)),
    academicDeliveryOf(db, admission.lastRequestEventId),
  ]);
  const names = await namesOf(db, [approval?.approvedBy ?? null, admission.legacyVerifiedBy]);
  return {
    application: application && {
      id: application.id,
      reference: application.reference,
      status: application.status,
      version: application.currentVersion,
    },
    approval: approval && {
      admissionNumber: approval.admissionNumber,
      approvedAt: approval.approvedAt,
      approvedByName: names.get(approval.approvedBy) ?? null,
      applicationVersion: approval.applicationVersion,
      reauthMethod: approval.reauthMethod,
      reauthVerifiedAt: approval.reauthVerifiedAt,
    },
    academicSetup:
      approval || application?.status === 'admission_confirmed'
        ? academicSetupLabel(
            admission.status,
            deriveHandoffView(handoffInputOf(admission, delivery)).label,
          )
        : null,
    legacy: admission.legacyVerification && {
      state: admission.legacyVerification,
      verifiedByName: names.get(admission.legacyVerifiedBy ?? '') ?? null,
      verifiedAt: admission.legacyVerifiedAt,
    },
    legacyNumber: approval ? null : admission.admissionNumber,
    /** An extra programme case: its bundle's number (on the primary case), once confirmed. */
    bundleNumber:
      !approval && application && application.admissionId !== admission.id
        ? ((
            await db
              .select({ n: opsAdmissionApprovals.admissionNumber })
              .from(opsAdmissionApprovals)
              .where(eq(opsAdmissionApprovals.applicationId, application.id))
          )[0]?.n ?? null)
        : null,
    canReconcile: can(actor, 'ops:admissions:confirm'),
  };
}

/**
 * POST /admissions/{id}/legacy-verification — an approver records that a legacy admission's
 * paper evidence was checked. It never creates an approval, a signed form or a payment.
 */
export async function verifyLegacyAdmission(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: { note: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:confirm');
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, admissionId);
    if (admission.legacyVerification !== 'required')
      throw new InvalidStateTransitionError(
        'This admission is not waiting for legacy verification.',
      );
    const now = new Date();
    const [after] = await tx
      .update(opsAdmissions)
      .set({ legacyVerification: 'verified', legacyVerifiedBy: actor.id, legacyVerifiedAt: now })
      .where(
        and(eq(opsAdmissions.id, admission.id), eq(opsAdmissions.legacyVerification, 'required')),
      )
      .returning();
    await opsAudit('admission')(
      tx,
      actor,
      admission.id,
      'admission.legacy_verified',
      {
        before: { legacyVerification: 'required' },
        after: { legacyVerification: 'verified', at: now.toISOString() },
        metadata: { note: input.note },
      },
      requestId,
    );
    return after!;
  });
}
