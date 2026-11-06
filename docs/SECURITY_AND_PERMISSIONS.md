# Security and Permissions

Status of everything here: **Implemented + Tested** in the Foundation wave unless marked otherwise. Nothing is Deployed.

## 1. Identity and sessions
| Topic | Rule | Code |
|---|---|---|
| Accounts | One user table `core.users`; email stored lower-case and unique; `status` `active`/`disabled` | `packages/database/src/schema/core.ts` |
| Passwords | scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte salt), constant-time verify, min 10 / max 512 chars; unknown emails spend equal time | `packages/authentication/src/password.ts` |
| Sessions | 32-byte random token in the cookie; DB stores only `HMAC-SHA256(SESSION_SECRET, token)`; 7-day absolute expiry; revocation per session or per user; disabled users lose access immediately | `packages/authentication/src/sessions.ts` |
| Cookie | `elevate_session`; `HttpOnly; SameSite=Lax; Path=/`; `Secure` when `NODE_ENV=production` | `packages/authentication/src/cookies.ts` |
| Student and parent portal (D-150, 6 Nov 2026; `portal.enabled` Proposed off) | Kept apart from staff sign-in. Portal logins are `<login>@portal.invalid` (`users_email_domain` allows them; `isAllowedEmail` refuses them on every staff sign-in path, password and Google). Roles `student` and `guardian` hold only `platform:portal:access` (own): no workspace, no `platform:module:access`; the staff role editor and staff lists never show or give them, and a portal session keeps only portal roles. Own cookie `elevate_portal` (same flags), read only by `validatePortalSession`, so a portal sign-in never opens or replaces a staff session. Accounts only by staff from the student record; a one-time 8-character setup code (7 days, stored as HMAC-SHA256(`SESSION_SECRET`, "portal-setup|" + code), one live code per login) is printed on a slip. Every portal page scopes to the linked students (any other id: 404), re-checks that the account, the guardian row and (for students aged 18 or over) `portal.guardian_access_to_adults` still allow it, and the receipt download checks ownership first. Archiving a guardian switches the login, its sessions and codes off | `packages/authentication/src/portal.ts`, `apps/platform/src/app/portal/`, `apps/business-ops-os/src/server/portal-access.ts`, `portal-switch-off.ts`; tests `apps/platform/tests/integration/portal.test.ts`, `packages/authentication/tests/portal.test.ts`, `apps/business-ops-os/tests/integration/portal-access.test.ts` |
| One sign-in for all workspaces (D-072, 22 Oct 2026) | Each workspace runs on its own origin (`:3000` Business Operations, `:3001` Academic, `:3002` Marketing, `:3003` platform). Browsers do not separate cookies by port, so the one host-only `elevate_session` cookie is sent to every local port and every app validates it against the same `core.sessions`. Signing out on any port revokes the server session everywhere. Other local programs on other ports can also see a cookie of this name: use a separate browser profile when running untrusted local apps. In production each workspace gets its own host name under one site, with the cookie kept host-only. The platform's rewrites (D-004) remain an optional single-origin gateway | `packages/authentication/tests/workspace-login.test.ts`, `sessions.test.ts` |
| Workspace membership (D-072) | A person belongs to a workspace when a stored role grants `<workspace>:module:access` (`workspacesFor`); the email address decides nothing. Pages: `requirePageAccess(…, { workspace })` redirects a non-member to their own workspace (or the chooser) before any data loads. Routes: `defineRoute` answers 403 "Your roles do not include this workspace." on any path under `/ops`, `/academic` or `/marketing` without that workspace's `module:access`, even when the route's own permission is held. **Enforced since 31 Oct 2026 (D-113):** Next strips the base path before a handler runs, so until then this check did not run on `next dev` or `next start`. Each `next.config.ts` declares `ELEVATE_BASE_PATH`; a production build without it answers 500 (Turbopack not proven). Roles are read on every request, so a removed role or disabled account takes effect on the next click | `packages/authorization/src/workspaces.ts`, `packages/server-kit/src/next.ts`, `define-route.ts`; tests `packages/authorization/tests/workspaces.test.ts`, `packages/server-kit/tests/define-route.test.ts` |
| Landing after sign-in | `resolveLanding`: a member stays where they signed in (deep link kept); else the remembered workspace (`core.users.preferred_workspace`, migration 0013, set from the chooser with "remember" and audited `user.workspace_preference_set`) if still permitted; else the only workspace; else the chooser `<base>/workspaces`. Redirects go only to the four configured origins and never carry a token | `packages/authentication/src/login.ts`; test `workspace-login.test.ts` |
| Demo accounts (development only) | `npm run db:seed-demo-accounts` creates `business@`, `teacher@`, `marketing@elevateeducation.in` with one shared `LOCAL_DEMO_PASSWORD`; it refuses `NODE_ENV=production`, a non-local database and any email already owned by another account; `db:clear-samples` disables them and removes the password. Staff never share these accounts | `packages/database/src/seed/demo-accounts.ts`; test `packages/database/tests/demo-accounts.test.ts` |
| Login errors | Generic "Email or password is incorrect." for unknown email, wrong password and disabled user | `packages/authentication/src/login.ts` |
| Open redirects | Post-login `next` must be a same-site relative path (`safeRelativePath`); since 22 Oct 2026 control characters (tab, newline …) and backslashes are refused too, because browsers drop the first and read `\` as `/` (`/\t/evil` would become `//evil`) | `packages/shared-contracts/src/http.ts`; test `packages/shared-contracts/tests/safe-path.test.ts` |
| Login throttling | 5 failures per (email, IP), 20 per email from any IP (26 Oct 2026), 50 per IP, each in 15 min → 15-min lock; 429 `RATE_LIMITED`; Google refusals 50 per IP; re-entering a password to confirm 5. Since 6 Nov 2026 counted once for every app and process in `core.login_attempts` (migration `0019`), one atomic upsert per failure, kept across restarts; the key is stored only as HMAC-SHA256(`SESSION_SECRET`, bucket and key), never the raw email or address; without `SESSION_SECRET` sign-in is refused. Attempts count while in flight: 60 wrong at once, 5 checked. The per-email limit lets anyone lock a person out of every workspace for 15 minutes. Expired counts are deleted by the housekeeping job. Since 6 Nov 2026 a re-entered password is counted before it is checked, so a burst of 20 checks the password exactly 5 times (FR-A I1); a Google refusal that cannot be counted sends the person back with "unavailable", not a 500. **Portal and website-form buckets (Proposed, D-150, D-152)**, all per 15 minutes and never the staff buckets: `portal` 5 per login and address, `portal-ip` 50 per address (sign-in and setup), `portal-login` 20 per login from any address, `portal-setup` 5 per login, `portal-all` 500 and `portal-setup-all` 200 for every address together, `website-form` 5 per address, `website-form-all` 300 for every address together. The global ceilings exist because an address can be forged (item 5); their cost: once `portal-all` is reached **every family** is locked out of portal sign-in for 15 minutes, `portal-setup-all` stops every first-time setup, and above `website-form-all` the website form silently drops every enquiry for 15 minutes (owner questions) | `packages/authentication/src/throttle.ts` |
| Google sign-in (D-030, optional) | OIDC code flow + PKCE; state/nonce/verifier in a 10-min HttpOnly SameSite=Lax cookie HMAC'd with `SESSION_SECRET`, compared in constant time; ID token verified locally (RS256 + Google JWKS, `iss`, `aud`, `exp`/`iat` ±5 min, `nonce`, `email_verified`, `hd = elevateeducation.in`, production domain rule); new accounts get no roles; disabled accounts refused; refusals throttled per IP (50 / 15 min) and logged without tokens or emails; `GOOGLE_CLIENT_SECRET` is server-only | `packages/authentication/src/google.ts` |

