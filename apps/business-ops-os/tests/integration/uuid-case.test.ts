/**
 * REV-1 D1: an id in upper case is the same id to PostgreSQL, so a "never your own record" check
 * must refuse it too (server-kit lower-cases UUID-shaped input before validation).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestDatabase } from '@elevate/testing';
import { POST as leaveRoute } from '../../src/app/api/v1/attendance/leave/route';
import { POST as decisionRoute } from '../../src/app/api/v1/attendance/decisions/route';
import { attendanceWorld, D1, post } from './attendance-fixture';

const ctx = setupTestDatabase();
let w: Awaited<ReturnType<typeof attendanceWorld>>;
beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
});

describe.each([
  ['/leave', leaveRoute, { fromDate: D1, toDate: D1, kind: 'Casual' }],
  ['/decisions', decisionRoute, { workDate: D1, status: 'present', note: 'Sample own day' }],
] as const)('HR on their own record through %s', (path, route, body) => {
  it.each([
    ['lower', (id: string) => id],
    ['upper', (id: string) => id.toUpperCase()],
  ])('%s-case own staffId is refused', async (_, spell) => {
    const r = await post(route, w.hr, path, { ...body, staffId: spell(w.hr.staffId) });
    expect(r.status).toBe(403);
  });
});
