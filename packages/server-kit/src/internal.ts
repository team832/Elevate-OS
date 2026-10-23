import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { createLogger, loadEnvKeys, type Logger } from '@elevate/configuration';
import { getDb, type Database } from '@elevate/database';
import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
  errorResponse,
  successResponse,
  type SourceResult,
} from '@elevate/shared-contracts';
import { isModuleKey, type ModuleKey } from '@elevate/shared-types';
import type { NextRouteContext, RouteHandler } from './define-route';
import { toAppError, zodIssues } from './errors';

/**
 * Server-to-server calls between zones use `/<zone>/api/internal/v1/...`
 * routes protected by a bearer token and a caller header naming the calling module:
 *   Authorization: Bearer <token>
 *   X-Elevate-Caller: ops
 * With one shared INTERNAL_SERVICE_TOKEN the caller header is self-declared. With
 * INTERNAL_SERVICE_TOKENS (`ops:<token>,academic:<token>,…`) each module has its own token,
 * the caller is the module whose token matched, and a header naming another module is refused.
 * Internal routes are never called from browsers.
 */
export const CALLER_HEADER = 'x-elevate-caller';
/** Write routes: the signed-in user the calling server acts for (recorded in the audit trail). */
export const ACTING_USER_HEADER = 'x-elevate-acting-user';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ModuleTokens = Partial<Record<ModuleKey, string>>;

export function getInternalServiceToken(): string {
  return loadEnvKeys(['INTERNAL_SERVICE_TOKEN'], process.env, 'internal-service')
    .INTERNAL_SERVICE_TOKEN;
}