**Known limitations (must be resolved before internet exposure):**
1. Fixed 6 Nov 2026: the throttle is shared in the database (`core.login_attempts`). It still counts per network address, so item 5 applies to it.
2. No password reset, MFA, or account self-service yet (platform admin screens are wave 3+ work).
3. The `Secure` cookie flag requires HTTPS in production; it is off only when `PLATFORM_URL` is plain `http://` (office Wi-Fi, D-110).
4. The platform `proxy.ts` only checks that a session cookie *exists* (a fast redirect). Real validation happens in every page (`requirePageAccess`) and route (`defineRoute`).
5. `x-forwarded-for` is trusted, so with no proxy a caller can forge the session address and dodge the per-address limits, the portal and website-form ones included (API-010, open, a deploy item). A go-live proxy must overwrite the header. Behind a rewriting proxy every visitor can share one address, so the per-address buckets then act as one shared bucket (FR-A M2, deploy note).

## 2. CSRF and input handling
- `SameSite=Lax` stops the cookie on cross-*site* POSTs. It does not help between ports of the same host (`localhost:3000` and `localhost:3001` are the same site), so since 22 Oct 2026 (D-072) every state-changing request is also origin-checked: `isAllowedRequestOrigin` (`packages/configuration/src/workspaces.ts`) accepts a request whose `Origin` is its own origin or one of the four configured app origins, and refuses any other present `Origin` with 403. Requests without `Origin` (curl, server-to-server, tests) carry no browser cookie and are allowed. `defineRoute` applies it to every non-GET/HEAD/OPTIONS route; the form-posting login, logout and workspace-chooser handlers apply it themselves (`refuseCrossSite`).
- `defineRoute` body routes accept only the exact media type `application/json` (parameters such as `charset` allowed). The "simple request" form `text/plain;application/json`, which a cross-site page could send without a CORS preflight, is refused with 400.
- No route sends CORS headers (no wildcard, no credentialed CORS): workspaces never call each other from the browser. Cross-workspace figures come from server-to-server summaries with `INTERNAL_SERVICE_TOKEN`.
- Login/logout and the workspace chooser accept HTML forms (progressive enhancement); a cross-site login or logout is refused by the origin check above (test `packages/authentication/tests/workspace-login.test.ts`, "cross-site requests to the auth handlers").
- Server Actions are origin-checked by Next.js and by each app's proxy (`isAllowedActionOrigin`); module apps allow the platform host from `PLATFORM_URL`. A cross-site POST to an action is refused (RVA-004), on paths the proxy otherwise skips too (RVA-008, 224 of 224 on the third package).
- Since 31 Oct 2026 the origin check also compares `Origin` with `Host`, so sign-in and writes work on `127.0.0.1` and the Wi-Fi address; a foreign origin still gets 403 (FEE-004, 124 checks on the first package). Allowed on purpose: no `Origin` at all (no browser POST omits it). Such a request from curl can answer 500 on Marketing and leave stack lines, with nothing saved (RL1-003, Low, left).
- **One public write route (D-152, 6 Nov 2026): `crossSite`.** `defineRoute({ permission: 'public', crossSite: true })` skips the generic origin check **and** reads no session (a cookie sent along is ignored), so the handler must check the origin itself. The option is typed for public routes only (a compile error otherwise) and `defineRoute` throws at start-up if a signed-in route sets it. Its only user is `POST /ops/api/v1/website-enquiries`: it accepts an `Origin` equal to its own or exactly listed in `leads.website_form.allowed_origins`, refuses a missing or `null` Origin with 403 before any lookup (so a relay server cannot post), takes form posts up to 16 KB, has a hidden trap field, answers every accepted post with the same 303 thank-you before it looks anything up (`after()`), opens only while `leads.website_form.enabled` is on and the consent wording is Approved, and logs a failed save as reason and error class only. It saves through a system user that must stay switched off with no roles (`apps/business-ops-os/src/server/website-form.ts`; tests `tests/integration/website-form.test.ts`, `packages/server-kit/tests/define-route.test.ts`).
- Stored links shown as links (`onlineLink` and the Marketing link fields) accept only `http` and `https` (`httpUrlSchema`, `StoredLink`, HAT-006).
- Duplicate warnings are shaped by what the viewer may open (D-119). Each check is audited as `lead.duplicate_check`. There is no rate limit on them.
- All input is validated with zod at the route boundary; validation errors return field paths, never stack traces. Unknown errors return `INTERNAL` with a request id; details go only to the structured log.
- Logs never include passwords, tokens or cookies; the mock email adapter logs only the recipient's domain.

