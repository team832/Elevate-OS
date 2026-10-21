/**
 * Marketing lead handoff intake (owner brief §10). Consumer `ops.lead-intake` of
 * `marketing.lead.handed_off` v1 (consumer-defined contract; Marketing producer not built).
 * Algorithm A-INT-1 in docs/parts/admissions-fees-intake.md.
 *
 * - Idempotent: one `ops.lead_handoff_receipts` row per Marketing lead id. The same event
 *   is delivered once (outbox); a later event for a lead already handed off only bumps
 *   `duplicate_deliveries` — never a second Ops lead.
 * - The Ops lead is created through `createLead` (normalised contacts, first enquiry with
 *   source + campaign ref = the attribution, admission case, follow-up rule, audit). Any
 *   duplicate match goes to the existing duplicate-review queue (status `duplicate_review`);
 *   nothing is merged automatically.
 * - Course interest maps to a programme code when it matches one; otherwise it is kept as
 *   the supplied text in the lead notes (owner decision 20 Oct 2026).
 * - A failure (e.g. a lead source not configured in Ops) rolls back only the lead work
 *   (savepoint) and is recorded on the receipt (`failed`, attempts, last error). The
 *   `lead-intake` job retries failed receipts; a manager can retry one by hand (audited).
 * - No system user exists: rows are created by the staff user who runs the intake (IR).
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  integrationEvents,
  opsContactPreferences,
  opsLeadHandoffReceipts,
  opsLeads,
  OPS_LEAD_HANDOFF_STATUSES,
  programmes,
  type Database,
} from '@elevate/database';
import { processEvents, withTransaction, type ProcessResult } from '@elevate/server-kit';
import {
  InvalidStateTransitionError,
  marketingLeadHandedOffV1Payload,
  type IntegrationEvent,
} from '@elevate/shared-contracts';
import type { IntegrationEventId } from '@elevate/shared-types';
import type { LeadHandoffPayload } from './adapters/marketing-intake';
import { accessScope, type Actor } from './context';
import { createLead } from './leads';
import { opsAudit, rowById } from './ops-common';
import { createLeadBody } from './schemas';

export const LEAD_INTAKE_CONSUMER = 'ops.lead-intake';
export const LEAD_HANDOFF_STATUSES = OPS_LEAD_HANDOFF_STATUSES;
export type LeadHandoffStatus = (typeof LEAD_HANDOFF_STATUSES)[number];
/** Automatic retries by the job stop after this many attempts (manual retry still works). */
const MAX_AUTO_ATTEMPTS = 5;

type Receipt = typeof opsLeadHandoffReceipts.$inferSelect;
const audit = opsAudit('lead_handoff');

async function programmeFor(tx: Database, interest: string | null) {
  const text = interest?.trim();
  if (!text) return null;
  const [row] = await tx
    .select({ code: programmes.code })
    .from(programmes)
    .where(
      sql`upper(${programmes.code}) = upper(${text}) OR lower(${programmes.name}) = lower(${text})`,
    )
    .limit(1);
  return row?.code ?? null;
}

