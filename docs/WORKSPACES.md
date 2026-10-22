# Role workspaces (D-072, D-073)

Elevate OS has three workspaces, one per kind of work, on one sign-in and one database.

| Workspace | Local URL | Who works there | Local demo sign-in |
|---|---|---|---|
| Business Operations | http://localhost:3000 (→ `/ops`) | Owner, director, operations manager, admissions counsellors, finance | `business@elevateeducation.in` (operations manager) |
| Academic OS | http://localhost:3001 (→ `/academic`) | Teachers, academic coordinators | `teacher@elevateeducation.in` (teacher) |
| Marketing OS | http://localhost:3002 (→ `/marketing`) | Marketing manager and contributors | `marketing@elevateeducation.in` (marketing manager) |
| Platform (admin) | http://localhost:3003 | Platform administrators: Users & roles, Google sign-in callback | — |

All four URLs are settings (`BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL`, `PLATFORM_URL` in the root `.env`); the dev commands take the port from them.

## Start only what you need

| Command | Starts |
|---|---|
| `npm run dev:business` | Business Operations (:3000) |
| `npm run dev:academic` | Academic OS (:3001) |
| `npm run dev:marketing` | Marketing OS (:3002) |
| `npm run dev:platform` | Platform admin (:3003) |
| `npm run dev:all` (= `npm run dev`) | the three workspaces |

Each command also starts the local PostgreSQL server if nothing is listening on the `DATABASE_URL` port, and reuses it if it is already running (from `npm run db:start` or another dev command): there is never a second database. Stopping the command that started the database stops it, so when you run several commands in separate terminals, start the database yourself with `npm run db:start`. Nothing starts automatically after `npm install`.

A workspace runs on its own. Panels that show another workspace's figures (for example Academic attendance on the Business Operations overview) say **"source unavailable"** while that workspace is not running; they never show 0.

Demo sign-ins (development only):
1. Put a password of at least 12 characters in `LOCAL_DEMO_PASSWORD` in the root `.env`.
2. `npm run db:seed` (departments) and then `npm run db:seed-demo-accounts`. Safe to run again; it never creates duplicates and never prints the password.
3. The script refuses `NODE_ENV=production` and any database that is not on this computer. `npm run db:clear-samples` switches the three accounts off before real use.

The demo teacher has no batches until a coordinator places them on one; the sample teacher `teacher@example.test` (password `SEED_USER_PASSWORD`) has sample classes.

## How sign-in and access work

**Identity.** One person = one `core.users` row with their own password (or Google sign-in) and their stored roles. Every change is audited with that user's id. Staff never share an account; the demo accounts exist only on development machines.

**Membership.** A person belongs to a workspace when one of their roles grants `<workspace>:module:access`. The email address decides nothing.

**After sign-in** (`resolveLanding`, `packages/authorization/src/workspaces.ts`):
1. Signed in on a workspace you belong to → you stay (at the page you asked for, if it is in that workspace).
2. Otherwise → your remembered workspace, if your roles still allow it.
3. Otherwise → your only workspace.
4. Otherwise (several, or none) → the chooser at `<workspace>/workspaces`, which lists only the workspaces you belong to. Tick "Open the one I pick by default next time" to remember the choice (stored per account, audited as `user.workspace_preference_set`).

Redirects go only to the four configured origins and never carry a token. If you open a workspace you do not belong to (for example a teacher opening :3000), every page sends you to your own workspace before anything is loaded.

**Sessions across ports.** Browsers do not separate cookies by port, so the single `elevate_session` cookie (HttpOnly, SameSite=Lax, path `/`, Secure in production, 7-day absolute expiry, only an HMAC of it stored in the database) is shared by every localhost port. One sign-in therefore covers all workspaces you belong to; signing out in any of them revokes the session everywhere. Other local projects on other ports can see a cookie with this name too — use a separate browser profile if you run untrusted local apps. In production each workspace gets its own host name; keep them under one site and the cookie host-only.

**Revoked permissions** take effect on the next request: roles are read from the database on every request, and a disabled account's sessions stop validating immediately.

**Cross-origin requests and CSRF.** Workspaces never call each other from the browser, so no CORS headers are sent anywhere (no wildcard, no credentialed CORS). Every state-changing request (API routes, sign-in, sign-out, the chooser) must come from the request's own origin or one of the four configured origins; a page on any other port or site gets 403. JSON routes accept only `Content-Type: application/json`. Server-to-server summaries use the `INTERNAL_SERVICE_TOKEN` bearer token.

**Authorization.** Role, branch, batch and record scope are enforced on the server: `requirePageAccess` on every page, `defineRoute({ permission })` on every route (including exports and downloads), and `own` scope in the queries (teachers see their own batches and students only). Hiding a menu item is never the control.

## Who owns which data

| Owner | Owns (writes) | Others see it through |
|---|---|---|
| Business Operations (`ops` schema) | admissions, applications, KYC, guardians, fees and instalments, student lifecycle, admission numbers | Academic: the admission → enrolment handoff event; Marketing: lead conversion status only |
| Academic OS (`academic` schema) | sessions/timetable, class delivery, student class attendance, teaching logs, assessments, curriculum progress, teacher-authored student reviews | Business Operations: internal summary routes (`/academic/api/internal/v1/*`) and published reviews |
| Marketing OS (`marketing` schema + the lead workflow) | campaigns, content, metrics imports; lead sources, lead ownership and follow-up activity on the one lead record | Business Operations: marketing summary route; lead records directly (same service) |
| Shared task service (Business Ops code, `ops.staff_tasks`, `ops.eod_*`) | staff tasks and EOD reports | each workspace's own Tasks / EOD screens (D-073) |

