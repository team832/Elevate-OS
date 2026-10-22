import { beforeAll, describe, expect, it } from 'vitest';
import { opsLeadSources, staffMembers } from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listLeads, POST as createLead } from '../../src/app/api/v1/leads/route';
import { GET as listTasks } from '../../src/app/api/v1/staff-tasks/route';
import { call } from '../helpers';

const ctx = setupTestDatabase();
let manager: TestUser;
let contributor: TestUser;
let teacher: TestUser;

/** A fictional marketing user linked to a staff record (own-scope leads need one). */
async function staff(role: 'marketing_manager' | 'marketing_contributor') {
  const user = await createTestUser(ctx.db, { roles: [role] });
  await ctx.db.insert(staffMembers).values({ userId: user.id, fullName: user.displayName });
  return user;
}

beforeAll(async () => {
  await ctx.db.insert(opsLeadSources).values({ code: 'UNKNOWN', label: 'Unknown' });
  manager = await staff('marketing_manager');
  contributor = await staff('marketing_contributor');
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
});

describe('Business Ops leads and tasks mounted in Marketing OS', () => {
  it('managers list every lead; contributors only their own', async () => {
    const add = (user: TestUser, studentName: string) =>
      call(createLead, user, '/marketing/api/v1/leads', {
        json: { studentName, studentEmail: `${studentName.replaceAll(' ', '.')}@example.test` },
      });
    expect((await add(manager, 'Sample Lead Manager')).status).toBe(201);
    expect((await add(contributor, 'Sample Lead Contributor')).status).toBe(201);

    const names = async (user: TestUser) => {
      const res = await call<{ studentName: string }[]>(listLeads, user, '/marketing/api/v1/leads');
      expect(res.status).toBe(200);
      return res.data!.map((l) => l.studentName).sort();
    };
    expect(await names(manager)).toEqual(['Sample Lead Contributor', 'Sample Lead Manager']);
    expect(await names(contributor)).toEqual(['Sample Lead Contributor']);
    expect((await call(listLeads, teacher, '/marketing/api/v1/leads')).status).toBe(403);
  });

  it('task routes answer with the same permission checks', async () => {
    expect((await call(listTasks, contributor, '/marketing/api/v1/staff-tasks')).status).toBe(200);
    expect((await call(listTasks, null, '/marketing/api/v1/staff-tasks')).status).toBe(401);
  });
});
