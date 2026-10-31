import { NextResponse, type NextRequest } from 'next/server';
import { withContentSecurityPolicy } from '@elevate/configuration/security-headers';
import { isAllowedActionOrigin } from '@elevate/configuration/workspaces';

/**
 * Module proxy (Next.js 16's renamed middleware): sets the Content-Security-Policy with a
 * fresh nonce on every page, whether reached directly or through the platform's rewrite.
 * Static security headers are in next.config.ts. Access is checked on each page and route.
 */
export function proxy(request: NextRequest) {
  if (request.method === 'POST' && !isAllowedActionOrigin(request))
    return new NextResponse('This request came from another site, so it was refused.', { status: 403 });
  const { headers, csp } = withContentSecurityPolicy(request.headers);
  headers.set('x-return-search', request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Paths are under the basePath (Next adds it). Skips API routes, Next internals and static files.
  matcher: ['/', '/((?!api/|_next/|brand/|favicon\\.ico|robots\\.txt).*)'],
};
