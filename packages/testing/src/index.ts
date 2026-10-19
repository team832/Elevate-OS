/**
 * Test helpers for packages and module apps.
 *
 *   import { setupTestDatabase, createTestUser, authedRequest, callRoute } from '@elevate/testing';
 *
 *   const ctx = setupTestDatabase();          // fresh PGlite per test file, installed as getDb()
 *   it('creates a lead', async () => {
 *     const counsellor = await createTestUser(ctx.db, { roles: ['admissions_counsellor'] });
 *     const res = await callRoute(POST, authedRequest(counsellor, '/ops/api/v1/leads', { method: 'POST', json: {...} }));
 *     expect(res.status).toBe(201);
 *   });
 */
import { afterAll, beforeAll } from 'vitest';
import {
  createSession,
  hashPassword,
  SESSION_COOKIE,
  type AuthenticatedUser,
} from '@elevate/authentication';
import { setDatabaseForTesting, userRoles, users, type Database } from '@elevate/database';
import { createTestDb, type TestDatabase } from '@elevate/database/testing';
import type { ApiErrorBody, ApiMeta } from '@elevate/shared-contracts';
import type { RoleKey, SessionId, UserId } from '@elevate/shared-types';

export { createTestDb, type TestDatabase } from '@elevate/database/testing';

/** The SESSION_SECRET used by tests (set in vitest.shared.ts). */
export function testSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set for tests — use vitest.shared.ts');
  return secret;
}

export interface TestDatabaseHandle {
  /** Available inside tests (after beforeAll). */
  readonly db: Database;
  readonly test: TestDatabase;
}

/**
 * Vitest hook: create one in-memory database for the test file, make
 * `getDb()` return it (so `defineRoute` handlers use it) and close it after.
 */
export function setupTestDatabase(): TestDatabaseHandle {
  let current: TestDatabase | undefined;
  beforeAll(async () => {
    current = await createTestDb();
    setDatabaseForTesting(current.db);
  });
  afterAll(async () => {
    setDatabaseForTesting(undefined);
    await current?.close();
  });
  return {
    get db() {
      if (!current) throw new Error('Test database not ready — use it inside a test or hook');
      return current.db;
    },
    get test() {
      if (!current) throw new Error('Test database not ready — use it inside a test or hook');
      return current;
    },
  };
}

export interface TestUser extends AuthenticatedUser {
  /** Raw session token (cookie value). */
  token: string;
  password: string;
}

let counter = 0;

/** Insert a fictional user with roles and an active session. */
export async function createTestUser(
  db: Database,
  options: {
    roles?: RoleKey[];
    email?: string;
    displayName?: string;
    password?: string;
    status?: 'active' | 'disabled';
  } = {},
): Promise<TestUser> {
  counter += 1;
  const suffix = `${Date.now().toString(36)}${counter}`;
  const password = options.password ?? 'fictional-test-password';
  const email = (options.email ?? `user-${suffix}@example.test`).toLowerCase();
  const [row] = await db
    .insert(users)
    .values({
      email,
      displayName: options.displayName ?? `Test User ${counter} (fictional)`,
      passwordHash: await hashPassword(password),
      status: options.status ?? 'active',
    })
    .returning({ id: users.id, email: users.email, displayName: users.displayName });
  if (!row) throw new Error('could not create test user');
  const roles = [...(options.roles ?? [])].sort();
  if (roles.length > 0)
    await db.insert(userRoles).values(roles.map((role) => ({ userId: row.id, role })));
  const session = await createSession(db, { userId: row.id, secret: testSessionSecret() });
  return {
    id: row.id as UserId,
    email: row.email,
    displayName: row.displayName,
    roles,
    sessionId: session.sessionId as SessionId,
    token: session.token,
    password,
  };
}

export interface RequestOptions {
  method?: string;
  /** JSON body; sets Content-Type. */
  json?: unknown;
  headers?: Record<string, string>;
  /** Base URL (default http://localhost:3000). */
  origin?: string;
}

/** Build a Request (no session). */
export function buildRequest(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  let body: string | undefined;
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  }
  return new Request(new URL(path, options.origin ?? 'http://localhost:3000'), {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });
}

/** Build a Request carrying the user's session cookie. */
export function authedRequest(
  user: { token: string },
  path: string,
  options: RequestOptions = {},
): Request {
  return buildRequest(path, {
    ...options,
    headers: { ...options.headers, cookie: `${SESSION_COOKIE}=${user.token}` },
  });
}

export type ParsedEnvelope<T> =
  | { status: number; ok: true; data: T; meta?: ApiMeta; error?: undefined; headers: Headers }
  | { status: number; ok: false; error: ApiErrorBody; data?: undefined; headers: Headers };

/** Call a route handler (`export const GET = defineRoute(...)`) and parse the envelope. */
export async function callRoute<T = unknown>(
  handler: (
    request: Request,
    context: { params: Promise<Record<string, string | string[] | undefined>> },
  ) => Promise<Response>,
  request: Request,
  params: Record<string, string | string[]> = {},
): Promise<ParsedEnvelope<T>> {
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as { data?: T; meta?: ApiMeta; error?: ApiErrorBody }) : {};
  if (json.error)
    return { status: response.status, ok: false, error: json.error, headers: response.headers };
  return {
    status: response.status,
    ok: true,
    data: json.data as T,
    meta: json.meta,
    headers: response.headers,
  };
}
