/**
 * Source of bin/smoke.mjs: do the running apps answer as they should? Exit 1 on any failure.
 * With SMOKE_EMAIL and SMOKE_PASSWORD set it also signs in on every address. Prints no secret.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { APPS, fontFile, loadEnvFile, originOf } from './common.mjs';

loadEnvFile();
const TIMEOUT_MS = 30_000;
const HEADERS = {
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'permissions-policy': /camera=\(\)/,
  'content-security-policy': /nonce-/,
};

const get = (url, options = {}) =>
  fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...options });

let failed = 0;
let passed = 0;
async function check(name, fn) {
  try {
    const skipped = await fn();
    if (skipped) return console.log(`SKIP  ${name}: ${skipped}`);
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}: ${error.cause?.code ?? error.message.split('\n')[0]}`);
  }
}

async function checkSignInPage(app) {
  const res = await get(`${originOf(app)}${app.base}/login`);
  assert.equal(res.status, 200, `status ${res.status}`);
  const html = await res.text();
  assert.match(html, /<form/, 'no form on the page');
  assert.match(html, /name="password"/, 'no password field');
  return { res, html };
}

async function checkFontServed(app, html) {
  const css = /[^"]*\/_next\/static\/css\/[^"]*\.css/.exec(html)?.[0];
  assert.ok(css, 'the page links no stylesheet');
  const sheet = await get(originOf(app) + css);
  assert.equal(sheet.status, 200, `stylesheet status ${sheet.status}`);
  const font = /url\(([^)]*\.woff2)\)/.exec(await sheet.text())?.[1];
  assert.ok(font, 'the stylesheet names no woff2 font');
  const served = await get(originOf(app) + font);
  assert.equal(served.status, 200, `font status ${served.status}`);
}

/** The session cookie from a real sign-in; signs out again when `use` is done. */
async function signedIn(app, use) {
  const base = `${originOf(app)}${app.base}/api/v1/auth`;
  const res = await get(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
  });
  assert.equal(res.status, 200, `sign-in status ${res.status}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('elevate_session='))?.split(';')[0];
  assert.ok(cookie, 'no session cookie');
  try {
    return await use(cookie);
  } finally {
    await get(`${base}/logout`, { method: 'POST', headers: { cookie } });
  }
}

async function checkPdf(app, cookie) {
  const base = `${originOf(app)}${app.base}/api/v1/eod-reports`;
  let id = process.env.SMOKE_EOD_REPORT_ID;
  if (!id) {
    const list = await get(base, { headers: { cookie } });
    if (list.status === 403) return 'this account may not read work reports';
    const body = await list.json();
    id = (body.data?.items ?? body.data ?? [])[0]?.id;
  }
  if (!id) return 'no work report on this database to print; font files were checked on disk only';
  const pdf = await get(`${base}/${id}/pdf`, { headers: { cookie } });
  assert.equal(pdf.status, 200, `status ${pdf.status}`);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF', 'not a PDF');
}

for (const app of APPS) {
  const origin = originOf(app);
  await check(`${app.key}: health`, async () => {
    const res = await get(origin + app.health);
    assert.equal(res.status, 200, `status ${res.status}`);
    assert.equal((await res.json()).data.status, 'ok', 'health is not ok');
  });
  let html = '';
  await check(`${app.key}: sign-in page and security headers`, async () => {
    const page = await checkSignInPage(app);
    html = page.html;
    for (const [name, want] of Object.entries(HEADERS))
      assert.match(page.res.headers.get(name) ?? '', want, `header ${name}`);
    assert.equal(page.res.headers.get('x-powered-by'), null, 'x-powered-by is exposed');
    if (origin.startsWith('https://'))
      assert.ok(page.res.headers.get('strict-transport-security'), 'no HSTS header');
  });
  await check(`${app.key}: page font and stylesheet served`, () => checkFontServed(app, html));
  await check(`${app.key}: unknown address answers 404`, async () => {
    const res = await get(`${origin}${app.base}/api/v1/smoke-no-such-route`);
    assert.equal(res.status, 404, `status ${res.status}`);
    if (!app.base) return;
    const page = await get(`${origin}${app.base}/smoke-no-such-page`);
    assert.equal(page.status, 404, `page status ${page.status}`);
  });
  if (app.base) {
    await check(`${app.key}: signed out goes to sign-in`, async () => {
      const res = await get(origin + app.base);
      assert.equal(res.status, 307, `status ${res.status}`);
      assert.match(res.headers.get('location') ?? '', new RegExp(`${app.base}/login`), 'wrong target');
    });
    await check(`platform: forwards ${app.base}`, async () => {
      const res = await get(originOf(APPS.at(-1)) + app.base);
      assert.equal(res.status, 307, `status ${res.status}`);
      assert.match(res.headers.get('location') ?? '', new RegExp(`${app.base}/login`), 'wrong target');
    });
  }
  if (app.pdfFonts)
    await check(`${app.key}: PDF font files in place`, () =>
      assert.ok(existsSync(fontFile(app)), 'NotoSans-Regular.ttf is missing'),
    );
}

if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  for (const app of APPS) {
    await check(`${app.key}: real sign-in`, () =>
      signedIn(app, async (cookie) => {
        const res = await get(`${originOf(app)}${app.base || '/api/v1/auth/me'}`, { headers: { cookie } });
        assert.ok(!/\/login/.test(res.headers.get('location') ?? ''), 'still sent to sign-in');
        assert.ok(res.status < 500, `status ${res.status}`);
      }),
    );
    if (app.pdfFonts)
      await check(`${app.key}: a PDF prints`, () => signedIn(app, (cookie) => checkPdf(app, cookie)));
  }
} else {
  console.log('SKIP  real sign-in: set SMOKE_EMAIL and SMOKE_PASSWORD to include it');
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
