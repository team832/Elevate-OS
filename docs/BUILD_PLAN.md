# Build Plan

How Elevate OS is being built, in what order, and who owns which files. Read `docs/DECISIONS.md` first.

## Waves

| Wave | Work | Owner (agent) | Depends on |
|---|---|---|---|
| 1a | Monorepo, tooling, shared packages, core schema, auth, RBAC, server-kit, shared UI, four Next.js app skeletons, integration contract | Foundation | — |
| 1b | Audit of legacy source → `docs/EXISTING_PROJECT_AUDIT.md`, `docs/PRODUCT_REQUIREMENTS.md` | Audit | — |
| 1c | Structured extracts of legacy planning data → `data/legacy/` | Legacy data | — |
| 2 | Marketing OS vertical slices | Marketing | 1a, 1c |
| 2 | Academic OS vertical slices | Academic | 1a, 1c |
| 2 | Business Ops OS vertical slices | Business Ops | 1a, 1c |
| 3 | Central migration, seed, cross-module integration tests, platform consolidated views, full validation, docs reconciliation | Integration | 2 |

## File ownership during parallel work

Parallel agents must not edit files they do not own. If a change is needed in a file owned by someone else, write the request into your module's `docs/INTEGRATION_REQUESTS.md` and continue.

| Path | Owner |
|---|---|
| root config (`package.json`, `tsconfig.base.json`, eslint, prettier, vitest) | Foundation (wave 1), then Integration (wave 3) |
| `packages/**` except the module schema files below | Foundation, then Integration |
| `packages/database/src/schema/marketing.ts` | Marketing |
| `packages/database/src/schema/academic.ts` | Academic |
| `packages/database/src/schema/ops.ts` | Business Ops |
| `packages/shared-contracts/src/modules/marketing.ts` | Marketing |
| `packages/shared-contracts/src/modules/academic.ts` | Academic |
| `packages/shared-contracts/src/modules/ops.ts` | Business Ops |
| `apps/marketing-os/**` | Marketing |
| `apps/academic-os/**` | Academic |
| `apps/business-ops-os/**` | Business Ops |
| `apps/platform/**` | Foundation, then Integration |
| `data/legacy/**` | Legacy data |
| `docs/EXISTING_PROJECT_AUDIT.md`, `docs/PRODUCT_REQUIREMENTS.md` | Audit |
| `IMPLEMENTATION_STATUS.md` | Each agent edits only its own section |

**Migrations:** module agents do **not** run `drizzle-kit generate`. Tests build the schema in memory with the test helper from `@elevate/database/testing`. Wave 3 generates the single baseline migration from all schema files.

## Module internal layout (all three modules follow it)

```
apps/<module>/
  README.md                 module manual: scope, rules, commands, APIs, status
  requirements/REQUIREMENTS.md   numbered functional requirements (MKT-001…, ACD-001…, OPS-001…) with status
  docs/ARCHITECTURE.md      layers and data flow
  docs/DOMAIN_MODEL.md      entities, states, relationships (matches the schema file)
  docs/API.md               every route: method, path, permission, request, response, errors
  docs/ALGORITHMS.md        every algorithm/business rule in the 10-point format below
  docs/TEST_PLAN.md         what is tested where
  docs/INTEGRATION_REQUESTS.md   requests to other owners
  src/domain/               pure deterministic logic — no I/O, no framework imports
  src/server/               services (transactions, permission checks, audit), repositories, adapters
  src/app/                  Next.js App Router pages and route handlers (thin)
  src/ui/                   module React components
  tests/unit/               domain tests
  tests/integration/        service + route tests on in-memory PGlite
  seed/                     fictional fixtures + legacy importers
```

Requirement → schema → domain function → service → route → screen → test should be traceable by requirement ID.

## Algorithm documentation format (`docs/ALGORITHMS.md`)
1 Purpose · 2 Inputs · 3 Output · 4 Preconditions · 5 Rules and constraints · 6 Steps · 7 Errors and edge cases · 8 Permissions · 9 Tests (file + case names) · 10 Known limitations.

## Definition of done for a vertical slice
- Schema + domain logic + service + API route + at least one screen with loading/empty/error/success states.
- Permission enforced on the server, audited where it changes business state.
- Unit tests for domain logic (normal, boundary, missing, invalid, conflicting) and an integration test for the service/route.
- `npm run typecheck`, `npm run lint`, `npm test` pass for the workspace.
- Module README, REQUIREMENTS status, API.md and IMPLEMENTATION_STATUS.md updated.
