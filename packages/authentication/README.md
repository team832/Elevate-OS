# @elevate/authentication

Passwords, sessions and the shared `elevate_session` cookie (D-008).

## Passwords (`src/password.ts`)
- `hashPassword(pw)` — scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random salt) via `node:crypto`; stored as `scrypt$N$r$p$salt$hash`. Minimum length 10, maximum 512.
- `verifyPassword(pw, stored)` — constant-time; returns false (never throws) for malformed hashes.
- `needsRehash(stored)`; `burnVerificationTime(pw)` equalises timing for unknown emails.

## Sessions (`src/sessions.ts`)
- `createSession(db, { userId, secret, ttlMs?, ipAddress?, userAgent? })` → `{ token, sessionId, expiresAt }`. Token = 32 random bytes (base64url). **Only `HMAC-SHA256(SESSION_SECRET, token)` is stored** in `core.sessions.token_hash`.
- `validateSession(db, token, secret, now?)` → `AuthenticatedUser | null` (`{ id, email, displayName, roles, sessionId }`). Null when unknown, expired, revoked, or the user is disabled. Refreshes `last_seen_at` at most every 5 minutes.
- `revokeSessionByToken`, `revokeAllSessionsForUser`, `purgeOldSessions`, `loadRoles`.
- Lifetime: 7 days absolute (`SESSION_TTL_MS`), not extended by activity. Rotating `SESSION_SECRET` signs everyone out.

## Cookie (`src/cookies.ts`)
`elevate_session`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, plus `Secure` when `NODE_ENV=production`. Same host for all zones through the platform rewrites, so one sign-in covers every module. Note that the Secure flag means production must be served over HTTPS (`next start` locally is plain HTTP: browsers accept Secure cookies on `localhost`, other hostnames will not).

## Route handlers (`src/login.ts`)
- `createLoginHandler({ module, loginPath, defaultRedirect })` — POST; JSON body `{ email, password, next? }` → `{ data: { user, expiresAt } }` + Set-Cookie; HTML form → 303 to the safe relative `next` (or back to `loginPath?error=invalid|missing|locked|unavailable`). Generic error text; login audited (`auth.login`).
- `createLogoutHandler(...)` — revokes the session, clears the cookie, audits `auth.logout`; form → 303 to `loginPath`.
- `getUserFromRequest(request, db?)`, `checkPassword(db, email, pw)`, `getSessionSecret()`.

## Next.js (`@elevate/authentication/next`)
`getCurrentUser()` reads the cookie with `next/headers`. For page redirects use `requirePageAccess` / `requireUser` from `@elevate/server-kit/next` (basePath-aware).

## Throttling — known limitation
`LoginThrottle` (in memory, per process): 5 failures per (email, IP) in 15 min → 15 min lock (429 `RATE_LIMITED`); 50 failures per IP → lock. It resets on restart and is not shared between apps or replicas. Before any internet exposure add a shared (DB- or proxy-level) limiter — see `docs/SECURITY_AND_PERMISSIONS.md`.

Tests: `tests/password.test.ts`, `tests/sessions.test.ts`.
