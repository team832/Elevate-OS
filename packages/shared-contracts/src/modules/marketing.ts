/**
 * OWNER: Marketing OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Contracts that Marketing OS publishes for other modules: its integration
 * events (add `defineEvent(...)` entries to `marketingEvents`; type names start
 * with `marketing.`) and any shared request/response shapes for its internal
 * APIs. The marketing summary contract `MarketingSummaryV1` lives in
 * `../summaries.ts` (Foundation-owned) because Ops and the platform consume it.
 *
 * Do not import other modules' files from here.
 */
import { z } from 'zod';
import type { EventDefinition } from '../events/define';
import { campaignIdSchema, isoDateTimeSchema } from '../ids';
import { metricSchema } from '../summaries';

// No event yet: the consumer-defined `marketing.lead.handed_off` was retired unbuilt (D-075).
export const marketingEvents = [] as const satisfies readonly EventDefinition[];

/**
 * Marketing facts of a monthly work report (brief 23 Oct 2026 §15): stored under `marketing` in
 * the snapshot of the ops.eod_reports row with period_kind 'month' (one report lifecycle: draft →
 * submitted to HR → reviewed / changes requested). Marketing builds it from canonical records at
 * `cutoffAt`; Business Ops stores and renders it. Counts follow MISSING IS NOT ZERO (metricSchema).
 * Employee text (incomplete work and reasons, blockers, next month's plan) uses the report's own
 * summary / notes / next_day_plan fields; manager comments are review events; HR tasks come from
 * the report's task snapshot. No spend or cost-per-outcome until verified spend data exists.
 */
const countRow = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  count: metricSchema,
});
const contentCounts = { planned: metricSchema, approved: metricSchema, published: metricSchema };

export const marketingMonthlySnapshotV1Schema = z.object({
  version: z.literal(1),
  cutoffAt: isoDateTimeSchema,
  isSample: z.boolean(),
  targets: z.array(
    z.object({
      targetId: z.uuid(),
      scope: z.enum(['employee', 'team', 'campaign']),
      metricKey: z.string().min(1).max(60),
      target: z.number().int().positive(),
      actual: metricSchema,
    }),
  ),
  /** Leads by stage reached in the month (stage keys are configurable). */
  funnel: z.array(countRow),
  /** Logged call and follow-up outcomes; a count of calls is not a count of sales. */
  callOutcomes: z.array(countRow),
  campaigns: z.array(
    z.object({
      campaignId: campaignIdSchema,
      code: z.string(),
      name: z.string(),
      ...contentCounts,
    }),
  ),
  content: z.object(contentCounts),
  optimisation: z.array(
    z.object({
      itemId: z.uuid(),
      categoryKey: z.string(),
      topic: z.string(),
      reviewState: z.string(),
      evidence: z.string().nullable(),
    }),
  ),
});
export type MarketingMonthlySnapshotV1 = z.output<typeof marketingMonthlySnapshotV1Schema>;
