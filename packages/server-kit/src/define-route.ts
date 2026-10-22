import type { z } from 'zod';
import { getUserFromRequest, type AuthenticatedUser } from '@elevate/authentication';
import {
  WORKSPACE_KEYS,
  can,
  requirePermission,
  type GrantScope,
  type Permission,
} from '@elevate/authorization';
import { createLogger, isAllowedRequestOrigin, type Logger } from '@elevate/configuration';
import { getDb, type Database } from '@elevate/database';
import {
  ForbiddenError,
  HEADERS,
  UnauthenticatedError,
  ValidationError,
  errorResponse,
  successResponse,
  type ApiMeta,
} from '@elevate/shared-contracts';
import { MODULES, type ModuleKey } from '@elevate/shared-types';
import { toAppError, zodIssues } from './errors';
import { hashRequestBody, validateIdempotencyKey, withIdempotency } from './idempotency';

/**
 * Who may call a route:
 * - a permission string            → signed in AND holding that permission
 * - `{ anyOf: [...] }`             → signed in AND holding at least one
 * - `'authenticated'`              → any signed-in user
 * - `'public'`                     → anyone (use sparingly: health, login)
 */
export type RouteAccess =
  Permission | { anyOf: readonly [Permission, ...Permission[]] } | 'authenticated' | 'public';

type Schema = z.ZodType | undefined;
type Out<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteSpec<
  A extends RouteAccess,
  B extends Schema,
  Q extends Schema,
  P extends Schema,
> {
  permission: A;
  /** JSON body schema. Requests must send `Content-Type: application/json`. */
  body?: B;
  /** Query-string schema (values are strings; use z.coerce for numbers; repeated keys become arrays). */
  query?: Q;
  /** Dynamic route segment schema, e.g. z.object({ id: z.uuid() }). */
  params?: P;
  /**
   * Honour an `Idempotency-Key` header: the handler runs inside one
   * transaction with the key and retries replay the stored response.
   * `required` rejects requests without the header.
   */
  idempotency?: 'optional' | 'required';
  /** Module label for logs; defaults to the permission's module prefix. */
  module?: ModuleKey;
}

export interface RouteContext<
  A extends RouteAccess,
  B extends Schema,
  Q extends Schema,
  P extends Schema,
> {
  request: Request;
  requestId: string;
  /** The signed-in user (null only for `'public'` routes with no session). */
  user: A extends 'public' ? AuthenticatedUser | null : AuthenticatedUser;
  /** Scope of the route permission (`all` / `own`); null for public/authenticated routes. */
  scope: GrantScope | null;
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
  /** The database — a transaction when `idempotency` is set. */
  db: Database;
  log: Logger;
}

const RESULT = Symbol('elevate.routeResult');
export interface RouteResult<T> {
  readonly [RESULT]: true;
  readonly data: T;
  readonly status: number;
  readonly meta?: ApiMeta;
  readonly headers?: HeadersInit;
}

/** Return `{ data }` with a custom status, headers or meta. */
export function respond<T>(
  data: T,
  init: { status?: number; meta?: ApiMeta; headers?: HeadersInit } = {},
): RouteResult<T> {
  return {
    [RESULT]: true,
    data,
    status: init.status ?? 200,
    meta: init.meta,
    headers: init.headers,
  };
}
/** 201 Created. */
export function created<T>(
  data: T,
  init: { meta?: ApiMeta; headers?: HeadersInit } = {},
): RouteResult<T> {
  return respond(data, { ...init, status: 201 });
}

function isRouteResult(value: unknown): value is RouteResult<unknown> {
  return typeof value === 'object' && value !== null && RESULT in value;
}

/** Next.js passes `{ params: Promise<…> }` as the second argument. */
export interface NextRouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

export type RouteHandler = (request: Request, context: NextRouteContext) => Promise<Response>;

/** Inject the database (tests). Defaults to `getDb()`. */
export interface DefineRouteOptions {
  getDb?: () => Database;
}

const baseLog = createLogger({ component: 'route' });

function requestIdFrom(request: Request): string {
  const incoming = request.headers.get(HEADERS.requestId);
  return incoming && /^[\w.:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
}

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return out;
}

function moduleOf(access: RouteAccess, fallback?: ModuleKey): ModuleKey | undefined {
  if (fallback) return fallback;
  const first = typeof access === 'string' ? access : access.anyOf[0];
  const prefix = first.split(':')[0];
  return prefix === 'platform' ||
    prefix === 'marketing' ||
    prefix === 'academic' ||
    prefix === 'ops'
    ? prefix
    : undefined;
}

/**
 * Wrap a Next.js App Router route handler with the Elevate conventions:
 * request id → session → permission (server-side) → params/query/body
 * validation → handler → D-012 envelope, with one structured log line per
 * request.
 *
 *   export const POST = defineRoute(
 *     { permission: 'ops:leads:write', body: createLeadBody },
 *     async ({ body, user, db, requestId }) => created(await createLead(db, user, body, requestId)),
 *   );
 *
 * Return a value (→ 200 `{ data }`), `created(v)` (→ 201), `respond(v, {...})`,
 * or a `Response` (passed through untouched). Throw an AppError for failures.
 */
export function defineRoute<
  A extends RouteAccess,
  B extends Schema = undefined,
  Q extends Schema = undefined,
  P extends Schema = undefined,
