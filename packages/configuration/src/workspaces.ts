/**
 * Where each app is reached in the browser (D-072). One variable per app; the defaults are
 * the local development ports. These origins are also the only places a sign-in may redirect
 * to and the only origins whose state-changing requests the apps accept.
 */
export const APP_URL_VARS = {
  ops: 'BUSINESS_OPS_OS_URL',
  academic: 'ACADEMIC_OS_URL',
  marketing: 'MARKETING_OS_URL',
  platform: 'PLATFORM_URL',
} as const;

export type AppKey = keyof typeof APP_URL_VARS;

export const APP_URL_DEFAULTS: Readonly<Record<AppKey, string>> = {
  ops: 'http://localhost:3000',
  academic: 'http://localhost:3001',
  marketing: 'http://localhost:3002',
  platform: 'http://localhost:3003',
};

/** Origin (scheme://host:port, no path) of an app, from its variable or the default. */
export function appOrigin(
  key: AppKey,
  env: Record<string, string | undefined> = process.env,
): string {
  return new URL(env[APP_URL_VARS[key]] || APP_URL_DEFAULTS[key]).origin;
}

/** Every configured app origin (the allowlist). */
export function appOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((Object.keys(APP_URL_VARS) as AppKey[]).map((k) => appOrigin(k, env)));
}

/**
 * CSRF guard for state-changing requests: a browser always sends `Origin` on a cross-origin
 * POST, and other localhost ports share our cookie, so a present Origin must be this
 * request's own origin or one of the configured app origins. No Origin (curl, server-to-server,
 * tests) is allowed; those callers carry no ambient browser cookie.
 */
export function isAllowedRequestOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === new URL(request.url).origin || appOrigins(env).has(origin);
}
