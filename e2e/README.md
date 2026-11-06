# Browser tests (Playwright + axe)

Twelve checks in the installed Chrome, against apps that are already running. Nothing here starts a server or downloads a browser.

| File | Checks |
|---|---|
| `landing.spec.ts` | Each workspace home for its main role (Ops and Home as `business@`, Academic as `teacher@`, Marketing as `marketing@`), at 1440 px and 390 px: exactly one h1 with the expected text, no error panel, and no serious or critical axe violation (WCAG 2.0, 2.1 and 2.2, levels A and AA). A failure lists each violation's id and the elements it found |
| `access.spec.ts` | Who can open what, each refusal next to a control on the same page: the business administrator opens Fees, but a teacher who opens Fees lands on Academic (no Ops access, D-072); the HR manager opens HR, but a counsellor who opens HR sees "No access" |

## Before you run
1. The demo sign-ins exist: `npm run db:seed`, then `npm run db:seed-demo-accounts` (see the `elevate-demo-accounts` skill).
2. `LOCAL_DEMO_PASSWORD` is set in the root `.env`. Without it every test is skipped, with a message saying so. The tests sign in from Node, so the password never reaches the browser, a trace or the report.
3. All four apps are running:
   - built (faster): `npm run office:build` once, then `npm run office`;
   - or dev: `npm run dev` plus `npm run dev:platform` in a second window. The first visit to each page compiles it, so the first run is slow.

Addresses come from the same `BUSINESS_OPS_OS_URL`, `ACADEMIC_OS_URL`, `MARKETING_OS_URL` and `PLATFORM_URL` values the apps read (defaults `http://localhost:3000/ops`, `:3001/academic`, `:3002/marketing`, `:3003`).

## Run
```
npm run test:e2e                          # all twelve
npm run test:e2e -- access                # one file
npx playwright test -c e2e --list         # list the tests without running them
```
A failed test keeps a trace in `e2e/test-results/` (git-ignored): `npx playwright show-trace e2e/test-results/<test>/trace.zip`. A trace holds that test's session cookie, so do not share it.
