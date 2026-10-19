/**
 * Placements, scheduling and publishing (MKT-002, MKT-008, MKT-014–MKT-017, MKT-024–MKT-026).
 */
import { and, asc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  approvals,
  isUniqueViolation,
  marketingContentAssets,
  marketingContentItems,
  marketingIdeas,
  marketingPlacements,
  marketingPublishingAttempts,
  marketingPublishingRecords,
  marketingSocialAccounts,
  type Database,
  type MarketingPlacementId,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  recordAudit,
  withTransaction,
} from '@elevate/server-kit';
import {
  PLACEMENT_VARIANTS,
  buildPlacementCode,
  calendarConflicts,
  checkPlacementScope,
  checkPublishEligibility,
  decidePublishAttempt,
  detectScheduleConflicts,
  publishingIdempotencyKey,
  transitionContent,
  validateManualPublication,
  type ScheduleCandidate,
  type ScheduleConflict,
} from '../domain';
import { assertCan, type Actor } from './access';
import { cadenceOf, getAccountByCode } from './accounts';
import { getPublishingAdapter, type PublishResult } from './adapters/publishing';
import { getContentItem, getVersion, type ContentItemRow } from './content';
import { loadPolicy } from './policy';
import { runRuleCheck } from './rules';

export type PlacementRow = typeof marketingPlacements.$inferSelect;

export const createPlacementBody = z
  .object({
    accountCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,5}$/),
    variant: z.enum(PLACEMENT_VARIANTS).nullable().optional(),
  })
  .strict();

export const scheduleBody = z.object({ publishAt: z.iso.datetime({ offset: true }) }).strict();
export const cancelBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const manualPublicationBody = z
  .object({
    publishedAt: z.iso.datetime({ offset: true }),
    url: z.url({ protocol: /^https?$/ }).max(2000),
  })
  .strict();

const STALE_PENDING_MS = 10 * 60_000;

export async function getPlacement(db: Database, id: string): Promise<PlacementRow> {
  const [row] = await db
    .select()
    .from(marketingPlacements)
    .where(eq(marketingPlacements.id, id as MarketingPlacementId));
  if (!row) throw new NotFoundError('Placement not found.');
  return row;
}

async function lockPlacement(db: Database, id: string): Promise<PlacementRow> {
  const [row] = await db
    .select()
    .from(marketingPlacements)
    .where(eq(marketingPlacements.id, id as MarketingPlacementId))
    .for('update');
  if (!row) throw new NotFoundError('Placement not found.');
  return row;
}

async function accountOf(db: Database, placement: PlacementRow) {
  const [a] = await db
    .select()
    .from(marketingSocialAccounts)
    .where(eq(marketingSocialAccounts.id, placement.accountId));
  if (!a) throw new NotFoundError('Account not found.');
  return a;
}

/** Valid approval = approved state family + approved version is current + core approval approved. */
export async function approvalValidity(
  db: Database,
  item: ContentItemRow,
): Promise<{ valid: boolean; reason?: string }> {
  if (!['approved', 'scheduled', 'published'].includes(item.state)) {
    return {
      valid: false,
      reason: `The content item is ${item.state.replace('_', ' ')}, not approved (AP-001).`,
    };
  }
  if (!item.approvalId || !item.approvedVersionId) {
    return {
      valid: false,
      reason: 'No approval record exists in Elevate OS for this item (legacy state only).',
    };
  }
  if (item.approvedVersionId !== item.currentVersionId) {
    return {
      valid: false,
      reason: 'The current version is not the approved one; it needs re-approval.',
    };
  }
  const [a] = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, item.approvalId));
  if (a?.status !== 'approved')
    return { valid: false, reason: 'The approval record is not in the approved state.' };
  return { valid: true };
}

async function itemTransition(
  tx: Database,
  item: ContentItemRow,
  action: 'schedule' | 'unschedule' | 'publish',
) {
  const t = transitionContent(item.state, action);
  if (!t.ok) throw new InvalidStateTransitionError(t.reason);
  if (t.to !== item.state) {
    await tx
      .update(marketingContentItems)
      .set({ state: t.to })
      .where(eq(marketingContentItems.id, item.id));
  }
  return t.to;
}

