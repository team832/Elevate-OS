# @elevate/platform

The root zone (basePath `''`, port 3003 since 22 Oct 2026, `PLATFORM_URL`): sign-in, the workspace overview, the leadership dashboard, user administration (Users & roles), the Google sign-in callback and the workspace chooser (`/workspaces`, `POST /api/v1/auth/workspace`). Its rewrites of `/marketing`, `/academic` and `/ops` make it an optional single-origin gateway; staff normally open the three workspaces on their own ports (D-072, `docs/WORKSPACES.md`). Start it alone with `npm run dev:platform`. Rules: `AGENTS.md`.

## `/` for signed-out visitors (21 Oct 2026)
Without a valid session, `/` shows the public Elevate Education front page (`src/app/_components/front-page.tsx`): programmes as the owner confirmed them (D-034, D-037), mentors and contact details as listed on elevateeducation.in, links to the public site, its privacy policy and "Staff sign in". It reads no database and shows no internal data. With a session, `/` is the workspace overview as before. The proxy lets `/`, `/login`, `/favicon.ico` and `/icon.svg` through without a cookie; every other page still redirects to `/login`. The site's metadata keeps `robots: noindex`.
