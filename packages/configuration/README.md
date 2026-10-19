# @elevate/configuration

Validated environment loading. Every variable Elevate OS reads is declared once in `src/env.ts` (`ENV_FIELDS`) with a zod rule and a description.

```ts
import { loadEnv } from '@elevate/configuration';
const env = loadEnv('marketing'); // typed; throws ConfigurationError listing ALL problems
```

Subsets (`ENV_SUBSETS`): `platform`, `marketing`, `academic`, `ops`, `server`, `database`, `seed`. A missing or placeholder value (`replace-with…`) fails with a message like:

```
Invalid environment configuration for "platform" — 2 problem(s):
  - SESSION_SECRET: missing
      (HMAC key for session tokens (>= 32 chars). Changing it signs everyone out.)
  ...
```

Other exports:
- `loadRootEnv()` — loads `<repo>/.env` into `process.env` for scripts without overwriting existing values (Next.js apps use `@next/env` in `next.config.ts` instead).
- `findRepoRoot()`, `isLocalDatabaseUrl(url)` (used by `db:reset` / `db:start` safety checks).

Load configuration lazily (inside a handler or a memoised getter), never at module top level — `next build` evaluates modules without a database.

Adding a variable: add it to `ENV_FIELDS`, the right subsets, `.env.example` (placeholder + explanation) and the root README's environment table.

Tests: `tests/env.test.ts`.
