/**
 * "Sign in with Google" (OpenID Connect, authorization code flow + PKCE, D-030).
 * Only verified @elevateeducation.in Workspace accounts get in; a first sign-in
 * creates an account with no roles (OD-009: an administrator assigns them).
 * Network access is the injected `fetch`, time the injected `now`, so tests
 * run offline with their own signing key.
 */
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { WORKSPACE_KEYS } from '@elevate/authorization';
import { appOrigin, createLogger, loadEnv } from '@elevate/configuration';
import { getDb, insertAuditEvent, staffMembers, users, type Database } from '@elevate/database';
import {
  NotFoundError,
  errorResponse,
  safeRelativePath,
  seeOther,
} from '@elevate/shared-contracts';
import { MODULES } from '@elevate/shared-types';
import { parseCookieHeader, serializeCookie, sessionCookieOptions } from './cookies';
import { ORGANISATION_EMAIL_DOMAIN, isAllowedEmail } from './email-domain';
import {
  clientIp,
  getSessionSecret,
  landingFor,
  openSession,
  withQuery,
  type AuthHandlerOptions,
} from './login';
import { LoginThrottle } from './throttle';

const log = createLogger({ component: 'authentication.google' });

export const GOOGLE_START_PATH = '/api/v1/auth/google/start';
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';
const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_COOKIE = 'elevate_google_signin';
const STATE_TTL_S = 10 * 60;
const CLOCK_SKEW_S = 5 * 60;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** From GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / PLATFORM_URL; null unless both Google values are set. */
export function googleConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleConfig | null {
  const e = loadEnv('googleSignIn', env);
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: `${e.PLATFORM_URL.replace(/\/$/, '')}${GOOGLE_CALLBACK_PATH}`,
  };
}

/**
 * Link for the "Sign in with Google" button on any zone's login page, or
 * undefined when Google sign-in is not configured (D-014: no button, no claim).
 * Absolute on PLATFORM_URL so the state cookie and the callback share a host.
 */
export function googleSignInHref(next: string, env = process.env): string | undefined {
  const config = googleConfig(env);
  if (!config) return undefined;
  return `${new URL(config.redirectUri).origin}${withQuery(GOOGLE_START_PATH, { next })}`;
}

/** `code` is what the login page shows (`?error=google_<code>`); `reason` is only logged. */
export class GoogleSignInError extends Error {
  constructor(
    readonly code: 'domain' | 'failed' | 'alias',
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'GoogleSignInError';
  }
}

