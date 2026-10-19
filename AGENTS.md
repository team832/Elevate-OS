# AGENTS.md — rules for coding agents

Read before changing anything: `docs/DECISIONS.md`, `docs/BUILD_PLAN.md`, `INTEGRATION_CONTRACT.md`, and the README of every package you touch.

## Non-negotiable
1. **Stay in your files.** Edit only paths your wave owns (`docs/BUILD_PLAN.md` → file ownership). Anything else → write a request in your module's `docs/INTEGRATION_REQUESTS.md` and continue.
2. **Never import another module.** No `@elevate/<other>-os`, no relative paths into another app. Talk through `@elevate/shared-contracts` (events, summaries) or an API. ESLint enforces this.
3. **Never write another module's schema** or add foreign keys between module schemas. FKs into `core` are fine. Write `core` tables only through the shared packages (or as the designated steward).
4. **Permissions are checked on the server** for every route (`defineRoute({ permission })`) and page (`requirePageAccess`). Hiding UI is not security. Declare new permissions in your module's permission file with least-privilege grants; the auditor gets only `read`/`access`.
5. **Change state inside a transaction** and record it: `withTransaction` + `recordAudit` (+ `publishEvent` / `notify` when others must react).
6. **Missing is not zero.** Unknown or unavailable data is shown as missing/unavailable (`metric.missing`, `SourceResult`), never as 0. Planned counts are never shown as delivered.
7. **No fake data presented as real.** Seeds and tests use fictional people (`@example.test`, names marked "(fictional)"). External systems are mock adapters that never claim a connection (D-014).
8. **No secrets in the repo.** Real values only in the git-ignored root `.env`. Test fixtures use `test-only-` values. `npm run secret-scan` must pass.
9. **Status words mean what D-013 says.** Proposed → Approved → Implemented → Tested (a passing automated test recorded in `IMPLEMENTATION_STATUS.md`) → Deployed (evidence required). Nothing is Deployed.
10. **Do not run `npm run db:generate` in wave 2**, do not commit migrations, and never run `db:reset`/`db:seed` against a non-local database.
11. **Keep the build green:** `npm run typecheck && npm run lint && npm test` must pass when you hand over. Do not commit unless asked.
12. **Business choices are the owner's.** Where requirements need a leadership decision, expose it as configuration or an approval state; do not silently pick.

## Conventions that bite
- `src/domain/**` is pure: no Next/React, database, server-kit or Node I/O imports.
- Schema files use only `import type` from workspace packages; prefix exports with your module (`opsLeads`).
- In module apps, pass **browser paths** (with basePath) to `requirePageAccess`/`requireUser`; never call `redirect('/academic/…')` directly — Next adds the basePath itself (D-022).
- Do not add `loading.tsx` to permission-checked pages — at the root **or nested** — it turns the signed-out 307 into a 200 page load (D-022, corrected). Show loading states after the access check instead.
- Links to other zones are plain `<a href="/ops">`, not `<Link>`.
- Route bodies are JSON (`Content-Type: application/json`); errors are thrown `AppError`s, never ad-hoc JSON.
- Dates: `YYYY-MM-DD` in Asia/Kolkata for calendar days; UTC instants for timestamps.
- Integration events: `<producer>.<aggregate>.<past-tense verb>`, versioned, idempotency key per business fact.
- Windows + Git Bash: prefix curl commands containing `=/path` arguments with `MSYS_NO_PATHCONV=1`.

## Before you finish
- Tests for normal, boundary, missing, invalid and conflicting cases; 401/403/400/2xx for routes.
- Update your module README, `requirements/REQUIREMENTS.md`, `docs/API.md`, and your section of `IMPLEMENTATION_STATUS.md` with the exact commands you ran and their results.
