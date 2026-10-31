#!/usr/bin/env node
/**
 * Every role, every page, by real HTTP against the running apps. No dependencies.
 *
 *   node scripts/release/walk.mjs <outDir>          writes walk.json + walk.txt, exit 1 on any failure
 *   node scripts/release/walk.mjs --self-check      checks the HTML inspector only
 *
 * Environment: BUSINESS_OPS_OS_URL, ACADEMIC_OS_URL, MARKETING_OS_URL, PLATFORM_URL (local only);
 * WALK_ACCOUNTS = JSON file of [{ email, passwordEnv, role? }]; passwords are read from the named variables.
 * Optional: WALK_EXPECT = JSON { "<role>": { "<path>": "allow" | "deny" } }, WALK_ONLY = comma-separated emails,
 * WALK_MAX_PAGES (default 120 per account), WALK_CONCURRENCY (default 4).
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = [
  { key: 'ops', base: '/ops', env: 'BUSINESS_OPS_OS_URL', dir: 'business-ops-os', port: 3000 },
  { key: 'academic', base: '/academic', env: 'ACADEMIC_OS_URL', dir: 'academic-os', port: 3001 },
  { key: 'marketing', base: '/marketing', env: 'MARKETING_OS_URL', dir: 'marketing-os', port: 3002 },
  { key: 'platform', base: '', env: 'PLATFORM_URL', dir: 'platform', port: 3003 },
].map((a) => ({ ...a, origin: (process.env[a.env] ?? `http://localhost:${a.port}`).replace(/\/$/, '') }));
const PUBLIC_PATHS = /\/login$/;
const signedOutOpen = (p) => p === '/' || PUBLIC_PATHS.test(p); // the platform's front page and sign-in pages
const UNSAFE_LINK = /\/api\/|\/logout|\/notifications\/[^/]+\/open|\.(pdf|csv)(\?|$)/;
const ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Failure when found in the raw HTML (scripts included) or in the text a person sees. */
const RAW_MARKERS = { digest: /data-dgst=|data-next-error|"digest":"/, NEXT_REDIRECT: /NEXT_REDIRECT/, errorState: /data-state="error"/ };
const TEXT_MARKERS = {
  'Application error': /Application error/,
  undefined: /\bundefined\b/,
  NaN: /\bNaN\b/,
  '[object Object]': /\[object Object\]/,
  null: /\bnull\b/,
};

function visibleText(html) {
  return html
    .replace(/<(script|style|template|textarea)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function inspect(html) {
  const noScript = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = visibleText(html);
  const markers = [
    ...Object.entries(RAW_MARKERS).filter(([, re]) => re.test(html)).map(([k]) => k),
    ...Object.entries(TEXT_MARKERS).filter(([, re]) => re.test(text)).map(([k]) => k),
  ];
  const noAccess = /<h1[^>]*>\s*No access/.test(noScript);
  return {
    h1: (noScript.match(/<h1\b/g) ?? []).length,
    noAccess,
    markers: noAccess ? markers.filter((m) => m !== 'errorState') : markers,
    unavailable: />\s*Source unavailable/i.test(noScript),
  };
}

function links(html, pageUrl) {
  const out = new Set();
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    if (!href || href.startsWith('#')) continue;
    const u = new URL(href.replaceAll('&amp;', '&'), pageUrl);
    u.hash = '';
    out.add(u.href);
  }
  return [...out];
}

function menu(html) {
  const label = (s) => visibleText(s).trim();
  return {
    workspace: html.match(/class="el-ws-name">([^<]*)</)?.[1] ?? null,
    switcher: [...html.matchAll(/class="el-ws-option"[^>]*href="([^"]*)"/g)].map((m) => m[1]),
    chooser: [...html.matchAll(/class="el-workspace-option"[\s\S]*?value="([^"]*)"/g)].map((m) => m[1]),
    items: [...html.matchAll(/class="el-nav-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [label(m[2]), m[1]]),
  };
}

async function get(url, cookie) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(90_000) });
  const ttfbMs = Math.round(performance.now() - t0);
  const body = await res.text();
  return { url, status: res.status, location: res.headers.get('location'), ttfbMs, totalMs: Math.round(performance.now() - t0), bytes: body.length, body };
}

function classify(r, app) {
  if (r.status >= 500) return 'error';
  if (r.status === 404) return 'not-found';
  if (r.status === 401 || r.status === 403) return 'deny';
  if (r.status >= 300 && r.status < 400) {
    const to = new URL(r.location, r.url);
    if (to.pathname.endsWith('/login')) return 'login';
    if (to.origin !== app.origin) return 'other-workspace';
    return to.pathname.endsWith('/workspaces') ? 'chooser' : 'redirect';
  }
  return inspect(r.body).noAccess ? 'deny' : 'allow';
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

function staticPages(app) {
  const root = join(ROOT, 'apps', app.dir, 'src', 'app');
  const walk = (dir, rel) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name.startsWith('[') || name === 'api' ? [] : walk(p, `${rel}/${name}`);
    return name === 'page.tsx' ? [rel] : [];
  });
  return walk(root, '').map((p) => `${app.base}${p}` || '/');
}

