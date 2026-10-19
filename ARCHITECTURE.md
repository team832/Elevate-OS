# Architecture

## 1. Shape
Elevate OS is an npm-workspaces monorepo (D-003) of four Next.js 16 App Router apps (D-004) on shared TypeScript packages and one PostgreSQL database with a schema per domain (D-005).

```
                         Browser (one origin, one elevate_session cookie)
                                        │
                     ┌──────────────────▼──────────────────┐
                     │  apps/platform  :3000   basePath ''  │  login, home, dashboard,
                     │  src/proxy.ts (cookie presence → /login)│ /api/v1/auth/*, /api/health
                     │  next.config rewrites:                │
                     │   /marketing/* → MARKETING_OS_URL     │
                     │   /academic/*  → ACADEMIC_OS_URL      │
                     │   /ops/*       → BUSINESS_OPS_OS_URL  │
                     └───────┬──────────────┬───────────────┬┘
                             │              │               │
          ┌──────────────────▼─┐ ┌──────────▼─────────┐ ┌───▼────────────────┐
          │ apps/marketing-os  │ │ apps/academic-os   │ │ apps/business-ops-os│
          │ :3001 /marketing   │ │ :3002 /academic    │ │ :3003 /ops          │
          └──────────┬─────────┘ └──────────┬─────────┘ └───┬────────────────┘
                     │   shared packages (@elevate/*), no app→app imports     │
                     └──────────────┬───────────────────────────────────────┘
                                    ▼
                PostgreSQL: schemas core │ marketing │ academic │ ops
                (dev: embedded-postgres 18 on 127.0.0.1:54320; tests: PGlite in memory)
```

Each module app also runs standalone on its own port with its own `/<base>/login`; the cookie is host-scoped (not port-scoped), so a session made on one port works on the others in development.

## 2. Packages (dependency order)
| Package | Depends on | Role |
|---|---|---|
| `@elevate/shared-types` | — | Branded IDs, `ModuleKey`, `MODULES`, `ROLE_KEYS`, `FeatureStatus`, `Result`, Asia/Kolkata date helpers |
| `@elevate/configuration` | zod | `loadEnv(subset)`, `ENV_FIELDS`, `ConfigurationError`, `createLogger`; `/node`: `loadRootEnv`, `findRepoRoot` |
| `@elevate/shared-contracts` | shared-types, zod | Entities, API envelope + `AppError`s, HTTP helpers, events (define/registry/enrolment), summary contracts; module-owned files `src/modules/*.ts` |
| `@elevate/database` | configuration, shared-types, drizzle-orm, pg, pglite | Schema (4 files), client factory, `insertAuditEvent`, PG error helpers; `/seed`, `/migrate`, `/testing` |
| `@elevate/authorization` | shared-contracts, shared-types | Roles, per-module permission files, `can`/`requirePermission`/`scopeFor`/`scopedValue`/`modulesFor`, matrix renderer |
| `@elevate/authentication` | database, configuration, shared-contracts, authorization | scrypt, sessions, cookie, throttle, login/logout handler factories; `/next`: `getCurrentUser` |
| `@elevate/server-kit` | all of the above | `defineRoute`, `withTransaction`, `recordAudit`, approvals, outbox, internal routes, idempotency, health; `/next`: `requirePageAccess` |
| `@elevate/notifications` | database, configuration | `notify`, list/mark-read, channel adapters (mock email) |
| `@elevate/shared-ui` | shared-contracts, shared-types, react | Server-component UI kit + `styles.css` tokens |
| `@elevate/testing` | database, authentication | `setupTestDatabase`, `createTestUser`, `authedRequest`, `callRoute` |

Packages are consumed as TypeScript source (`exports` → `src/*.ts`): no build step; Next.js transpiles them (`transpilePackages`), vitest and tsx run them directly.

## 3. Module app layout (BUILD_PLAN)
```
apps/<module>/
  src/app/        Next.js routes & pages (thin: call server/, render ui/)
  src/domain/     pure logic — no I/O, no framework (ESLint-enforced)
  src/server/     services, repositories, adapters, auth handlers
  src/ui/         module components
  seed/index.ts   `seeds` for npm run db:seed
  tests/unit, tests/integration
```
Request path for a write: `route.ts (defineRoute: session → permission → zod)` → `server/service.ts (withTransaction: domain rules → repository writes → recordAudit → publishEvent/notify)` → envelope.

## 4. Cross-cutting rules
- **Security:** server-side permission checks everywhere (D-008); session details in `docs/SECURITY_AND_PERMISSIONS.md`.
- **Integration:** commands via the transactional outbox; read-only summaries via internal HTTP with "missing ≠ zero" (D-011, `INTEGRATION_CONTRACT.md`).
- **Boundaries:** ESLint blocks module→module imports, package→app imports, impure domain code and test helpers in app code (D-023).
- **External systems:** adapters with mock defaults and honest connection status (D-014).
- **Observability:** one JSON log line per request (`requestId`, method, path, status, ms, userId); `x-request-id` on every response; audit trail in `core.audit_events`.
- **Configuration:** one root `.env`, validated per app subset (D-021).

## 5. Key design choices and their reasons
See `docs/DECISIONS.md`: D-004 (multi-zone), D-005 (one DB, schema per domain), D-006/006a (Drizzle; PGlite tests; embedded-postgres dev), D-011 (outbox + summaries), D-017/018 (toolchain), D-019 (session tokens), D-022 (basePath redirects), D-025 (`createTestDb`). Deeper runtime description: `docs/SYSTEM_DESIGN.md`.
