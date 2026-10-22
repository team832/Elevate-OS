# Testing Strategy

## 1. Tools
- **vitest 5.0.5**, one project per workspace (`packages/*/vitest.config.ts`, `apps/*/vitest.config.ts`) using the shared preset `vitest.shared.ts` (node environment, `tests/**/*.test.ts(x)`, test-only env values such as `SESSION_SECRET=test-only-…`, `LOG_LEVEL=error`).
- **PGlite** in memory via `createTestDb()` / `setupTestDatabase()` — real PostgreSQL 17 semantics (constraints, transactions, `gen_random_uuid()`, jsonb) with the full current schema from all four schema files (D-025).
- Route handlers are called directly with `Request` objects (`authedRequest`, `callRoute`) — no server needed.
- **Playwright E2E is deferred** (D-007) until screens stabilise. Instead, screens are checked by `renderToStaticMarkup` contract tests and a scripted real-browser pass (§3).

## 2. Commands
| Command | Runs |
|---|---|
| `npm test` | All projects |
| `npx vitest run --project academic-os` | One project (names = package folder names) |
| `npm run test:watch` | Watch mode |
| `npm run validate` | typecheck + lint + test + secret scan |
| `npm run db:check` | Read-only check of the local live database (see §3) |

## 3. Layers
| Layer | Where | What | Database |
|---|---|---|---|
| Domain unit | `apps/<m>/tests/unit` | Pure functions in `src/domain`: normal, boundary, missing, invalid, conflicting cases | none |
| Service / route integration | `apps/<m>/tests/integration` | Services and `defineRoute` handlers: permissions (401/403), validation (400), happy path, audit rows, events published | `setupTestDatabase()` |
| Contract | `packages/shared-contracts/tests` | Schemas accept valid and reject invalid payloads; registry | none |
| Platform services | `packages/*/tests` | Auth, RBAC, outbox, approvals, idempotency, notifications, UI rendering | PGlite where needed |
| Database constraints | `packages/database/tests/constraints/*.test.ts` | One suite per schema area (`core`, `marketing`, `academic`, `academic-workspace`, `ops-*`): each CHECK, unique and foreign key refuses a bad row and accepts a good one (`helpers.ts`: `insertSql`, `rolledBack`). `enum-checks.test.ts` fails if any `text(..., { enum })` column has no CHECK | PGlite |
| Migrations ≡ schema | `packages/database/tests/constraints/migrations.test.ts`, `migration-0009.test.ts` | Applying `0000`…latest gives the same tables, columns, constraints and indexes as `createTestDb()`; data migrations keep existing rows. Plus `drizzle-kit generate --name check` → "No schema changes" | PGlite |
| Live database | `npm run db:check` (`scripts/development/db-check.ts`) | Read-only, local URLs only: live schema ≡ `createTestDb()`, every migration applied, no invalid indexes or constraints, sample rows follow D-036 | the owner's local PostgreSQL |
| Screen contract | `packages/shared-ui/tests/components.test.tsx`, `apps/<m>/tests/unit/screens.test.tsx` | `renderToStaticMarkup` of components and screen parts: labels, aria, empty states, missing ≠ 0, SAMPLE DATA badge, ₹ grouping, masked phones, escaping | none |
| Real browser (manual run) | headless Chrome over the DevTools protocol; not in `validate` | Every static page and the sample detail pages at 1440 and 390 px: console errors, horizontal scroll, one h1, labelled controls, named buttons, image alt, duplicate ids, `href="#"`, skip link, visible first-Tab focus, text contrast. Last run 22 Oct 2026 (`IMPLEMENTATION_STATUS.md`). On a PC where Windows blocks Next's native compiler, start the apps with `npm run dev -w <app> -- --webpack` | local dev database |
| Cross-module (wave 3) | Integration wave | e.g. publish `ops.admission.enrolment_requested` → Academic consumer → reply → Ops consumer, importing modules' `./server` entry points | PGlite |

