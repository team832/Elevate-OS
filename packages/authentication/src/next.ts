/**
 * Next.js server helpers — `import { getCurrentUser } from '@elevate/authentication/next'`.
 * Use only in server components, route handlers and server actions.
 * For redirects to the sign-in page use `requirePageAccess` / `requireUser` from
 * `@elevate/server-kit/next` (they handle basePath correctly).
 */
import { cookies } from 'next/headers';
import { getDb } from '@elevate/database';
import { SESSION_COOKIE } from './cookies';
import { getSessionSecret } from './login';
import { validateSession, type AuthenticatedUser } from './sessions';

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token, getSessionSecret());
}