/** Create the Ops lead (+ consent) for a handoff. Throws on any problem (caller records it). */
async function createHandedOffLead(tx: Database, actor: Actor, p: LeadHandoffPayload) {
  const programmeCode = await programmeFor(tx, p.courseInterest);
  const notes = [
    `Handed off from Marketing OS (Marketing lead ${p.marketingLeadId}).`,
    !programmeCode && p.courseInterest ? `Course interest as supplied: ${p.courseInterest}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const result = await createLead(
    tx,
    actor,
    createLeadBody.parse({
      ...p.contacts,
      programmeCode,
      sourceCode: p.source.code,
      channel: p.source.channel ?? null,
      campaignRef: p.campaign?.ref ?? null,
      receivedAt: p.capturedAt,
      notes,
      acknowledgeDuplicates: {
        reason:
          'Received from Marketing OS; possible duplicate sent to review (never merged automatically).',
      },
    }),
  );
  await tx
    .insert(opsContactPreferences)
    .values({
      leadId: result.lead.id,
      consentStatus: p.consent.status,
      consentBy: p.consent.by,
      allowedChannels: p.consent.status === 'given' ? p.consent.allowedChannels : [],
      preferredContact: p.consent.preferredContact ?? null,
      note: 'Recorded from the Marketing OS handoff.',
      recordedBy: actor.id,
    })
    .onConflictDoNothing();
  return { leadId: result.lead.id, duplicates: result.duplicates.length };
}

/** One processing attempt of a receipt; the outcome (success or failure) is written to it. */
async function attempt(
  tx: Database,
  actor: Actor,
  receipt: Receipt,
  payload: LeadHandoffPayload,
  requestId?: string,
) {
  const attempts = receipt.attempts + 1;
  const marketingLeadId = receipt.marketingLeadId;
  let outcome: Partial<Receipt> & { status: LeadHandoffStatus };
  let metadata: Record<string, unknown>;
  try {
    const r = await tx.transaction((sp) =>
      createHandedOffLead(sp as unknown as Database, actor, payload),
    );
    const status = r.duplicates ? 'duplicate_review' : 'accepted';
    outcome = { status, lastError: null, leadId: r.leadId, processedAt: new Date() };
    metadata = { leadId: r.leadId, marketingLeadId };
  } catch (error) {
    const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    outcome = { status: 'failed', lastError };
    metadata = { marketingLeadId };
  }
  const [after] = await tx
    .update(opsLeadHandoffReceipts)
    .set({ ...outcome, attempts })
    .where(eq(opsLeadHandoffReceipts.id, receipt.id))
    .returning();
  await audit(
    tx,
    actor,
    receipt.id,
    `lead_handoff.${outcome.status}`,
    { after: { ...outcome, attempts }, metadata },
    requestId,
  );
  return after!;
}

/** Outbox handler: receipt per Marketing lead; later events for a handled lead are counted only. */
async function receive(
  tx: Database,
  actor: Actor,
  event: IntegrationEvent<'marketing.lead.handed_off'>,
) {
  const p = event.payload;
  await tx
    .insert(opsLeadHandoffReceipts)
    .values({ marketingLeadId: p.marketingLeadId, eventId: event.id })
    .onConflictDoNothing();
  const [receipt] = await tx
    .select()
    .from(opsLeadHandoffReceipts)
    .where(eq(opsLeadHandoffReceipts.marketingLeadId, p.marketingLeadId))
    .for('update');
  if (!receipt) throw new Error('lead handoff receipt missing after insert');
  if (receipt.eventId !== event.id && receipt.status !== 'failed') {
    await tx
      .update(opsLeadHandoffReceipts)
      .set({ duplicateDeliveries: receipt.duplicateDeliveries + 1 })
      .where(eq(opsLeadHandoffReceipts.id, receipt.id));
    await audit(tx, actor, receipt.id, 'lead_handoff.duplicate_ignored', {
      metadata: { eventId: event.id, marketingLeadId: p.marketingLeadId, leadId: receipt.leadId },
    });
    return;
  }
  await attempt(tx, actor, { ...receipt, eventId: event.id }, p);
  if (receipt.eventId !== event.id)
    await tx
      .update(opsLeadHandoffReceipts)
      .set({ eventId: event.id })
      .where(eq(opsLeadHandoffReceipts.id, receipt.id));
}

async function payloadOf(tx: Database, eventId: IntegrationEventId) {
  const event = await rowById(tx, integrationEvents, eventId, 'Handoff event');
  return marketingLeadHandedOffV1Payload.parse(event.payload);
}

/** POST /leads/handoffs/{id}/retry — reprocess a failed handoff (audited). */
export async function retryLeadHandoff(
  db: Database,
  actor: Actor,
  receiptId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:lead_handoffs:manage');
  return withTransaction(db, async (tx) => {
    const receipt = await rowById(tx, opsLeadHandoffReceipts, receiptId, 'Lead handoff', true);
    if (receipt.status !== 'failed')
      throw new InvalidStateTransitionError(
        `Only a failed handoff can be retried (this one is ${receipt.status}).`,
      );
    await audit(
      tx,
      actor,
      receipt.id,
      'lead_handoff.retry_requested',
      {
        before: { status: receipt.status, attempts: receipt.attempts },
        metadata: { marketingLeadId: receipt.marketingLeadId },
      },
      requestId,
    );
    return attempt(tx, actor, receipt, await payloadOf(tx, receipt.eventId), requestId);
  });
}

/**
 * Job `lead-intake`: process new handoff events, then retry receipts that had already
 * failed before this run (fewer than MAX_AUTO_ATTEMPTS attempts).
 */
export async function processLeadIntake(
  db: Database,
  options: { actor: Actor; requestId?: string },
): Promise<ProcessResult & { retried: number }> {
  const { actor } = options;
  await accessScope(db, actor, 'ops:lead_handoffs:manage');
  const earlierFailures = await db
    .select({ id: opsLeadHandoffReceipts.id })
    .from(opsLeadHandoffReceipts)
    .where(
      and(
        eq(opsLeadHandoffReceipts.status, 'failed'),
        lt(opsLeadHandoffReceipts.attempts, MAX_AUTO_ATTEMPTS),
      ),
    );
  const result = await processEvents(db, {
    consumer: LEAD_INTAKE_CONSUMER,
    handlers: { 'marketing.lead.handed_off': (event, { db: tx }) => receive(tx, actor, event) },
  });
  for (const r of earlierFailures) await retryLeadHandoff(db, actor, r.id, options.requestId);
  return { ...result, retried: earlierFailures.length };
}

/**
 * GET /leads/handoffs — receipts newest first, with status counts. Never returns contacts;
 * attribution (campaign, channel, source reference) only with `ops:lead_attribution:read`.
 * Own scope (counsellor): handoffs whose Ops lead they own.
 */
export async function listLeadHandoffs(
  db: Database,
  actor: Actor,
  filters: { status?: LeadHandoffStatus } = {},
) {
  const access = await accessScope(db, actor, 'ops:leads:read');
  const attribution = can(actor, 'ops:lead_attribution:read');
  const rows = await db
    .select({
      r: opsLeadHandoffReceipts,
      payload: integrationEvents.payload,
      leadCode: opsLeads.code,
      leadName: opsLeads.studentName,
      ownerStaffId: opsLeads.ownerStaffId,
    })
    .from(opsLeadHandoffReceipts)
    .innerJoin(integrationEvents, eq(integrationEvents.id, opsLeadHandoffReceipts.eventId))
    .leftJoin(opsLeads, eq(opsLeads.id, opsLeadHandoffReceipts.leadId))
    .orderBy(desc(opsLeadHandoffReceipts.receivedAt))
    .limit(500);
  const scoped = rows.filter(
    (x) => access.scope === 'all' || (access.staffId && x.ownerStaffId === access.staffId),
  );
  const counts = Object.fromEntries(
    LEAD_HANDOFF_STATUSES.map((s) => [s, scoped.filter((x) => x.r.status === s).length]),
  ) as Record<LeadHandoffStatus, number>;
  const items = scoped
    .filter((x) => !filters.status || x.r.status === filters.status)
    .map(({ r, payload, leadCode, leadName }) => {
      const p = payload as LeadHandoffPayload;
      return {
        id: r.id,
        marketingLeadId: r.marketingLeadId,
        status: r.status as LeadHandoffStatus,
        attempts: r.attempts,
        duplicateDeliveries: r.duplicateDeliveries,
        lastError: r.lastError,
        receivedAt: r.receivedAt,
        processedAt: r.processedAt,
        leadId: r.leadId,
        leadCode,
        studentName: leadName ?? p.contacts.studentName,
        sourceCode: p.source.code,
        courseInterest: p.courseInterest,
        capturedAt: p.capturedAt,
        attribution: attribution
          ? {
              channel: p.source.channel ?? null,
              campaignRef: p.campaign?.ref ?? null,
              campaignName: p.campaign?.name ?? null,
              sourceReference: p.sourceReference,
            }
          : null,
      };
    });
  return { items, counts, attributionVisible: attribution };
}
