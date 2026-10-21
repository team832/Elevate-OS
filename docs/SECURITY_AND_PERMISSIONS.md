# Security and Permissions

Status of everything here: **Implemented + Tested** in the Foundation wave unless marked otherwise. Nothing is Deployed.

## 1. Identity and sessions
| Topic | Rule | Code |
|---|---|---|
| Accounts | One user table `core.users`; email stored lower-case and unique; `status` `active`/`disabled` | `packages/database/src/schema/core.ts` |
| Passwords | scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte salt), constant-time verify, min 10 / max 512 chars; unknown emails spend equal time | `packages/authentication/src/password.ts` |
| Sessions | 32-byte random token in the cookie; DB stores only `HMAC-SHA256(SESSION_SECRET, token)`; 7-day absolute expiry; revocation per session or per user; disabled users lose access immediately | `packages/authentication/src/sessions.ts` |
| Cookie | `elevate_session`; `HttpOnly; SameSite=Lax; Path=/`; `Secure` when `NODE_ENV=production` | `packages/authentication/src/cookies.ts` |
| One sign-in for all zones | The platform serves every module through rewrites (D-004), so the cookie is first-party for all of them; modules validate it against the same `core.sessions` | verified end-to-end (IMPLEMENTATION_STATUS.md) |
| Login errors | Generic "Email or password is incorrect." for unknown email, wrong password and disabled user | `packages/authentication/src/login.ts` |
| Open redirects | Post-login `next` must be a same-site relative path (`safeRelativePath`) | `packages/shared-contracts/src/http.ts` |
| Login throttling | 5 failures per (email, IP) / 15 min → 15-min lock; 50 per IP → lock; 429 `RATE_LIMITED` | `packages/authentication/src/throttle.ts` |
| Google sign-in (D-030, optional) | OIDC code flow + PKCE; state/nonce/verifier in a 10-min HttpOnly SameSite=Lax cookie HMAC'd with `SESSION_SECRET`, compared in constant time; ID token verified locally (RS256 + Google JWKS, `iss`, `aud`, `exp`/`iat` ±5 min, `nonce`, `email_verified`, `hd = elevateeducation.in`, production domain rule); new accounts get no roles; disabled accounts refused; refusals throttled per IP (50 / 15 min) and logged without tokens or emails; `GOOGLE_CLIENT_SECRET` is server-only | `packages/authentication/src/google.ts` |

**Known limitations (must be resolved before internet exposure):**
1. The throttle is in memory per process: it resets on restart and is not shared between the four apps or replicas. Add a shared limiter (DB table or reverse proxy).
2. No password reset, MFA, or account self-service yet (platform admin screens are wave 3+ work).
3. The `Secure` cookie flag requires HTTPS in production.
4. The platform `proxy.ts` only checks that a session cookie *exists* (a fast redirect). Real validation happens in every page (`requirePageAccess`) and route (`defineRoute`).

## 2. CSRF and input handling
- `SameSite=Lax` stops the cookie on cross-site POSTs.
- `defineRoute` body routes accept only `Content-Type: application/json`, which cross-site HTML forms cannot send without a CORS preflight.
- Login/logout accept HTML forms (progressive enhancement); login CSRF and forced logout are low-impact and accepted.
- Server Actions (if module teams use them) are origin-checked by Next.js; module apps allow the platform host from `PLATFORM_URL`.
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
- **teacher** grants are `own`-scoped (own assignments, batches, classes, attendance, students, assessments).
- Mapping real staff to roles is an **owner decision** (D-008).

### Roles
| Role | Purpose |
|---|---|
| `platform_admin` | Manages user accounts and role assignments. No access to business records by default. |
| `director` | Leadership: reads everything, decides approvals, sees consolidated reporting. |
| `marketing_manager` | Runs Marketing OS: plans, approves and publishes content, reads marketing metrics. |
| `marketing_contributor` | Drafts ideas and content in Marketing OS; cannot approve or publish. |
| `academic_coordinator` | Runs Academic OS: courses, batches, timetables, assignments, enrolments. |
| `teacher` | Sees only own teaching assignments and records class delivery and attendance for them. |
| `admissions_counsellor` | Works leads, counselling, demos and admissions in Business Ops OS. |
| `operations_manager` | Runs Business Ops OS: tasks, SOPs, departments and staff (steward), admissions oversight. |
| `auditor` | Read-only access everywhere. Can never change anything. |

### Role × permission matrix
Generated from the code by `npm run docs:permissions` (check with `npm run docs:permissions -- --check`). ✓ = all records, `own` = only the user's own records, blank = no access. The module rows are the Foundation's starting proposal; module teams refine their own files and Integration regenerates this table.

