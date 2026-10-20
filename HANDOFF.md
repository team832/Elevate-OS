# Elevate OS — handoff

_Last updated 20 Oct 2026. Branch `feature/business-ops-hr-admissions`. Nothing is deployed yet._

## For the owner (plain language)

**What it is.** Elevate OS is the internal system your staff sign in to. It has three parts: Marketing, Academic and Business Operations (admissions, HR, tasks, SOPs). It also has a home page with a leadership overview. Only `@elevateeducation.in` accounts can use it (decision D-030).

**What works today.** All three parts are built and pass their automated tests on a developer's computer. The data in it is fictional sample data. It is **not on the internet yet**. Where it will be hosted is your decision, and so is the account it runs under.

**What it needs from you.** `PLACEHOLDERS.md` lists every fact only you can supply: staff and roles, fees, holidays, leave rules, policies, targets and the logo file. The numbered open business decisions (OD-001 to OD-048) are in `docs/EXISTING_PROJECT_AUDIT.md` §9. Until you answer them, the system shows "Proposed" or "Not available". It never makes up a number.

**What is not connected yet.** Email sending, the social-media publishing tool, document uploads, a biometric attendance device and a CRM are all "pretend" connections (mock adapters). They record what would happen and never claim it happened. "Sign in with Google" needs a client ID from your Google account (`docs/GOOGLE_SIGN_IN_SETUP.md`).

**Security.** Every page checks who is signed in and what they may see. Pages also send the standard browser protections against embedding, script injection and sniffing (details below). Passwords and keys are kept out of the code, in a private settings file (`.env`) that is never uploaded.

---

## 1. What was built and what was not

| Area | State | Where to read more |
|---|---|---|
| Foundation (sign-in, sessions, roles, audit, outbox, approvals, shared UI) | Implemented, Tested | `IMPLEMENTATION_STATUS.md` |
| Marketing OS, Academic OS, Business Ops OS (incl. HR, D-028) | Implemented, Tested | `IMPLEMENTATION_STATUS.md`, `apps/*/README.md` |
| Baseline migration `0000_baseline.sql` | Implemented | `docs/DATABASE_MIGRATION_PLAN.md` |
| Security headers and CSP with per-request nonces (all four apps) | Implemented, Tested (unit test + production smoke, §6) | §5 below |
| Google sign-in | Being built in parallel; needs the owner's OAuth client | `docs/GOOGLE_SIGN_IN_SETUP.md` |
| Deployment, hosting, domain, monitoring, backups schedule | **Not built** (Proposed only) | `infrastructure/deployment/README.md` |
| Password reset and account-admin screens, shared login rate limit, outbox scheduler | **Not built** | `infrastructure/deployment/README.md` "Must be resolved before go-live" |
| Business facts (fees, holidays, staff, policies, targets) | **Missing — owner** | `PLACEHOLDERS.md`; OD-001…OD-048 in `docs/EXISTING_PROJECT_AUDIT.md` §9 |

Status words follow D-013: Proposed → Approved → Implemented → Tested → Deployed. Nothing is Deployed.

Sections of `website-build-guidelines` judged **not applicable**, and why: §10 SEO (an internal app behind a login; every response sends `X-Robots-Tag: noindex, nofollow` and pages set `robots: noindex`), and the public-site parts of §13 (no cookie banner: the only cookies are the essential session and sign-in-state cookies; no analytics or third-party embeds). The privacy notice for staff data (DPDP) is still owed, needs the owner's input and is marked `needs lawyer review`.

## 2. Stack and why

Node 24, npm workspaces, TypeScript (strict), Next.js 16.4.2 App Router as **four apps**: the platform on `/` plus one per module on `/marketing`, `/academic` and `/ops`. The platform rewrites the module paths, so staff see one site with one session cookie (D-004). The database is PostgreSQL with one schema per domain, through Drizzle ORM (D-005, D-006), with zod validation (D-007), vitest and ESLint module-boundary rules (D-023). Styling is plain CSS tokens with system fonts. No external CDN and no tracking scripts. Every version is pinned (D-018). The full reasoning is in `docs/DECISIONS.md` and README §3.

