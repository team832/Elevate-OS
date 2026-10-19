import { describe, expect, it } from 'vitest';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { GET as health } from '../../src/app/api/v1/health/route';
import { POST as login } from '../../src/app/api/v1/auth/login/route';
import { seeds } from '../../seed';

const ctx = setupTestDatabase();

describe('Business Ops OS routes (in-memory database)', () => {
  it('health reports the database', async () => {
    const res = await callRoute<{ status: string; module: string }>(
      () => health(),
      buildRequest('/ops/api/v1/health'),
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok', module: 'ops' });
  });

  it('standalone login issues the shared session cookie', async () => {
    const user = await createTestUser(ctx.db, {
      roles: ['director'],
      password: 'fictional-password-9',
    });
    const res = await login(
      buildRequest('/ops/api/v1/auth/login', {
        json: { email: user.email, password: 'fictional-password-9' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^elevate_session=/);
    expect(authedRequest(user, '/').headers.get('cookie')).toContain('elevate_session=');
  });

  it('exports the Business Ops seed list', () => {
    expect(Array.isArray(seeds)).toBe(true);
  });
});