## 3. Authorization model (D-008)
- Permissions are strings `<module>:<resource>:<action>`, declared per module in `packages/authorization/src/permissions/{platform,marketing,academic,ops}.ts` (each module team owns its file).
- A grant is either `all` records or `own` records (only those the user is responsible for). Modules enforce `own` with `scopedValue()` / `canAccessRecord()` in their queries.
- Every protected route and page checks permissions **on the server** (`defineRoute`, `requirePageAccess`). Hiding UI is cosmetic.
- Invariants checked when the catalogue loads (the app will not start otherwise) and by tests:
  - the **auditor** holds only `read`/`access` actions;
  - only **platform_admin** holds `platform:users:manage` and `platform:roles:manage`;
  - a module file may only grant its own module's permissions;
  - every grant names a declared permission.
- **platform_admin** administers accounts but has no business-record access by default (least privilege).
- **teacher** grants are `own`-scoped (own assignments, batches, classes, attendance, students, assessments). Since 22 Oct 2026 (D-073, **Proposed**) the teacher has no `ops:module:access`: own tasks, EOD reports and meetings are reached inside Academic OS.
- **Lead contacts** (D-073, **Proposed**): `ops:lead_contacts:read` shows a lead's contact fields (student and parent phone/email, city, school, consent) to marketing manager (all) and marketing contributor (own), never KYC, student records or fees; it is excluded from the director/auditor read baseline together with `ops:student_private:read`. KYC fields on a lead need `ops:student_private:read`.
- Mapping real staff to roles is an **owner decision** (D-008).

