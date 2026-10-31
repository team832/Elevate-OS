/**
 * Error codes and the AppError hierarchy (D-012). Every API failure is
 * `{ "error": { code, message, details?, requestId } }` with the HTTP status
 * fixed by the code. `RATE_LIMITED` (429) extends D-012 for login throttling
 * (recorded as D-020).
 */
import { settingFieldName } from '@elevate/shared-types';
import type { z } from 'zod';

export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/** Base class. `message` is shown to the caller, so never put secrets or internals in it. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is not valid.', options?: AppErrorOptions) {
    super('VALIDATION_FAILED', message, options);
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You need to sign in.', options?: AppErrorOptions) {
    super('UNAUTHENTICATED', message, options);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this.', options?: AppErrorOptions) {
    super('FORBIDDEN', message, options);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.', options?: AppErrorOptions) {
    super('NOT_FOUND', message, options);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'This conflicts with existing data.', options?: AppErrorOptions) {
    super('CONFLICT', message, options);
    this.name = 'ConflictError';
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(
    message = 'That change is not allowed from the current state.',
    options?: AppErrorOptions,
  ) {
    super('INVALID_STATE_TRANSITION', message, options);
    this.name = 'InvalidStateTransitionError';
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many attempts. Try again later.', options?: AppErrorOptions) {
    super('RATE_LIMITED', message, options);
    this.name = 'RateLimitedError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our side.', options?: AppErrorOptions) {
    super('INTERNAL', message, options);
    this.name = 'InternalError';
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A setting's validation issue in plain words, naming the field: the refusal behind a form with no JSON on show. */
export function plainSettingIssue(i: z.core.$ZodIssue): string {
  if (i.code === 'custom') return i.message;
  const key = i.path.findLast((p) => typeof p === 'string');
  if (typeof key !== 'string') return 'This value is not in the accepted form.';
  const row = i.path.findLast((p) => typeof p === 'number');
  const name = `${settingFieldName(key)}${typeof row === 'number' ? ` in row ${row + 1}` : ''}`;
  const amount = (n: number) =>
    key.endsWith('Paise')
      ? `₹${(n / 100).toLocaleString('en-IN')}`
      : key.endsWith('Inr')
        ? `₹${n.toLocaleString('en-IN')}`
        : String(n);
  switch (i.code) {
    case 'invalid_type':
      return `${name} needs a value.`;
    case 'invalid_value':
      return `Choose one of the options for ${name}.`;
    case 'too_small':
      return i.origin === 'string'
        ? `${name} needs at least ${count(Number(i.minimum), 'character', 'characters')}.`
        : i.origin === 'array'
          ? `${name} needs at least ${count(Number(i.minimum), 'entry', 'entries')}.`
          : `${name} must be at least ${amount(Number(i.minimum))}.`;
    case 'too_big':
      return i.origin === 'string'
        ? `${name} can have at most ${count(Number(i.maximum), 'character', 'characters')}.`
        : i.origin === 'array'
          ? `${name} can have at most ${count(Number(i.maximum), 'entry', 'entries')}.`
          : `${name} can be at most ${amount(Number(i.maximum))}.`;
    default:
      return `${name} is not in the accepted form.`;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