export async function createPlacement(
  db: Database,
  actor: Actor,
  itemId: string,
  input: z.output<typeof createPlacementBody>,
  requestId?: string,
) {
  assertCan(actor, 'marketing:content:write');
  return withTransaction(db, async (tx) => {
    const item = await getContentItem(tx, itemId);
    if (item.state === 'archived')
      throw new InvalidStateTransitionError('Archived content cannot be placed.');
    const [idea] = await tx.select().from(marketingIdeas).where(eq(marketingIdeas.id, item.ideaId));
    if (!idea?.code)
      throw new InvalidStateTransitionError(
        'The idea has no code (quarantined); it cannot be placed.',
      );
    const account = await getAccountByCode(tx, input.accountCode);
    if (account.status === 'later' || account.status === 'retired') {
      throw new InvalidStateTransitionError(
        `${account.code} is ${account.status}; it does not take posts yet.`,
      );
    }
    let code: string;
    try {
      code = buildPlacementCode({
        ideaCode: idea.code,
        accountCode: account.code,
        platform: account.platform,
        variant: input.variant ?? null,
      });
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid placement.');
    }
    const scope = checkPlacementScope(
      { code: idea.code, scope: idea.scope, scopePrefixes: idea.scopePrefixes },
      {
        accountCode: account.code,
        platform: account.platform,
        scope: account.scope,
        examPrefixes: account.examPrefixes,
      },
      false,
    );
    if (!scope.valid) {
      throw new ValidationError('This placement breaks the account rules (BR-MKT-4 / MKT-014).', {
        details: { errors: scope.errors, warnings: scope.warnings },
      });
    }
    try {
      const [row] = await tx
        .insert(marketingPlacements)
        .values({
          code,
          ideaId: idea.id,
          contentItemId: item.id,
          accountId: account.id,
          variant: input.variant ?? null,
          status: 'planned',
          createdBy: actor.id,
        })
        .returning();
      await recordAudit(tx, {
        actorUserId: actor.id,
        module: 'marketing',
        action: 'placement.created',
        entityType: 'placement',
        entityId: row!.id,
        after: row,
        requestId,
      });
      return { placement: row!, warnings: scope.warnings };
    } catch (error) {
      if (isUniqueViolation(error, 'placements_code_key')) {
        throw new ConflictError(
          `${code} already exists: one idea has at most one placement per account (MKT-002).`,
        );
      }
      throw error;
    }
  });
}

async function scheduledSlotsAround(tx: Database, at: Date, excludeId: string) {
  const from = new Date(at.getTime() - 8 * 86_400_000);
  const to = new Date(at.getTime() + 8 * 86_400_000);
  const rows = await tx
    .select({
      id: marketingPlacements.id,
      code: marketingPlacements.code,
      ideaId: marketingPlacements.ideaId,
      at: marketingPlacements.scheduledAt,
      groupId: marketingPlacements.placementGroupId,
      accountCode: marketingSocialAccounts.code,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(
      and(
        eq(marketingPlacements.status, 'scheduled'),
        gte(marketingPlacements.scheduledAt, from),
        lt(marketingPlacements.scheduledAt, to),
        ne(marketingPlacements.id, excludeId as MarketingPlacementId),
      ),
    );
  return rows.map((r) => ({
    placementId: r.id as string,
    placementCode: r.code,
    ideaId: r.ideaId,
    accountCode: r.accountCode,
    at: r.at!,
    groupId: r.groupId,
  }));
}

export async function schedulePlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  input: z.output<typeof scheduleBody>,
  requestId?: string,
  now: Date = new Date(),
) {
  assertCan(actor, 'marketing:schedule:manage');
  const at = new Date(input.publishAt);
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    if (placement.status !== 'planned' && placement.status !== 'scheduled') {
      throw new InvalidStateTransitionError(`A ${placement.status} placement cannot be scheduled.`);
    }
    if (!placement.contentItemId)
      throw new InvalidStateTransitionError('This legacy placement is not linked to content.');
    const item = await getContentItem(tx, placement.contentItemId);
    const account = await accountOf(tx, placement);
    const policy = await loadPolicy(tx);
    const approval = await approvalValidity(tx, item);
    const hard: ScheduleConflict[] = [];
    if (approval.valid && item.approvedVersionId) {
      const version = await getVersion(tx, item.approvedVersionId);
      const check = await runRuleCheck(tx, {
        itemId: item.id,
        format: item.format,
        version,
        accountCodes: [account.code],
      });
      for (const b of check.blocking) {
        hard.push({
          code: 'NOT_APPROVED',
          severity: 'hard',
          message: `Brand rule ${b.ruleCode} blocks this version on ${account.code}: ${b.description}`,
          accountCode: account.code,
          relatedPlacementIds: [],
        });
      }
    }
    const candidate: ScheduleCandidate = {
      placementId: placement.id,
      placementCode: placement.code,
      ideaId: placement.ideaId,
      accountCode: account.code,
      at,
      groupId: placement.placementGroupId,
      approval,
    };
    const result = detectScheduleConflicts(
      candidate,
      await scheduledSlotsAround(tx, at, placement.id),
      [cadenceOf(account)],
      { slotWindowMinutes: policy.slotWindowMinutes, staggerWarning: policy.staggerWarning },
      now,
    );
    result.hard.push(...hard);
    if (result.hard.length > 0) {
      throw new InvalidStateTransitionError('Scheduling is blocked.', {
        details: { hard: result.hard, warnings: result.warnings },
      });
    }
    const [after] = await tx
      .update(marketingPlacements)
      .set({
        status: 'scheduled',
        scheduledAt: at,
        originalPublishAt: placement.originalPublishAt ?? at,
      })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    const itemState = await itemTransition(tx, item, 'schedule');
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'marketing',
      action: placement.status === 'scheduled' ? 'placement.rescheduled' : 'placement.scheduled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: placement.status, scheduledAt: placement.scheduledAt },
      after: { status: 'scheduled', scheduledAt: at, itemState },
      requestId,
      metadata: { warnings: result.warnings.map((w) => w.code) },
    });
    return { placement: after!, warnings: result.warnings };
  });
}

