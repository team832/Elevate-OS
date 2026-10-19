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
 * routes protected by a shared bearer token (INTERNAL_SERVICE_TOKEN) and a
 * caller header naming the calling module:
 *   Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
 *   X-Elevate-Caller: ops
 * Internal routes are never called from browsers.
 */
export const CALLER_HEADER = 'x-elevate-caller';

export function getInternalServiceToken(): string {
  return loadEnvKeys(['INTERNAL_SERVICE_TOKEN'], process.env, 'internal-service')
    .INTERNAL_SERVICE_TOKEN;
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
): ModuleKey {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !constantTimeEquals(match[1] ?? '', expectedToken)) {
    throw new UnauthenticatedError('Internal routes need a valid service token.');
  }
  const caller = request.headers.get(CALLER_HEADER);
  if (!isModuleKey(caller)) throw new ForbiddenError(`Missing or unknown ${CALLER_HEADER} header.`);
  return caller;
}

type Schema = z.ZodType | undefined;
type Out<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;

export interface InternalRouteSpec<Q extends Schema, P extends Schema> {
  /** Modules allowed to call this route (default: any module). */
  callers?: readonly ModuleKey[];
  query?: Q;
  params?: P;
}

export interface InternalRouteContext<Q extends Schema, P extends Schema> {
  request: Request;
  requestId: string;
  caller: ModuleKey;
  query: Out<Q>;
  params: Out<P>;
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
export function defineInternalRoute<Q extends Schema = undefined, P extends Schema = undefined>(
  spec: InternalRouteSpec<Q, P>,
  handler: (ctx: InternalRouteContext<Q, P>) => Promise<unknown>,
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
      const data = await handler({
        request,
        requestId,
        caller,
        query: query as Out<Q>,
        params: params as Out<P>,
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
      headers: {
        authorization: `Bearer ${options.token ?? getInternalServiceToken()}`,
        [CALLER_HEADER]: options.caller,
        accept: 'application/json',
      },
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
