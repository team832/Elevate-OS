import { NextResponse, type NextRequest } from 'next/server';

/**
 * Platform proxy (Next.js 16's renamed middleware).
 *
 * - Gives every request an `x-request-id`.
 * - Sends visitors WITHOUT a session cookie to /login for platform pages.
 *   This is only a fast UX redirect: the cookie is not validated here.
 *   Every page and route still checks the session and permissions on the
 *   server (getCurrentUser / requirePageAccess / defineRoute).
 * - Module zones (/marketing, /academic, /ops) are excluded by the matcher;
 *   the module apps enforce their own access.
 */
const SESSION_COOKIE = 'elevate_session';
const PUBLIC_PATHS = ['/login'];

export function proxy(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const { pathname, search } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('x-request-id', requestId);
    return redirect;
  }

  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, static files and the module zones.
    '/((?!api/|_next/|favicon\\.ico|robots\\.txt|marketing(?:/|$)|academic(?:/|$)|ops(?:/|$)).*)',
  ],
};
