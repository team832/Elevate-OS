import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, sessions, userRoles, users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import {
  LoginThrottle,
  SESSION_COOKIE,
  createGoogleSignInHandlers,
  googleConfig,
  googleSignInHref,
  parseCookieHeader,
  validateSession,
  type GoogleConfig,
} from '../src/index';

const SECRET = 'test-only-session-secret-0123456789-abcdefghij';
const CONFIG: GoogleConfig = {
  clientId: 'test-only-client.apps.googleusercontent.com',
  clientSecret: 'test-only-google-client-secret',
  redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
};
const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const IDP = 'https://idp.example.test';

const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const signer = rsa();
const stranger = rsa();
const jwk = {
  ...signer.publicKey.export({ format: 'jwk' }),
  kid: 'key-1',
  alg: 'RS256',
  use: 'sig',
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(
  claims: Record<string, unknown>,
  key: KeyObject = signer.privateKey,
  kid = 'key-1',
) {
  const head = `${b64({ alg: 'RS256', kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${sign('sha256', Buffer.from(head), key).toString('base64url')}`;
}

/** Offline stand-in for Google: discovery, JWKS and a token endpoint that checks PKCE. */
let issue: (nonce: string) => string;
let lastNonce = '';
let challenge = '';
let jwksFetches = 0;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/.well-known/openid-configuration')) {
    return Response.json({
      authorization_endpoint: `${IDP}/auth`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/jwks`,
    });
  }
  if (url === `${IDP}/jwks`) {
    jwksFetches += 1;
    return Response.json({ keys: [jwk] });
  }
  if (url === `${IDP}/token`) {
    const form = new URLSearchParams(String(init?.body));
    const verifier = form.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier).digest('base64url') !== challenge) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    return Response.json({ id_token: issue(lastNonce) });
  }
  return new Response(null, { status: 404 });
};

const claims = (nonce: string, over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CONFIG.clientId,
  sub: '1234567890',
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
  nonce,
  email: 'fictional.asha@elevateeducation.in',
  email_verified: true,
  hd: 'elevateeducation.in',
  name: 'Asha Rao (fictional)',
  ...over,
});

let t: TestDatabase;
let db: Database;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db;
});
afterAll(() => t.close());
beforeEach(() => {
  issue = (nonce) => idToken(claims(nonce));
});

function handlers(over: Partial<Parameters<typeof createGoogleSignInHandlers>[0]> = {}) {
  return createGoogleSignInHandlers({
    module: 'platform',
    loginPath: '/login',
    defaultRedirect: '/',
    getDb: () => db,
    getSecret: () => SECRET,
    getConfig: () => CONFIG,
    fetch: fakeFetch,
    now: () => NOW,
    ...over,
  });
}

/** Start → (fake Google) → callback; `query` / `cookie` may alter what the browser sends back. */
async function signIn(
  h = handlers(),
  options: {
    next?: string;
    query?: (q: URLSearchParams) => void;
    cookie?: (c: string) => string;
  } = {},
) {
  const start = await h.start(
    new Request(
      `http://localhost:3000/api/v1/auth/google/start?next=${encodeURIComponent(options.next ?? '/dashboard')}`,
    ),
  );
  const auth = new URL(start.headers.get('location')!);
  const stateCookie = start.headers.get('set-cookie')!;
  lastNonce = auth.searchParams.get('nonce')!;
  challenge = auth.searchParams.get('code_challenge')!;
  const query = new URLSearchParams({
    code: 'test-only-code',
    state: auth.searchParams.get('state')!,
  });
  options.query?.(query);
  const cookie = stateCookie.split(';')[0]!;
  const res = await h.callback(
    new Request(`http://localhost:3000/api/v1/auth/google/callback?${query}`, {
      headers: { cookie: options.cookie ? options.cookie(cookie) : cookie },
    }),
  );
  const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return { start, auth, stateCookie, res, location: res.headers.get('location'), session };
}

const sessionCount = async () => (await db.select().from(sessions)).length;

