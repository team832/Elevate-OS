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
import { applicationActionBlocked } from '../domain/applications';
import { lockAccessible } from './admissions';
import { confirmationCheck, gapSettings } from './applications';
import { accessScope, type Actor } from './context';
import { assignAdmissionNumber } from './conversion';
import { publishEnrolmentRequest } from './enrolment';
import { opsAudit, rowById } from './ops-common';
import { applyTransition, lockAdmission } from './pipeline';
import { loadSettings } from './settings';

export {
  academicSetupLabel,
  acknowledgementDocument,
  admissionConfirmation,
  idCardDocument,
} from './applications-confirm-documents';

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