<!-- permission-matrix:begin (generated by renderPermissionMatrix; do not edit by hand) -->
| Permission | platform_admin | director | marketing_manager | marketing_contributor | academic_coordinator | teacher | admissions_counsellor | operations_manager | auditor | finance_officer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `platform:module:access` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform:dashboard:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| `platform:users:read` | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |
| `platform:users:manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `platform:roles:manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `platform:audit:read` | ✓ | ✓ |  |  |  |  |  |  | ✓ |  |
| `platform:approvals:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| `platform:notifications:read` | own | own | own | own | own | own | own | own | own | own |
| `marketing:module:access` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `marketing:ideas:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `marketing:ideas:write` |  |  | ✓ | ✓ |  |  |  |  |  |  |
| `marketing:content:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `marketing:content:write` |  |  | ✓ | ✓ |  |  |  |  |  |  |
| `marketing:content:approve` |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `marketing:schedule:manage` |  | ✓ | ✓ |  |  |  |  |  |  |  |
| `marketing:content:publish` |  |  | ✓ |  |  |  |  |  |  |  |
| `marketing:metrics:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `marketing:metrics:import` |  |  | ✓ | ✓ |  |  |  |  |  |  |
| `marketing:accounts:read` |  | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| `marketing:accounts:manage` |  |  | ✓ |  |  |  |  |  |  |  |
| `marketing:campaigns:write` |  |  | ✓ |  |  |  |  |  |  |  |
| `marketing:summary:read` |  | ✓ | ✓ |  |  |  |  |  | ✓ |  |
| `academic:module:access` |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |  |
| `academic:programmes:manage` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:courses:read` |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |  |
| `academic:courses:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:curriculum:approve` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:batches:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:batches:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:students:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:students:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:enrolments:read` |  | ✓ |  |  | ✓ |  |  |  | ✓ |  |
| `academic:enrolments:decide` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:assignments:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:assignments:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:timetable:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:timetable:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:classes:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:classes:record` |  |  |  |  | ✓ | own |  |  |  |  |
| `academic:classes:verify` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:attendance:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:attendance:record` |  |  |  |  | ✓ | own |  |  |  |  |
| `academic:assessments:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:assessments:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:assessments:finalise` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:progress:read` |  | ✓ |  |  | ✓ | own |  |  | ✓ |  |
| `academic:progress:write` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:settings:manage` |  |  |  |  | ✓ |  |  |  |  |  |
| `academic:summary:read` |  | ✓ |  |  | ✓ |  |  |  | ✓ |  |
| `ops:module:access` |  | ✓ |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ops:dashboard:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| `ops:leads:read` |  | ✓ |  |  |  |  | own | ✓ | ✓ |  |
| `ops:leads:write` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:leads:assign` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:leads:merge` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:admissions:read` |  | ✓ |  |  |  |  | own | ✓ | ✓ | ✓ |
| `ops:admissions:write` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:admissions:approve` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `ops:organisation:read` |  | ✓ |  |  |  |  | ✓ | ✓ | ✓ |  |
| `ops:organisation:manage` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:settings:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| `ops:settings:manage` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:jobs:run` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:fees:read` |  | ✓ |  |  |  |  | own | ✓ | ✓ | ✓ |
| `ops:fees:record` |  |  |  |  |  |  |  | ✓ |  | ✓ |
| `ops:students:read` |  | ✓ |  |  | ✓ |  | own | ✓ | ✓ |  |
| `ops:student_private:read` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:lead_attribution:read` |  | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| `ops:lead_handoffs:manage` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:admissions:convert` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:admission_number:override` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:admissions:confirm` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `ops:kyc:verify` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:students:lifecycle` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:students:reactivate` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:guardians:write` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:student_reports:generate` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:student_reports:review` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:appointments:read` |  | ✓ |  |  |  | own | own | ✓ | ✓ |  |
| `ops:appointments:manage` |  |  |  |  |  |  | own | ✓ |  |  |
| `ops:event_messages:send` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:teachers:read` |  | ✓ |  |  | ✓ | own | ✓ | ✓ | ✓ |  |
| `ops:teachers:manage` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:feedback:read` |  | ✓ |  |  | ✓ | own |  | ✓ | ✓ |  |
| `ops:feedback:write` |  |  |  |  |  | own |  | ✓ |  |  |
| `ops:feedback:manage` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:feedback:record` |  |  |  |  |  |  | ✓ | ✓ |  |  |
| `ops:feedback:moderate` |  |  |  |  |  |  |  | ✓ |  |  |
| `ops:tasks:read` |  | ✓ |  |  | own | own | own | ✓ | ✓ | own |
| `ops:tasks:write` |  | own |  |  | own | own | own | ✓ |  | own |
| `ops:eod:review` |  | ✓ |  |  |  |  |  | ✓ |  |  |
<!-- permission-matrix:end -->

## 4. Server-to-server calls
`/<zone>/api/internal/v1/*` routes use `defineInternalRoute`: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` (≥ 32 chars, constant-time comparison) plus `X-Elevate-Caller: <module>`, optionally restricted to listed callers. These routes are for server code only; the token must never reach a browser. Consumers use `fetchInternal`, which reports "unavailable" instead of inventing zeros.

## 5. Secrets
- Real values live only in the git-ignored root `.env`; `.env.example` holds placeholders, and the config loader rejects placeholder values (`replace-with…`).
- `npm run secret-scan` (part of `npm run validate`) fails on non-ignored `.env` files and on credential-like text (private keys, cloud/API tokens, JWTs, database URLs with real passwords, long secret assignments). Verified with a probe file containing three fake secrets (all three reported).
- Test fixtures use values prefixed `test-only-`.

## 6. Data protection
- Development seeds contain only fictional people (`@example.test`, names marked "(fictional)") — D-016.
- The enrolment handoff contract carries the minimum student/guardian identity Academic needs; fees and payments stay in Ops.
- Audit events (`core.audit_events`) record actor, module, action, entity, before/after and request id for logins, logouts and approval steps; modules must audit business-state changes with `recordAudit` in the same transaction.
