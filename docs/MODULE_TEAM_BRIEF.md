# Module Team Brief (wave 2)

Shared briefing for the Marketing OS, Academic OS and Business Ops OS teams. The foundation (wave 1a) is built and verified: `npm run validate` passes (115 tests), all four apps build, and a session crosses the platform → module rewrite. Read in this order: `AGENTS.md`, `README.md`, `docs/DECISIONS.md`, `docs/BUILD_PLAN.md`, `INTEGRATION_CONTRACT.md`, `DATABASE_DESIGN.md`, `docs/SECURITY_AND_PERMISSIONS.md`, `docs/PRODUCT_REQUIREMENTS.md` (your module + PLT), `docs/EXISTING_PROJECT_AUDIT.md` (your module's sections and the OD-xxx owner decisions), `data/legacy/README.md` + your module's `data/legacy/<module>/*.json`.

## Foundation APIs

**Route handlers**
`defineRoute({ permission, body?, query?, params?, idempotency?: 'optional'|'required', module? }, async ({ request, requestId, user, scope, body, query, params, db, log }) => value | created(v) | respond(v, {status, meta, headers}) | Response)` from `@elevate/server-kit`.
- `permission` is a perm string, `{ anyOf: [...] }`, `'authenticated'` or `'public'`.
- `scope` is `'all'` or `'own'`.
- Check order: 401 → 403 (before validation) → 400 with details `[{location, path, message}]` → handler.
- Bodies must be JSON. A PG unique violation becomes 409; unknown errors become 500 `INTERNAL`.
- Throw `ValidationError`, `NotFoundError`, `ConflictError`, `InvalidStateTransitionError`, `ForbiddenError`, `UnauthenticatedError`, `RateLimitedError` or `InternalError`.

**Pages**
`requirePageAccess('<perm>', { loginPath: '/<zone>/login', returnTo, basePath: '/<zone>' })` from `@elevate/server-kit/next` returns `{status:'allowed'|'forbidden', user, modules}`, or redirects (307).
- Never call `redirect('/<zone>/…')` yourself; Next adds the basePath, so use `toAppPath`.
- No root `loading.tsx`.
- Links to other zones must be plain `<a>`.

**Transactions, audit, approvals**
- `withTransaction(db, tx => …)`.
- `recordAudit(tx, { actorUserId, module, action, entityType, entityId, before, after, requestId })`.
- `defineApprovalPolicy`, `requestApproval`, `decideApproval` (no self-approval unless the policy allows it; history kept), `withdrawApproval`, `listApprovalHistory`.

**Events (outbox)**
- Producer: `publishEvent(tx, { type, version, idempotencyKey, payload, correlationId?, causationId? })`.
- Consumer: `processEvents(db, { consumer, handlers: { '<type>': async (event, { db: tx, log }) => … }, maxAttempts })`.
- Processing is idempotent per consumer; a failing handler rolls back and is retried, and is marked dead after `maxAttempts`.
- The enrolment handoff events and the `enrolmentKeys` helper are in `packages/shared-contracts/src/events/enrolment.ts`.
- Add your own events in `packages/shared-contracts/src/modules/<module>.ts`.

**Internal summaries**
- `defineInternalRoute({ callers }, handler)`: bearer `INTERNAL_SERVICE_TOKEN` plus an `X-Elevate-Caller` header.
- `fetchInternal(url, schema, { caller })` never throws; it returns "unavailable".
- Build metrics with `metric.ok | metric.estimated | metric.missing`. Missing is never zero.

**Notifications**
`notify(tx, { userIds, module, kind, title, body?, link? })`, plus `listNotifications`, `countUnread` and `markNotificationsRead`. Email is a mock that reports `not_sent`.

**Tables** go in `packages/database/src/schema/<module>.ts`, defined with `<module>.table('name', …)`.
- Exports are prefixed with the module name (e.g. `opsLeads`).
- UUID primary key: `uuid('id').primaryKey().defaultRandom().$type<XId>()`.
- Foreign keys only within your schema or into `core`.
- Only `import type` from workspace packages.
- Never run `db:generate`. Wave 3 does it.

**Permissions** are defined in `packages/authorization/src/permissions/<module>.ts`.
- Add entries to the `…PermissionList` and to `grants`, as `'perm'` or `{ permission, scope: 'own' }`.
- The catalogue refuses to load if the auditor is granted any action other than read/access, if user administration is granted to anyone except platform_admin, or if a file grants another module's permissions.
- Record-level helpers: `scopedValue(user, perm, {all, own})`, `canAccessRecord`.

**Seeds**
- Export `seeds` from `apps/<module>/seed/index.ts`.
- `defineSeed({ name: '<module>.x', module, dependsOn: ['core.users', …], description, run({ db, seedUserPassword, hashPassword, log }) })`.
- Seeds must be idempotent and use fictional people only.
- Legacy planning data comes from `data/legacy/**` with its status label preserved; planned work is never seeded as delivered.

**Tests**
- `const ctx = setupTestDatabase()` from `@elevate/testing` gives each test file a fresh in-memory PGlite with the full live schema.
- Helpers: `createTestUser(ctx.db, { roles })`, `authedRequest(user, path, { json, headers })`, `callRoute(handler, req, params)` → `{ok, status, data|error}`.
- Use unique values per test. Fixtures use `test-only-` prefixes for anything secret-looking.

**UI** comes from `@elevate/shared-ui`:
- Layout: AppShell, Wordmark, PageHeader, Card.
- Data: DataTable, StatusBadge, FeatureStatusBadge, StatTile (shows missing and estimated distinctly from zero), formatMetricValue.
- Forms: Button, ButtonLink, Field, TextInput, Select, TextArea, Checkbox.
- States: Alert, EmptyState, ErrorState, LoadingState, LoginForm.

## Rules while three teams work in parallel
1. **Edit only files you own** (see BUILD_PLAN), plus your own section of `IMPLEMENTATION_STATUS.md`. Put requests to other owners in `apps/<module>/docs/INTEGRATION_REQUESTS.md`.
2. **Do not add npm dependencies or touch `package-lock.json`.** Three teams share one lockfile. If a dependency is truly needed, put a request in INTEGRATION_REQUESTS and work around it.
3. **ESLint enforces module boundaries.** Lint fails on importing another module, on framework, DB or Node I/O inside `src/domain`, and on app code importing test helpers.
4. **Run checks scoped to your workspace while others are mid-edit:**
   - `npm run typecheck -w @elevate/<app>`
   - `npx eslint apps/<app> packages/database/src/schema/<module>.ts packages/authorization/src/permissions/<module>.ts packages/shared-contracts/src/modules/<module>.ts --max-warnings=0`
   - `npx vitest run apps/<app>`
   - `npm run build -w @elevate/<app>`
   
   If a failure is caused by another team's file, don't fix it; note it and re-run later. At the end, also run root `npm test` once.
5. **Write large files in pieces** (under ~400 lines per Write/Edit call). A stalled stream loses work.
6. **Honesty.**
   - Never claim a platform or CRM connection, a publication, a metric, an admission or a score that did not happen. External integrations use mock adapters that say they are mocks.
   - Unapproved business policies are configuration with status `proposed`; they are never hard-coded as fact.
   - Owner decisions (OD-xxx) are exposed as approval states or config.
7. **Definition of done** is in `docs/BUILD_PLAN.md`. Prefer fewer, complete vertical slices over many half-built ones. Anything not done is listed honestly as Proposed in REQUIREMENTS.md and IMPLEMENTATION_STATUS.md.
8. **Do not commit to git. Do not start long-running dev servers and leave them running.** If you start one for a smoke test, stop it.

## Final report format (your last message)
Under 900 words, covering:
- Slices delivered, by requirement ID.
- Tables added.
- Routes, with their permissions.
- Screens.
- Algorithms.
- Events produced and consumed.
- Seeds.
- Every command run, with its result and test counts.
- What is Proposed or not built.
- Integration requests.
- Owner decisions your module depends on.
