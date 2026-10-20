import { describe, expect, it } from 'vitest';
import { GET as start } from '../../src/app/api/v1/auth/google/start/route';
import { GET as callback } from '../../src/app/api/v1/auth/google/callback/route';

// The test environment sets no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (vitest.shared.ts).
describe('Google sign-in routes when not configured', () => {
  it.each([
    ['start', start, '/api/v1/auth/google/start?next=/'],
    ['callback', callback, '/api/v1/auth/google/callback?code=x&state=y'],
  ])('%s answers 404 NOT_FOUND', async (_name, handler, path) => {
    const res = await handler(new Request(`http://localhost:3000${path}`));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
