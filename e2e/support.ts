import { expect, test, type Page } from '@playwright/test';
import { loadRootEnv } from '@elevate/configuration/node';
import { appOrigin } from '@elevate/configuration/workspaces';
import { MODULE_KEYS, MODULES, type ModuleKey } from '@elevate/shared-types';

loadRootEnv();

/** Each workspace's home, from the *_URL variables the apps read (defaults :3000/ops … :3003). */
export const HOME = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, `${appOrigin(k)}${MODULES[k].basePath}`]),
) as Record<ModuleKey, string>;

/** Demo sign-ins (packages/database/src/seed/demo-accounts.ts); what each may open comes from its stored role. */
export const DEMO = {
  business: 'business@elevateeducation.in', // operations_manager
  hr: 'hr@elevateeducation.in', // hr_manager
  teacher: 'teacher@elevateeducation.in',
  marketing: 'marketing@elevateeducation.in', // marketing_manager
  counsellor: 'schar.mathur@elevateeducation.in', // admissions_counsellor
};

/** Each workspace's home for its main role. No demo login is a platform admin: the business administrator opens Home. */
export const LANDINGS = {
  ops: { url: HOME.ops, email: DEMO.business, h1: 'Overview' },
  academic: { url: HOME.academic, email: DEMO.teacher, h1: /^(My day|Academic overview)$/ },
  marketing: { url: HOME.marketing, email: DEMO.marketing, h1: 'Overview' },
  platform: { url: HOME.platform, email: DEMO.business, h1: 'Overview' },
};

const NO_PASSWORD = process.env.LOCAL_DEMO_PASSWORD
  ? ''
  : 'Browser tests skipped: LOCAL_DEMO_PASSWORD is not set in the root .env, so no demo account can sign in (see e2e/README.md).';
if (NO_PASSWORD) console.warn(NO_PASSWORD);

/** Call at the top of a spec file: skips it when the root .env has no demo password. */
export function requireDemoPassword() {
  test.skip(Boolean(NO_PASSWORD), NO_PASSWORD);
}

/**
 * Signs `email` in from Node, not the browser, so the password never reaches the page, the
 * trace or the report; then opens `url`. Ops is always running, and its session cookie serves
 * every zone on the same host (D-004).
 */
export async function openAs(page: Page, email: string, url: string) {
  const res = await fetch(`${HOME.ops}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.LOCAL_DEMO_PASSWORD }),
  });
  expect(res.status, `sign-in refused for ${email}: run npm run db:seed-demo-accounts`).toBe(200);
  const [pair = ''] = res.headers.getSetCookie()[0]?.split(';') ?? [];
  const eq = pair.indexOf('=');
  await page
    .context()
    .addCookies([{ name: pair.slice(0, eq), value: pair.slice(eq + 1), url: HOME.ops }]);
  await page.goto(url);
}
