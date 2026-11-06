/**
 * "42" typed by hand and "042" from the counter are one admission number (C1-6, D-037, D-040):
 * neither direction gives two students the same number. Fictional data only.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { opsAdmissionNumberCounters, opsAdmissions } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { callRoute, setupTestDatabase } from '@elevate/testing';
import { POST as overrideNumber } from '../../src/app/api/v1/admissions/[id]/admission-number/route';
import { SETTING_DEFINITIONS } from '../../src/domain';
import { assignAdmissionNumber } from '../../src/server/conversion';
import { post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const FORMAT = SETTING_DEFINITIONS['admissions.number.format'].defaultValue;
let manager: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
});

/** A case holding `number` as stored text; null = a legacy case without a number. */
async function caseWith(number: string | null) {
  const a = await caseOf(ctx.db, manager.id, null, 'admitted');
  await ctx.db
    .update(opsAdmissions)
    .set({ admissionNumber: number, legacyVerification: number ? null : 'required' })
    .where(eq(opsAdmissions.id, a.id));
  return { ...a, admissionNumber: number };
}
const override = (id: string, admissionNumber: string) =>
  callRoute<{ admissionNumber: string }>(
    overrideNumber,
    post(manager, { admissionNumber, reason: 'Number on the paper form (test)' }),
    { id },
  );
const counterAt = (nextValue: number) =>
  ctx.db
    .insert(opsAdmissionNumberCounters)
    .values({ scopeKey: 'all', nextValue })
    .onConflictDoUpdate({ target: opsAdmissionNumberCounters.scopeKey, set: { nextValue } });
const autoNumber = async () => {
  const a = await caseWith(null);
  return withTransaction(ctx.db, (tx) => assignAdmissionNumber(tx, manager, a, FORMAT));
};

// caseOf stores 001, 002 … for its own cases, so the numbers here stay well above that.
describe('one admission number, however it is written (C1-6)', () => {
  it.each([
    ['42', '042'],
    ['0043', '043'],
  ])('"%s" by hand when the counter gave %s → 409', async (typed, given) => {
    await caseWith(given);
    expect((await override((await caseWith(null)).id, typed)).status).toBe(409);
  });

  it('a hand-typed "77" is stored as 077, and the counter then skips it', async () => {
    const res = await override((await caseWith(null)).id, '77');
    expect(res.data?.admissionNumber).toBe('077');
    await counterAt(77);
    expect(await autoNumber()).toBe('078');
  });

  it('a legacy "50" stored unpadded is skipped by the counter at 50', async () => {
    await caseWith('50');
    await counterAt(50);
    expect(await autoNumber()).toBe('051');
  });

  it('numbers with letters are compared as written', async () => {
    await caseWith('MAN-42');
    const res = await override((await caseWith(null)).id, 'MAN-042');
    expect(res.data?.admissionNumber).toBe('MAN-042');
  });
});