### Roles
| Role | Purpose |
|---|---|
| `platform_admin` | Manages user accounts and role assignments. No access to business records by default. |
| `director` | Leadership: reads everything, decides approvals, sees consolidated reporting. |
| `marketing_manager` | Runs Marketing OS: plans, approves and publishes content, reads marketing metrics; works every lead and follow-up and own tasks there (Proposed, D-073). |
| `marketing_contributor` | Drafts ideas and content in Marketing OS; cannot approve or publish; works own leads and own tasks (Proposed, D-073). |
| `academic_coordinator` | Runs Academic OS: courses, batches, timetables, assignments, enrolments. |
| `teacher` | Sees only own teaching assignments and records class delivery and attendance for them. |
| `admissions_counsellor` | Works leads, counselling, demos and admissions in Business Ops OS. |
| `operations_manager` | Runs Business Ops OS: admissions oversight, fees, tasks and EOD review, departments and staff (steward). |
| `auditor` | Read-only access everywhere. Can never change anything. Gets no salary figures and no payslips (D-151, Proposed). |
| `student`, `guardian` | Portal logins only (D-150, 6 Nov 2026): `platform:portal:access` for the linked students; never a staff workspace. |

### Role × permission matrix
Generated from the code by `npm run docs:permissions` (check with `npm run docs:permissions -- --check`). ✓ = all records, `own` = only the user's own records, blank = no access. The module rows are the Foundation's starting proposal; module teams refine their own files and Integration regenerates this table.

