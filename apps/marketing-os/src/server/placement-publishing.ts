/** Publishing a placement: through the adapter (idempotent, retried) or by hand (MKT-025). */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  isUniqueViolation,
  marketingContentAssets,
  marketingPlacements,
  marketingPublishingAttempts,
  marketingPublishingRecords,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  ValidationError,
  withTransaction,
} from '@elevate/server-kit';
import { httpUrlSchema } from '@elevate/shared-contracts';
import {
  decidePublishAttempt,
  publishingIdempotencyKey,
  validateManualPublication,
} from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import { getPublishingAdapter, type PublishResult } from './adapters/publishing';
import { getContentItem, getVersion } from './content';
import { accountOf, assertPublishable, itemTransition, lockPlacement } from './placement-checks';
import { loadPolicy } from './policy';

export const manualPublicationBody = z
  .object({
    publishedAt: z.iso.datetime({ offset: true }),
    url: httpUrlSchema.max(2000),
  })
  .strict();

const STALE_PENDING_MS = 10 * 60_000;

interface PreparedPublish {
  kind: 'publish' | 'duplicate';
  recordId: string;
  attemptNumber: number;
}

/**
 * Publish through the adapter. Idempotent per (placement, version): a repeat returns the
 * existing record (`duplicate: true`) without calling the adapter again; failures are
 * retried on the same record up to `maxAttempts`.
 */
export async function publishPlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:publish');
  const adapter = getPublishingAdapter();
  const policy = await loadPolicy(db);

  const prepared: PreparedPublish & { request: Parameters<typeof adapter.publish>[0] } =
    await withTransaction(db, async (tx) => {
      const placement = await lockPlacement(tx, placementId);
      if (!placement.contentItemId)
        throw new InvalidStateTransitionError('This legacy placement is not linked to content.');
      const item = await getContentItem(tx, placement.contentItemId);
      const account = await accountOf(tx, placement);
      const versionId = item.approvedVersionId ?? item.currentVersionId;
      const key = versionId ? publishingIdempotencyKey(placement.id, versionId) : null;
      const [existing] = key
        ? await tx
            .select()
            .from(marketingPublishingRecords)
            .where(eq(marketingPublishingRecords.idempotencyKey, key))
        : [];
      const duplicate = (r: NonNullable<typeof existing>) =>
        ({
          kind: 'duplicate',
          recordId: r.id,
          attemptNumber: r.attempts,
          request: null as never,
        }) as const;
      if (placement.status === 'published' && existing?.status === 'succeeded')
        return duplicate(existing);
      await assertPublishable(tx, placement, item);
      // shortcut: a sandbox run also answers for a later version; a real adapter must take over this record.
      const [sandboxRun] = await tx
        .select()
        .from(marketingPublishingRecords)
        .where(
          and(
            eq(marketingPublishingRecords.placementId, placement.id),
            eq(marketingPublishingRecords.isSandbox, true),
            eq(marketingPublishingRecords.status, 'succeeded'),
          ),
        );
      if (sandboxRun) return duplicate(sandboxRun);
      const stale =
        existing?.status === 'pending' &&
        Date.now() - existing.updatedAt.getTime() > STALE_PENDING_MS;
      const decision = decidePublishAttempt(
        existing
          ? {
              status: stale ? 'failed' : existing.status,
              attempts: existing.attempts,
              maxAttempts: existing.maxAttempts,
            }
          : null,
      );
      if (decision.action === 'in_progress')
        throw new ConflictError('A publish attempt for this placement is already running.');
      if (decision.action === 'exhausted') {
        throw new InvalidStateTransitionError(
          `Publishing failed ${decision.attempts} times (the maximum); record a manual publication or investigate.`,
          { details: { reason: 'MAX_ATTEMPTS' } },
        );
      }
      let recordId: string;
      let attemptNumber: number;
      if (decision.action === 'create') {
        const [rec] = await tx
          .insert(marketingPublishingRecords)
          .values({
            placementId: placement.id,
            versionId: item.approvedVersionId!,
            idempotencyKey: key!,
            adapter: adapter.name,
            status: 'pending',
            attempts: 0,
            maxAttempts: policy.publishMaxAttempts,
            isSandbox: adapter.name === 'mock',
            requestedBy: actor.id,
          })
          .returning();
        recordId = rec!.id;
        attemptNumber = 1;
      } else if (decision.action === 'retry') {
        await tx
          .update(marketingPublishingRecords)
          .set({ status: 'pending' })
          .where(eq(marketingPublishingRecords.id, existing!.id));
        recordId = existing!.id;
        attemptNumber = decision.attemptNumber;
      } else {
        return duplicate(existing!);
      }
      const version = await getVersion(tx, item.approvedVersionId!);
      const assets = await tx
        .select()
        .from(marketingContentAssets)
        .where(eq(marketingContentAssets.versionId, version.id));
      return {
        kind: 'publish',
        recordId,
        attemptNumber,
        request: {
          idempotencyKey: key!,
          placementCode: placement.code ?? placement.id,
          accountCode: account.code,
          platform: account.platform,
          title: version.title,
          body: version.body,
          assets: assets.map((a) => ({ fileName: a.fileName, externalUrl: a.externalUrl })),
          scheduledAt: placement.scheduledAt,
        },
      };
    });

  if (prepared.kind === 'duplicate') {
    const [record] = await db
      .select()
      .from(marketingPublishingRecords)
      .where(eq(marketingPublishingRecords.id, prepared.recordId as never));
    return record!.isSandbox
      ? {
          outcome: 'sandbox' as const,
          duplicate: true,
          record: record!,
          message:
            'Already run in the sandbox: nothing was posted and the placement stays scheduled. Record the publication by hand once it is live.',
        }
      : {
          outcome: 'already_published' as const,
          duplicate: true,
          record: record!,
          message: 'Already published with this version; nothing was sent again.',
        };
  }

  let result: PublishResult;
  try {
    result = await adapter.publish(prepared.request);
  } catch (error) {
    result = {
      ok: false,
      retryable: true,
      error: error instanceof Error ? error.message : 'Adapter error',
      raw: {},
    };
  }

  return withTransaction(db, async (tx) => {
    const [rec] = await tx
      .select()
      .from(marketingPublishingRecords)
      .where(eq(marketingPublishingRecords.id, prepared.recordId as never))
      .for('update');
    const ok = result.ok;
    await tx.insert(marketingPublishingAttempts).values({
      recordId: rec!.id,
      attemptNumber: prepared.attemptNumber,
      outcome: ok ? 'succeeded' : 'failed',
      response: result.raw,
      error: ok ? null : result.error,
      attemptedBy: actor.id,
    });
    const sandbox = result.ok ? result.sandbox : rec!.isSandbox;
    const [record] = await tx
      .update(marketingPublishingRecords)
      .set({
        status: ok ? 'succeeded' : 'failed',
        attempts: prepared.attemptNumber,
        isSandbox: sandbox,
        externalPostId: result.ok ? result.externalPostId : rec!.externalPostId,
        publishedUrl: result.ok && !result.sandbox ? result.url : null,
        lastResponse: result.ok ? { ...result.raw, message: result.message } : result.raw,
        lastError: result.ok ? null : result.error,
      })
      .where(eq(marketingPublishingRecords.id, rec!.id))
      .returning();
    if (result.ok) {
      const placement = await lockPlacement(tx, rec!.placementId);
      // Sandbox: nothing was posted, so placement and item stay scheduled (D-014); only the run is noted.
      await tx
        .update(marketingPlacements)
        .set(
          result.sandbox
            ? { publicationMode: 'sandbox' }
            : {
                status: 'published',
                publishedAt: new Date(),
                publishedUrl: result.url,
                publicationMode: 'adapter',
              },
        )
        .where(eq(marketingPlacements.id, placement.id));
      if (!result.sandbox)
        await itemTransition(tx, await getContentItem(tx, placement.contentItemId!), 'publish');
    }
    await auditMarketing(tx, actor, {
      action: ok
        ? sandbox
          ? 'placement.published_sandbox'
          : 'placement.published'
        : 'placement.publish_failed',
      entityType: 'placement',
      entityId: rec!.placementId,
      after: {
        recordId: rec!.id,
        attempt: prepared.attemptNumber,
        sandbox,
        error: result.ok ? null : result.error,
      },
      requestId,
    });
    return {
      outcome: ok ? (sandbox ? ('sandbox' as const) : ('published' as const)) : ('failed' as const),
      duplicate: false,
      record: record!,
      message: result.ok ? result.message : result.error,
      attemptsLeft: record!.maxAttempts - record!.attempts,
    };
  });
}

