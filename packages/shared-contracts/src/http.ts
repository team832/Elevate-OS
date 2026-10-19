import type { ApiFailure, ApiMeta, ApiSuccess } from './api';
import { AppError, InternalError } from './errors';

/**
 * Build D-012 envelope responses with the Web `Response` API (works in
 * Next.js route handlers and tests alike).
 */
export function successResponse<T>(
  data: T,
  init: { status?: number; headers?: HeadersInit; meta?: ApiMeta } = {},
): Response {
  const body: ApiSuccess<T> = init.meta ? { data, meta: init.meta } : { data };
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/** Turn any thrown value into an error envelope. Non-AppErrors become a generic INTERNAL. */
export function errorResponse(
  error: unknown,
  requestId: string,
  init: { headers?: HeadersInit } = {},
): Response {
  const appError = error instanceof AppError ? error : new InternalError();
  const body: ApiFailure = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      requestId,
    },
  };
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-request-id', requestId);
  return new Response(JSON.stringify(body), { status: appError.status, headers });
}

/** A 303 redirect with a RELATIVE Location, so it stays on whatever host the browser used (works through the platform rewrite). */
export function seeOther(location: string, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('location', location);
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 303, headers: h });
}

/** Accept only same-site relative paths for post-login redirects (blocks open redirects). */
export function safeRelativePath(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string') return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\'))
    return fallback;
  if (/[\r\n]/.test(candidate)) return fallback;
  return candidate;
}
