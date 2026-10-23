# @elevate/platform

The root zone (basePath `''`, port 3003 since 22 Oct 2026, `PLATFORM_URL`): sign-in, the workspace overview (its removal is Proposed, D-076), user administration (Users & roles), the Google sign-in callback and the workspace chooser (`/workspaces`, `POST /api/v1/auth/workspace`). The placeholder `/dashboard` page and `platform:dashboard:read` were removed on 22 Oct 2026 (D-077). Since 22 Oct 2026 the screens use the shared light system (D-074): `overview.css` and `users.css` on `--el-*` tokens only (`home.css` merged away), roles shown as pills (`RoleBadges`), an Accounts panel on Users & roles, `ButtonLink` for link-buttons, an h1 on the not-found and "Not found" states. Its rewrites of `/marketing`, `/academic` and `/ops` make it an optional single-origin gateway; staff normally open the three workspaces on their own ports (D-072, `docs/WORKSPACES.md`). Start it alone with `npm run dev:platform`. Rules: `AGENTS.md`.

## `/` for signed-out visitors (21 Oct 2026)
Without a valid session, `/` shows the public Elevate Education front page (`src/app/_components/front-page.tsx`): programmes as the owner confirmed them (D-034, D-037), mentors and contact details as listed on elevateeducation.in, links to the public site, its privacy policy and "Staff sign in". It reads no database and shows no internal data. With a session, `/` is the workspace overview as before. The proxy lets `/`, `/login`, `/favicon.ico` and `/icon.svg` through without a cookie; every other page still redirects to `/login`. The site's metadata keeps `robots: noindex`.

## Users & roles additions (23 Oct 2026, D-080, D-090)
- Role **HR manager** (`hr_manager`, Proposed) can be assigned on the user screen; it opens Business Operations only.
- **Change login email** (`PUT /api/v1/admin/users/{id}/email`, `platform:users:manage`): the same account id, every session ended, audited `user.email_changed`; never your own; an email already in use → 409. Test: `tests/integration/admin-users.test.ts`.
- Google sign-in for a new email whose name matches a staff record already linked to another account is refused (`/login?error=google_alias`); an administrator adds such a person by hand.