/** MKT-025: a person records a real publication with its actual time and live link. */
export async function recordManualPublication(
  db: Database,
  actor: Actor,
  placementId: string,
  input: z.output<typeof manualPublicationBody>,
  requestId?: string,
  now: Date = new Date(),
) {
  assertCan(actor, 'marketing:content:publish');
  const publishedAt = new Date(input.publishedAt);
  const problems = validateManualPublication({ publishedAt, url: input.url }, now);
  if (problems.length) throw new ValidationError(problems.join(' '), { details: { problems } });
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    if (!placement.contentItemId)
      throw new InvalidStateTransitionError('This legacy placement is not linked to content.');
    const item = await getContentItem(tx, placement.contentItemId);
    await assertPublishable(tx, placement, item);
    const [sandboxRun] = await tx
      .select()
      .from(marketingPublishingRecords)
      .where(
        and(
          eq(marketingPublishingRecords.placementId, placement.id),
          eq(marketingPublishingRecords.isSandbox, true),
          eq(marketingPublishingRecords.status, 'succeeded'),
        ),
      );
    const attempt = (sandboxRun?.attempts ?? 0) + 1;
    const manual = {
      versionId: item.approvedVersionId!,
      idempotencyKey: publishingIdempotencyKey(placement.id, item.approvedVersionId!),
      adapter: 'manual',
      status: 'succeeded',
      attempts: attempt,
      maxAttempts: attempt,
      isSandbox: false,
      publishedUrl: input.url,
      lastResponse: { recordedBy: actor.id, publishedAt: publishedAt.toISOString() },
      requestedBy: actor.id,
    } as const;
    let record;
    try {
      [record] = sandboxRun
        ? await tx
            .update(marketingPublishingRecords)
            .set(manual)
            .where(eq(marketingPublishingRecords.id, sandboxRun.id))
            .returning()
        : await tx
            .insert(marketingPublishingRecords)
            .values({ placementId: placement.id, ...manual })
            .returning();
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictError('This placement already has a publishing record for this version.');
      throw error;
    }
    await tx.insert(marketingPublishingAttempts).values({
      recordId: record!.id,
      attemptNumber: attempt,
      outcome: 'succeeded',
      response: { manual: true },
      attemptedBy: actor.id,
    });
    const [after] = await tx
      .update(marketingPlacements)
      .set({ status: 'published', publishedAt, publishedUrl: input.url, publicationMode: 'manual' })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    await itemTransition(tx, item, 'publish');
    await auditMarketing(tx, actor, {
      action: 'placement.publication_recorded',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: placement.status },
      after: { status: 'published', publishedAt, url: input.url },
      requestId,
    });
    return { placement: after!, record: record! };
  });
}