describe('Google sign-in: start', () => {
  it('redirects to Google with PKCE, nonce, state, the hd hint and a 10-minute state cookie', async () => {
    issue = (nonce) => idToken(claims(nonce, { email: 'fictional.start@elevateeducation.in' }));
    const { start, auth, stateCookie } = await signIn();
    expect(start.status).toBe(303);
    expect(auth.origin + auth.pathname).toBe(`${IDP}/auth`);
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      hd: 'elevateeducation.in',
      prompt: 'select_account',
    });
    expect(auth.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
    expect(auth.searchParams.get('nonce')).toMatch(/^[\w-]{43}$/);
    expect(stateCookie).toMatch(
      /^elevate_google_signin=[\w.-]+; Path=\/api\/v1\/auth\/google; Max-Age=600; HttpOnly; SameSite=Lax$/,
    );
    expect(stateCookie).not.toContain(CONFIG.clientSecret);
  });

  it('answers 404 on both routes when not configured, and the button link is absent', async () => {
    const h = handlers({ getConfig: () => null });
    expect((await h.start(new Request('http://localhost/api/v1/auth/google/start'))).status).toBe(
      404,
    );
    expect(
      (await h.callback(new Request('http://localhost/api/v1/auth/google/callback'))).status,
    ).toBe(404);
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: CONFIG.clientId })).toBeNull();
    expect(googleSignInHref('/', {})).toBeUndefined();
  });

  it('builds the button link and redirect URI from PLATFORM_URL', () => {
    const env = {
      PLATFORM_URL: 'https://os.example.test/',
      GOOGLE_CLIENT_ID: CONFIG.clientId,
      GOOGLE_CLIENT_SECRET: CONFIG.clientSecret,
    };
    expect(googleConfig(env)?.redirectUri).toBe(
      'https://os.example.test/api/v1/auth/google/callback',
    );
    expect(googleSignInHref('/academic', env)).toBe(
      'https://os.example.test/api/v1/auth/google/start?next=%2Facademic',
    );
  });
});

