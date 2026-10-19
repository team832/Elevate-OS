import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './errors';

/**
 * API envelope (D-012).
 *   success: { "data": T, "meta"?: {...} }
 *   failure: { "error": { "code", "message", "details"?, "requestId" } }
 */
export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  /** Cursor pagination: pass `nextCursor` back as `?cursor=` to get the next page; null = last page. */
  page?: { limit: number; nextCursor: string | null };
  [key: string]: unknown;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface ApiFailure {
  error: ApiErrorBody;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export const errorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

export const apiFailureSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

/** Build a schema for a success envelope around `data`. */
export function apiSuccessSchema<S extends z.ZodType>(data: S) {
  return z.object({ data, meta: z.record(z.string(), z.unknown()).optional() });
}

/** Header names used across zones. */
export const HEADERS = {
  requestId: 'x-request-id',
  idempotencyKey: 'idempotency-key',
  authorization: 'authorization',
} as const;

/** Field-level validation issue in `error.details` for VALIDATION_FAILED. */
export interface ValidationIssue {
  /** Where the problem is: `body`, `query` or `params`, then the field path. */
  location: 'body' | 'query' | 'params' | 'headers';
  path: (string | number)[];
  message: string;
}

/** Common pagination query: `?limit=&cursor=`. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
