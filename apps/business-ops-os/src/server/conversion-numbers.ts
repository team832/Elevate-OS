/**
 * Admission numbers (D-037, D-040): the final confirmation's number from the locked counter, and
 * a legacy admission's number given by hand. Re-exported by conversion.ts.
 */
import { and, eq, ne } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissionNumberChanges,
  opsAdmissionNumberCounters,
  opsAdmissions,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { AdmissionId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  checkManualNumber,
  counterScopeKey,
  formatAdmissionNumber,
  type AdmissionNumberFormat,
} from '../domain/admission-numbers';
import { lockAccessible } from './admissions';
import { accessScope, type Actor } from './context';
import { fieldError, opsAudit } from './ops-common';
import type { AdmissionRow } from './pipeline';

export const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

async function numberTaken(tx: Database, value: string, exceptId?: AdmissionId) {
  const [row] = await tx
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .where(
      and(
        eq(opsAdmissions.admissionNumber, value),
        exceptId ? ne(opsAdmissions.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

const yearNow = () => Number(istToday(new Date()).slice(0, 4));

/** Take the next free automatic number: the counter row is locked FOR UPDATE until commit. */
async function takeAutoNumber(tx: Database, format: AdmissionNumberFormat): Promise<string> {
  const year = yearNow();
  const scopeKey = counterScopeKey(format, year);
  await tx.insert(opsAdmissionNumberCounters).values({ scopeKey }).onConflictDoNothing();
  const [counter] = await tx
    .select()
    .from(opsAdmissionNumberCounters)
    .where(eq(opsAdmissionNumberCounters.scopeKey, scopeKey))
    .for('update');
  let next = counter!.nextValue;
  // A legacy or hand-entered number may already use a value: skip it, never reuse.
  while (await numberTaken(tx, formatAdmissionNumber(format, next, year))) next += 1;
  await tx
    .update(opsAdmissionNumberCounters)
    .set({ nextValue: next + 1 })
    .where(eq(opsAdmissionNumberCounters.scopeKey, scopeKey));
  return formatAdmissionNumber(format, next, year);
}

/** The final confirmation's number (D-040): from the locked counter, on an admission that has none. */
export async function assignAdmissionNumber(
  tx: Database,
  actor: Actor,
  admission: Pick<AdmissionRow, 'id' | 'admissionNumber'>,
  format: AdmissionNumberFormat,
  requestId?: string,
): Promise<string> {
  if (admission.admissionNumber)
    throw new ConflictError(
      `This admission already has number ${admission.admissionNumber}; it is never changed.`,
    );
  const value = await takeAutoNumber(tx, format);
  await setAdmissionNumber(tx, actor, admission, value, 'auto', null, requestId);
  return value;
}

/** Write the number on the admission and its change row; a taken number → 409, nothing kept. */
async function setAdmissionNumber(
  tx: Database,
  actor: Actor,
  admission: Pick<AdmissionRow, 'id' | 'admissionNumber'>,
  value: string,
  kind: 'auto' | 'manual',
  reason: string | null,
  requestId?: string,
) {
  const conflict = () =>
    new ConflictError(`Admission number ${value} is already used by another admission.`, {
      details: { field: 'admissionNumber', admissionNumber: value },
    });
  if (await numberTaken(tx, value, admission.id)) throw conflict();
  try {
    await tx
      .update(opsAdmissions)
      .set({ admissionNumber: value })
      .where(eq(opsAdmissions.id, admission.id));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict();
    throw e;
  }
  await tx.insert(opsAdmissionNumberChanges).values({
    admissionId: admission.id,
    previousNumber: admission.admissionNumber,
    newNumber: value,
    kind,
    reason,
    actorUserId: actor.id,
  });
  await opsAudit('admission')(
    tx,
    actor,
    admission.id,
    kind === 'auto' ? 'admission.number_assigned' : 'admission.number_overridden',
    {
      before: { admissionNumber: admission.admissionNumber },
      after: { admissionNumber: value },
      metadata: { kind, reason },
    },
    requestId,
  );
}

function manualOrThrow(
  actor: Actor,
  number: string | null | undefined,
  reason: string | null | undefined,
) {
  const check = checkManualNumber({
    number,
    reason,
    hasPermission: can(actor, 'ops:admission_number:override'),
  });
  if (check.ok) return check;
  if (check.field === 'permission') throw new ForbiddenError(check.message);
  throw fieldError(
    check.field === 'reason' ? 'admissionNumberReason' : 'admissionNumber',
    check.message,
  );
}

/** POST /admissions/{id}/admission-number — a legacy admission without a number (permission, reason ≥ 10, logged). */
export async function overrideAdmissionNumber(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: { admissionNumber: string; reason: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admission_number:override');
  const check = manualOrThrow(actor, input.admissionNumber, input.reason);
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, admissionId);
    // D-040: a number, once given, never changes (legacy numbers included). A legacy admission
    // without one may get one by hand during reconciliation; everyone else gets it at confirmation.
    if (admission.admissionNumber)
      throw new ConflictError(
        `Admission number ${admission.admissionNumber} is fixed and cannot be changed.`,
      );
    if (admission.legacyVerification !== 'required')
      throw new InvalidStateTransitionError(
        'Admission numbers are given at final confirmation. Only a legacy admission without a number can be given one by hand.',
      );
    await setAdmissionNumber(tx, actor, admission, check.number, 'manual', check.reason, requestId);
    return { id: admission.id, admissionNumber: check.number };
  });
}