<!-- permission-matrix:begin (generated by renderPermissionMatrix; do not edit by hand) -->
| Permission | platform_admin | director | marketing_manager | marketing_contributor | academic_coordinator | teacher | admissions_counsellor | operations_manager | auditor | finance_officer | hr_manager | student | guardian |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `platform:module:access` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `platform:users:read` | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  |  |  |
| `platform:users:manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform:roles:manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform:audit:read` | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |  |  |  |
| `platform:approvals:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |  |  |  |
| `platform:notifications:read` | own | own | own | own | own | own | own | own | own | own | own |  |  |
| `platform:portal:access` |  |  |  |  |  |  |  |  |  |  |  | own | own |
| `marketing:module:access` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:ideas:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:ideas:write` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `marketing:content:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:content:write` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `marketing:content:approve` |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:schedule:manage` |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:content:publish` |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:metrics:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:metrics:import` |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `marketing:accounts:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:accounts:manage` |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:campaigns:write` |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:campaigns:read` |  | ✓ | ✓ | own |  |  |  |  | ✓ |  |  |  |  |
| `marketing:calendar:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:calendar:write` |  |  | ✓ | own |  |  |  |  |  |  |  |  |  |
| `marketing:optimisation:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `marketing:optimisation:write` |  |  | ✓ | own |  |  |  |  |  |  |  |  |  |
| `marketing:optimisation:review` |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:targets:read` |  | ✓ | ✓ | own |  |  |  |  | ✓ |  |  |  |  |
| `marketing:targets:manage` |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |
| `marketing:reports:read` |  | ✓ | ✓ | own |  |  |  |  | ✓ |  |  |  |  |
| `marketing:summary:read` |  | ✓ | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `academic:module:access` |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |  |  |  |  |
| `academic:programmes:manage` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:courses:read` |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |  |  |  |  |
| `academic:courses:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:curriculum:approve` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:batches:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:batches:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:students:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:students:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:enrolments:read` |  | ✓ |  |  | ✓ |  |  |  | ✓ |  |  |  |  |
| `academic:enrolments:decide` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:assignments:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:assignments:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:timetable:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:timetable:publish` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:timetable:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:classes:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:classes:record` |  |  |  |  | ✓ | own |  |  |  |  |  |  |  |
| `academic:classes:verify` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:attendance:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:attendance:record` |  |  |  |  | ✓ | own |  |  |  |  |  |  |  |
| `academic:assessments:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:assessments:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:assessments:mark` |  |  |  |  | ✓ | own |  |  |  |  |  |  |  |
| `academic:assessments:publish` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:assessments:finalise` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:progress:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:progress:write` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:reviews:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |  |  |  |
| `academic:reviews:write` |  |  |  |  | own | own |  |  |  |  |  |  |  |
| `academic:settings:manage` |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| `academic:summary:read` |  | ✓ |  |  | ✓ |  |  |  | ✓ |  |  |  |  |
| `ops:module:access` |  | ✓ |  |  | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `ops:dashboard:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |  |  |  |
| `ops:leads:read` |  | ✓ | ✓ | own |  |  | own | ✓ | ✓ |  |  |  |  |
| `ops:leads:write` |  |  | ✓ | own |  |  | own | ✓ |  |  |  |  |  |
| `ops:leads:assign` |  |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:lead_contacts:read` |  |  | ✓ | own |  |  |  | ✓ |  |  |  |  |  |
| `ops:leads:merge` |  |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:admissions:read` |  | ✓ |  |  |  |  | own | ✓ | ✓ | ✓ |  |  |  |
| `ops:admissions:write` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:admissions:approve` |  | ✓ |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:organisation:read` |  | ✓ |  |  |  |  | ✓ | ✓ | ✓ |  | ✓ |  |  |
| `ops:organisation:manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:settings:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `ops:settings:manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:jobs:run` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:fees:read` |  | ✓ |  |  |  |  | own | ✓ | ✓ | ✓ |  |  |  |
| `ops:fees:record` |  |  |  |  |  |  |  | ✓ |  | ✓ |  |  |  |
| `ops:students:read` |  | ✓ |  |  | ✓ |  | own | ✓ | ✓ |  |  |  |  |
| `ops:student_private:read` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:lead_attribution:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |  |  |  |
| `ops:admissions:convert` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:admission_number:override` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:admissions:confirm` |  | ✓ |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:kyc:verify` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:students:lifecycle` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:students:reactivate` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:guardians:write` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:student_reports:generate` |  | ✓ |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:student_reports:review` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:teacher_reports:generate` |  | ✓ |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:appointments:read` |  | ✓ |  |  |  | own | own | ✓ | ✓ |  |  |  |  |
| `ops:appointments:manage` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:event_messages:send` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:teachers:read` |  | ✓ |  |  | ✓ |  | ✓ | ✓ | ✓ |  | ✓ |  |  |
| `ops:teachers:manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:feedback:read` |  | ✓ |  |  | ✓ |  | own | ✓ | ✓ |  |  |  |  |
| `ops:feedback:acknowledge` |  |  |  |  |  |  | own | ✓ |  |  |  |  |  |
| `ops:feedback:write` |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `ops:feedback:manage` |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `ops:feedback:record` |  |  |  |  |  |  | ✓ | ✓ |  |  |  |  |  |
| `ops:feedback:moderate` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:tasks:read` |  | ✓ | own | own | own | own | own | ✓ | ✓ | own | ✓ |  |  |
| `ops:tasks:write` |  | own | own | own | own | own | own | ✓ |  | own | ✓ |  |  |
| `ops:eod:review` |  | ✓ |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:tasks:import` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:tasks:review` |  | own | own |  | own |  |  | ✓ |  |  | ✓ |  |  |
| `ops:hr:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `ops:staff:manage` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:staff_private:read` |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:staff_private:manage` |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:teaching_assignments:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `ops:attendance:read` |  | ✓ | own | own | own | own | own | ✓ | ✓ | own | ✓ |  |  |
| `ops:attendance:manage` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:attendance:request` |  | own | own | own | own | own | own | ✓ |  | own | ✓ |  |  |
| `ops:work_reports:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  | ✓ |  |  |
| `ops:teacher_feedback:read` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:teacher_feedback:manage` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:teacher_feedback:import` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:teacher_feedback_summaries:read` |  | ✓ |  |  |  | own |  | ✓ | ✓ |  | ✓ |  |  |
| `ops:hr_settings:manage` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:hr_requests:create` |  | own | own | own | own | own | own | ✓ |  | own |  |  |  |
| `ops:hr_requests:read` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:hr_requests:manage` |  |  |  |  |  |  |  | ✓ |  |  | ✓ |  |  |
| `ops:assessments:read` |  | ✓ |  |  | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| `ops:assessments:manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:assessments:publish` |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:certificates:issue` |  | ✓ |  |  |  |  |  | ✓ |  |  |  |  |  |
| `ops:payroll:manage` |  | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:payroll:approve` |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| `ops:payslips:read` |  | own | own | own | own | own | own | own |  | own | own |  |  |
<!-- permission-matrix:end -->

