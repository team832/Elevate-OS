/**
 * Student and parent portal (F4-13): its own sign-in, setup and cookie, separate from staff.
 * - A portal login (`<login>@portal.invalid`, roles student / guardian) never opens a staff
 *   workspace: staff sessions refuse its domain. A staff user who opens /portal is sent to `/`.
 * - Every page and file is for one of the login's LIVE linked students (core.portal_accounts):
 *   any other id is 404. A guardian link also needs its Ops guardian row not archived, and, while
 *   `portal.guardian_access_to_adults` is off (Proposed), a child under 18 (or with no date of
 *   birth). Checked on every request and at sign-in.
 * - Setting `portal.enabled` (Ops, Proposed off): off = pages say "not open yet", sign-in and
 *   setup refuse, files 404.
 * - Sign-in and setup are limited in core.login_attempts by portal-only buckets (never the staff
 *   ones): per login and address, per address, per login, and a global ceiling, since the address
 *   (X-Forwarded-For) can be forged. A setup code is typed with its login and counted per login.
 */
import { and, asc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import {
  burnVerificationTime,
  clientIp,
  createSession,
  getSessionSecret,
  LoginThrottle,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  parseCookieHeader,
  PORTAL_COOKIE,
  portalEmail,
  redeemSetupCode,
  refuseCrossSite,
  revokeSessionByToken,
  serializeCookie,
  SESSION_TTL_MS,
  sessionCookieOptions,
  validatePortalSession,
  verifyPassword,
  withQuery,
  type AuthenticatedUser,
} from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { createLogger } from '@elevate/configuration';
import {
  getDb,
  insertAuditEvent,
  opsGuardians,
  portalAccounts,
  students,
  users,
  type Database,
} from '@elevate/database';
import {
  feeRecordStudentId,
  isAdultStudent,
  loadSettings,
  receiptFor,
  renderReceiptPdf,
} from '@elevate/business-ops-os/server';
import { getCurrentUser } from '@elevate/server-kit/next';
import {
  errorResponse,
  NotFoundError,
  safeRelativePath,
  seeOther,
  UnauthenticatedError,
} from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';

const log = createLogger({ component: 'portal' });
export const PORTAL_LOGIN = '/portal/login';

export const portalOpen = async (db: Database) =>
  (await loadSettings(db))['portal.enabled'].value.enabled;

/** The login's live linked students, by name (see the rules above). */
export async function linkedStudents(db: Database, userId: UserId) {
  const rows = await db
    .select({
      id: students.id,
      fullName: students.fullName,
      isSample: students.isSample,
      kind: portalAccounts.kind,
    })
    .from(portalAccounts)
    .innerJoin(students, eq(students.id, portalAccounts.studentId))
    .leftJoin(opsGuardians, eq(opsGuardians.id, portalAccounts.guardianId))
    .where(
      and(
        eq(portalAccounts.userId, userId),
        isNull(portalAccounts.disabledAt),
        or(
          isNull(portalAccounts.guardianId),
          and(isNotNull(opsGuardians.id), isNull(opsGuardians.archivedAt)),
        ),
      ),
    )
    .orderBy(asc(students.fullName));
  if (
    !rows.some((r) => r.kind === 'guardian') ||
    (await loadSettings(db))['portal.guardian_access_to_adults'].value.allowed
  )
    return rows;
  const shown = [];
  for (const r of rows)
    if (r.kind === 'student' || !(await isAdultStudent(db, r.id))) shown.push(r);
  return shown;
}

export type Linked = Awaited<ReturnType<typeof linkedStudents>>[number];
export type PortalView =
  { closed: true } | { closed: false; user: AuthenticatedUser; children: Linked[]; child: Linked };

async function portalUser(db: Database, token: string | undefined) {
  const user = await validatePortalSession(db, token, getSessionSecret());
  if (!user || !can(user, 'platform:portal:access')) return null;
  const children = await linkedStudents(db, user.id);
  return children.length ? { user, children } : null;
}

/** Signed-in portal login or nothing: a staff user goes home, anyone else to the portal sign-in. */
async function requirePortalUser(db: Database, path: string) {
  const found = await portalUser(db, (await cookies()).get(PORTAL_COOKIE)?.value);
  if (found) return found;
  if (await getCurrentUser()) redirect('/');
  redirect(withQuery(PORTAL_LOGIN, { next: path }));
}

/** Gate of every portal page: the student is `?student=` (one of the login's), else the first. */
export async function portalPage(path: string, student?: string | string[]): Promise<PortalView> {
  const db = getDb();
  if (!(await portalOpen(db))) return { closed: true };
  const { user, children } = await requirePortalUser(db, path);
  const child = student === undefined ? children[0] : children.find((c) => c.id === student);
  if (!child) notFound();
  return { closed: false, user, children, child };
}

/** Sign-in and setup pages: a signed-in portal login goes to the portal, a staff user home. */
export async function portalEntry() {
  const db = getDb();
  if (await portalUser(db, (await cookies()).get(PORTAL_COOKIE)?.value)) redirect('/portal');
  if (await getCurrentUser()) redirect('/');
  return { open: await portalOpen(db) };
}

// --- sign-in limits ---------------------------------------------------------------------------

const pairLimit = new LoginThrottle('portal');
const ipLimit = new LoginThrottle('portal-ip');
const loginLimit = new LoginThrottle('portal-login');
const loginCeiling = new LoginThrottle('portal-all');
const setupLimit = new LoginThrottle('portal-setup');
const setupCeiling = new LoginThrottle('portal-setup-all');
type Limit = readonly [LoginThrottle, string];

/** Staff sign-in's order: refuse while locked, count first, take the count back on success. */
async function limited<T>(
  db: Database,
  limits: readonly Limit[],
  attempt: () => Promise<T | null>,
) {
  const each = <R>(run: (l: LoginThrottle, k: string, i: number) => Promise<R>) =>
    Promise.all(limits.map(([l, k], i) => run(l, k, i)));
  const undo = () => each((l, k) => l.undo(db, k));
  if ((await each((l, k) => l.retryAfterMs(db, k))).some((ms) => ms > 0)) return 'locked' as const;
  if ((await each((l, k) => l.recordFailure(db, k))).includes(false)) {
    await undo();
    return 'locked' as const;
  }
  const out = await attempt().catch(async (error: unknown) => {
    await undo();
    throw error;
  });
  if (out !== null) await each((l, k, i) => (i === 0 ? l.reset(db, k) : l.undo(db, k)));
  return out;
}

// --- handlers ---------------------------------------------------------------------------------

const loginName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/@portal\.invalid$/, ''))
  .pipe(z.string().regex(/^[a-z0-9.]{3,40}$/));