One canonical row per student (`core.students`), staff member (`core.staff_members`) and lead (`ops.leads`). No record is copied to show it in another workspace, no screen is scraped, and browser storage is never used to pass data between workspaces. No new events or background jobs were added: every cross-workspace read is a direct query or an existing summary route.

## Role and workspace matrix

<!-- generated by the coordinator from packages/authorization; regenerate with npm run docs:permissions for the full permission list -->
Generated from `packages/authorization` (all = every record, own = the person's own records, — = none). "Workspaces" = roles granting `<workspace>:module:access`. Grants changed on 22 Oct 2026 are **Proposed** until the owner confirms them (D-073): teachers belong only to Academic OS; coordinators to Academic OS and Business Operations; marketing roles get leads, lead contacts (`ops:lead_contacts:read`: the contact fields on a lead, never KYC) and their own tasks/EOD.

| Role | Workspaces | Leads | Admissions | Lead contacts | Student KYC / private | Fees | Own tasks/EOD | EOD review | Academic students | Attendance record | Student reviews | Campaigns/content | Users & roles |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Platform administrator | — (platform only) | — | — | — | — | — | — | — | — | — | — | — | all |
| Director | Business Ops, Academic, Marketing | all | all | — | — | all | own | all | all | — | all | all | — |
| Marketing manager | Marketing | all | — | all | — | — | own | — | — | — | — | all | — |
| Marketing contributor | Marketing | own | — | own | — | — | own | — | — | — | — | all | — |
| Academic coordinator | Business Ops, Academic | — | — | — | — | — | own | — | all | all | all | — | — |
| Teacher | Academic | — | — | — | — | — | own | — | own | own | own | — | — |
| Admissions counsellor | Business Ops | own | own | — | own | own | own | — | — | — | — | — | — |
| Operations manager | Business Ops | all | all | all | all | all | all | all | — | — | — | — | — |
| Auditor | Business Ops, Academic, Marketing | all | all | — | — | all | — | — | all | — | all | all | — |
| Finance-authorised user | Business Ops | — | all | — | — | all | own | — | — | — | — | — | — |

## What changed (file structure)

```
packages/configuration/src/workspaces.ts      origins, allowlist, isAllowedRequestOrigin
packages/authorization/src/workspaces.ts      WORKSPACE_KEYS, workspacesFor, resolveLanding
packages/authentication/src/login.ts          landingFor/landingLocation, cross-site refusal, createWorkspaceChoiceHandler
packages/server-kit/src/next.ts               requirePageAccess({ workspace }), workspaceHrefs()
packages/server-kit/src/define-route.ts       Origin check, exact JSON media type
packages/shared-ui/src/components/workspaces.tsx   the chooser
packages/database/src/seed/demo-accounts.ts   demo sign-ins + guard; migration 0013 (users.preferred_workspace)
scripts/development/dev.mjs                   per-workspace dev launcher
scripts/development/seed-demo-accounts.ts     npm run db:seed-demo-accounts
apps/<workspace>/src/app/workspaces/page.tsx  chooser page; api/v1/auth/workspace/route.ts
apps/business-ops-os  work.ts / leads.ts entry points (D-073)
```

## Verification (22 Oct 2026)

| Check | Result |
|---|---|
| `npm run validate` | exit 0 — 183 test files, 2,556 tests, lint 0 warnings, secret scan OK |
| Build, four apps (`npm run build -w @elevate/<app> -- --webpack`) | exit 0 for all four ("Compiled successfully") |
| Wrong-port sign-in (real form, headless Chrome) | marketing@ on :3000 → :3002/marketing; teacher@ on :3002 → :3001/academic; business@ on :3001 → :3000/ops |
| Opening another workspace | teacher on /ops/students → :3001/academic; marketing session on an Ops page → :3002/marketing |
| Direct API requests | non-member → 403 "Your roles do not include this workspace."; teacher A → 404 on teacher B's task; marketing → 403 on students, KYC, fees, admissions, reviews; KYC columns absent from marketing's lead view |
| CSRF | cross-site login/logout/chooser and API writes → 403; `text/plain;application/json` → 400 |
| Screens | 25 pages × 390 / 1440 px: no console errors, no horizontal scroll, focus ring on first Tab |
| One workspace alone | `npm run dev:business` starts one Next server and reuses the running database |
| Demo seed in production | `NODE_ENV=production` or a remote `DATABASE_URL` → refused, nothing written |

## Memory, measured on this PC (16 GB, webpack dev, after opening 5 pages per workspace)

| Running | Node working set | Node private bytes | Free RAM afterwards |
|---|---|---|---|
| `dev:business` (one workspace) | 1,837 MB | 2,253 MB | 5,038 MB |
| `dev:all` (three workspaces) | 4,760 MB | 5,552 MB | 2,229 MB |
| PostgreSQL (shared, any of the above) | 50 MB (11 processes) | — | — |

Separate ports do not save memory by themselves; starting only the workspace you work in does. The old default `npm run dev` started four servers (the three workspaces plus the platform); it was not measured again here because the machine had about 2 GB free with three running. Every list is paginated on the server, no screen polls, and no workspace loads another's data in the browser.

## Known limitations
- A panel that shows another workspace's figures says "source unavailable" while that workspace is not running.
- Google sign-in needs the platform app (:3003) running; its redirect URI is now `http://localhost:3003/api/v1/auth/google/callback`.
- Not built (owner decisions first): teacher staff attendance ("My Attendance"), Resources, Events and Webinars in Marketing (needs an events-only permission), conversion outcomes by campaign (enquiries hold a free-text campaign note), leads by source (needs an attribution rule).
- Teachers no longer see approved feedback about themselves (it was an Ops view).
- The `Elevate.html` prototype does not show the workspaces.

