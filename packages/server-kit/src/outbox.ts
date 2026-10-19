import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { createLogger, type Logger } from '@elevate/configuration';
import { eventDeliveries, integrationEvents, type Database } from '@elevate/database';
import {
  ConflictError,
  ValidationError,
  getEventDefinition,
  type EventEnvelope,
  type EventPayload,
  type EventType,
  type EventVersion,
  type IntegrationEvent,
} from '@elevate/shared-contracts';
import type { IntegrationEventId, ModuleKey } from '@elevate/shared-types';
import { zodIssues } from './errors';

/**
 * Transactional outbox (D-011.1).
 *
 * PRODUCER — inside the transaction that changes your own state:
 *   await publishEvent(tx, {
 *     type: 'ops.admission.enrolment_requested', version: 1,
 *     idempotencyKey: enrolmentKeys.request(admission.id, 1),
 *     payload: { ... },
 *   });
 * The event exists if and only if your change committed. Publishing again
 * with the same (producer, idempotencyKey) returns the existing event.
 *
 * CONSUMER — a worker/cron/route calls:
 *   await processEvents(db, {
 *     consumer: 'academic.enrolment-intake',
 *     handlers: { 'ops.admission.enrolment_requested': async (event, { db }) => { ... } },
 *   });
 * Each event is handled in its own transaction together with a
 * `core.event_deliveries` row (unique per event+consumer), so processing the
 * same event twice has exactly one effect. Failed handlers roll back, are
 * recorded as `failed` with the error, and are retried on the next run until
 * `maxAttempts`, after which the delivery is `dead` (needs a human).
 */

export interface PublishEventInput<T extends EventType, V extends EventVersion<T>> {
  type: T;
  version: V;
  idempotencyKey: string;
  payload: EventPayload<T, V>;
  correlationId?: string | null;
  causationId?: string | null;
  occurredAt?: Date;
}

export async function publishEvent<T extends EventType, V extends EventVersion<T>>(
  tx: Database,
  input: PublishEventInput<T, V>,
): Promise<{ id: IntegrationEventId; created: boolean }> {
  const definition = getEventDefinition(input.type, input.version);
  const parsed = definition.payload.safeParse(input.payload);
  if (!parsed.success) {
    throw new ValidationError(`Payload does not match ${input.type} v${input.version}.`, {
      details: zodIssues(parsed.error, 'body'),
    });
  }
  const [row] = await tx
    .insert(integrationEvents)
    .values({
      type: input.type,
      version: input.version,
      producer: definition.producer,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt ?? new Date(),
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      // Store what the producer sent (validated), not transformed output.
      payload: input.payload as object,
    })
    .onConflictDoNothing({ target: [integrationEvents.producer, integrationEvents.idempotencyKey] })
    .returning({ id: integrationEvents.id });
  if (row) return { id: row.id, created: true };

  const [existing] = await tx
    .select({ id: integrationEvents.id, type: integrationEvents.type })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.producer, definition.producer),
        eq(integrationEvents.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) throw new ConflictError('Event could not be stored; retry.');
  if (existing.type !== input.type) {
    throw new ConflictError(
      `Idempotency key "${input.idempotencyKey}" is already used by a ${existing.type} event.`,
    );
  }
  return { id: existing.id, created: false };
}

export interface ConsumerContext {
  /** Transaction shared with the delivery record — write your effects through it. */
  db: Database;
  log: Logger;
}

type HandlerMap = {
  [T in EventType]?: (event: IntegrationEvent<T>, ctx: ConsumerContext) => Promise<void>;
};

export type ConsumerSpec =
  | {
      /** Stable consumer name, e.g. `academic.enrolment-intake`. Changing it re-processes everything. */
      consumer: string;
      handlers: HandlerMap;
      batchSize?: number;
      maxAttempts?: number;
    }
  | {
      consumer: string;
      types: readonly EventType[];
      handler: (event: EventEnvelope, ctx: ConsumerContext) => Promise<void>;
      batchSize?: number;
      maxAttempts?: number;
    };

export interface ProcessResult {
  processed: number;
  failed: number;
  /** Delivered by a concurrent worker between selection and processing. */
  skipped: number;
}

const outboxLog = createLogger({ component: 'outbox' });