const password = z.string().min(1).max(MAX_PASSWORD_LENGTH);

async function readForm(request: Request) {
  const form = await request.formData().catch(() => new FormData());
  return (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : '';
  };
}

/** A portal sign-in, a setup or a sign-out: CSRF check, form, and "unavailable" on a fault. */
function formHandler(
  back: string,
  run: (request: Request, requestId: string, db: Database) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const crossSite = refuseCrossSite(request, requestId);
    if (crossSite) return crossSite;
    try {
      return await run(request, requestId, getDb());
    } catch (error) {
      log.error('portal form failed', { requestId, error });
      return seeOther(withQuery(back, { error: 'unavailable' }));
    }
  };
}

async function checkLogin(db: Database, email: string, pw: string): Promise<UserId | null> {
  const [u] = await db
    .select({ id: users.id, hash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, email));
  if (!u?.hash) {
    await burnVerificationTime(pw);
    return null;
  }
  if (!(await verifyPassword(pw, u.hash)) || u.status !== 'active') return null;
  return (await linkedStudents(db, u.id)).length ? u.id : null;
}

/** POST /api/v1/portal/login (form): login + password → portal cookie, 303 to `next` (a /portal page). */
export const portalLogin = formHandler(PORTAL_LOGIN, async (request, requestId, db) => {
  const field = await readForm(request);
  const raw = safeRelativePath(field('next'), '/portal');
  const next =
    raw === '/portal' || raw.startsWith('/portal/') || raw.startsWith('/portal?') ? raw : '/portal';
  const back = (error: string) => seeOther(withQuery(PORTAL_LOGIN, { error, next }));
  if (!(await portalOpen(db))) return back('closed');
  const login = loginName.safeParse(field('login'));
  const pw = password.safeParse(field('password'));
  if (!login.success || !pw.success)
    return back(field('login') && field('password') ? 'invalid' : 'missing');
  const email = portalEmail(login.data);
  const ip = clientIp(request);
  const userId = await limited(
    db,
    [
      [pairLimit, `${email}|${ip}`],
      [ipLimit, ip],
      [loginLimit, email],
      [loginCeiling, 'all'],
    ],
    () => checkLogin(db, email, pw.data),
  );
  if (userId === 'locked') return back('locked');
  if (!userId) return back('invalid');
  const session = await db.transaction(async (t) => {
    const tx = t as unknown as Database;
    const created = await createSession(tx, {
      userId,
      secret: getSessionSecret(),
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
    });
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
    await insertAuditEvent(tx, {
      actorType: 'user',
      actorUserId: userId,
      module: 'platform',
      action: 'auth.login',
      entityType: 'session',
      entityId: created.sessionId,
      requestId,
      metadata: { method: 'portal' },
    });
    return created;
  });
  return seeOther(next, {
    'set-cookie': serializeCookie(
      PORTAL_COOKIE,
      session.token,
      sessionCookieOptions(SESSION_TTL_MS / 1000),
    ),
  });
});

