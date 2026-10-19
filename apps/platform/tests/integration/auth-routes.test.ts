import { describe, expect, it } from 'vitest';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { GET as me } from '../../src/app/api/v1/auth/me/route';
import { GET as health } from '../../src/app/api/health/route';

const ctx = setupTestDatabase();

describe('platform API', () => {
  it('GET /api/v1/auth/me needs a session', async () => {
    expect((await callRoute(me, buildRequest('/api/v1/auth/me'))).status).toBe(401);
  });

  it('GET /api/v1/auth/me lists the modules and permissions of the user', async () => {
    const counsellor = await createTestUser(ctx.db, { roles: ['admissions_counsellor'] });
    const res = await callRoute<{ modules: string[]; permissions: Record<string, string> }>(
      me,
      authedRequest(counsellor, '/api/v1/auth/me'),
    );
    expect(res.status).toBe(200);
    expect(res.data?.modules).toEqual(['platform', 'ops']);
    expect(res.data?.permissions['ops:tasks:write']).toBe('own');
    expect(res.data?.permissions['platform:users:manage']).toBeUndefined();
  });

  it('GET /api/health reports the database', async () => {
    const res = await callRoute(() => health(), buildRequest('/api/health'));
    expect(res.status).toBe(200);
  });
});
