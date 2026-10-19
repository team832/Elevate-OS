import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { idempotencyKeys, type Database } from '@elevate/database';
import { ConflictError, ValidationError } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';

/** Stored responses are kept for 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequestBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}

export function validateIdempotencyKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 200 || !/^[\w.:-]+$/.test(trimmed)) {
    throw new ValidationError(
      'Idempotency-Key must be 8–200 characters of letters, digits, _ . : -',
    );
  }
  return trimmed;
}

export interface IdempotencyInput {
  /** e.g. `POST /ops/api/v1/leads` */
  scope: string;
  key: string;
  userId: UserId | null;
  requestHash: string;
  now?: Date;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Run `run` at most once per (scope, key, user). MUST be called inside a
 * transaction together with the work `run` does (defineRoute does this when a
 * route sets `idempotency`): a concurrent duplicate blocks on the unique key
 * until the first commits, then receives the stored response.
 *
 * - same key, same body, completed  → stored response (`replayed: true`)
 * - same key, different body        → CONFLICT
 * - `run` throws                    → the whole transaction (and the key) rolls back, so a retry runs again
 */
export async function withIdempotency(
  tx: Database,
  input: IdempotencyInput,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const now = input.now ?? new Date();
  const userCondition =
    input.userId === null
      ? isNull(idempotencyKeys.userId)
      : eq(idempotencyKeys.userId, input.userId);
  const match = and(
    eq(idempotencyKeys.scope, input.scope),
    eq(idempotencyKeys.key, input.key),
    userCondition,
  );

  const [existing] = await tx.select().from(idempotencyKeys).where(match).limit(1);
  if (existing && existing.expiresAt.getTime() <= now.getTime()) {
    await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, existing.id));
  }

  const inserted = await tx
    .insert(idempotencyKeys)
    .values({
      scope: input.scope,
      key: input.key,
      userId: input.userId,
      requestHash: input.requestHash,
      completed: false,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });

  if (inserted.length === 0) {
    const [stored] = await tx.select().from(idempotencyKeys).where(match).limit(1);
    if (!stored) throw new ConflictError('Idempotency-Key could not be reserved; retry.');
    if (stored.requestHash !== input.requestHash) {
      throw new ConflictError('This Idempotency-Key was already used with a different request.');
    }
    if (!stored.completed || stored.responseStatus === null) {
      throw new ConflictError('A request with this Idempotency-Key is still being processed.');
    }
    return { status: stored.responseStatus, body: stored.responseBody, replayed: true };
  }

  const id = inserted[0]!.id;
  const response = await run();
  await tx
    .update(idempotencyKeys)
    .set({
      completed: true,
      responseStatus: response.status,
      responseBody: response.body as object,
    })
    .where(eq(idempotencyKeys.id, id));
  return { ...response, replayed: false };
}
