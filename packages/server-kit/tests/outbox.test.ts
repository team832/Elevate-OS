import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { eventDeliveries, integrationEvents, programmes } from '@elevate/database';
import { enrolmentKeys, type EventPayload } from '@elevate/shared-contracts';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  ValidationError,
  getDelivery,
  processEvents,
  publishEvent,
  withTransaction,
} from '../src/index';

const ctx = setupTestDatabase();

const ADMISSION = '0b6f8f2e-3c1a-4f7e-9b2d-1a2b3c4d5e6f';
const LEAD = '1c7a9e3f-4d2b-4a8f-8c3e-2b3c4d5e6f70';
const STAFF = '2d8b0f40-5e3c-4b90-9d4f-3c4d5e6f7081';

async function requestPayload(
  attempt = 1,
): Promise<EventPayload<'ops.admission.enrolment_requested', 1>> {
  const counsellor = await createTestUser(ctx.db, { roles: ['admissions_counsellor'] });
  return {
    admissionId: ADMISSION,
    leadId: LEAD,
    attempt,
    programmeCode: 'CLAT',
    student: { fullName: 'Asha Example (fictional)', phone: '+919800000001' },
    counsellorStaffId: STAFF,
    requestedByUserId: counsellor.id,
  } as EventPayload<'ops.admission.enrolment_requested', 1>;
}

describe('publishEvent', () => {
  it('stores one event per (producer, idempotencyKey) and validates payloads', async () => {
    const payload = await requestPayload();
    const key = enrolmentKeys.request(ADMISSION, 1);
    const a = await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'ops.admission.enrolment_requested',
        version: 1,
        idempotencyKey: key,
        payload,
      }),
    );
    const b = await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'ops.admission.enrolment_requested',
        version: 1,
        idempotencyKey: key,
        payload,
      }),
    );
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const [row] = await ctx.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.id, a.id));
    expect(row).toMatchObject({
      producer: 'ops',
      type: 'ops.admission.enrolment_requested',
      version: 1,
    });

    await expect(
      publishEvent(ctx.db, {
        type: 'ops.admission.enrolment_requested',
        version: 1,
        idempotencyKey: 'bad-1',
        payload: { ...payload, programmeCode: 'lower' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rolls back with the producer transaction', async () => {
    const payload = await requestPayload(9);
    await expect(
      withTransaction(ctx.db, async (tx) => {
        await publishEvent(tx, {
          type: 'ops.admission.enrolment_requested',
          version: 1,
          idempotencyKey: 'rollback-1',
          payload,
        });
        throw new Error('producer failed after publishing');
      }),
    ).rejects.toThrow('producer failed');
    expect(
      await ctx.db
        .select()
        .from(integrationEvents)
        .where(eq(integrationEvents.idempotencyKey, 'rollback-1')),
    ).toHaveLength(0);
  });
});

describe('processEvents (idempotent consumer)', () => {
  it('processing the same event twice has exactly one effect', async () => {
    const payload = await requestPayload(2);
    const { id } = await publishEvent(ctx.db, {
      type: 'ops.admission.enrolment_requested',
      version: 1,
      idempotencyKey: enrolmentKeys.request(ADMISSION, 2),
      payload,
    });
    let calls = 0;
    const consumer = {
      consumer: 'test.enrolment-intake',
      handlers: {
        'ops.admission.enrolment_requested': async (
          event: { id: string; payload: EventPayload<'ops.admission.enrolment_requested', 1> },
          { db }: { db: typeof ctx.db },
        ) => {
          calls += 1;
          // The "effect": one row written in the consumer's transaction.
          await db
            .insert(programmes)
            .values({ code: `EFFECT_${event.payload.attempt}`, name: event.id });
        },
      },
    };
    const first = await processEvents(ctx.db, consumer);
    const second = await processEvents(ctx.db, consumer);
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect(second.processed).toBe(0);
    expect(calls).toBe(first.processed);
    expect(
      await ctx.db.select().from(programmes).where(eq(programmes.code, 'EFFECT_2')),
    ).toHaveLength(1);
    expect(await getDelivery(ctx.db, id, 'test.enrolment-intake')).toMatchObject({
      status: 'processed',
      attempts: 1,
    });

    // A second, independent consumer still receives the event once.
    let otherCalls = 0;
    await processEvents(ctx.db, {
      consumer: 'test.other',
      types: ['ops.admission.enrolment_requested'],
      handler: async () => void (otherCalls += 1),
    });
    await processEvents(ctx.db, {
      consumer: 'test.other',
      types: ['ops.admission.enrolment_requested'],
      handler: async () => void (otherCalls += 1),
    });
    expect(otherCalls).toBe(first.processed);
  });

  it('a failing handler rolls back its effects, is retried, and goes dead after maxAttempts', async () => {
    const payload = await requestPayload(3);
    const { id } = await publishEvent(ctx.db, {
      type: 'ops.admission.enrolment_requested',
      version: 1,
      idempotencyKey: enrolmentKeys.request(ADMISSION, 3),
      payload,
    });
    let attempts = 0;
    const flaky = {
      consumer: 'test.flaky',
      maxAttempts: 3,
      types: ['ops.admission.enrolment_requested'] as const,
      handler: async (event: { id: string }, { db }: { db: typeof ctx.db }) => {
        if (event.id !== id) return;
        attempts += 1;
        await db
          .insert(programmes)
          .values({ code: `PARTIAL_${attempts}`, name: 'should roll back' });
        throw new Error(`boom ${attempts}`);
      },
    };
    await processEvents(ctx.db, flaky);
    expect(await getDelivery(ctx.db, id, 'test.flaky')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'boom 1',
    });
    await processEvents(ctx.db, flaky);
    await processEvents(ctx.db, flaky);
    expect(await getDelivery(ctx.db, id, 'test.flaky')).toMatchObject({
      status: 'dead',
      attempts: 3,
    });
    await processEvents(ctx.db, flaky);
    expect(attempts).toBe(3);
    const partial = await ctx.db
      .select()
      .from(programmes)
      .where(sql`${programmes.code} LIKE 'PARTIAL_%'`);
    expect(partial).toHaveLength(0);
    expect(
      (
        await ctx.db
          .select()
          .from(eventDeliveries)
          .where(eq(eventDeliveries.consumer, 'test.flaky'))
      ).length,
    ).toBeGreaterThan(0);
  });
});