function toEnvelope(row: typeof integrationEvents.$inferSelect): EventEnvelope {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString() as EventEnvelope['occurredAt'],
    producer: row.producer as ModuleKey,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    causationId: row.causationId,
    payload: row.payload,
  };
}

/** Process up to `batchSize` (default 50) undelivered events for one consumer. */
export async function processEvents(db: Database, spec: ConsumerSpec): Promise<ProcessResult> {
  const types = 'handlers' in spec ? (Object.keys(spec.handlers) as EventType[]) : [...spec.types];
  const dispatch = async (event: EventEnvelope, ctx: ConsumerContext) => {
    if ('handlers' in spec) {
      const fn = spec.handlers[event.type as EventType] as
        ((e: EventEnvelope, c: ConsumerContext) => Promise<void>) | undefined;
      if (!fn) throw new Error(`No handler for ${event.type}`);
      await fn(event, ctx);
    } else {
      await spec.handler(event, ctx);
    }
  };
  const maxAttempts = spec.maxAttempts ?? 5;
  const result: ProcessResult = { processed: 0, failed: 0, skipped: 0 };
  if (types.length === 0) return result;

  const candidates = await db
    .select()
    .from(integrationEvents)
    .where(
      and(
        inArray(integrationEvents.type, types),
        notExists(
          db
            .select({ one: sql`1` })
            .from(eventDeliveries)
            .where(
              and(
                eq(eventDeliveries.eventId, integrationEvents.id),
                eq(eventDeliveries.consumer, spec.consumer),
                inArray(eventDeliveries.status, ['processed', 'dead']),
              ),
            ),
        ),
      ),
    )
    .orderBy(
      asc(integrationEvents.occurredAt),
      asc(integrationEvents.createdAt),
      asc(integrationEvents.id),
    )
    .limit(spec.batchSize ?? 50);

  for (const row of candidates) {
    const log = outboxLog.child({
      consumer: spec.consumer,
      eventId: row.id,
      type: row.type,
      version: row.version,
    });
    try {
      const handled = await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Database;
        const now = new Date();
        // Claim the delivery. Blocks while another worker holds it; returns no row when already processed/dead.
        const claimed = await tx
          .insert(eventDeliveries)
          .values({
            eventId: row.id,
            consumer: spec.consumer,
            status: 'processed',
            attempts: 1,
            processedAt: now,
          })
          .onConflictDoUpdate({
            target: [eventDeliveries.eventId, eventDeliveries.consumer],
            set: {
              status: 'processed',
              attempts: sql`${eventDeliveries.attempts} + 1`,
              processedAt: now,
              lastError: null,
            },
            setWhere: eq(eventDeliveries.status, 'failed'),
          })
          .returning({ id: eventDeliveries.id });
        if (claimed.length === 0) return false;

        const envelope = toEnvelope(row);
        const definition = getEventDefinition(row.type, row.version);
        const parsed = definition.payload.safeParse(row.payload);
        if (!parsed.success)
          throw new Error(
            `Stored payload does not match ${row.type} v${row.version}: ${parsed.error.message}`,
          );
        await dispatch({ ...envelope, payload: parsed.data }, { db: tx, log });
        return true;
      });
      if (handled) {
        result.processed += 1;
        log.info('event processed');
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      log.error('event handler failed', { error });
      await db
        .insert(eventDeliveries)
        .values({
          eventId: row.id,
          consumer: spec.consumer,
          status: maxAttempts <= 1 ? 'dead' : 'failed',
          attempts: 1,
          lastError: message.slice(0, 2000),
        })
        .onConflictDoUpdate({
          target: [eventDeliveries.eventId, eventDeliveries.consumer],
          set: {
            attempts: sql`${eventDeliveries.attempts} + 1`,
            lastError: message.slice(0, 2000),
            status: sql`CASE WHEN ${eventDeliveries.attempts} + 1 >= ${maxAttempts} THEN 'dead' ELSE 'failed' END`,
          },
          setWhere: sql`${eventDeliveries.status} <> 'processed'`,
        });
    }
  }
  return result;
}

/** Delivery state of one event for one consumer (for status screens and tests). */
export async function getDelivery(db: Database, eventId: IntegrationEventId, consumer: string) {
  const [row] = await db
    .select()
    .from(eventDeliveries)
    .where(and(eq(eventDeliveries.eventId, eventId), eq(eventDeliveries.consumer, consumer)));
  return row;
}
