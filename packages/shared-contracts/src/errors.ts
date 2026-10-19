/**
 * Error codes and the AppError hierarchy (D-012). Every API failure is
 * `{ "error": { code, message, details?, requestId } }` with the HTTP status
 * fixed by the code. `RATE_LIMITED` (429) extends D-012 for login throttling
 * (recorded as D-020).
 */
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

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
