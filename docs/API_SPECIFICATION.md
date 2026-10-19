# API Specification

Conventions apply to every zone (D-012). Module endpoints are specified by their owners in `apps/marketing-os/docs/API.md`, `apps/academic-os/docs/API.md` and `apps/business-ops-os/docs/API.md` (written by the module teams in wave 2).

## 1. Conventions
| Topic | Rule |
|---|---|
| Base paths | Platform `/api/…`; Marketing `/marketing/api/…`; Academic `/academic/api/…`; Business Ops `/ops/api/…` |
| Versioning | `/api/v1/…`; breaking change → `/api/v2/…`, v1 kept until consumers migrate |
| Format | JSON, UTF-8. Bodies require `Content-Type: application/json` (HTML form posts are accepted only by login/logout) |
| Success | `{ "data": <payload>, "meta"?: { "page"?: { "limit": n, "nextCursor": string \| null } } }` |
| Failure | `{ "error": { "code": ErrorCode, "message": string, "details"?: any, "requestId": string } }` |
| Validation details | `[{ "location": "body" \| "query" \| "params" \| "headers", "path": [..], "message": "…" }]` |
| Auth | `elevate_session` cookie (HttpOnly). 401 when absent/invalid, 403 when the permission is missing |
| Request id | Send `x-request-id` (8–100 chars `[\w.:-]`) or one is generated; always echoed in the response header and in errors |
| Idempotency | `Idempotency-Key` (8–200 chars `[\w.:-]`) on routes that declare it; replay within 24 h returns the stored response with `idempotency-replayed: true`; same key + different body → 409 |
| Pagination | `?limit=1..200` (default 50) `&cursor=<opaque>` |
| Dates | `YYYY-MM-DD` calendar dates (Asia/Kolkata); instants ISO 8601 UTC |
| Internal routes | `/<base>/api/internal/v1/…`; `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` + `X-Elevate-Caller: platform\|marketing\|academic\|ops`; never from browsers |

### Error codes
| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad params/query/body, non-JSON body, broken FK/check constraint |
| `UNAUTHENTICATED` | 401 | No valid session (or bad internal token); wrong credentials at login |
| `FORBIDDEN` | 403 | Signed in without the permission; self-approval not allowed; disallowed internal caller |
| `NOT_FOUND` | 404 | Record does not exist (or is outside the caller's `own` scope — do not reveal it) |
| `CONFLICT` | 409 | Unique business key exists; pending approval exists; idempotency-key misuse |
| `INVALID_STATE_TRANSITION` | 409 | Change not allowed from the current status |
| `RATE_LIMITED` | 429 | Login throttle (D-020) |
| `INTERNAL` | 500 | Anything unexpected — generic message, details only in logs |

## 2. Platform endpoints (`apps/platform`)

### `GET /api/health` — public
200 `{ "data": { "status": "ok", "app": "@elevate/platform", "module": "platform", "time": "…", "checks": { "database": "ok" } } }`; 503 with `"status": "degraded", "checks": { "database": "unavailable" }` when `SELECT 1` fails or takes > 3 s.

### `POST /api/v1/auth/login` — public
- JSON body `{ "email": string(3..320), "password": string(1..512), "next"?: string }` → 200 `{ "data": { "user": { "id", "email", "displayName", "roles": [..] }, "expiresAt": "…" } }` + `Set-Cookie: elevate_session=…; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax[; Secure]`.
- Form body (`application/x-www-form-urlencoded`, fields `email`, `password`, `next`) → 303 `Location: <next if a safe relative path, else />`, cookie as above; on failure 303 `Location: /login?error=invalid|missing|locked|unavailable&next=…`.
- Errors (JSON): 400 `VALIDATION_FAILED`, 401 `UNAUTHENTICATED` ("Email or password is incorrect." for any credential problem), 429 `RATE_LIMITED`.
- Audited as `auth.login`.

### `POST /api/v1/auth/logout` — any
Revokes the current session (if any), clears the cookie. JSON → 200 `{ "data": { "signedOut": true } }`; form → 303 `Location: /login`. Audited as `auth.logout`.

### `GET /api/v1/auth/me` — permission `authenticated`
200 `{ "data": { "id", "email", "displayName", "roles": [..], "modules": ["platform", …], "permissions": { "<permission>": "all" | "own" } } }`; 401 without a session.

### Pages
`/login` (public), `/` (home; `platform:module:access`), `/dashboard` (`platform:dashboard:read`; states honestly that consolidated reporting arrives in wave 3 — no figures).

## 3. Endpoints every module skeleton provides
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/<base>/api/v1/health` | public | Same shape as the platform health check, `module` = zone |
| POST | `/<base>/api/v1/auth/login` | public | Same contract as the platform login; form failures redirect to `/<base>/login?error=…` |
| POST | `/<base>/api/v1/auth/logout` | any | Form → 303 `/<base>/login` |
| page | `/<base>` | `<module>:module:access` | AppShell home |
| page | `/<base>/login` | public | Standalone sign-in |

## 4. Planned internal endpoints (wave 2/3, contracts fixed now)
| Method | Path | Contract | Callers |
|---|---|---|---|
| GET | `/marketing/api/internal/v1/summary?from=&to=` | `MarketingSummaryV1` | ops, platform |
| GET | `/academic/api/internal/v1/summary?from=&to=` | `AcademicDeliverySummaryV1` | ops, platform |

Status: **Proposed** until the owning module implements and tests them.
