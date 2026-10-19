# @elevate/shared-types

Framework-free types and helpers used everywhere.

- **Branded IDs** (`UserId`, `LeadId`, `StudentId`, `BatchId`, …) — UUIDs at runtime, distinct types at compile time (D-009). `asId<T>(s)` checks and casts; normally obtain IDs through the zod schemas in `@elevate/shared-contracts`.
- **`ModuleKey`** — `platform | marketing | academic | ops`, plus `MODULES` (label, basePath, port per D-004).
- **`FeatureStatus`** — `Proposed → Approved → Implemented → Tested → Deployed` (D-013). `PlanningStatus` — `locked | provisional | proposed | delivered` (D-016).
- **`Result<T, E>`** with `ok()`, `err()`, `unwrap()`.
- **Dates** — `TIMEZONE = 'Asia/Kolkata'`; `toIsoDate(instant)` gives the IST calendar date; `isIsoDate`, `parseIsoDate`, `addDays`, `daysBetween`, `compareIsoDates`, `nowIso`.

Adding a new branded ID for your module: open an integration request (this package is Foundation/Integration owned), or declare it locally in your module with `Brand<string, 'XId'>` until it is needed cross-module.

Tests: `tests/shared-types.test.ts`.
