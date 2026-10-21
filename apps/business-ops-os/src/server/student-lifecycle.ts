/**
 * Student lifecycle (owner brief §9, §11): hold, resume and exit. Every change goes through
 * the transition table (applyTransition) and is audited; an exit writes an exit record with
 * the prior batch, the fee balance at that moment and the material status. A returning
 * student is readmitted with a new application (the recommended path); reactivating the exited
 * case itself stays available as before (`ops:students:reactivate`, never by whoever recorded
 * the exit; the exit record is kept with who reactivated it). Needs `ops:students:lifecycle`.
 */
import { can } from '@elevate/authorization';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { opsAdmissions, opsApplications, opsExitRecords, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import { istToday, type AdmissionStatus } from '../domain';
import { isExitStatus, lifecycleOptions } from '../domain/student-lifecycle';
import { lockAccessible } from './admissions';
import { createApplication } from './applications';
import { accessScope, clean, programmeByCode, type Actor } from './context';
import { feeSummaryFor, studentFeePlans } from './fees';
import { fieldError, opsAudit } from './ops-common';
import { applyTransition, createAdmissionRecord } from './pipeline';
import { loadSettings } from './settings';
import type { LifecycleInput } from './students-schemas';

type Admission = typeof opsAdmissions.$inferSelect;

/**
 * Fee balance of the case at exit, in paise (> 0 owed, < 0 credit), read from the fee domain:
 * the active plan's outstanding amount, else the case's ledger summary. null = not recorded,
 * or the actor may not read fees (never 0).
 */
async function balanceAtExit(db: Database, actor: Actor, a: Admission) {
  if (!can(actor, 'ops:fees:read')) return null;
  if (a.studentId) {
    const plans = (await studentFeePlans(db, actor, a.studentId)).plans.filter(
      (p) => p.plan.admissionId === a.id && p.plan.status === 'active',
    );
    if (plans.length) return plans.reduce((n, p) => n + p.totals.outstandingPaise, 0);
  }
  return (await feeSummaryFor(db, a.id)).balancePaise;
}

/** POST /admissions/{id}/lifecycle — every change validated by the transition table and audited. */
export async function changeStudentLifecycle(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: LifecycleInput,
  requestId?: string,
) {
  const [access, settings] = await Promise.all([
    accessScope(
      db,
      actor,
      input.action === 'reactivate' ? 'ops:students:reactivate' : 'ops:students:lifecycle',
    ),
    loadSettings(db),
  ]);
  return withTransaction(db, async (tx) => {
    if (input.action === 'reactivate' || input.action === 'readmit')
      await lockStudentCases(tx, admissionId);
    const admission = await lockAccessible(tx, access, admissionId);
    const move = (to: AdmissionStatus, patch: Partial<typeof opsAdmissions.$inferInsert> = {}) =>
      applyTransition(tx, {
        admission,
        to,
        actorUserId: actor.id,
        reason: input.reason,
        context: { viaStudentLifecycle: true },
        patch,
        requestId,
        settings,
      });
    switch (input.action) {
      case 'hold':
        if (!lifecycleOptions(admission).hold)
          throw new InvalidStateTransitionError(
            'Only an enrolled student can be put on hold here; use the admission pipeline for cases still in admission.',
          );
        if (input.reviewDate < istToday(new Date()))
          throw new ValidationError('The review date cannot be in the past.', {
            details: [
              { location: 'body', path: ['reviewDate'], message: 'Choose today or a later date' },
            ],
          });
        return move('on_hold', { holdReviewDate: input.reviewDate });
      case 'resume':
        return move('enrolled', { holdReviewDate: null });
      case 'exit': {
        const codes = settings['admissions.closure_reasons'].value.codes.map((c) => c.code);
        if (input.reasonCode && !codes.includes(input.reasonCode))
          throw fieldError('reasonCode', 'Choose a reason from the configured list.');
        const balancePaise = await balanceAtExit(tx, actor, admission);
        const updated = await move(input.exitStatus, { holdReviewDate: null });
        const [record] = await tx
          .insert(opsExitRecords)
          .values({
            admissionId: admission.id,
            exitStatus: input.exitStatus,
            exitDate: input.exitDate,
            reason: input.reason,
            reasonCode: input.reasonCode ?? null,
            exitFeedback: clean(input.exitFeedback),
            guardianFeedback: clean(input.guardianFeedback),
            feeReference: clean(input.feeReference),
            priorBatchId: admission.enrolledBatchId ?? admission.intendedBatchId,
            balancePaise,
            materialStatus: input.materialStatus,
            closingNotes: clean(input.closingNotes),
            reactivationAllowed: input.reactivationAllowed,
            recordedBy: actor.id,
          })
          .returning();
        await opsAudit('admission')(
          tx,
          actor,
          admission.id,
          'student.exit_recorded',
          {
            after: {
              exitStatus: input.exitStatus,
              exitDate: input.exitDate,
              exitRecordId: record!.id,
              balancePaise,
              materialStatus: input.materialStatus,
            },
          },
          requestId,
        );
        return updated;
      }
      case 'reactivate': {
        const open = await openReadmission(tx, admission.id);
        if (open)
          throw new ConflictError(
            `A readmission is already open (${open}): continue it instead of reactivating.`,
          );
        await assertNoLiveCase(tx, admission, admission.programmeId);
        const [exit] = await tx
          .select()
          .from(opsExitRecords)
          .where(
            and(eq(opsExitRecords.admissionId, admission.id), isNull(opsExitRecords.reactivatedAt)),
          )
          .orderBy(desc(opsExitRecords.recordedAt))
          .limit(1);
        if (!exit?.reactivationAllowed)
          throw new ConflictError('The exit record of this student does not allow reactivation.');
        if (exit.recordedBy === actor.id)
          throw new ForbiddenError(
            'The person who recorded the exit cannot also approve the reactivation.',
          );
        const updated = await move('admitted', { handoffStatus: 'not_requested' });
        await tx
          .update(opsExitRecords)
          .set({ reactivatedBy: actor.id, reactivatedAt: new Date() })
          .where(eq(opsExitRecords.id, exit.id));
        return updated;
      }
      case 'readmit':
        return readmit(tx, actor, admission, input, requestId);
    }
  });
}

/** Reference of the open (not withdrawn) readmission application of a closed case, if any. */
export async function openReadmission(db: Database, oldAdmissionId: string) {
  const [open] = await db
    .select({ reference: opsApplications.reference })
    .from(opsApplications)
    .where(
      and(
        eq(opsApplications.previousAdmissionId, oldAdmissionId as Admission['id']),
        ne(opsApplications.status, 'withdrawn'),
      ),
    )
    .limit(1);
  return open?.reference ?? null;
}

/**
 * Locks every case of the case's student in id order, before the target case itself, so
 * concurrent readmit/reactivate on any of the student's cases take locks in the same order
 * (no deadlock) and serialise.
 */
async function lockStudentCases(tx: Database, admissionId: string) {
  const [target] = await tx
    .select({ studentId: opsAdmissions.studentId })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, admissionId as Admission['id']));
  if (target?.studentId)
    await tx
      .select({ id: opsAdmissions.id })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.studentId, target.studentId))
      .orderBy(asc(opsAdmissions.id))
      .for('update');
}