## 3. How to run locally

```bash
npm install
cp .env.example .env        # fill every "replace-with-…" value (README §5)
npm run db:start            # terminal 1: local PostgreSQL 18 on 127.0.0.1:54320; leave running
npm run db:migrate
npm run db:seed             # local databases only (refuses others)
npm run dev                 # terminal 2: all four apps; open http://localhost:3000
```

Production-like run: `npm run build`, then `npm run start -w @elevate/<module>-os` for each module, then `npm run start -w @elevate/platform`.

The seed users are fictional `@example.test` accounts. Since D-030 they cannot sign in, so a local sign-in needs a local `@elevateeducation.in` user or Google sign-in.

Checks: `npm run validate` runs typecheck, lint, tests and the secret scan. `npm run build` builds all four apps.

Never run `db:reset` or `db:seed` against a non-local database. `pg_dump` is not installed (D-024), so install the PostgreSQL client tools before relying on `npm run db:backup`.

## 4. How deployment will work

**Nothing is deployed.** The hosting provider, database provider and domain are **owner decisions**. The proposed shape is in `infrastructure/deployment/README.md`:
- Only the platform is public, over HTTPS.
- The three module apps run on a private network.
- PostgreSQL is a managed service with backups.
- CI runs `npm ci`, then `validate`, then `build`, then migrates after a verified backup.

Two settings are compiled in at **build** time, so set them before `npm run build`:
- The module URLs, for the rewrites.
- `PLATFORM_URL`. If it starts with `https://`, the build turns on HSTS and `upgrade-insecure-requests`.

## 5. Security headers (what was added 20 Oct 2026)

- **Static headers** come from `packages/configuration/src/security-headers.ts` → `securityHeaders()`, used by each app's `next.config.ts` `headers()`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `X-Robots-Tag: noindex, nofollow`
  - `Strict-Transport-Security: max-age=31536000`, only when served over https.
  - `poweredByHeader: false`, so there is no `X-Powered-By`.
