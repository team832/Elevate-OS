# System Design

How Elevate OS behaves at runtime. Structure: `ARCHITECTURE.md`. Contracts: `INTEGRATION_CONTRACT.md`. Business requirements: `docs/PRODUCT_REQUIREMENTS.md`; legacy analysis: `docs/EXISTING_PROJECT_AUDIT.md`.

## 1. Request lifecycle

### Page request (server component)
1. Browser → `http://<platform>/academic/batches`.
2. Platform `proxy.ts` is skipped for module zones (matcher); the rewrite forwards to `ACADEMIC_OS_URL/academic/batches` with the original cookies.
3. The Academic page calls `requirePageAccess('academic:batches:read', { loginPath: '/academic/login', returnTo: '/academic/batches', basePath: '/academic' })`:
   - no/invalid session → 307 to `/academic/login?next=%2Facademic%2Fbatches` (basePath handled, D-022);
   - session without permission → `{ status: 'forbidden' }` → page renders `ErrorState`, no data queried;
   - allowed → page loads data through `src/server` services, scoped with `scopedValue` for `own` grants.
4. HTML streams back through the platform.

For platform pages, `proxy.ts` first redirects requests with **no** `elevate_session` cookie to `/login?next=…` and stamps `x-request-id`; the page then validates the session for real.

### API request (route handler)
`defineRoute` (server-kit): request id (incoming `x-request-id` or a new UUID) → session from cookie (`validateSession`: HMAC lookup, expiry, revocation, user active) → permission → params → query → JSON body → handler → `{ data }` / `{ error }` → one structured log line. Optional `Idempotency-Key` runs the handler and the key reservation in one transaction.

### Sign-in
`POST /api/v1/auth/login` (or `/<zone>/api/v1/auth/login`): throttle check → `checkPassword` (scrypt; dummy hash for unknown emails) → transaction { insert session (token hash), update `last_login_at`, audit `auth.login` } → `Set-Cookie: elevate_session=…` → JSON envelope or 303 to the safe `next`. Sign-out revokes the session, audits `auth.logout`, clears the cookie.

Google sign-in (D-030, optional): every zone's login page links to `PLATFORM_URL/api/v1/auth/google/start?next=…` → signed 10-minute state cookie → Google → `/api/v1/auth/google/callback` on the platform: state check → code exchange (PKCE) → ID-token verification (JWKS, claims, `hd`) → find or create the user (no roles) → the same session transaction as the password login → 303 to `next`. The session cookie is set on the platform host, which serves every zone (D-004).

## 2. State changes inside a module
```ts
await withTransaction(db, async (tx) => {
  const before = await repo.get(tx, id);
  const after = domain.transition(before, input);          // pure rules; throws InvalidStateTransitionError
  await repo.save(tx, after);
  await recordAudit(tx, { actorUserId: user.id, module, action, entityType, entityId: id, before, after, requestId });
  await publishEvent(tx, { ... });                          // if another module must react
  await notify(tx, { userIds, module, kind, title, link }); // if someone must be told
});
```
Everything commits or nothing does.

## 3. Cross-module flows
- **Commands** (admission → enrolment): producer writes `core.integration_events` in its transaction; the consumer runs `processEvents` (one transaction per event, guarded by the unique `core.event_deliveries` row) and replies with its own event. Failures retry; repeated failure → `dead`.
- **Read-only summaries** (dashboards): `fetchInternal()` → `GET /<zone>/api/internal/v1/summary` (bearer token + caller header) → validated contract or `unavailable`. Never zeros in place of missing data.
- **Approvals**: any module can open/decide approvals on its own subjects through the shared service; history is preserved in `core.approvals` and audited.

## 4. Environments
| Environment | Database | Apps | Status |
|---|---|---|---|
| Tests | PGlite in memory per test file (`createTestDb`) | Route handlers called directly | Implemented, Tested |
| Local development | embedded-postgres 18 on `127.0.0.1:54320` (`npm run db:start`) | `npm run dev` (four apps, hot reload) or `npm run build` + `start` | Implemented, verified manually (IMPLEMENTATION_STATUS.md) |
| Production | Managed PostgreSQL ≥ 17 | Four Next.js servers behind HTTPS; only the platform public | **Proposed** (`infrastructure/deployment/README.md`) |

## 5. Background work
There is no scheduler yet. Outbox consumers run when a module calls `processEvents` (for example from an action in its UI). A periodic runner (cron route protected by `INTERNAL_SERVICE_TOKEN`, or a small worker process) is a wave-3 integration item; until then nothing claims automatic delivery.

## 6. Failure handling
| Failure | Behaviour |
|---|---|
| Database down | Health endpoints return 503 `degraded`; routes return 500 `INTERNAL` with a request id; pages render `error.tsx` |
| Module app down | Platform rewrite fails for that zone only (other zones keep working); summaries show "source unavailable" |
| Invalid configuration | `loadEnv` throws `ConfigurationError` listing every missing/invalid variable (lazily, on first use) |
| Expired/revoked session | Treated as signed out (401 / redirect to sign-in) |
| Event handler error | Rolled back, recorded `failed`, retried, then `dead` |

## 7. Time and locale
All instants stored as UTC `timestamptz`; calendar logic (class days, deadlines, report windows) uses `Asia/Kolkata` via `toIsoDate()`. UI language: English (en-IN number formatting in `StatTile`).