/** One live case per student and programme (cases locked by lockStudentCases). */
async function assertNoLiveCase(
  tx: Database,
  old: Admission,
  programmeId: Admission['programmeId'],
) {
  if (!old.studentId) return;
  const cases = await tx
    .select({
      id: opsAdmissions.id,
      code: opsAdmissions.code,
      status: opsAdmissions.status,
      programmeId: opsAdmissions.programmeId,
    })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.studentId, old.studentId)); // locked by lockStudentCases
  const live = cases.find(
    (c) =>
      c.id !== old.id &&
      c.programmeId === programmeId &&
      !isExitStatus(c.status) &&
      c.status !== 'lost',
  );
  if (live)
    throw new ConflictError(
      `${live.code} is already open for this programme: continue it instead.`,
    );
}

/**
 * A-STU-7 readmission: a new case on the SAME lead (the student's KYC is not forked) and the
 * same `core.students` identity, opened at "admission pending" with a new application (origin
 * `readmission`, `previous_admission_id`). The closed case, its number and its exit record are
 * not touched; the new case gets its own number only at final confirmation.
 */
async function readmit(
  tx: Database,
  actor: Actor,
  old: Admission,
  input: Extract<LifecycleInput, { action: 'readmit' }>,
  requestId?: string,
) {
  await accessScope(tx, actor, 'ops:admissions:write');
  if (!lifecycleOptions(old).readmit || !old.studentId)
    throw new InvalidStateTransitionError(
      'Only a student who has left (an exit status) can be readmitted.',
    );
  const open = await openReadmission(tx, old.id);
  if (open) throw new ConflictError(`A readmission is already open (${open}).`);
  const programmeId = input.programmeCode
    ? (await programmeByCode(tx, input.programmeCode)).id
    : old.programmeId;
  await assertNoLiveCase(tx, old, programmeId);
  const admission = await createAdmissionRecord(tx, {
    leadId: old.leadId,
    programmeId,
    counsellorStaffId: old.counsellorStaffId,
    createdBy: actor.id,
    requestId,
    initial: {
      status: 'admission_pending',
      reason: `Readmission after ${old.code}: ${input.reason}`,
    },
    patch: { studentId: old.studentId },
  });
  const application = await createApplication(tx, actor, {
    admission,
    studentId: old.studentId,
    origin: 'readmission',
    previousAdmissionId: old.id,
    academicYear: input.academicYear,
    requestId,
  });
  await opsAudit('admission')(
    tx,
    actor,
    old.id,
    'student.readmission_started',
    { metadata: { newAdmissionId: admission.id, applicationId: application.id } },
    requestId,
  );
  return application;
}
