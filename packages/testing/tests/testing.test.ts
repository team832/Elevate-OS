import { describe, expect, it } from 'vitest';
import { getDb } from '@elevate/database';
import { getUserFromRequest } from '@elevate/authentication';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '../src/index';

const ctx = setupTestDatabase();

describe('@elevate/testing', () => {
  it('installs the test database as getDb()', () => {
    expect(getDb()).toBe(ctx.db);
  });

  it('creates users with roles and a working session', async () => {
    const user = await createTestUser(ctx.db, { roles: ['auditor', 'director'] });
    expect(user.roles).toEqual(['auditor', 'director']);
    const resolved = await getUserFromRequest(authedRequest(user, '/'), ctx.db);
    expect(resolved?.id).toBe(user.id);
    expect(await getUserFromRequest(buildRequest('/'), ctx.db)).toBeNull();
  });

  it('parses envelopes from handlers', async () => {
    const ok = await callRoute<{ n: number }>(
      async () => Response.json({ data: { n: 1 } }),
      buildRequest('/x'),
    );
    expect(ok).toMatchObject({ ok: true, status: 200, data: { n: 1 } });
    const fail = await callRoute(
      async () =>
        Response.json(
          { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r1' } },
          { status: 403 },
        ),
      buildRequest('/x'),
    );
    expect(fail.ok).toBe(false);
    expect(fail.error?.code).toBe('FORBIDDEN');
  });
});
