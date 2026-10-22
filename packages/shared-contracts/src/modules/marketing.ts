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
import type { EventDefinition } from '../events/define';

// No event yet: the consumer-defined `marketing.lead.handed_off` was retired unbuilt (D-075).
export const marketingEvents = [] as const satisfies readonly EventDefinition[];
