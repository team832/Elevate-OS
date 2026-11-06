# Third-party notices

Elevate OS is private (`UNLICENSED`). This file credits outside work used in it, under the owner's rule of 6 Nov 2026 (D-136): only free licences; permissive code may be used with credit; copyleft projects give ideas only; MPL-2.0 only as an unmodified dependency.

Other licences (fonts, the PDF library, the npm census): `HANDOFF.md` §11.

## Development dependencies added 6 Nov 2026
Root `devDependencies`, used only by the browser checks in `e2e/` (`npm run test:e2e`). No app imports them.

| Package | Version | Licence | Notes |
|---|---|---|---|
| `@playwright/test`, `playwright`, `playwright-core` | 1.64.1 | Apache-2.0 | Copyright (c) Microsoft Corporation. Licence and NOTICE in `node_modules/playwright-core/` |
| `@axe-core/playwright`, `axe-core` | 4.14.0 | MPL-2.0 | Deque Systems. Used unmodified; source at github.com/dequelabs/axe-core and github.com/dequelabs/axe-core-npm |

## Ideas only (no code copied)

| Project | Licence | What we learned from it |
|---|---|---|
| better-auth | MIT | A sign-in limit counted in the database with one atomic statement (`packages/authentication/src/throttle.ts`) |
| Documenso | AGPL-3.0 | Background jobs without a separate job server; files kept in the database |
| frappe/education, frappe/hrms | GPL-3.0 | One clash check for batch, teacher and room; leave overlap, attendance clash and half days |
| Gibbon | GPL-3.0 | Staff absence approval and substitute cover |
| academico | MIT | Substitute cover (idea only) |
| Krayin | MIT | A public web form that turns into a lead (`apps/business-ops-os/src/server/website-form.ts`, D-152; idea only) |
| OpenEduCat | LGPL-3.0 | Admission states; fee terms that must total 100% |

Checked 6 Nov 2026 (final docs pass): no dependency other than the packages above was added on 6 Nov (root and workspace `package.json`), and no code was copied for the 16 features of D-138 … D-153. The reference copies are in `C:\OPENBOT\reference-repos` (outside this repository), listed with their licences in its `README.md`.
