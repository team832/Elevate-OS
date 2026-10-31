/** HUS-015: a new institute is told its first jobs in order; they go once staff and leads exist. */
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { prerender } from 'react-dom/static';
import type { Database } from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { FirstJobs } from '../../src/app/_components/first-jobs';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const html = async (node: ReactNode) =>
  new Response((await prerender(node)).prelude).text();

describe('first jobs on the Overview', () => {
  let manager: StaffUser;
  beforeAll(async () => {
    await setupReference(ctx.db as Database);
    manager = await staffUser(ctx.db as Database, ['operations_manager']);
  });

  it('shown with no leads yet, then gone once there is one', async () => {
    const before = await html(<FirstJobs user={manager as never} />);
    expect(before).toContain('First jobs on a new system');
    expect(before).toContain('href="/ops/staff?new=1"');
    expect(before).toContain('href="/ops/leads?new=1"');
    const lead = await callRoute(
      createLead,
      authedRequest(manager, '/ops/api/v1/leads', {
        method: 'POST',
        json: { studentName: 'First Lead', studentPhone: phone(), sourceCode: 'WEBINAR' },
      }),
    );
    expect(lead.status).toBe(201);
    expect(await html(<FirstJobs user={manager as never} />)).toBe('');
  });
});
