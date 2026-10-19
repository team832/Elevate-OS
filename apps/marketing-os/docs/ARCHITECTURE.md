# Marketing OS — architecture

## Layers
| Layer | Path | Rules |
|---|---|---|
| Domain | `src/domain/*.ts` | Pure, deterministic functions: codes, duplicates, content state machine, brand-rule checker, IST week helpers, schedule conflicts, collab rule, publishing decisions, CSV parsing, weekly aggregation, legacy mappings. No DB, framework, server-kit or Node I/O (ESLint-enforced, D-023). |
| Server | `src/server/*.ts` | Services: one transaction per command (`withTransaction`), permission re-check (`assertCan`), audit (`recordAudit`), approvals (`requestApproval`/`decideApproval`/`withdrawApproval`), notifications (`notify`). Adapters in `src/server/adapters/` (mock/disabled publishing). Legacy importer in `src/server/legacy/`. Policy defaults in `policy.ts`. |
| Routes | `src/app/api/v1/**/route.ts`, `src/app/api/internal/v1/summary/route.ts` | Thin `defineRoute` / `defineInternalRoute` wrappers: permission, zod validation, call one service. |
| Screens | `src/app/**/page.tsx`, `src/ui/*.tsx` | Server components inside `AppShell` via `MarketingPage` (`requirePageAccess` + forbidden state + Suspense loading + notices); `Section` turns load failures into `ErrorState`. Forms post to server actions in `src/app/actions/*.ts`, which read the session server-side and call the services. |
| Seed | `seed/index.ts` | `marketing.legacy` seed → `importLegacyMarketing(loadLegacyMarketingData())`. |

## Data flow examples
- **Approve:** screen form → `decideAction` → `decideContent`: lock item → policy (approver roles) → pending core approval → review row (version + hash) → author/requester checks → fresh rule check (`runRuleCheck` → `checkContentRules`) → eligibility → `decideApproval` → item `approved` + `approved_version_id` → notify requester → audit. All in one transaction.
- **Schedule:** `schedulePlacement` → approval validity → per-account rule check → `detectScheduleConflicts` (cadence, collisions, stagger) → hard ⇒ 409; else placement scheduled (original time kept), item `scheduled`, audit with warnings.
- **Publish:** transaction A (eligibility + idempotent record `pending`) → adapter call → transaction B (attempt row, record outcome, placement/item published if success, audit). See ALGORITHMS §6.
- **Metrics:** CSV text → `parseMetricsCsv` (declared date format, value states) → match placements → snapshots + values (dry run stops before writing).
- **Summary:** `buildMarketingSummary` → `MarketingSummaryV1` validated by the shared zod schema → internal route.

## Configuration
`MARKETING_PUBLISHING_ADAPTER` = `mock` (default) | `disabled`. Policies (OD-001, OD-002, OD-003, OD-005, OD-007, OD-008 and technical thresholds) live in `marketing.policy_settings` with status `proposed`; values are validated on read and fall back to defaults. Server-action body limit 5 MB (`next.config.ts`) for CSV imports.

## Boundaries
No imports of other modules. Cross-module output is `MarketingSummaryV1` only; no events are produced or consumed in this wave (`shared-contracts/src/modules/marketing.ts` keeps `marketingEvents = []`).
