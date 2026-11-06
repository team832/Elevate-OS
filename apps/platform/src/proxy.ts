import { NextResponse, type NextRequest } from 'next/server';
import { withContentSecurityPolicy } from '@elevate/configuration/security-headers';
import { isAllowedActionOrigin } from '@elevate/configuration/workspaces';

/**
 * Platform proxy (Next.js 16's renamed middleware).
 *
 * - Gives every request an `x-request-id`.
 * - Sets the Content-Security-Policy with a fresh nonce (static security headers are in next.config.ts).
 * - Sends visitors WITHOUT a session cookie to /login for platform pages, except the
 *   public front page `/` and `/login` itself.
 *   This is only a fast UX redirect: the cookie is not validated here.
 *   Every page and route still checks the session and permissions on the
 *   server (getCurrentUser / requirePageAccess / defineRoute).
 * - Module zones (/marketing, /academic, /ops) are excluded by the matcher;
 *   the module apps enforce their own access.
 */
const SESSION_COOKIE = 'elevate_session';
// The portal has its own sign-in and cookie (F4-13); its pages check the portal session themselves.
const PUBLIC_PATHS = ['/login', '/portal'];

export function proxy(request: NextRequest) {
  if (request.method === 'POST' && !isAllowedActionOrigin(request))
    return new NextResponse('This request came from another site, so it was refused.', { status: 403 });
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const { pathname, search } = request.nextUrl;

  const isPublic =
    pathname === '/' || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('x-request-id', requestId);
    return redirect;
  }

  const { headers, csp } = withContentSecurityPolicy(request.headers);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, static files (favicon, icon) and the module zones.
    '/((?!api/|_next/|favicon\\.ico|icon\\.svg|robots\\.txt|marketing(?:/|$)|academic(?:/|$)|ops(?:/|$)).*)',
    // A form posted to a skipped path is a server action to Next: without this, a 500 or 409 and a logged stack.
    {
      source: '/((?:_next/|favicon\\.ico|icon\\.svg|robots\\.txt).*)',
      has: [{ type: 'header', key: 'content-type', value: 'multipart/form-data.*' }],
    },
  ],
};