async function afterPlacementLeavesSchedule(
  tx: Database,
  item: ContentItemRow,
  placementId: string,
) {
  if (item.state !== 'scheduled') return item.state;
  const others = await tx
    .select({ id: marketingPlacements.id })
    .from(marketingPlacements)
    .where(
      and(
        eq(marketingPlacements.contentItemId, item.id),
        eq(marketingPlacements.status, 'scheduled'),
        ne(marketingPlacements.id, placementId as MarketingPlacementId),
      ),
    );
  if (others.length > 0) return item.state;
  return itemTransition(tx, item, 'unschedule');
}

export async function unschedulePlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  requestId?: string,
) {
  assertCan(actor, 'marketing:schedule:manage');
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    if (placement.status !== 'scheduled')
      throw new InvalidStateTransitionError('Only scheduled placements can be unscheduled.');
    const [after] = await tx
      .update(marketingPlacements)
      .set({ status: 'planned', scheduledAt: null })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    const itemState = placement.contentItemId
      ? await afterPlacementLeavesSchedule(
          tx,
          await getContentItem(tx, placement.contentItemId),
          placement.id,
        )
      : null;
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'marketing',
      action: 'placement.unscheduled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: 'scheduled', scheduledAt: placement.scheduledAt },
      after: { status: 'planned', itemState },
      requestId,
    });
    return after!;
  });
}

