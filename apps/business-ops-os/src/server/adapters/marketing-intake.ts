/**
 * Marketing lead intake adapter (owner brief §10, D-014). Marketing OS does not publish
 * `marketing.lead.handed_off` v1 yet (IR row in apps/marketing-os/docs/INTEGRATION_REQUESTS.md),
 * so the live connection is NOT configured and the UI says so. The consumer
 * (server/lead-intake.ts) is real and runs against whatever events exist in the outbox.
 *
 * `publishMockLeadHandoff` is for tests and the sample seed ONLY: it stores an event exactly
 * as the Marketing producer would. It is not reachable from any route.
 */
import type { Database } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { marketingLeadHandoffKey, type EventPayload } from '@elevate/shared-contracts';

export type LeadHandoffPayload = EventPayload<'marketing.lead.handed_off', 1>;

export const MARKETING_INTAKE_STATUS = {
  connection: 'not_configured' as const,
  label: 'Live sync with Marketing OS: not configured',
  detail:
    'Marketing OS does not send lead handoffs yet. Handoffs listed here come from test or sample events only.',
};

/** TEST/SAMPLE ONLY — publish a handoff as Marketing would (same key twice = one event). */
export function publishMockLeadHandoff(
  db: Database,
  payload: LeadHandoffPayload,
  idempotencyKey = marketingLeadHandoffKey(payload.marketingLeadId),
) {
  return withTransaction(db, (tx) =>
    publishEvent(tx, { type: 'marketing.lead.handed_off', version: 1, idempotencyKey, payload }),
  );
}