/** POST /api/v1/portal/setup (form): login + setup code + new password (twice); the code works once. */
export const portalSetup = formHandler('/portal/setup', async (request, requestId, db) => {
  const field = await readForm(request);
  const back = (error: string) => seeOther(withQuery('/portal/setup', { error }));
  if (!(await portalOpen(db))) return back('closed');
  const code = field('code').trim();
  const pw = field('password');
  const login = loginName.safeParse(field('login'));
  if (!code || !pw || !field('login').trim()) return back('missing');
  if (pw.length < MIN_PASSWORD_LENGTH || pw.length > MAX_PASSWORD_LENGTH) return back('short');
  if (pw !== field('confirm')) return back('mismatch');
  const ip = clientIp(request);
  // A malformed login is counted like a wrong code, under what was typed.
  const who = login.success ? login.data : field('login').trim().toLowerCase().slice(0, 64);
  const userId = await limited(
    db,
    [
      [setupLimit, who],
      [ipLimit, ip],
      [setupCeiling, 'all'],
    ],
    () =>
      db.transaction(async (t) => {
        const tx = t as unknown as Database;
        const id = login.success
          ? await redeemSetupCode(tx, { login: who, code, password: pw })
          : null;
        if (id)
          await insertAuditEvent(tx, {
            actorType: 'user',
            actorUserId: id,
            module: 'platform',
            action: 'portal.setup_completed',
            entityType: 'user',
            entityId: id,
            requestId,
          });
        return id;
      }),
  );
  if (userId === 'locked') return back('locked');
  if (!userId) return back('invalid');
  return seeOther(withQuery(PORTAL_LOGIN, { done: '1' }));
});

/** POST /api/v1/portal/logout (form): ends the portal session only. */
export const portalLogout = formHandler(PORTAL_LOGIN, async (request, requestId, db) => {
  const token = parseCookieHeader(request.headers.get('cookie')).get(PORTAL_COOKIE);
  if (token) await revokeSessionByToken(db, token, getSessionSecret());
  log.info('portal sign-out', { requestId });
  return seeOther(PORTAL_LOGIN, {
    'set-cookie': serializeCookie(PORTAL_COOKIE, '', sessionCookieOptions(0)),
  });
});

/**
 * GET /api/v1/portal/receipts/{feeRecordId}: the receipt PDF of a payment of one of the login's
 * students; anything else is 404 (never "exists but not yours").
 */
export async function portalReceipt(request: Request, feeRecordId: string): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  try {
    const db = getDb();
    const missing = new NotFoundError('Receipt not found.');
    if (!(await portalOpen(db))) return errorResponse(missing, requestId);
    const found = await portalUser(
      db,
      parseCookieHeader(request.headers.get('cookie')).get(PORTAL_COOKIE),
    );
    if (!found) return errorResponse(new UnauthenticatedError(), requestId);
    const owner = z.uuid().safeParse(feeRecordId).success
      ? await feeRecordStudentId(db, feeRecordId)
      : null;
    const receipt =
      owner && found.children.some((c) => c.id === owner)
        ? await receiptFor(db, feeRecordId)
        : null;
    if (!receipt) return errorResponse(missing, requestId);
    return new Response(Buffer.from(await renderReceiptPdf(db, feeRecordId, 'a4', false)), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="receipt-${receipt.receiptNumber.replace(/[^\w.-]/g, '-')}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    log.error('portal receipt failed', { requestId, error });
    return errorResponse(error, requestId);
  }
}
