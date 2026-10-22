# Architecture

## 1. Shape
Elevate OS is an npm-workspaces monorepo (D-003) of four Next.js 16 App Router apps (D-004) on shared TypeScript packages and one PostgreSQL database with a schema per domain (D-005).

```
   Browser: one elevate_session cookie (host localhost, path /), sent to every port
        │                      │                      │                      ┊ (only for admin
        ▼                      ▼                      ▼                      ▼  and Google sign-in)
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────────┐
│ business-ops-os    │ │ academic-os        │ │ marketing-os       │ │ apps/platform          │
│ :3000  /ops        │ │ :3001  /academic   │ │ :3002  /marketing  │ │ :3003  basePath ''     │
│ Business Operations│ │ Academic workspace │ │ Marketing workspace│ │ Users & roles, Google  │
│ workspace          │ │ (teachers, coord.) │ │                    │ │ callback; optional     │
│ exports ./work and │ │ mounts ./work      │ │ mounts ./work and  │ │ gateway (rewrites /ops,│
│ ./leads (D-073)    │ │                    │ │ ./leads            │ │ /academic, /marketing) │
└─────────┬──────────┘ └─────────┬──────────┘ └─────────┬──────────┘ └───────────┬────────────┘
          │  internal HTTP summaries (INTERNAL_SERVICE_TOKEN) · outbox events     │
          │  shared packages (@elevate/*)                                          │
          └──────────────────────┴──────────────┬───────┴──────────────────────────┘
                                                ▼
                     PostgreSQL: schemas core │ marketing │ academic │ ops
                     (dev: embedded-postgres 18 on 127.0.0.1:54320; tests: PGlite in memory)
```

Since 22 Oct 2026 (D-072) the three module apps are the three **role workspaces**, each on its own origin (`BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL`; `appOrigin()` in `packages/configuration/src/workspaces.ts`), each with its own `/<base>/login`, and each origin's `/` redirects to its workspace. The platform app moved to `:3003` (`PLATFORM_URL`); it hosts Users & roles and the Google sign-in callback, and its rewrites remain as an **optional** single-origin gateway. The workspaces run without it; only Users & roles and Google sign-in need it running.

- **One identity, one cookie.** Browsers do not separate cookies by port, so the single HttpOnly `elevate_session` cookie (SameSite=Lax, 7-day absolute expiry, Secure in production) signs a person in to every workspace their roles grant; signing out anywhere revokes the server session for all. Roles are read from the database on every request.
- **Membership.** A person belongs to a workspace when a stored role grants `<workspace>:module:access` (`workspacesFor`, `packages/authorization/src/workspaces.ts`). `requirePageAccess(…, { workspace })` sends non-members to their own workspace before any data loads; `defineRoute` refuses `/ops`, `/academic`, `/marketing` API paths to non-members with 403. After sign-in `resolveLanding` keeps a member where they signed in, else opens the remembered workspace (`core.users.preferred_workspace`), else the only one, else the chooser `<base>/workspaces`.
- **CSRF.** Other localhost ports share the cookie, so every state-changing request must come from its own origin or a configured app origin (`isAllowedRequestOrigin`), and JSON bodies need the exact `application/json` media type. No CORS headers are sent.
- **Shared code (D-073).** Business Ops exports two entries, `./work` (tasks, EOD, meetings) and `./leads` (leads, follow-ups); Academic OS imports `./work`, Marketing OS imports both, and each re-exports the same route handlers under its own base path. ESLint (`SHARED_ENTRIES` in `eslint.config.mjs`) allows exactly these imports; all other app→app imports stay blocked.
- Guide for people and roles: `docs/WORKSPACES.md`.

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
- **Boundaries:** ESLint blocks module→module imports (except the two Business Ops entries of D-073), package→app imports, impure domain code and test helpers in app code (D-023).
- **External systems:** adapters with mock defaults and honest connection status (D-014).
- **Observability:** one JSON log line per request (`requestId`, method, path, status, ms, userId); `x-request-id` on every response; audit trail in `core.audit_events`.
- **Configuration:** one root `.env`, validated per app subset (D-021).

## 5. Key design choices and their reasons
See `docs/DECISIONS.md`: D-004 (multi-zone), D-005 (one DB, schema per domain), D-006/006a (Drizzle; PGlite tests; embedded-postgres dev), D-011 (outbox + summaries), D-017/018 (toolchain), D-019 (session tokens), D-022 (basePath redirects), D-025 (`createTestDb`), D-072 (role workspaces on their own origins), D-073 (shared task and lead entries). Deeper runtime description: `docs/SYSTEM_DESIGN.md`.
