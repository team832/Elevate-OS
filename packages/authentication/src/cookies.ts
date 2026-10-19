/** Session cookie shared by all four zones (same host through the platform rewrites, D-004). */
export const SESSION_COOKIE = 'elevate_session';

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict';
  secure: boolean;
  path: string;
  /** Seconds. */
  maxAge?: number;
}

/** HttpOnly, SameSite=Lax, Secure in production, path `/`. */
export function sessionCookieOptions(
  maxAgeSeconds?: number,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: nodeEnv === 'production',
    path: '/',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!/^[\w!#$%&'*+\-.^`|~]+$/.test(name)) throw new Error('Invalid cookie name');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    if (options.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite === 'lax' ? 'Lax' : 'Strict'}`);
  return parts.join('; ');
}

/** `Set-Cookie` value that deletes the session cookie. */
export function clearSessionCookie(nodeEnv?: string): string {
  return serializeCookie(SESSION_COOKIE, '', sessionCookieOptions(0, nodeEnv));
}

export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (!out.has(name)) {
      try {
        out.set(name, decodeURIComponent(raw));
      } catch {
        out.set(name, raw);
      }
    }
  }
  return out;
}

export function readSessionToken(request: Request): string | undefined {
  return parseCookieHeader(request.headers.get('cookie')).get(SESSION_COOKIE) || undefined;
}