export async function cancelPlacement(
  db: Database,
  actor: Actor,
  placementId: string,
  reason: string,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const placement = await lockPlacement(tx, placementId);
    assertCan(
      actor,
      placement.status === 'scheduled' ? 'marketing:schedule:manage' : 'marketing:content:write',
    );
    if (placement.status !== 'planned' && placement.status !== 'scheduled') {
      throw new InvalidStateTransitionError(`A ${placement.status} placement cannot be cancelled.`);
    }
    const [after] = await tx
      .update(marketingPlacements)
      .set({ status: 'cancelled', cancelledReason: reason, scheduledAt: null })
      .where(eq(marketingPlacements.id, placement.id))
      .returning();
    if (placement.status === 'scheduled' && placement.contentItemId) {
      await afterPlacementLeavesSchedule(
        tx,
        await getContentItem(tx, placement.contentItemId),
        placement.id,
      );
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'marketing',
      action: 'placement.cancelled',
      entityType: 'placement',
      entityId: placement.id,
      before: { status: placement.status },
      after: { status: 'cancelled', reason },
      requestId,
    });
    return after!;
  });
}

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
      if (existing?.status === 'succeeded') {
        return {
          kind: 'duplicate',
          recordId: existing.id,
          attemptNumber: existing.attempts,
          request: null as never,
        };
      }
      const approval = await approvalValidity(tx, item);
      const eligibility = checkPublishEligibility({
        placementStatus: placement.status,
        contentState: item.state,
        approvalApproved: approval.valid,
        approvedVersionId: item.approvedVersionId,
        currentVersionId: item.currentVersionId,
      });
      if (!eligibility.ok) {
        throw new InvalidStateTransitionError(eligibility.message, {
          details: { reason: eligibility.code },
        });
      }
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
        return {
          kind: 'duplicate',
          recordId: existing!.id,
          attemptNumber: existing!.attempts,
          request: null as never,
        };
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
    return {
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
      await tx
        .update(marketingPlacements)
        .set({
          status: 'published',
          publishedAt: new Date(),
          publishedUrl: result.sandbox ? null : result.url,
          publicationMode: result.sandbox ? 'sandbox' : 'adapter',
        })
        .where(eq(marketingPlacements.id, placement.id));
      await itemTransition(tx, await getContentItem(tx, placement.contentItemId!), 'publish');
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'marketing',
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
      outcome: ok ? ('published' as const) : ('failed' as const),
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
    const approval = await approvalValidity(tx, item);
    const eligibility = checkPublishEligibility({
      placementStatus: placement.status,
      contentState: item.state,
      approvalApproved: approval.valid,
      approvedVersionId: item.approvedVersionId,
      currentVersionId: item.currentVersionId,
    });
    if (!eligibility.ok)
      throw new InvalidStateTransitionError(eligibility.message, {
        details: { reason: eligibility.code },
      });
    let record;
    try {
      [record] = await tx
        .insert(marketingPublishingRecords)
        .values({
          placementId: placement.id,
          versionId: item.approvedVersionId!,
          idempotencyKey: publishingIdempotencyKey(placement.id, item.approvedVersionId!),
          adapter: 'manual',
          status: 'succeeded',
          attempts: 1,
          maxAttempts: 1,
          isSandbox: false,
          publishedUrl: input.url,
          lastResponse: { recordedBy: actor.id, publishedAt: publishedAt.toISOString() },
          requestedBy: actor.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictError('This placement already has a publishing record for this version.');
      throw error;
    }
    await tx.insert(marketingPublishingAttempts).values({
      recordId: record!.id,
      attemptNumber: 1,
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'marketing',
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

/** Calendar (MKT-017): scheduled and published placements in an IST date range, with conflicts. */
export async function listCalendar(
  db: Database,
  range: { from: Date; to: Date; accountCode?: string },
) {
  const rows = await db
    .select({
      p: marketingPlacements,
      accountCode: marketingSocialAccounts.code,
      platform: marketingSocialAccounts.platform,
      item: marketingContentItems,
    })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .leftJoin(
      marketingContentItems,
      eq(marketingContentItems.id, marketingPlacements.contentItemId),
    )
    .where(
      and(
        inArray(marketingPlacements.status, ['scheduled', 'published']),
        or(
          and(
            gte(marketingPlacements.scheduledAt, range.from),
            lt(marketingPlacements.scheduledAt, range.to),
          ),
          and(
            gte(marketingPlacements.publishedAt, range.from),
            lt(marketingPlacements.publishedAt, range.to),
          ),
        ),
        range.accountCode ? eq(marketingSocialAccounts.code, range.accountCode) : undefined,
      ),
    )
    .orderBy(asc(marketingPlacements.scheduledAt), asc(marketingPlacements.code));
  const accounts = await db.select().from(marketingSocialAccounts);
  const slots: ScheduleCandidate[] = [];
  for (const r of rows) {
    if (r.p.status !== 'scheduled' || !r.p.scheduledAt) continue;
    slots.push({
      placementId: r.p.id,
      placementCode: r.p.code,
      ideaId: r.p.ideaId,
      accountCode: r.accountCode,
      at: r.p.scheduledAt,
      groupId: r.p.placementGroupId,
      approval: r.item
        ? await approvalValidity(db, r.item)
        : { valid: false, reason: 'Not linked to content.' },
    });
  }
  const policy = await loadPolicy(db);
  const conflicts = calendarConflicts(slots, accounts.map(cadenceOf), {
    slotWindowMinutes: policy.slotWindowMinutes,
    staggerWarning: policy.staggerWarning,
  });
  return rows.map((r) => ({
    ...r.p,
    accountCode: r.accountCode,
    platform: r.platform,
    contentTitle: r.item?.title ?? null,
    contentState: r.item?.state ?? null,
    conflicts: conflicts.get(r.p.id) ?? { hard: [], warnings: [] },
  }));
}

/** Placements not yet scheduled (planning board). */
export async function listPlannedPlacements(db: Database) {
  return db
    .select({ p: marketingPlacements, accountCode: marketingSocialAccounts.code })
    .from(marketingPlacements)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingPlacements.accountId),
    )
    .where(eq(marketingPlacements.status, 'planned'))
    .orderBy(asc(marketingPlacements.originalPublishAt), asc(marketingPlacements.code));
}
