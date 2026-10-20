/**
 * Who may have an Elevate OS account (owner decision D-030, 20 Oct 2026): only
 * people with an @elevateeducation.in email. Deliberately a constant, not
 * configuration, so no deployment can widen it. The fictional @example.test
 * accounts used by seeds and tests (D-016) are accepted only outside production.
 *
 * Enforced at every way in: password sign-in, Google sign-in, session
 * validation on each request, and user creation (including seeds).
 */
import { ForbiddenError } from '@elevate/shared-contracts';

export const ORGANISATION_EMAIL_DOMAIN = 'elevateeducation.in';
const NON_PRODUCTION_DOMAINS = ['example.test'] as const;

export function allowedEmailDomains(nodeEnv = process.env.NODE_ENV): readonly string[] {
  return nodeEnv === 'production'
    ? [ORGANISATION_EMAIL_DOMAIN]
    : [ORGANISATION_EMAIL_DOMAIN, ...NON_PRODUCTION_DOMAINS];
}

/** Exact domain match: `name@elevateeducation.in` yes; subdomains and look-alikes no. */
export function isAllowedEmail(email: string, nodeEnv = process.env.NODE_ENV): boolean {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && parts[0] !== '' && allowedEmailDomains(nodeEnv).includes(parts[1]!);
}

export function assertAllowedEmail(email: string, nodeEnv = process.env.NODE_ENV): void {
  if (!isAllowedEmail(email, nodeEnv)) {
    throw new ForbiddenError(
      `Only Elevate Education accounts (@${ORGANISATION_EMAIL_DOMAIN}) can use Elevate OS.`,
    );
  }
}