/** Per-module tokens from INTERNAL_SERVICE_TOKENS, or undefined when the single token is in use. */
export function getInternalServiceTokens(
  raw = process.env.INTERNAL_SERVICE_TOKENS,
): ModuleTokens | undefined {
  if (!raw) return undefined;
  const tokens: ModuleTokens = {};
  for (const entry of raw.split(',')) {
    const at = entry.indexOf(':');
    const module = entry.slice(0, at).trim();
    const token = entry.slice(at + 1).trim();
    if (!isModuleKey(module) || token.length < 32)
      throw new Error(
        'INTERNAL_SERVICE_TOKENS must be <module>:<token> pairs (ops, academic, marketing, platform; tokens of 32+ characters).',
      );
    tokens[module] = token;
  }
  return tokens;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Returns the calling module or throws UNAUTHENTICATED / FORBIDDEN. */
export function verifyInternalRequest(
  request: Request,
  expectedToken: string = getInternalServiceToken(),
  tokens: ModuleTokens | undefined = getInternalServiceTokens(),
): ModuleKey {
  const header = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer (.+)$/.exec(header)?.[1] ?? '';
  const owner = tokens
    ? (Object.entries(tokens) as [ModuleKey, string][]).find(([, t]) =>
        constantTimeEquals(bearer, t),
      )?.[0]
    : undefined;
  if (tokens ? !owner : !constantTimeEquals(bearer, expectedToken)) {
    throw new UnauthenticatedError('Internal routes need a valid service token.');
  }
  const caller = request.headers.get(CALLER_HEADER);
  if (!isModuleKey(caller)) throw new ForbiddenError(`Missing or unknown ${CALLER_HEADER} header.`);
  if (owner && caller !== owner)
    throw new ForbiddenError(`The service token belongs to "${owner}", not "${caller}".`);
  return caller;
}

type Schema = z.ZodType | undefined;
type Out<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;

export interface InternalRouteSpec<
  Q extends Schema,
  P extends Schema,
  B extends Schema = undefined,
> {
  /** Modules allowed to call this route (default: any module). */
  callers?: readonly ModuleKey[];
  query?: Q;
  params?: P;
  /** JSON body: write routes only (use defineInternalWriteRoute). */
  body?: B;
}

export interface InternalRouteContext<
  Q extends Schema,
  P extends Schema,
  B extends Schema = undefined,
> {
  request: Request;
  requestId: string;
  caller: ModuleKey;
  query: Out<Q>;
  params: Out<P>;
  body: Out<B>;
  /** Write routes: the user the caller acts for (from ACTING_USER_HEADER); null on reads. */
  actingUserId: string | null;
  db: Database;
  log: Logger;
}

const log = createLogger({ component: 'internal-route' });

/**
 * Wrap a read-only internal route handler (GET), e.g. the summary endpoint:
 *
 *   export const GET = defineInternalRoute({ callers: ['ops', 'platform'] }, async ({ db }) =>
 *     buildAcademicDeliverySummary(db));
 */
export function defineInternalRoute<
  Q extends Schema = undefined,
  P extends Schema = undefined,
  B extends Schema = undefined,
>(
  spec: InternalRouteSpec<Q, P, B>,
  handler: (ctx: InternalRouteContext<Q, P, B>) => Promise<unknown>,
  options: { getDb?: () => Database; getToken?: () => string } = {},
): RouteHandler {
  return async (request: Request, context: NextRouteContext) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const started = Date.now();
    let response: Response;
    let caller: ModuleKey | undefined;
    try {
      caller = verifyInternalRequest(request, (options.getToken ?? getInternalServiceToken)());
      if (spec.callers && !spec.callers.includes(caller)) {
        throw new ForbiddenError(`Module "${caller}" may not call this internal route.`);
      }
      const url = new URL(request.url);
      let query: unknown;
      if (spec.query) {
        const parsed = spec.query.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success)
          throw new ValidationError('The query string is not valid.', {
            details: zodIssues(parsed.error, 'query'),
          });
        query = parsed.data;
      }
      let params: unknown;
      if (spec.params) {
        const parsed = spec.params.safeParse((await context?.params) ?? {});
        if (!parsed.success)
          throw new ValidationError('The URL is not valid.', {
            details: zodIssues(parsed.error, 'params'),
          });
        params = parsed.data;
      }
      let body: unknown;
      let actingUserId: string | null = null;
      if (spec.body) {
        actingUserId = request.headers.get(ACTING_USER_HEADER);
        if (!actingUserId || !UUID_RE.test(actingUserId))
          throw new ValidationError(
            `Write routes need the ${ACTING_USER_HEADER} header (a user id).`,
          );
        const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim();
        if (mediaType.toLowerCase() !== 'application/json')
          throw new ValidationError(
            'Send the request body as JSON (Content-Type: application/json).',
          );
        const raw: unknown = await request.json().catch(() => {
          throw new ValidationError('The request body is not valid JSON.');
        });
        const parsed = spec.body.safeParse(raw);
        if (!parsed.success)
          throw new ValidationError('The request body is not valid.', {
            details: zodIssues(parsed.error, 'body'),
          });
        body = parsed.data;
      }
      const data = await handler({
        request,
        requestId,
        caller,
        query: query as Out<Q>,
        params: params as Out<P>,
        body: body as Out<B>,
        actingUserId,
        db: (options.getDb ?? getDb)(),
        log: log.child({ requestId, caller }),
      });
      response = successResponse(data ?? null, { headers: { 'x-request-id': requestId } });
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) log.error('internal request failed', { requestId, error });
      response = errorResponse(appError, requestId);
    }
    log.info('internal request', {
      requestId,
      caller,
      path: new URL(request.url).pathname,
      status: response.status,
      ms: Date.now() - started,
    });
    return response;
  };
}

/**
 * Wrap an internal WRITE route (export it as POST or PATCH). Same token auth as reads, plus: the
 * calling modules must be listed, the JSON body is validated, and the caller names the user it
 * acts for in ACTING_USER_HEADER (the handler audits under that user). The calling server must
 * have checked that user's own permission first; this route trusts the authenticated module.
 *
 *   export const POST = defineInternalWriteRoute(
 *     { callers: ['ops'], params: idParams, body: recordScoresBody },
 *     async ({ db, params, body, actingUserId }) => recordScores(db, actingUserId, params.id, body));
 */
