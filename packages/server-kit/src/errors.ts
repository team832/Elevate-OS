import { ZodError } from 'zod';
import { findPgError } from '@elevate/database';
import {
  AppError,
  ConflictError,
  InternalError,
  ValidationError,
  type ValidationIssue,
} from '@elevate/shared-contracts';

export {
  AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  InvalidStateTransitionError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  isAppError,
  type ErrorCode,
} from '@elevate/shared-contracts';

export function zodIssues(
  error: ZodError,
  location: ValidationIssue['location'],
): ValidationIssue[] {
  return error.issues.map((issue) => ({
    location,
    path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    message: issue.message,
  }));
}

/**
 * Normalise anything thrown inside a route into an AppError:
 * - AppError → itself
 * - ZodError (validation inside a service) → VALIDATION_FAILED
 * - PostgreSQL unique violation → CONFLICT; FK / check violation → VALIDATION_FAILED
 * - anything else → INTERNAL (details are logged, never returned)
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new ValidationError('The data is not valid.', {
      details: zodIssues(error, 'body'),
      cause: error,
    });
  }
  const pg = findPgError(error);
  if (pg?.code === '23505') {
    return new ConflictError('This record already exists.', {
      details: { constraint: pg.constraint },
      cause: error,
    });
  }
  if (pg?.code === '23503') {
    return new ValidationError('A referenced record does not exist or is still in use.', {
      details: { constraint: pg.constraint },
      cause: error,
    });
  }
  if (pg?.code === '23514' || pg?.code === '23502') {
    return new ValidationError('The data breaks a database rule.', {
      details: { constraint: pg.constraint },
      cause: error,
    });
  }
  return new InternalError(undefined, { cause: error });
}