const discoverySchema = z.object({
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
const jwksSchema = z.object({
  keys: z.array(z.looseObject({ kid: z.string(), kty: z.string() })),
});
const tokenSchema = z.object({ id_token: z.string() });
const headerSchema = z.object({ alg: z.string(), kid: z.string() });
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  nonce: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  hd: z.string().optional(),
  name: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GoogleSignInError('failed', `${what} malformed`);
  return parsed.data;
}

const decodeSegment = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface GoogleDeps {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

/** Google's endpoints and signing keys, discovered and cached per process. */
export function createGoogleOidc(deps: GoogleDeps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const nowS = () => Math.floor((deps.now ?? Date.now)() / 1000);
  let discovery: Promise<z.infer<typeof discoverySchema>> | undefined;
  let keys = new Map<string, KeyObject>();

  async function getJson(url: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!res.ok)
      throw new GoogleSignInError('failed', `${new URL(url).pathname} answered ${res.status}`);
    return res.json();
  }

  const endpoints = () =>
    (discovery ??= getJson(DISCOVERY_URL)
      .then((body) => parse(discoverySchema, body, 'discovery document'))
      .catch((error: unknown) => {
        discovery = undefined;
        throw error;
      }));

  async function signingKey(kid: string): Promise<KeyObject | undefined> {
    if (!keys.has(kid)) {
      const jwks = parse(jwksSchema, await getJson((await endpoints()).jwks_uri), 'JWKS');
      keys = new Map(
        jwks.keys
          .filter((jwk) => jwk.kty === 'RSA')
          .map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]),
      );
    }
    return keys.get(kid);
  }

  async function verifyIdToken(config: GoogleConfig, idToken: string, nonce: string) {
    const [h, p, s, extra] = idToken.split('.');
    if (!h || !p || !s || extra !== undefined)
      throw new GoogleSignInError('failed', 'ID token malformed');
    const header = parse(headerSchema, decodeSegment(h), 'ID token header');
    if (header.alg !== 'RS256')
      throw new GoogleSignInError('failed', `unexpected alg ${header.alg}`);
    const key = await signingKey(header.kid);
    if (!key) throw new GoogleSignInError('failed', 'unknown signing key');
    if (!verify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
      throw new GoogleSignInError('failed', 'bad signature');
    }
    const c = parse(claimsSchema, decodeSegment(p), 'ID token claims');
    const now = nowS();
    if (!ISSUERS.includes(c.iss)) throw new GoogleSignInError('failed', 'wrong issuer');
    if (c.aud !== config.clientId) throw new GoogleSignInError('failed', 'wrong audience');
    if (c.exp + CLOCK_SKEW_S < now) throw new GoogleSignInError('failed', 'expired');
    if (c.iat - CLOCK_SKEW_S > now) throw new GoogleSignInError('failed', 'issued in the future');
    if (!safeEqual(c.nonce, nonce)) throw new GoogleSignInError('failed', 'nonce mismatch');
    // Production rule even in development: Google accounts are never @example.test.
    if (
      !c.email_verified ||
      c.hd !== ORGANISATION_EMAIL_DOMAIN ||
      !isAllowedEmail(c.email, 'production')
    ) {
      throw new GoogleSignInError('domain', 'not a verified organisation account');
    }
    return { email: c.email.trim().toLowerCase(), name: c.name?.trim() };
  }

  return {
    async authorizationUrl(
      config: GoogleConfig,
      p: { state: string; nonce: string; codeChallenge: string },
    ) {
      const url = new URL((await endpoints()).authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: p.state,
        nonce: p.nonce,
        code_challenge: p.codeChallenge,
        code_challenge_method: 'S256',
        hd: ORGANISATION_EMAIL_DOMAIN, // a hint for the account chooser only; the ID token is checked
        prompt: 'select_account',
      }).toString();
      return url.toString();
    },

    /** Exchange the code and return the verified organisation identity. */
    async identify(config: GoogleConfig, code: string, saved: { nonce: string; verifier: string }) {
      const body = await getJson((await endpoints()).token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: saved.verifier,
        }),
      });
      return verifyIdToken(
        config,
        parse(tokenSchema, body, 'token response').id_token,
        saved.nonce,
      );
    },
  };
}

// --- state cookie: state, nonce, PKCE verifier and `next`, HMAC'd with SESSION_SECRET -----

interface SavedState {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  exp: number;
}

const stateMac = (body: string, secret: string) =>
  createHmac('sha256', secret).update(`google-signin-state:${body}`).digest('base64url');