- **CSP with a fresh nonce per request** is set by each app's `src/proxy.ts` through `withContentSecurityPolicy()`. Next reads the nonce from the request's CSP header and stamps it on its own scripts and styles. The production policy:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`
  - `style-src 'self' 'nonce-…'`
  - `style-src-attr 'unsafe-inline'`
  - `img-src 'self' data:`
  - `font-src 'self'`
  - `connect-src 'self'`
  - `object-src 'none'`
  - `base-uri 'self'`
  - `form-action 'self'`
  - `frame-ancestors 'none'`
  - plus `upgrade-insecure-requests` over https.
- **Why `style-src-attr 'unsafe-inline'`:** React `style={…}` props, which the pages use, render as `style=""` attributes, and nonces cannot cover attributes. Style attributes cannot run script. `<style>` elements still need the nonce.
- **Development** (`next dev`) relaxes the policy only for what Next needs: `'unsafe-eval'` for React dev error stacks, `'unsafe-inline'` styles for the dev overlay, and `ws:`/`wss:` for hot reload.
- **Multi-zone:** the platform's `headers()` skips `/marketing`, `/academic` and `/ops`. Each module app sets its own headers and CSP, and they pass through the platform's rewrite unchanged (verified with curl, §6).
- Nonces require per-request rendering. Every page is dynamic, including `not-found.tsx`, which calls `connection()`.
- **Do not** add a `<form action>` that redirects to another site, such as a Google sign-in start. `form-action 'self'` blocks it. Use a plain link.
- HSTS has no `includeSubDomains` yet. Add it once the owner confirms that no `elevateeducation.in` subdomain is HTTP-only.

## 6. Verification results

Run by the security agent on 20 Oct 2026 (Windows 11, Node 24.19.0):

| Check | Result |
|---|---|
| `npm test` (whole suite) | `Test Files 95 passed (95)` · `Tests 1064 passed \| 1 todo (1065)` |
| `npx vitest run --project configuration` | 2 files, 12 tests passed (incl. `tests/security-headers.test.ts`) |
| `npx eslint . --max-warnings=0` | 0 problems |
| `npm run typecheck` | exit 0 on the final run (an earlier run showed 3 errors in `apps/platform/tests/integration/overview.test.ts` from the Overview work in progress; they were fixed by the end) |
| `npm run secret-scan` | `secret-scan — OK (974 files checked, no secrets or .env files found).` |
| `npm run build` | exit 0; every route is dynamic (ƒ), including `/_not-found` |
| Signed-out GET via platform `:3000` | `/`, `/dashboard` → 307 `/login`. `/ops`, `/marketing`, `/academic` and `/academic/{timetable,assessments,batches,curriculum,intake,progress,students,teaching}` → 307 to the zone's `/login`. `/ops/leads`, `/marketing/ideas` → 307 |
| Missing pages | `/ops/no-such-page`, `/academic/no-such-page`, `/marketing/no-such-page` → 404. `/no-such-page` → 307 to login when signed out (by design), 404 with a session cookie |
| `curl -sI` headers | All headers in §5 are present on platform and module pages, and through the rewrite. No `X-Powered-By`. Each response has a new nonce. Every `<script>` (12 on `/login`) carries the matching nonce |
| Browser (Chrome) | Production `/login`, `/academic/login`, `/marketing/login`, `/ops/no-such-page`: no console errors (no CSP violations). Dev: `/academic/login` through the platform shows `[HMR] connected` and no CSP errors |
| Banned-pattern grep (Appendix C) | No hits in production code. `console.log` appears only in CLI scripts (`scripts/**`, `packages/shared-ui/scripts/brand-logo.mjs`), on purpose, as their output. Prose "any" in comments is not a type. Copy grep: brand-name hits only (exempt) |
| Data exposure spot check (§6.6) | `password_hash` is read only in `packages/authentication/src/login.ts`. Every join with `core.users` selects named columns. Session `token_hash` never leaves `sessions.ts` |

Not verified: pages behind sign-in in a browser (the seed users are `@example.test`, which D-030 rejects); axe, Lighthouse and keyboard passes. These belong to the release run.

### Final verification — filled at release
_To be filled by the orchestrator: `npm run validate`, `npm run build`, smoke test, axe, Lighthouse, keyboard pass, `npm audit`._

## 7. Where secrets live and how to rotate them

Real values live only in the git-ignored root `.env` (locally) or in the host's secret store (later). `.env.example` lists the keys without values. `npm run secret-scan` fails on credential-like text.

| Secret | Rotate by |
|---|---|
| `SESSION_SECRET` | Set a new value (≥ 32 chars) in all four apps and restart them. Everyone is signed out |
| `INTERNAL_SERVICE_TOKEN` | Set a new value, the same in all four apps, and restart them together |
| `DATABASE_URL` password | Change the password in PostgreSQL, update `DATABASE_URL`, restart |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console → the OAuth client → reset the secret, paste the new one, restart the platform |
| `SEED_USER_PASSWORD` | Local development only; change it and re-run `db:seed` |

If a secret is ever committed, rotate it. Deleting the commit is not enough.

## 8. Third-party services

| Service | Purpose | Status | Account owner |
|---|---|---|---|
| Google OAuth | "Sign in with Google" | Code in progress; needs the owner's client ID and secret | Owner (to create) |
| Email sending | Reminders | Mock adapter (`packages/notifications`): records, sends nothing | — |
| Publishing / metrics tool (e.g. Metricool, YouTube) | Marketing posting and numbers | Mock adapter: "SANDBOX: nothing was posted" | — |
| CRM | Lead sync | Mock adapter (`apps/business-ops-os/src/server/adapters/crm.ts`) | — |
| Document storage | HR and admission documents | Mock adapter: references only, no files | — |
| Attendance device / provider | Staff attendance | Mock adapter; manual entry and CSV import work | — |
| Hosting, managed PostgreSQL, domain | Going live | Not chosen (owner decision) | Owner |

None of these costs money today.

## 9. Where to change content

Business content is data, so it is entered on the screens, not in code. For example, to add a company policy: sign in as an operations manager, open **Business Ops → Settings → Policies & compliance**, add the policy (it starts as a draft), and have a second person approve it. Programmes, departments, shift templates and leave types are edited the same way under each module's settings. Interface wording is in each app's `src/app/**/page.tsx` and needs a developer.

## 10. Known limitations and the next three improvements

Limitations:
- No password reset.
- The login throttle is per process.
- There is no outbox scheduler; the intake is run by hand.
- Module services often `select()` whole module rows. None are secret, but §6.6 prefers named columns, so that is a follow-up.
- Error and 404 pages use an `h2` with no `h1`.
- Signed-in screens were not browser-checked against the CSP.

Next three improvements, in priority order:
1. **Go-live basics.** The owner chooses hosting. Then build HTTPS, CI deploy, error monitoring, an uptime check and a tested backup and restore (§15.1).
2. **Account safety.** Password reset, a shared login rate limit (by IP and account), and account-admin screens.
3. **Release QA.** axe, keyboard and Lighthouse passes on every template, signed-in, with a real `@elevateeducation.in` test user. Then narrow whole-row `select()` calls to the fields each screen needs.

## 11. Licences

- **Logo:** `apps/*/public/brand/elevate-logo.png` and `favicon.ico` belong to the owner (Elevate Education).
- **Fonts:** system fonts only (Segoe UI and platform fallbacks), so none are shipped.
- **No third-party images.**
- **npm dependencies:** all come from the public npm registry, and the project itself is `UNLICENSED` (private). A census of installed packages on 20 Oct 2026 found:
  - MIT 204, Apache-2.0 24, ISC 19, BSD-2-Clause 6, BSD-3-Clause 3, MPL-2.0 2, 0BSD 1, BlueOak-1.0.0 1, CC-BY-4.0 1 (data).
  - One package is "Apache-2.0 AND LGPL-3.0-or-later": `@img/sharp-win32-x64`, the libvips binary used by Next's image optimiser and loaded dynamically.
  - The two MPL-2.0 packages are `lightningcss`, a build-time CSS tool.
  - None are copyleft-incompatible with private use.
- To re-list licences without new dependencies, read the `license` field of every `node_modules/**/package.json`. `npm ls --all` lists the tree.

## 12. Known `npm audit` advisories (8, development tools only)

`npm audit` on 20 Oct 2026 reports 4 high and 4 moderate advisories, 0 critical. None are in code that runs in production:
- **High:** `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`, a stack-exhaustion denial of service from deeply nested glob patterns. It only runs inside ESLint, on our own patterns.
- **Moderate:** `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`, where the esbuild dev server lets a website read its responses. `drizzle-kit` only generates migrations and never starts that server.

They are not fixed because the fixes need a major downgrade or upgrade of the lint plugin or drizzle-kit. Versions are pinned (D-018), and neither tool ships to production. Re-check when Next or drizzle-kit release updates.

## 13. Maintenance

- **Automatic:** nothing yet; there is no deploy or monitoring.
- **Recommended once live:**
  - Dependabot or Renovate for dependency updates, with the owner merging them.
  - Daily database backups with a monthly restore test.
  - An uptime alert to the owner's email.
- **Owner monthly glance:** the site loads, and the reminder emails arrive (once email is connected).

To hand this to a developer, point them to `README.md`, `AGENTS.md`, `docs/DECISIONS.md` and this file.