>(
  spec: RouteSpec<A, B, Q, P>,
  handler: (ctx: RouteContext<A, B, Q, P>) => Promise<unknown>,
  options: DefineRouteOptions = {},
): RouteHandler {
  return async (request, context) => {
    const started = Date.now();
    const requestId = requestIdFrom(request);
    const url = new URL(request.url);
    const log = baseLog.child({
      requestId,
      method: request.method,
      path: url.pathname,
      module: moduleOf(spec.permission, spec.module),
    });
    let userId: string | undefined;
    let response: Response;
    try {
      // 0. CSRF: every localhost port shares the session cookie, so a state change must come
      // from this origin or a configured app origin (D-072).
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAllowedRequestOrigin(request))
        throw new ForbiddenError('This request came from another site and was refused.');
      const db = (options.getDb ?? getDb)();

      // 1. Who is calling?
      let user: AuthenticatedUser | null = null;
      let scope: GrantScope | null = null;
      if (spec.permission !== 'public') {
        user = await getUserFromRequest(request, db);
        if (!user) throw new UnauthenticatedError();
        userId = user.id;
        // A route served under a workspace's base path needs membership of that workspace
        // (D-072), as its pages do: holding a permission never opens another workspace's API.
        const workspace = WORKSPACE_KEYS.find((k) =>
          `${url.pathname}/`.startsWith(`${MODULES[k].basePath}/`),
        );
        if (workspace && !can(user, `${workspace}:module:access` as Permission))
          throw new ForbiddenError('Your roles do not include this workspace.');
        if (spec.permission !== 'authenticated') {
          if (typeof spec.permission === 'string') {
            scope = requirePermission(user, spec.permission);
          } else {
            for (const p of spec.permission.anyOf) {
              try {
                const s = requirePermission(user, p);
                if (scope === null || s === 'all') scope = s;
              } catch {
                // try the next permission
              }
            }
            if (scope === null) {
              throw new ForbiddenError('You do not have permission to do this.', {
                details: { anyOf: spec.permission.anyOf },
              });
            }
          }
        }
      } else {
        user = await getUserFromRequest(request, db).catch(() => null);
        userId = user?.id;
      }

      // 2. Validate input.
      let params: unknown = undefined;
      if (spec.params) {
        const raw = (await context?.params) ?? {};
        const parsed = spec.params.safeParse(raw);
        if (!parsed.success)
          throw new ValidationError('The URL is not valid.', {
            details: zodIssues(parsed.error, 'params'),
          });
        params = parsed.data;
      }
      let query: unknown = undefined;
      if (spec.query) {
        const parsed = spec.query.safeParse(queryObject(url));
        if (!parsed.success)
          throw new ValidationError('The query string is not valid.', {
            details: zodIssues(parsed.error, 'query'),
          });
        query = parsed.data;
      }
      let body: unknown = undefined;
      let rawBody: unknown = undefined;
      if (spec.body) {
        // The exact media type: `text/plain;application/json` is a "simple" cross-site request.
        const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim();
        if (mediaType.toLowerCase() !== 'application/json') {
          throw new ValidationError(
            'Send the request body as JSON (Content-Type: application/json).',
          );
        }
        try {
          rawBody = await request.json();
        } catch {
          throw new ValidationError('The request body is not valid JSON.');
        }
        const parsed = spec.body.safeParse(rawBody);
        if (!parsed.success)
          throw new ValidationError('The request body is not valid.', {
            details: zodIssues(parsed.error, 'body'),
          });
        body = parsed.data;
      }

      // 3. Run the handler (inside an idempotency transaction when asked).
      const run = async (runDb: Database) => {
        const ctx = {
          request,
          requestId,
          user,
          scope,
          body,
          query,
          params,
          db: runDb,
          log,
        } as RouteContext<A, B, Q, P>;
        return handler(ctx);
      };
      const toResponse = (result: unknown): Response => {
        if (result instanceof Response) return result;
        if (isRouteResult(result)) {
          const headers = new Headers(result.headers);
          headers.set('x-request-id', requestId);
          return successResponse(result.data, {
            status: result.status,
            meta: result.meta,
            headers,
          });
        }
        return successResponse(result ?? null, { headers: { 'x-request-id': requestId } });
      };

      const idempotencyHeader = request.headers.get(HEADERS.idempotencyKey);
      if (spec.idempotency && (idempotencyHeader || spec.idempotency === 'required')) {
        if (!idempotencyHeader)
          throw new ValidationError('This request needs an Idempotency-Key header.');
        const key = validateIdempotencyKey(idempotencyHeader);
        const stored = await db.transaction(async (tx) =>
          withIdempotency(
            tx as unknown as Database,
            {
              scope: `${request.method} ${url.pathname}`,
              key,
              userId: user?.id ?? null,
              requestHash: hashRequestBody(rawBody),
            },
            async () => {
              const result = await run(tx as unknown as Database);
              if (result instanceof Response) {
                throw new Error('Idempotent routes must return data, not a raw Response');
              }
              const status = isRouteResult(result) ? result.status : 200;
              const data = isRouteResult(result) ? result.data : (result ?? null);
              return { status, body: data };
            },
          ),
        );
        response = successResponse(stored.body, {
          status: stored.status,
          headers: { 'x-request-id': requestId, 'idempotency-replayed': String(stored.replayed) },
        });
      } else {
        response = toResponse(await run(db));
      }
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) log.error('request failed', { error, userId });
      response = errorResponse(appError, requestId);
    }
    log.info('request', { status: response.status, ms: Date.now() - started, userId });
    return response;
  };
}
