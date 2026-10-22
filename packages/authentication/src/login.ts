import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  appOrigin,
  createLogger,
  isAllowedRequestOrigin,
  loadEnvKeys,
} from '@elevate/configuration';
import {
  isWorkspaceKey,
  resolveLanding,
  workspacesFor,
  type Landing,
} from '@elevate/authorization';
import { getDb, insertAuditEvent, userRoles, users, type Database } from '@elevate/database';
import {
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  errorResponse,
  safeRelativePath,
  seeOther,
  successResponse,
} from '@elevate/shared-contracts';
import { MODULES, type ModuleKey, type RoleKey, type UserId } from '@elevate/shared-types';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readSessionToken,
  serializeCookie,
  sessionCookieOptions,
} from './cookies';
import { assertAllowedEmail, isAllowedEmail } from './email-domain';
import { burnVerificationTime, verifyPassword } from './password';
import {
  SESSION_TTL_MS,
  createSession,
  loadRoles,
  revokeSessionByToken,
  validateSession,
} from './sessions';
import { LoginThrottle } from './throttle';

const log = createLogger({ component: 'authentication' });

/** SESSION_SECRET from the environment (validated, read lazily). */
export function getSessionSecret(): string {
  return loadEnvKeys(['SESSION_SECRET'], process.env, 'authentication').SESSION_SECRET;
}

/** Resolve the signed-in user from a Request's cookie (route handlers, tests). */
export async function getUserFromRequest(request: Request, db: Database = getDb()) {
  return validateSession(db, readSessionToken(request), getSessionSecret());
}

export interface PasswordCheckResult {
  userId: UserId;
  email: string;
  displayName: string;
}

/** Check an email/password pair. Returns null for unknown email, wrong password, disabled user or a non-organisation email. */
export async function checkPassword(
  db: Database,
  email: string,
  password: string,
): Promise<PasswordCheckResult | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user || !user.passwordHash) {
    await burnVerificationTime(password);
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || user.status !== 'active' || !isAllowedEmail(user.email)) return null;
  return { userId: user.id, email: user.email, displayName: user.displayName };
}

const loginBody = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(512),
  next: z.string().max(2000).optional(),
});

