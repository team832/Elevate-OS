# @elevate/testing

Helpers for vitest tests in packages and module apps (add `"@elevate/testing": "0.1.0"` to your devDependencies).

| Helper | What it does |
|---|---|
| `setupTestDatabase()` | Registers `beforeAll`/`afterAll`: a fresh in-memory PGlite with the full current schema (all four schema files), installed as `getDb()` so `defineRoute` handlers use it. Returns `{ db, test }` getters. |
| `createTestDb()` | Same database without hooks (re-exported from `@elevate/database/testing`). |
| `createTestUser(db, { roles, email?, displayName?, password?, status? })` | Inserts a fictional `@example.test` user, its roles and an active session; returns the `AuthenticatedUser` plus `token` and `password`. |
| `buildRequest(path, { method?, json?, headers?, origin? })` | A `Request` with no session. |
| `authedRequest(user, path, options)` | Same, with the user's `elevate_session` cookie. |
| `callRoute(handler, request, params?)` | Calls a route handler (as Next.js would, with `{ params: Promise }`) and parses the D-012 envelope into `{ ok, status, data | error, meta, headers }`. |
| `testSessionSecret()` | The test SESSION_SECRET from `vitest.shared.ts`. |

Use the shared vitest preset in your `vitest.config.ts`:

```ts
import { defineProject } from 'vitest/config';
import { sharedTest } from '../../vitest.shared';
export default defineProject({ test: { ...sharedTest, name: 'academic-os' } });
```

Tests: `tests/testing.test.ts`.
