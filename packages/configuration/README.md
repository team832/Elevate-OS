# @elevate/configuration

Validated environment loading. Every variable Elevate OS reads is declared once in `src/env.ts` (`ENV_FIELDS`) with a zod rule and a description.

```ts
import { loadEnv } from '@elevate/configuration';
const env = loadEnv('marketing'); // typed; throws ConfigurationError listing ALL problems
```

Subsets (`ENV_SUBSETS`): `platform`, `marketing`, `academic`, `ops`, `server`, `database`, `seed`, `googleSignIn` (`PLATFORM_URL` plus the optional `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; unset means Google sign-in is off). `BOOTSTRAP_OWNER_EMAILS` (optional, read at sign-in by @elevate/authentication) parses to a lower-cased list and accepts only exact `@elevateeducation.in` addresses. A missing or placeholder value (`replace-with…`) fails with a message like:

```
Invalid environment configuration for "platform" — 2 problem(s):
  - SESSION_SECRET: missing
      (HMAC key for session tokens (>= 32 chars). Changing it signs everyone out.)
  ...
```

Other exports:
- `loadRootEnv()` — loads `<repo>/.env` into `process.env` without overwriting existing values; scripts call it, and the Next.js apps load it through `zoneConfig()`.
- `findRepoRoot()`, `isLocalDatabaseUrl(url)` (used by `db:reset` / `db:start` safety checks).
- `zoneConfig({ basePath?, env, … })` (`@elevate/configuration/next-config`, 6 Nov 2026) — the one `next.config` of all four apps: root `.env`, base path and `/` redirect, security headers, shared `transpilePackages`, standalone output for `release:package`, and the memory flags `webpackMemoryOptimizations` and `preloadEntriesOnStart: false` (not yet measured). Test: `tests/next-config.test.ts`.
- `securityHeaders()` (`/security-headers`); `appOrigin()` and the origin checks (`/workspaces`).

Load configuration lazily (inside a handler or a memoised getter), never at module top level — `next build` evaluates modules without a database.

Adding a variable: add it to `ENV_FIELDS`, the right subsets, `.env.example` (placeholder + explanation) and the root README's environment table.

Tests: `tests/env.test.ts`.
