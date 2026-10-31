import { expect, it } from 'vitest';
import { admissionRecord } from '../../src/server/application-record';

it('asks one question at a time: it runs on a transaction, whose one pg client must not overlap (CHK-024)', async () => {
  let active = 0;
  let most = 0;
  const query: unknown = new Proxy(() => query, {
    get: (_t, key) =>
      key === 'then'
        ? (done: (rows: unknown[]) => void) => {
            most = Math.max(most, ++active);
            setTimeout(() => {
              active -= 1;
              done([]);
            });
          }
        : () => query,
  });
  await admissionRecord(
    query as never,
    { id: 'a', studentId: 's', admissionId: 'c', reference: 'R' } as never,
    { feeAgreement: { planId: 'p' } } as never,
    1,
    new Date('2026-10-30T00:00:00Z'),
  ).catch(() => undefined); // only the query order matters here, not the empty fee summary
  expect(most).toBe(1);
});
