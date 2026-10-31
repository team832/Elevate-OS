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
    message: plainMessage(issue),
  }));
}

/** zod's default words are for programmers; a message a schema wrote itself passes through. */
function plainMessage(issue: ZodError['issues'][number]): string {
  const m = issue.message;
  switch (issue.code) {
    case 'invalid_type':
      if (!m.startsWith('Invalid input')) return m;
      if (/received (undefined|null)/.test(m)) return 'This is required.';
      return issue.expected === 'number'
        ? 'Enter a number.'
        : 'This is not the right kind of value.';
    case 'too_small':
      if (!m.startsWith('Too small')) return m;
      if (issue.origin === 'string')
        return issue.minimum === 1
          ? 'This is required.'
          : `Enter at least ${issue.minimum} characters.`;
      if (issue.origin === 'array') return `Choose at least ${issue.minimum}.`;
      return `This must be ${issue.minimum} or more.`;
    case 'too_big':
      if (!m.startsWith('Too big')) return m;
      if (issue.origin === 'string') return `Enter at most ${issue.maximum} characters.`;
      if (issue.origin === 'array') return `Choose at most ${issue.maximum}.`;
      return `This must be ${issue.maximum} or less.`;
    case 'invalid_format':
      if (!m.startsWith('Invalid')) return m;
      if (issue.format === 'uuid') return 'Choose from the list.';
      return issue.format === 'email'
        ? 'Enter a valid email address.'
        : 'This is not in the right format.';
    case 'invalid_value':
      return m.startsWith('Invalid') ? 'Choose one of the options.' : m;
    default:
      return m;
  }
}

/** Too long, out of range, bad date, NUL or bad encoding, bad uuid. Other 22xxx (dividing by zero) are ours. */
const SENDER_VALUE_CODES = new Set(['22001', '22003', '22007', '22008', '22021', '22P02']);

/**
 * Normalise anything thrown inside a route into an AppError:
 * - AppError → itself
 * - ZodError (validation inside a service) → VALIDATION_FAILED
 * - PostgreSQL unique violation → CONFLICT; FK / check violation or a refused value → VALIDATION_FAILED
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
  if (pg && SENDER_VALUE_CODES.has(pg.code)) {
    return new ValidationError('One of the values sent is not valid. Check it and try again.', {
      cause: error,
    });
  }
  return new InternalError(undefined, { cause: error });
}