async function signIn(app, account, password) {
  const t0 = performance.now();
  const res = await fetch(`${app.origin}${app.base}/api/v1/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: app.origin },
    body: new URLSearchParams({ email: account.email, password }),
    signal: AbortSignal.timeout(60_000),
  });
  const ms = Math.round(performance.now() - t0);
  await res.text();
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('elevate_session='))?.split(';')[0] ?? null;
  const chain = [res.headers.get('location')];
  let url = chain[0] ? new URL(chain[0], app.origin).href : null;
  while (cookie && url && chain.length < 6) {
    const hop = await get(url, cookie);
    if (hop.status < 300 || hop.status >= 400) { chain.push(`${hop.status}`); break; }
    url = new URL(hop.location, url).href;
    chain.push(url);
  }
  return { on: app.key, status: res.status, ms, cookie, landing: url, chain };
}

async function crawl(app, home, cookie, max, record) {
  const seen = new Set();
  const perShape = new Map();
  const queue = [[home, null]];
  while (queue.length && seen.size < max) {
    const [url, from] = queue.shift();
    if (seen.has(url)) continue;
    const u = new URL(url);
    const shape = `${u.pathname.replace(ID, ':id')}?${[...u.searchParams.keys()].sort()}`;
    if ((perShape.get(shape) ?? 0) >= 3) continue;
    perShape.set(shape, (perShape.get(shape) ?? 0) + 1);
    seen.add(url);
    const r = await get(url, cookie);
    record(r, app, from);
    if (r.status === 200)
      for (const l of links(r.body, url)) {
        const t = new URL(l);
        if (t.origin === app.origin && t.pathname.startsWith(app.base) && !UNSAFE_LINK.test(l) && !seen.has(l)) queue.push([l, url]);
      }
  }
}

function selfCheck() {
  const page = '<html><title>T</title><script>self.x = "undefined null NaN"</script><body><h1>Hello</h1><a href="/ops/a?x=1&amp;y=2#z">a</a><a href="#s">s</a></body></html>';
  assert.deepEqual(inspect(page).markers, []);
  assert.equal(inspect(page).h1, 1);
  assert.deepEqual(links(page, 'http://localhost:3000/ops'), ['http://localhost:3000/ops/a?x=1&y=2']);
  assert.deepEqual(inspect('<p>Total: NaN of undefined</p><div data-state="error"></div>').markers.sort(), ['NaN', 'errorState', 'undefined']);
  assert.equal(inspect('<div data-state="error"><h1>No access</h1></div>').noAccess, true);
  assert.deepEqual(inspect('<div data-state="error"><h1>No access</h1></div>').markers, []);
  assert.equal(classify({ status: 307, location: '/ops/login?next=x', url: 'http://localhost:3000/ops' }, APPS[0]), 'login');
  assert.equal(classify({ status: 307, location: 'http://localhost:3001/academic', url: 'http://localhost:3000/ops' }, APPS[0]), 'other-workspace');
  console.log('self-check ok');
}

async function main(outDir) {
  for (const a of APPS)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(a.origin).hostname)) throw new Error(`refusing a non-local origin: ${a.origin}`);
  if (!process.env.WALK_ACCOUNTS) throw new Error('set WALK_ACCOUNTS to the JSON accounts file');
  const only = process.env.WALK_ONLY?.split(',');
  const accounts = JSON.parse(readFileSync(process.env.WALK_ACCOUNTS, 'utf8')).filter((a) => !only || only.includes(a.email));
  const expected = process.env.WALK_EXPECT ? JSON.parse(readFileSync(process.env.WALK_EXPECT, 'utf8')) : null;
  const max = Number(process.env.WALK_MAX_PAGES ?? 120);
  const size = Number(process.env.WALK_CONCURRENCY ?? 4);
  const pages = APPS.map((a) => ({ app: a, paths: staticPages(a) }));
  const failures = [];
  const fail = (kind, who, url, detail) => failures.push({ kind, who, url, detail });
  const result = { startedAt: new Date().toISOString(), signedOut: [], accounts: [] };

  const checkPage = (who, r) => {
    const i = inspect(r.body);
    if (r.status >= 500) fail('server-error', who, r.url, r.status);
    if (r.status === 200 && i.markers.length) fail('error-marker', who, r.url, i.markers);
    if (r.status === 200 && r.body.includes('<html') && i.h1 !== 1) fail('h1-count', who, r.url, i.h1);
    if (i.unavailable) fail('source-unavailable', who, r.url, 'all four apps are up');
    return i;
  };

  // Signed out: every static page goes to its sign-in page; unknown paths give a real 404 page.
  for (const { app, paths } of pages) {
    const rows = await pool(paths, size, async (p) => {
      let r = await get(`${app.origin}${p}`);
      if (classify(r, app) === 'redirect') r = await get(new URL(r.location, r.url).href); // an old address that moved
      const cls = classify(r, app);
      const publicPage = signedOutOpen(p);
      if (publicPage ? cls !== 'allow' : cls !== 'login') fail('signed-out', 'nobody', r.url, `${r.status} ${r.location ?? ''}`);
      if (publicPage) checkPage('nobody', r);
      return { path: p, status: r.status, location: r.location, class: cls, ms: r.totalMs };
    });
    const missing = await get(`${app.origin}${app.base}/no-such-page-walk`);
    if (missing.status !== 404 || inspect(missing.body).h1 !== 1) fail('unknown-path', 'nobody', missing.url, `${missing.status} h1=${inspect(missing.body).h1}`);
    result.signedOut.push({ app: app.key, pages: rows, unknownPath: missing.status });
  }

  for (const account of accounts) {
    const row = { email: account.email, role: account.role ?? null, signIns: [], menus: {}, direct: [], crawl: [] };
    result.accounts.push(row);
    const password = process.env[account.passwordEnv];
    if (!password) { fail('no-password-env', account.email, '', account.passwordEnv); continue; }
    row.signIns = [];
    for (const app of APPS) row.signIns.push(await signIn(app, account, password));
    const cookie = row.signIns.find((s) => s.cookie)?.cookie;
    for (const s of row.signIns) {
      if (!s.cookie) fail('sign-in', account.email, s.on, `${s.status} ${s.chain[0]}`);
      delete s.cookie;
    }
    if (!cookie) continue;

    for (const { app, paths } of pages) {
      const hits = await pool(paths, size, async (p) => {
        if (PUBLIC_PATHS.test(p)) return null;
        const r = await get(`${app.origin}${p}`, cookie);
        const cls = classify(r, app);
        const want = account.role ? expected?.[account.role]?.[p] : undefined;
        if (want === 'deny' && cls === 'allow') fail('CRITICAL-open-to-denied-role', account.email, r.url, cls);
        if (want === 'allow' && !['allow', 'redirect'].includes(cls)) fail('refused-to-allowed-role', account.email, r.url, `${cls} ${r.location ?? ''}`);
        if (cls === 'allow') checkPage(account.email, r);
        return { path: p, class: cls, status: r.status, location: r.location, ttfbMs: r.ttfbMs, totalMs: r.totalMs, bytes: r.bytes };
      });
      row.direct.push(...hits.filter(Boolean));
    }

    for (const app of APPS) {
      const home = row.direct.find((d) => d.path === (app.base || '/'));
      if (!['allow', 'redirect'].includes(home?.class)) continue; // a home may forward to the person's own start page
      const url = home.class === 'redirect' ? new URL(home.location, app.origin).href : `${app.origin}${app.base || '/'}`;
      const first = await get(url, cookie);
      row.menus[app.key] = menu(first.body);
      const left = Math.max(10, max - row.crawl.length);
      await crawl(app, url, cookie, left, (r, _app, from) => {
        const i = checkPage(account.email, r);
        const cls = classify(r, app);
        if (cls === 'deny') fail('link-to-no-access', account.email, r.url, `linked from ${from}`);
        if (cls === 'not-found') fail('dead-link', account.email, r.url, `linked from ${from}`);
        row.crawl.push({ url: r.url, from, status: r.status, class: cls, location: r.location, h1: i.h1, markers: i.markers, unavailable: i.unavailable, ttfbMs: r.ttfbMs, totalMs: r.totalMs, bytes: r.bytes });
      });
    }
  }

  result.failures = failures;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'walk.json'), JSON.stringify(result, null, 1));
  const counts = Object.entries(Object.groupBy(failures, (f) => f.kind)).map(([k, v]) => `${k}: ${v.length}`);
  const lines = [
    `accounts ${result.accounts.length}; direct hits ${result.accounts.reduce((n, a) => n + a.direct.length, 0)}; crawled ${result.accounts.reduce((n, a) => n + a.crawl.length, 0)}; failures ${failures.length}`,
    ...counts,
    '',
    ...result.accounts.map((a) => `${a.email} | lands ${a.signIns.map((s) => `${s.on}->${s.landing ?? 'none'}`).join(' ')} | ${Object.entries(a.menus).map(([k, m]) => `${k}:${m.workspace}[${m.items.length}]`).join(' ')}`),
    '',
    ...failures.slice(0, 300).map((f) => `${f.kind} | ${f.who} | ${f.url} | ${JSON.stringify(f.detail)}`),
  ];
  writeFileSync(join(outDir, 'walk.txt'), lines.join('\n'));
  console.log(lines.slice(0, 2 + counts.length).join('\n'));
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[2] === '--self-check') selfCheck();
else if (!process.argv[2]) { console.error('usage: node scripts/release/walk.mjs <outDir> | --self-check'); process.exit(2); }
else await main(process.argv[2]);