export interface AuthHandlerOptions {
  /** Module the handler is mounted in (for the audit trail). */
  module: ModuleKey;
  /** Login page path including basePath, e.g. `/login` or `/marketing/login`. */
  loginPath: string;
  /** Where to send the browser after login when `next` is absent, e.g. `/` or `/marketing`. */
  defaultRedirect: string;
  getDb?: () => Database;
  getSecret?: () => string;
  /** Per (email, ip) throttle. Default: 5 failures / 15 min → 15 min lock. */
  throttle?: LoginThrottle;
  /** Per ip throttle. Default: 50 failures / 15 min → 15 min lock. */
  ipThrottle?: LoginThrottle;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function isFormPost(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
}

async function readBody(request: Request): Promise<unknown> {
  if (isFormPost(request)) {
    const form = await request.formData();
    return Object.fromEntries(
      [...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']),
    );
  }
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Send JSON { "email", "password" } or an HTML form.');
  }
}

/**
 * Browser location for a landing (D-072). Another workspace is its configured origin (an
 * allowlist, never user input) and the URL never carries a token: the session cookie is
 * shared by every localhost port. `hereOrigin` makes a same-app landing absolute.
 */
export function landingLocation(landing: Landing, current: ModuleKey, hereOrigin = ''): string {
  if (landing.kind === 'workspace')
    return `${appOrigin(landing.workspace)}${MODULES[landing.workspace].basePath}`;
  return `${hereOrigin}${landing.kind === 'here' ? landing.path : `${MODULES[current].basePath}/workspaces`}`;
}

/** Where `userId` goes after signing in on app `current` (stored roles + remembered workspace). */
export async function landingFor(
  db: Database,
  userId: UserId,
  current: ModuleKey,
  next: string | undefined,
  hereOrigin = '',
): Promise<string> {
  const [row] = await db
    .select({ preferred: users.preferredWorkspace })
    .from(users)
    .where(eq(users.id, userId));
  const workspaces = workspacesFor({ id: userId, roles: await loadRoles(db, userId) });
  const landing = resolveLanding({ workspaces, preferred: row?.preferred, current, next });
  return landingLocation(landing, current, hereOrigin);
}

/** CSRF guard for the form-posting auth handlers (defineRoute routes have their own). */
export function refuseCrossSite(request: Request, requestId: string): Response | null {
  if (isAllowedRequestOrigin(request)) return null;
  log.warn('cross-site auth request refused', { requestId, origin: request.headers.get('origin') });
  return errorResponse(
    new ForbiddenError('This request came from another site and was refused.'),
    requestId,
  );
}

/** Roles a BOOTSTRAP_OWNER_EMAILS address holds after signing in (first administrator, D-030). */
export const BOOTSTRAP_ROLES = ['director', 'platform_admin'] as const satisfies readonly RoleKey[];

/**
 * If the signing-in email is listed in BOOTSTRAP_OWNER_EMAILS, add the missing
 * BOOTSTRAP_ROLES and audit `role.bootstrapped` (only when something was added).
 * An invalid list throws ConfigurationError, so sign-in fails loudly until it is fixed.
 */
async function bootstrapOwner(
  tx: Database,
  input: { userId: UserId; module: ModuleKey; requestId: string },
  email: string,
): Promise<void> {
  const owners = loadEnvKeys(['BOOTSTRAP_OWNER_EMAILS']).BOOTSTRAP_OWNER_EMAILS;
  if (!owners.includes(email) || !isAllowedEmail(email, 'production')) return;
  const added = await tx
    .insert(userRoles)
    .values(BOOTSTRAP_ROLES.map((role) => ({ userId: input.userId, role })))
    .onConflictDoNothing()
    .returning({ role: userRoles.role });
  if (added.length === 0) return;
  await insertAuditEvent(tx, {
    actorType: 'system',
    module: input.module,
    action: 'role.bootstrapped',
    entityType: 'user',
    entityId: input.userId,
    requestId: input.requestId,
    after: { roles: added.map((r) => r.role).sort() },
    metadata: { source: 'BOOTSTRAP_OWNER_EMAILS' },
  });
  log.warn('bootstrap owner roles granted', { requestId: input.requestId, userId: input.userId });
}

/**
 * Create a session for an already-verified user, stamp `last_login_at`, audit
 * `auth.login` (with the sign-in method) in one transaction, and return the
 * `Set-Cookie` value. Shared by password and Google sign-in.
 */
export async function openSession(
  db: Database,
  request: Request,
  input: {
    userId: UserId;
    secret: string;
    module: ModuleKey;
    requestId: string;
    method: 'password' | 'google';
  },
): Promise<{ cookie: string; expiresAt: Date }> {
  const session = await db.transaction(async (tx) => {
    const created = await createSession(tx as unknown as Database, {
      userId: input.userId,
      secret: input.secret,
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    const [signedIn] = await tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning({ email: users.email });
    if (signedIn) await bootstrapOwner(tx as unknown as Database, input, signedIn.email);
    await insertAuditEvent(tx as unknown as Database, {
      actorType: 'user',
      actorUserId: input.userId,
      module: input.module,
      action: 'auth.login',
      entityType: 'session',
      entityId: created.sessionId,
      requestId: input.requestId,
      metadata: { method: input.method },
    });
    return created;
  });
  const cookie = serializeCookie(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(Math.floor(SESSION_TTL_MS / 1000)),
  );
  log.info('login succeeded', {
    requestId: input.requestId,
    module: input.module,
    userId: input.userId,
    method: input.method,
  });
  return { cookie, expiresAt: session.expiresAt };
}

export function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

/**
 * POST handler for `/api/v1/auth/login`. Accepts JSON (returns the envelope)
 * or an HTML form post (303 redirect to `next` or back to the login page with
 * `?error=`). Sets the `elevate_session` cookie on success.
 */
export function createLoginHandler(options: AuthHandlerOptions) {
  const throttle = options.throttle ?? new LoginThrottle();
  const ipThrottle = options.ipThrottle ?? new LoginThrottle({ maxFailures: 50 });
  return async function login(request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const crossSite = refuseCrossSite(request, requestId);
    if (crossSite) return crossSite;
    const form = isFormPost(request);
    const ip = clientIp(request);
    let nextPath = options.defaultRedirect;
    try {
      const parsed = loginBody.safeParse(await readBody(request));
      if (!parsed.success) {
        throw new ValidationError('Email and password are required.', {
          details: parsed.error.issues.map((i) => ({
            location: 'body',
            path: i.path,
            message: i.message,
          })),
        });
      }
      const { email, password } = parsed.data;
      nextPath = safeRelativePath(parsed.data.next, options.defaultRedirect);
      if (!isAllowedEmail(email)) {
        log.warn('login refused: not an organisation email', {
          requestId,
          module: options.module,
          ip,
        });
        assertAllowedEmail(email);
      }
      const key = `${email.toLowerCase()}|${ip}`;
      if (throttle.retryAfterMs(key) > 0 || ipThrottle.retryAfterMs(ip) > 0) {
        throw new RateLimitedError('Too many failed sign-in attempts. Try again in 15 minutes.');
      }
      const db = (options.getDb ?? getDb)();
      const secret = (options.getSecret ?? getSessionSecret)();
      const user = await checkPassword(db, email, password);
      if (!user) {
        throttle.recordFailure(key);
        ipThrottle.recordFailure(ip);
        log.warn('login failed', { requestId, module: options.module, ip });
        throw new UnauthenticatedError('Email or password is incorrect.');
      }
      throttle.reset(key);
      const session = await openSession(db, request, {
        userId: user.userId,
        secret,
        module: options.module,
        requestId,
        method: 'password',
      });
      const { cookie } = session;
      if (form)
        return seeOther(await landingFor(db, user.userId, options.module, nextPath), {
          'set-cookie': cookie,
        });
      const roles = await loadRoles(db, user.userId);
      return successResponse(
        {
          user: { id: user.userId, email: user.email, displayName: user.displayName, roles },
          expiresAt: session.expiresAt.toISOString(),
        },
        { headers: { 'set-cookie': cookie, 'x-request-id': requestId } },
      );
    } catch (error) {
      if (!(
        error instanceof UnauthenticatedError ||
        error instanceof ValidationError ||
        error instanceof RateLimitedError ||
        error instanceof ForbiddenError
      )) {
        log.error('login error', { requestId, error });
      }
      if (form) {
        const code =
          error instanceof RateLimitedError
            ? 'locked'
            : error instanceof ValidationError
              ? 'missing'
              : error instanceof UnauthenticatedError
                ? 'invalid'
                : error instanceof ForbiddenError
                  ? 'domain'
                  : 'unavailable';
        return seeOther(withQuery(options.loginPath, { error: code, next: nextPath }));
      }
      return errorResponse(error, requestId);
    }
  };
}

/**
 * POST handler for `/api/v1/auth/logout`. Revokes the session, clears the
 * cookie; JSON → `{ data: { signedOut: true } }`, form → 303 to the login page.
 */
export function createLogoutHandler(options: AuthHandlerOptions) {
  return async function logout(request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const crossSite = refuseCrossSite(request, requestId);
    if (crossSite) return crossSite;
    const clear = clearSessionCookie();
    try {
      const token = readSessionToken(request);
      if (token) {
        const db = (options.getDb ?? getDb)();
        const secret = (options.getSecret ?? getSessionSecret)();
        const user = await validateSession(db, token, secret);
        await db.transaction(async (tx) => {
          const revoked = await revokeSessionByToken(tx as unknown as Database, token, secret);
          if (revoked && user) {
            await insertAuditEvent(tx as unknown as Database, {
              actorType: 'user',
              actorUserId: user.id,
              module: options.module,
              action: 'auth.logout',
              entityType: 'session',
              entityId: revoked,
              requestId,
            });
          }
        });
      }
      if (isFormPost(request)) return seeOther(options.loginPath, { 'set-cookie': clear });
      return successResponse(
        { signedOut: true },
        { headers: { 'set-cookie': clear, 'x-request-id': requestId } },
      );
    } catch (error) {
      log.error('logout error', { requestId, error });
      return errorResponse(error, requestId, { headers: { 'set-cookie': clear } });
    }
  };
}

/**
 * POST handler for `<base>/api/v1/auth/workspace` (the chooser form, D-072): opens a workspace
 * the signed-in user belongs to and, with `remember=yes`, stores it as their default (audited).
 * Anything else is refused; the redirect target is the workspace's configured origin.
 */
export function createWorkspaceChoiceHandler(options: AuthHandlerOptions) {
  return async function chooseWorkspace(request: Request): Promise<Response> {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const crossSite = refuseCrossSite(request, requestId);
    if (crossSite) return crossSite;
    try {
      const db = (options.getDb ?? getDb)();
      const user = await validateSession(
        db,
        readSessionToken(request),
        (options.getSecret ?? getSessionSecret)(),
      );
      if (!user) return seeOther(options.loginPath);
      const form = isFormPost(request) ? await request.formData() : new FormData();
      const workspace = form.get('workspace');
      if (!isWorkspaceKey(workspace) || !workspacesFor(user).includes(workspace)) {
        throw new ForbiddenError('Your roles do not include that workspace.');
      }
      if (form.get('remember') === 'yes' && user.preferredWorkspace !== workspace) {
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ preferredWorkspace: workspace })
            .where(eq(users.id, user.id));
          await insertAuditEvent(tx as unknown as Database, {
            actorType: 'user',
            actorUserId: user.id,
            module: options.module,
            action: 'user.workspace_preference_set',
            entityType: 'user',
            entityId: user.id,
            requestId,
            before: { preferredWorkspace: user.preferredWorkspace ?? null },
            after: { preferredWorkspace: workspace },
          });
        });
      }
      return seeOther(landingLocation({ kind: 'workspace', workspace }, options.module));
    } catch (error) {
      if (!(error instanceof ForbiddenError))
        log.error('workspace choice error', { requestId, error });
      return errorResponse(error, requestId);
    }
  };
}
