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

describe('Marketing OS routes (in-memory database)', () => {
  it('health reports the database', async () => {
    const res = await callRoute<{ status: string; module: string }>(
      () => health(),
      buildRequest('/marketing/api/v1/health'),
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok', module: 'marketing' });
  });

  it('standalone login issues the shared session cookie', async () => {
    const user = await createTestUser(ctx.db, {
      roles: ['director'],
      password: 'fictional-password-9',
    });
    const res = await login(
      buildRequest('/marketing/api/v1/auth/login', {
        json: { email: user.email, password: 'fictional-password-9' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^elevate_session=/);
    expect(authedRequest(user, '/').headers.get('cookie')).toContain('elevate_session=');
  });

  it('exports the legacy seed, the SEO/AIO/GEO categories and the sample set', () => {
    expect(seeds.map((s) => s.name)).toEqual([
      'marketing.legacy',
      'marketing.optimisation-categories',
      'marketing.samples',
    ]);
    expect(seeds[0]!.dependsOn).toContain('core.users');
  });
});
