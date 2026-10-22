/**
 * Security headers for all four apps (website-build-guidelines §6.4, Appendix A).
 * Imports only ./workspaces (itself import-free), so next.config.ts can load this file too.
 *
 * - `securityHeaders()` is static and goes in each app's next.config.ts `headers()`.
 * - The CSP needs a fresh nonce per request, so each app's `src/proxy.ts` sets it with
 *   `withContentSecurityPolicy()`. Next reads the nonce from the request's CSP header
 *   and stamps it on its own scripts and inline styles (Next 16 CSP guide). Module pages
 *   reached through the platform's rewrites keep the CSP their own app set.
 */

import { appOrigins } from './workspaces';

export interface HeaderPair {
  key: string;
  value: string;
}

export interface CspMode {
  /** `next dev`: allow eval (React dev error stacks), inline styles (dev overlay) and the HMR socket. */
  dev: boolean;
  /** Served over HTTPS (production with an https PLATFORM_URL): adds upgrade-insecure-requests and HSTS. */
  https: boolean;
}

/** Mode from the environment: dev under `next dev`, https only in production behind an https PLATFORM_URL. */
export function cspModeFromEnv(env: Record<string, string | undefined> = process.env): CspMode {
  return {
    dev: env.NODE_ENV === 'development',
    https: env.NODE_ENV === 'production' && (env.PLATFORM_URL ?? '').startsWith('https://'),
  };
}

/** Headers that do not change per request. */
export function securityHeaders(mode: CspMode = cspModeFromEnv()): HeaderPair[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Internal app behind a login: never indexed.
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    // includeSubDomains is left off until the owner confirms no subdomain is HTTP-only (§6.4).
    ...(mode.https ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}

export function contentSecurityPolicy(
  nonce: string,
  mode: CspMode = cspModeFromEnv(),
  workspaceOrigins: Iterable<string> = appOrigins(),
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${mode.dev ? " 'unsafe-eval'" : ''}`,
    // A nonce cancels 'unsafe-inline', so dev uses 'unsafe-inline' alone.
    `style-src 'self' ${mode.dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // React `style={...}` props render as style="" attributes, which nonces cannot cover.
    // Attributes cannot run script; <style> elements still need the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${mode.dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in and the workspace chooser answer a form post with a 303 to another workspace's
    // origin (D-072); form-action also governs that redirect, so the app origins are listed.
    `form-action 'self' ${[...workspaceOrigins].join(' ')}`,
    "frame-ancestors 'none'",
    ...(mode.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * For a proxy: copies the request headers with a fresh-nonce CSP added (pass them to
 * `NextResponse.next({ request: { headers } })`) and returns the same policy for the response.
 */
export function withContentSecurityPolicy(
  requestHeaders: Headers,
  mode: CspMode = cspModeFromEnv(),
): { headers: Headers; csp: string } {
  const csp = contentSecurityPolicy(btoa(crypto.randomUUID()), mode);
  const headers = new Headers(requestHeaders);
  headers.set('Content-Security-Policy', csp);
  return { headers, csp };
}