## 4. Server-to-server calls
`/<zone>/api/internal/v1/*` routes use `defineInternalRoute`: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` (≥ 32 chars, constant-time comparison) plus `X-Elevate-Caller: <module>`, optionally restricted to listed callers. These routes are for server code only; the token must never reach a browser. The platform does not forward `/*/api/internal/**`: it answers 404 there (HAT-004). Consumers use `fetchInternal`, which reports "unavailable" instead of inventing zeros.

## 5. Secrets
- Real values live only in the git-ignored root `.env`; `.env.example` holds placeholders, and the config loader rejects placeholder values (`replace-with…`).
- `npm run secret-scan` (part of `npm run validate`) fails on non-ignored `.env` files and on credential-like text (private keys, cloud/API tokens, JWTs, database URLs with real passwords, long secret assignments). Verified with a probe file containing three fake secrets (all three reported).
- Test fixtures use values prefixed `test-only-`.

## 6. Data protection
- Development seeds contain only fictional people (`@example.test`, names marked "(fictional)") — D-016.
- The enrolment handoff contract carries the minimum student/guardian identity Academic needs; fees and payments stay in Ops.
- Audit events (`core.audit_events`) record actor, module, action, entity, before/after and request id for logins, logouts and approval steps; modules must audit business-state changes with `recordAudit` in the same transaction.
- Since 6 Nov 2026: payroll audit rows, notices and logs carry ids and counts only, never an amount (D-151); salary figures reach only `ops:payroll:manage` and `ops:payroll:approve` holders and each person's own payslips; the operations manager's every-key grant leaves the three payroll permissions out. Spreadsheet downloads never include contact fields and audit only filter names and row counts (D-155). Leave-letter downloads are audited without the file name, reason or content; a portal receipt download is not audited and does not count as a print.