describe('Google sign-in: callback', () => {
  it('first sign-in creates the user with no roles, opens a session and audits both', async () => {
    const { res, location, session } = await signIn();
    expect(res.status).toBe(303);
    expect(location).toBe('/dashboard');
    expect(res.headers.getSetCookie()[0]).toMatch(/^elevate_google_signin=; .*Max-Age=0/);
    const token = parseCookieHeader(session!.split(';')[0]).get(SESSION_COOKIE)!;
    const user = await validateSession(db, token, SECRET);
    expect(user).toMatchObject({
      email: 'fictional.asha@elevateeducation.in',
      displayName: 'Asha Rao (fictional)',
      roles: [],
    });
    const [row] = await db.select().from(users).where(eq(users.id, user!.id));
    expect(row?.passwordHash).toBeNull();
    expect(await db.select().from(userRoles).where(eq(userRoles.userId, user!.id))).toEqual([]);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.actorUserId, user!.id));
    expect(audits.map((a) => a.action).sort()).toEqual(['auth.login', 'user.created_via_google']);
    expect(audits.find((a) => a.action === 'auth.login')?.metadata).toEqual({ method: 'google' });
  });

  it('a second sign-in reuses the account', async () => {
    const asha = () =>
      db.select().from(users).where(eq(users.email, 'fictional.asha@elevateeducation.in'));
    const [first] = await asha();
    const { session } = await signIn();
    const token = parseCookieHeader(session!.split(';')[0]).get(SESSION_COOKIE)!;
    expect((await validateSession(db, token, SECRET))?.id).toBe(first!.id);
    expect(await asha()).toHaveLength(1);
    const created = await db.select().from(auditEvents).where(eq(auditEvents.entityId, first!.id));
    expect(created.map((a) => a.action)).toEqual(['user.created_via_google']);
  });

  it.each([
    ['wrong hd', { hd: 'gmail.com' }, 'google_domain'],
    ['missing hd', { hd: undefined }, 'google_domain'],
    ['unverified email', { email_verified: false }, 'google_domain'],
    ['email outside the domain', { email: 'someone@gmail.com' }, 'google_domain'],
    ['fictional test domain', { email: 'tara@example.test' }, 'google_domain'],
    ['look-alike domain', { email: 'a@elevateeducation.in.evil.com' }, 'google_domain'],
    ['wrong audience', { aud: 'another-client.apps.googleusercontent.com' }, 'google_failed'],
    ['wrong issuer', { iss: 'https://evil.example.test' }, 'google_failed'],
    ['expired beyond 5 min skew', { exp: NOW / 1000 - 301 }, 'google_failed'],
    ['issued in the future', { iat: NOW / 1000 + 301 }, 'google_failed'],
    ['nonce mismatch', { nonce: 'another-nonce' }, 'google_failed'],
  ])('refuses %s', async (_name, over, code) => {
    issue = (nonce) => idToken(claims(nonce, over));
    const before = await sessionCount();
    const { location, session } = await signIn();
    expect(location).toBe(`/login?error=${code}&next=%2Fdashboard`);
    expect(session).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it('accepts exp within the 5-minute skew and the bare issuer form', async () => {
    issue = (nonce) =>
      idToken(claims(nonce, { exp: NOW / 1000 - 299, iss: 'accounts.google.com' }));
    expect((await signIn()).session).toBeDefined();
  });

  it.each([
    ['bad signature', () => (nonce: string) => idToken(claims(nonce), stranger.privateKey)],
    ['unknown key id', () => (nonce: string) => idToken(claims(nonce), signer.privateKey, 'key-2')],
    ['malformed token', () => () => 'not-a-jwt'],
    [
      'alg none',
      () => (nonce: string) => `${b64({ alg: 'none', kid: 'key-1' })}.${b64(claims(nonce))}.`,
    ],
  ])('refuses %s', async (_name, make) => {
    issue = make();
    const before = await sessionCount();
    const { location, session } = await signIn();
    expect(location).toBe('/login?error=google_failed&next=%2Fdashboard');
    expect(session).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it('refetches the JWKS once for an unknown key id', async () => {
    const h = handlers();
    await signIn(h);
    const fetched = jwksFetches;
    issue = (nonce) => idToken(claims(nonce), signer.privateKey, 'key-2');
    await signIn(h);
    expect(jwksFetches).toBe(fetched + 1);
  });

  it.each([
    ['state mismatch', { query: (q: URLSearchParams) => q.set('state', 'forged') }],
    ['missing state cookie', { cookie: () => '' }],
    [
      'tampered state cookie',
      { cookie: (c: string) => c.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) },
    ],
  ])('%s → google_expired, no session', async (_name, options) => {
    const before = await sessionCount();
    const { location, session } = await signIn(handlers(), options);
    expect(location).toMatch(/^\/login\?error=google_expired&next=/);
    expect(session).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it('a state cookie older than 10 minutes has expired', async () => {
    let now = NOW;
    const h = handlers({ now: () => now });
    const start = await h.start(new Request('http://localhost/api/v1/auth/google/start'));
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    now += 10 * 60 * 1000 + 1000;
    const res = await h.callback(
      new Request(`http://localhost/api/v1/auth/google/callback?code=x&state=${state}`, {
        headers: { cookie: start.headers.get('set-cookie')!.split(';')[0]! },
      }),
    );
    expect(res.headers.get('location')).toBe('/login?error=google_expired&next=%2F');
  });

  it('cancelling at Google → google_cancelled', async () => {
    const { location } = await signIn(handlers(), {
      query: (q) => {
        q.delete('code');
        q.set('error', 'access_denied');
      },
    });
    expect(location).toBe('/login?error=google_cancelled&next=%2Fdashboard');
  });

  it('a disabled account is refused', async () => {
    await db.insert(users).values({
      email: 'fictional.off@elevateeducation.in',
      displayName: 'Off User (fictional)',
      status: 'disabled',
    });
    issue = (nonce) => idToken(claims(nonce, { email: 'fictional.off@elevateeducation.in' }));
    const before = await sessionCount();
    const { location, session } = await signIn();
    expect(location).toBe('/login?error=google_disabled&next=%2Fdashboard');
    expect(session).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it('repeated failures from one IP are throttled', async () => {
    const h = handlers({ ipThrottle: new LoginThrottle({ maxFailures: 2 }) });
    issue = (nonce) => idToken(claims(nonce, { hd: 'gmail.com' }));
    await signIn(h);
    await signIn(h);
    issue = (nonce) => idToken(claims(nonce));
    expect((await signIn(h)).location).toBe('/login?error=locked&next=%2Fdashboard');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com'])(
    'open redirect %s falls back to /',
    async (next) => {
      const { location, session } = await signIn(handlers(), { next });
      expect(session).toBeDefined();
      expect(location).toBe('/');
    },
  );

  it('a BOOTSTRAP_OWNER_EMAILS address gets platform_admin and director (once)', async () => {
    vi.stubEnv('BOOTSTRAP_OWNER_EMAILS', 'fictional.boss@elevateeducation.in');
    issue = (nonce) => idToken(claims(nonce, { email: 'fictional.boss@elevateeducation.in' }));
    try {
      const first = await signIn();
      await signIn();
      const token = parseCookieHeader(first.session!.split(';')[0]).get(SESSION_COOKIE)!;
      const user = await validateSession(db, token, SECRET);
      expect(user?.roles).toEqual(['director', 'platform_admin']);
      const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, user!.id));
      expect(audits.map((a) => a.action).sort()).toEqual([
        'role.bootstrapped',
        'user.created_via_google',
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
