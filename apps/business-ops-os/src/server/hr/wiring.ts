/**
 * Deactivation → access revocation (OPS-048). Registers, once at module load,
 * the handler that publishes `ops.employee.separated` v1 whenever
 * `changeEmploymentStatus(… 'separated')` or `updateStaff({ status: 'inactive' })`
 * runs the deactivation hook. The platform consumer then disables the login.
 *
 * Idempotent: a live offboarding case gives the case key (the same key the
 * separation job publishes with), otherwise the key is per staff member and last
 * working day. A staff member without an employee record cannot be published
 * (the event needs the employee code), so the hook records `not_wired`.
 *
 * Imported for its side effect by every service that can deactivate someone.
 */
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { opsEmployeeRecords, opsLifecycleCases } from '@elevate/database';
import type { IsoDate } from '../../domain/dates';
import { registerDeactivationHandler } from './employee-core';
import { publishSeparation } from './offboarding';

registerDeactivationHandler(async (tx, _actor, event) => {
  const [employee] = await tx
    .select({ endDate: opsEmployeeRecords.employmentEndDate })
    .from(opsEmployeeRecords)
    .where(eq(opsEmployeeRecords.staffId, event.staffId));
  if (!employee) return false;
  const [liveCase] = await tx
    .select({ id: opsLifecycleCases.id })
    .from(opsLifecycleCases)
    .where(
      and(
        eq(opsLifecycleCases.staffId, event.staffId),
        eq(opsLifecycleCases.kind, 'offboarding'),
        notInArray(opsLifecycleCases.status, ['completed', 'cancelled']),
      ),
    )
    .orderBy(desc(opsLifecycleCases.createdAt));
  await publishSeparation(tx, {
    staffId: event.staffId,
    lastWorkingDay: (employee.endDate ?? event.effectiveOn) as IsoDate,
    separatedAt: new Date(),
    caseId: liveCase?.id ?? null,
  });
  return true;
});