## 4. Writing a module integration test
```ts
import { describe, expect, it } from 'vitest';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { POST } from '../../src/app/api/v1/leads/route';

const ctx = setupTestDatabase();            // fresh DB for this file; getDb() returns it

describe('POST /ops/api/v1/leads', () => {
  it('403 for a teacher', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    const res = await callRoute(POST, authedRequest(teacher, '/ops/api/v1/leads', { json: { name: 'Asha Example (fictional)' } }));
    expect(res.status).toBe(403);
  });
});
```
Use fictional data only. Each test file gets its own database; tests inside a file share it, so create unique values per test.

## 5. Foundation test inventory (all passing — see IMPLEMENTATION_STATUS.md)
| File | Covers |
|---|---|
| `packages/configuration/tests/env.test.ts` | Loader: typed values/defaults, all missing vars listed in one error, short/placeholder secrets, bad URLs, per-app subsets, empty = missing, local-URL check |
| `packages/shared-types/tests/shared-types.test.ts` | UUID brands, module keys, IST date derivation, calendar validation, date arithmetic, Result |
| `packages/shared-contracts/tests/contracts.test.ts` | Enrolment handoff payloads, registry, event naming, missing ≠ zero metrics, error statuses |
| `packages/database/tests/create-test-db.test.ts` | All schemas/tables created (incl. every exported module table), constraints, isolation, module-schema DDL |
| `packages/authentication/tests/password.test.ts` | scrypt hash/verify, salts, malformed hashes, rehash |
| `packages/authentication/tests/sessions.test.ts` | Session create (hash only stored) / verify / expire / revoke / revoke-all / disabled user; cookie flags; login JSON + form + open-redirect guard + throttle 429; logout |
| `packages/authorization/tests/authorization.test.ts` | `can`/`requirePermission` (FORBIDDEN), multi-role union, auditor read-only, only platform_admin manages users/roles, teacher `own` scope + `scopedValue`, `modulesFor`, catalogue format |
| `packages/server-kit/tests/define-route.test.ts` | 401/403/400/200 paths, error mapping (404, unique → 409, hidden 500), public/anyOf, 201, Idempotency-Key replay/conflict/rollback |
| `packages/server-kit/tests/approvals.test.ts` | Self-approval rule, decider permission, audit, state transitions, one pending per subject, rejection reason, preserved history |
| `packages/server-kit/tests/outbox.test.ts` | Idempotent publish, payload validation, producer rollback, **same event processed twice → one effect**, independent consumers, failure rollback/retry/dead |
| `packages/server-kit/tests/internal.test.ts` | Internal token/caller checks, `fetchInternal` never substitutes zero, health, `toAppPath` |
| `packages/notifications/tests/notifications.test.ts` | notify/list/count/mark-read (own rows only), relative links, mock email never claims delivery |
| `packages/shared-ui/tests/shared-ui.test.tsx` | StatTile ok/estimated/missing rendering, AppShell module switcher, DataTable, ErrorState, LoginForm |
| `packages/testing/tests/testing.test.ts` | Test DB installation, test users + sessions, envelope parsing |
| `apps/platform/tests/unit/proxy.test.ts` | Proxy redirect, pass-through, matcher exclusions |
| `apps/platform/tests/integration/auth-routes.test.ts` | `/api/v1/auth/me` 401/200 with modules and scopes; health |
| `apps/<module>/tests/unit/domain.test.ts` ×3 | Skeleton domain (basePath, `modulePath`) |
| `apps/<module>/tests/integration/routes.test.ts` ×3 | Health, standalone login cookie, seed export |

## 6. Rules
- A feature is **Tested** (D-013) only when an automated test for it passes and is recorded in `IMPLEMENTATION_STATUS.md`.
- Every permission-protected route needs at least one 401/403 test and one allowed test.
- Every state transition needs valid and invalid transition tests.
- Do not mock the database for service tests — use PGlite.
- `npm run typecheck && npm run lint && npm test` must pass before handing work over.