export function defineInternalWriteRoute<
  B extends z.ZodType,
  Q extends Schema = undefined,
  P extends Schema = undefined,
>(
  spec: InternalRouteSpec<Q, P, B> & { callers: readonly [ModuleKey, ...ModuleKey[]]; body: B },
  handler: (ctx: InternalRouteContext<Q, P, B> & { actingUserId: string }) => Promise<unknown>,
  options: { getDb?: () => Database; getToken?: () => string } = {},
): RouteHandler {
  return defineInternalRoute(
    spec,
    handler as (ctx: InternalRouteContext<Q, P, B>) => Promise<unknown>,
    options,
  );
}

const internalHeaders = (caller: ModuleKey, token?: string) => ({
  authorization: `Bearer ${token ?? getInternalServiceTokens()?.[caller] ?? getInternalServiceToken()}`,
  [CALLER_HEADER]: caller,
  accept: 'application/json',
});

/**
 * Fetch another zone's internal endpoint and validate it against a contract.
 * NEVER throws and never substitutes zeros: any failure (network, timeout,
 * non-2xx, schema mismatch) returns `{ status: 'unavailable', reason }`, which
 * the UI must show as "source unavailable" (D-011.2).
 */
export async function fetchInternal<S extends z.ZodType>(
  url: string,
  schema: S,
  options: { caller: ModuleKey; timeoutMs?: number; token?: string; fetchImpl?: typeof fetch },
): Promise<SourceResult<z.output<S>>> {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: internalHeaders(options.caller, options.token),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      cache: 'no-store',
    });
    if (!response.ok)
      return { status: 'unavailable', reason: `HTTP ${response.status}`, fetchedAt };
    const json = (await response.json()) as { data?: unknown };
    const parsed = schema.safeParse(json.data);
    if (!parsed.success)
      return { status: 'unavailable', reason: 'Response did not match the contract', fetchedAt };
    return { status: 'available', data: parsed.data, fetchedAt };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Timed out'
        : 'Could not reach the source';
    return { status: 'unavailable', reason, fetchedAt };
  }
}

export type InternalWriteResult<T> =
  | { ok: true; data: T }
  /** `status` 0 = the source was never reached (network failure or timeout). */
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

/**
 * Call another zone's internal WRITE route (POST/PATCH). Never throws: a refusal comes back with
 * the server's error code, message and details for the caller to show; a 2xx reply that does not
 * match `schema` is an error, never a success.
 */
export async function sendInternal<S extends z.ZodType>(
  url: string,
  schema: S,
  options: {
    caller: ModuleKey;
    actingUserId: string;
    body: unknown;
    method?: 'POST' | 'PATCH';
    timeoutMs?: number;
    token?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<InternalWriteResult<z.output<S>>> {
  const fail = (status: number, code: string, message: string) => ({
    ok: false as const,
    status,
    error: { code, message },
  });
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: options.method ?? 'POST',
      headers: {
        ...internalHeaders(options.caller, options.token),
        'content-type': 'application/json',
        [ACTING_USER_HEADER]: options.actingUserId,
      },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
      cache: 'no-store',
    });
  } catch (error) {
    // A timed-out write may still have committed: callers re-read before offering a retry.
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return fail(0, 'UNAVAILABLE', timedOut ? 'Timed out' : 'Could not reach the source');
  }
  const json = (await response.json().catch(() => null)) as {
    data?: unknown;
    error?: { code: string; message: string; details?: unknown };
  } | null;
  if (!response.ok)
    return json?.error
      ? { ok: false, status: response.status, error: json.error }
      : fail(response.status, 'UNAVAILABLE', `HTTP ${response.status}`);
  const parsed = schema.safeParse(json?.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : fail(response.status, 'CONTRACT_MISMATCH', 'Response did not match the contract');
}
