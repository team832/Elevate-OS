import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  cspModeFromEnv,
  securityHeaders,
  withContentSecurityPolicy,
} from '../src/security-headers';

const prod = { dev: false, https: true };
const dev = { dev: true, https: false };
const directives = (csp: string) => new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]));

describe('contentSecurityPolicy', () => {
  it('production: nonce scripts and styles, no unsafe-eval, no inline <style>, upgrade over https', () => {
    const d = directives(contentSecurityPolicy('n0nce', prod));
    expect(d.get('default-src')).toBe("default-src 'self'");
    expect(d.get('script-src')).toBe("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
    expect(d.get('style-src')).toBe("style-src 'self' 'nonce-n0nce'");
    expect(d.get('style-src-attr')).toBe("style-src-attr 'unsafe-inline'");
    expect(d.get('img-src')).toBe("img-src 'self' data:");
    expect(d.get('connect-src')).toBe("connect-src 'self'");
    for (const fixed of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(d.get(fixed.split(' ')[0])).toBe(fixed);
    }
    expect(d.has('upgrade-insecure-requests')).toBe(true);
  });

  it('development relaxes only what next dev needs', () => {
    const csp = contentSecurityPolicy('n0nce', dev);
    const d = directives(csp);
    expect(d.get('script-src')).toBe("script-src 'self' 'nonce-n0nce' 'strict-dynamic' 'unsafe-eval'");
    expect(d.get('style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(d.get('connect-src')).toBe("connect-src 'self' ws: wss:");
    expect(d.has('upgrade-insecure-requests')).toBe(false);
    expect(d.get('frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('plain-http production (local next start) does not upgrade requests', () => {
    expect(contentSecurityPolicy('n', { dev: false, https: false })).not.toContain('upgrade-insecure-requests');
  });
});

describe('securityHeaders', () => {
  it('sets the baseline headers and HSTS only over https', () => {
    const map = new Map(securityHeaders(prod).map((h) => [h.key, h.value]));
    expect(map.get('X-Content-Type-Options')).toBe('nosniff');
    expect(map.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(map.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(map.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(map.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(map.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(securityHeaders(dev).some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
  });
});

describe('cspModeFromEnv', () => {
  it('derives dev and https from NODE_ENV and PLATFORM_URL', () => {
    expect(cspModeFromEnv({ NODE_ENV: 'development', PLATFORM_URL: 'https://x.test' })).toEqual({ dev: true, https: false });
    expect(cspModeFromEnv({ NODE_ENV: 'production', PLATFORM_URL: 'https://x.test' })).toEqual({ dev: false, https: true });
    expect(cspModeFromEnv({ NODE_ENV: 'production', PLATFORM_URL: 'http://localhost:3000' })).toEqual({ dev: false, https: false });
    expect(cspModeFromEnv({ NODE_ENV: 'production' })).toEqual({ dev: false, https: false });
  });
});

describe('withContentSecurityPolicy', () => {
  it('adds a fresh nonce per call to a copy of the request headers', () => {
    const original = new Headers({ cookie: 'a=b' });
    const first = withContentSecurityPolicy(original, prod);
    const second = withContentSecurityPolicy(original, prod);
    expect(first.headers.get('Content-Security-Policy')).toBe(first.csp);
    expect(first.headers.get('cookie')).toBe('a=b');
    expect(original.has('Content-Security-Policy')).toBe(false);
    const nonce = (csp: string) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
    expect(nonce(first.csp)).toBeTruthy();
    expect(nonce(first.csp)).not.toBe(nonce(second.csp));
  });
});