function sealState(data: SavedState, secret: string): string {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${stateMac(body, secret)}`;
}

function openState(raw: string | undefined, secret: string, nowS: number): SavedState | null {
  const [body, mac] = raw?.split('.') ?? [];
  if (!body || !mac || !safeEqual(mac, stateMac(body, secret))) return null;
  const data = decodeSegment(body) as SavedState; // our own signed JSON
  return data.exp > nowS ? data : null;
}

const stateCookie = (value: string, maxAge: number) =>
  serializeCookie(STATE_COOKIE, value, {
    ...sessionCookieOptions(maxAge),
    path: '/api/v1/auth/google',
  });

const random = () => randomBytes(32).toString('base64url');

export interface GoogleHandlerOptions extends AuthHandlerOptions, GoogleDeps {
  getConfig?: () => GoogleConfig | null;
}

/**
 * GET handlers for `/api/v1/auth/google/start?next=` and `/api/v1/auth/google/callback`.
 * Both answer 404 when Google sign-in is not configured. Every refusal is a 303
 * to the login page with `?error=google_*` (or `locked` / `unavailable`).
 */
export function createGoogleSignInHandlers(options: GoogleHandlerOptions) {
  const google = createGoogleOidc(options);
  const ipThrottle = options.ipThrottle ?? new LoginThrottle({ maxFailures: 50 });
  const getConfig = options.getConfig ?? (() => googleConfig());
  const getSecret = options.getSecret ?? getSessionSecret;
  const nowS = () => Math.floor((options.now ?? Date.now)() / 1000);
  const notConfigured = (requestId: string) =>
    errorResponse(new NotFoundError('Google sign-in is not configured.'), requestId);
  const toLogin = (error: string, next: string, headers?: HeadersInit) =>
    seeOther(withQuery(options.loginPath, { error, next }), headers);

  async function start(request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const config = getConfig();
    if (!config) return notConfigured(requestId);
    const next = safeRelativePath(
      new URL(request.url).searchParams.get('next'),
      options.defaultRedirect,
    );
    const saved = {
      state: random(),
      nonce: random(),
      verifier: random(),
      next,
      exp: nowS() + STATE_TTL_S,
    };
    try {
      const url = await google.authorizationUrl(config, {
        state: saved.state,
        nonce: saved.nonce,
        codeChallenge: createHash('sha256').update(saved.verifier).digest('base64url'),
      });
      return seeOther(url, {
        'set-cookie': stateCookie(sealState(saved, getSecret()), STATE_TTL_S),
      });
    } catch (error) {
      log.error('google sign-in could not start', { requestId, error });
      return toLogin('unavailable', next);
    }
  }

  async function callback(request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const config = getConfig();
    if (!config) return notConfigured(requestId);
    const ip = clientIp(request);
    const params = new URL(request.url).searchParams;
    const secret = getSecret();
    const saved = openState(
      parseCookieHeader(request.headers.get('cookie')).get(STATE_COOKIE),
      secret,
      nowS(),
    );
    const next = safeRelativePath(saved?.next, options.defaultRedirect);
    const clear = stateCookie('', 0);
    const refuse = (code: string, reason: string) => {
      log.warn('google sign-in refused', { requestId, module: options.module, ip, reason });
      return toLogin(code, next, { 'set-cookie': clear });
    };

    const googleError = params.get('error');
    if (googleError) {
      return refuse(
        googleError === 'access_denied' ? 'google_cancelled' : 'google_failed',
        `google: ${googleError.slice(0, 40)}`,
      );
    }
    if (!saved || !safeEqual(params.get('state') ?? '', saved.state)) {
      return refuse('google_expired', saved ? 'state mismatch' : 'state cookie missing or expired');
    }
    const code = params.get('code');
    if (!code) return refuse('google_failed', 'no code');
    if (ipThrottle.retryAfterMs(ip) > 0) return refuse('locked', 'ip throttled');

    try {
      const identity = await google.identify(config, code, saved);
      const db = (options.getDb ?? getDb)();
      const user = await findOrCreateUser(db, identity, options.module, requestId);
      if (user.status !== 'active') return refuse('google_disabled', 'account disabled');
      const { cookie } = await openSession(db, request, {
        userId: user.id,
        secret,
        module: options.module,
        requestId,
        method: 'google',
      });
      // Module sign-in pages send their own path as `next`; land on that workspace's origin.
      const owner =
        WORKSPACE_KEYS.find(
          (k) => next === MODULES[k].basePath || next.startsWith(`${MODULES[k].basePath}/`),
        ) ?? options.module;
      const hereOrigin = owner === options.module ? '' : appOrigin(owner);
      return seeOther(await landingFor(db, user.id, owner, next, hereOrigin), [
        ['set-cookie', clear],
        ['set-cookie', cookie],
      ]);
    } catch (error) {
      if (error instanceof GoogleSignInError) {
        ipThrottle.recordFailure(ip);
        return refuse(`google_${error.code}`, error.reason);
      }
      log.error('google sign-in error', { requestId, error });
      return toLogin('unavailable', next, { 'set-cookie': clear });
    }
  }

  return { start, callback };
}

/**
 * The account for a verified Google identity; created (no roles) on first sign-in, unless a
 * staff record with the same name already has an account under another email (brief §3: an
 * email change must not create a second identity; an administrator changes that account's
 * login email instead).
 */
async function findOrCreateUser(
  db: Database,
  identity: { email: string; name?: string },
  module: AuthHandlerOptions['module'],
  requestId: string,
) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const find = async () =>
      (
        await t
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.email, identity.email))
          .limit(1)
      )[0];
    const existing = await find();
    if (existing) return existing;
    // shortcut: same-name match only (Google gives no other link); a namesake must be added by an administrator.
    const [linked] = identity.name
      ? await t
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .innerJoin(users, eq(users.id, staffMembers.userId))
          .where(sql`lower(trim(${staffMembers.fullName})) = lower(trim(${identity.name}))`)
          .limit(1)
      : [];
    if (linked) throw new GoogleSignInError('alias', 'staff record linked to another account');
    const [created] = await t
      .insert(users)
      .values({
        email: identity.email,
        displayName: (identity.name || identity.email.split('@')[0]!).slice(0, 200),
        passwordHash: null,
      })
      .onConflictDoNothing()
      .returning({ id: users.id, status: users.status });
    if (!created) return (await find())!; // created by a concurrent first sign-in
    await insertAuditEvent(t, {
      actorType: 'user',
      actorUserId: created.id,
      module,
      action: 'user.created_via_google',
      entityType: 'user',
      entityId: created.id,
      requestId,
    });
    return created;
  });
}
