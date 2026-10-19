import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { marketingIdeas, type Database } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { GET as accountsRoute } from '../../src/app/api/v1/accounts/route';
import { PATCH as patchAccount } from '../../src/app/api/v1/accounts/[id]/route';
import { POST as verifyRoute } from '../../src/app/api/v1/accounts/[id]/verify-connection/route';
import { GET as listIdeasRoute, POST as createIdeaRoute } from '../../src/app/api/v1/ideas/route';
import { POST as dupCheckRoute } from '../../src/app/api/v1/ideas/duplicate-check/route';
import { GET as ideaRoute, PATCH as patchIdea } from '../../src/app/api/v1/ideas/[id]/route';
import { POST as ideaStatusRoute } from '../../src/app/api/v1/ideas/[id]/status/route';
import { createIdea, allocateIdeaCode, type CodeAllocator } from '../../src/server';
import { call, makeTeam, seedRegistry, uniqueTitle, type Team } from '../helpers';

const ctx = setupTestDatabase();
let team: Team;

beforeAll(async () => {
  await seedRegistry(ctx.db);
  team = await makeTeam(ctx.db);
});

type Account = {
  id: string;
  code: string;
  handle: string | null;
  integrationStatus: string;
  cadenceMaxPerDay: number | null;
};

describe('social accounts', () => {
  it('lists the registry with honest handles and the OD-001 conflict', async () => {
    const res = await call<{
      accounts: Account[];
      conflicts: { code: string; ownerDecision: string }[];
    }>(accountsRoute, team.auditor, '/x');
    expect(res.status).toBe(200);
    expect(res.data!.accounts.map((a) => a.code).sort()).toEqual([
      'IGC',
      'IGI',
      'IGN',
      'IGS',
      'IGU',
      'LI',
      'LIP',
      'YTC',
      'YTI',
      'YTU',
    ]);
    const withHandle = res.data!.accounts.filter((a) => a.handle !== null);
    expect(withHandle.map((a) => [a.code, a.handle])).toEqual([['IGC', '@elevate.clat']]);
    expect(res.data!.accounts.every((a) => a.integrationStatus === 'not_configured')).toBe(true);
    expect(res.data!.accounts.find((a) => a.code === 'LI')!.cadenceMaxPerDay).toBe(1);
    expect(res.data!.conflicts).toEqual([
      expect.objectContaining({ code: 'ACC-CONFLICT-001', ownerDecision: 'OD-001' }),
    ]);
  });

  it('401 signed out, 403 for teachers', async () => {
    expect((await call(accountsRoute, null, '/x')).status).toBe(401);
    expect((await call(accountsRoute, team.teacher, '/x')).status).toBe(403);
  });

  it('verification sets sandbox (never connected); only managers may change accounts', async () => {
    const list = await call<{ accounts: Account[] }>(accountsRoute, team.manager, '/x');
    const igs = list.data!.accounts.find((a) => a.code === 'IGS')!;
    expect(
      (await call(verifyRoute, team.contributor, '/x', { params: { id: igs.id } })).status,
    ).toBe(403);
    const v = await call<Account>(verifyRoute, team.manager, '/x', { params: { id: igs.id } });
    expect(v.data!.integrationStatus).toBe('sandbox');
    const connected = await call(patchAccount, team.manager, '/x', {
      method: 'PATCH',
      params: { id: igs.id },
      json: { integrationStatus: 'connected' },
    });
    expect(connected.status).toBe(400);
    const ok = await call<Account>(patchAccount, team.manager, '/x', {
      method: 'PATCH',
      params: { id: igs.id },
      json: { cadenceMaxPerWeek: 3 },
    });
    expect(ok.status).toBe(200);
  });
});

type Created = {
  idea: { id: string; code: string };
  duplicates: { decision: string; candidates: { kind: string }[] };
};

describe('ideas', () => {
  it('creates ideas with sequential COURSE-NNN codes', async () => {
    const a = await call<Created>(createIdeaRoute, team.contributor, '/x', {
      json: {
        coursePrefix: 'IPMAT',
        title: uniqueTitle(),
        pillar: 'Paths',
        source: 'fictional test',
      },
    });
    const b = await call<Created>(createIdeaRoute, team.contributor, '/x', {
      json: { coursePrefix: 'IPMAT', title: uniqueTitle() },
    });
    expect(a.status).toBe(201);
    const n = (c: string) => Number(c.split('-')[1]);
    expect(a.data!.idea.code).toMatch(/^IPMAT-\d{3}$/);
    expect(n(b.data!.idea.code)).toBe(n(a.data!.idea.code) + 1);
  });

  it('validates input (400) and permissions (403 auditor)', async () => {
    expect(
      (
        await call(createIdeaRoute, team.contributor, '/x', {
          json: { coursePrefix: 'MBA', title: 'x' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(createIdeaRoute, team.auditor, '/x', {
          json: { coursePrefix: 'CLAT', title: uniqueTitle() },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(listIdeasRoute, team.auditor, '/marketing/api/v1/ideas?course=CLAT')).status,
    ).toBe(200);
  });

  it('blocks an exact normalised duplicate in the same course, warns on similar or other-course titles', async () => {
    const title = uniqueTitle('NLU fees the real total cost');
    expect(
      (
        await call(createIdeaRoute, team.contributor, '/x', {
          json: { coursePrefix: 'CLAT', title },
        })
      ).status,
    ).toBe(201);
    const exact = await call(createIdeaRoute, team.contributor, '/x', {
      json: { coursePrefix: 'CLAT', title: `  ${title.toUpperCase()}!! ` },
    });
    expect(exact.status).toBe(409);
    const other = await call<Created>(createIdeaRoute, team.contributor, '/x', {
      json: { coursePrefix: 'GEN', title },
    });
    expect(other.status).toBe(201);
    expect(other.data!.duplicates.decision).toBe('warn');
    expect(other.data!.duplicates.candidates[0]!.kind).toBe('exact_other_course');
    const check = await call<{ decision: string }>(dupCheckRoute, team.auditor, '/x', {
      json: { coursePrefix: 'CLAT', title },
    });
    expect(check.data!.decision).toBe('block');
  });

  it('never collides under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        call<Created>(createIdeaRoute, team.contributor, '/x', {
          json: { coursePrefix: 'CUET', title: uniqueTitle() },
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.data!.idea.code);
    expect(new Set(codes).size).toBe(12);
  });

  it('retries when an allocated code is already taken and never reuses it', async () => {
    const taken = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'COM',
      title: uniqueTitle(),
    });
    let first = true;
    const stale: CodeAllocator = async (db: Database, prefix) => {
      if (first) {
        first = false;
        return taken.idea.code!;
      }
      return allocateIdeaCode(db, prefix);
    };
    const res = await createIdea(
      ctx.db,
      team.manager,
      { coursePrefix: 'COM', title: uniqueTitle() },
      { allocate: stale },
    );
    expect(res.idea.code).not.toBe(taken.idea.code);
    // Archive frees nothing: the next code is still higher.
    await call(ideaStatusRoute, team.manager, '/x', {
      params: { id: res.idea.id },
      json: { status: 'archived' },
    });
    const next = await createIdea(ctx.db, team.manager, {
      coursePrefix: 'COM',
      title: uniqueTitle(),
    });
    expect(Number(next.idea.code!.split('-')[1])).toBeGreaterThan(
      Number(res.idea.code!.split('-')[1]),
    );
  });

  it('honours Idempotency-Key on create', async () => {
    const body = { coursePrefix: 'GEN', title: uniqueTitle() };
    const headers = { 'idempotency-key': `test-only-${Date.now()}` };
    const a = await call<Created>(createIdeaRoute, team.contributor, '/x', { json: body, headers });
    const b = await call<Created>(createIdeaRoute, team.contributor, '/x', { json: body, headers });
    expect(b.status).toBe(201);
    expect(b.data!.idea.id).toBe(a.data!.idea.id);
    expect(b.headers.get('idempotency-replayed')).toBe('true');
  });

  it('edits, enforces the lifecycle, and shows live duplicate candidates on detail', async () => {
    const created = await call<Created>(createIdeaRoute, team.contributor, '/x', {
      json: { coursePrefix: 'CLAT', title: uniqueTitle() },
    });
    const id = created.data!.idea.id;
    const patched = await call<{ idea: { objective: string } }>(patchIdea, team.contributor, '/x', {
      method: 'PATCH',
      params: { id },
      json: { objective: 'Explain to parents', audience: 'Parents (fictional)' },
    });
    expect(patched.data!.idea.objective).toBe('Explain to parents');
    const noReason = await call(ideaStatusRoute, team.contributor, '/x', {
      params: { id },
      json: { status: 'rejected' },
    });
    expect(noReason.status).toBe(400);
    expect(
      (
        await call(ideaStatusRoute, team.contributor, '/x', {
          params: { id },
          json: { status: 'archived' },
        })
      ).status,
    ).toBe(200);
    const again = await call(ideaStatusRoute, team.contributor, '/x', {
      params: { id },
      json: { status: 'idea' },
    });
    expect(again.error?.code).toBe('INVALID_STATE_TRANSITION');
    const detail = await call<{ idea: { id: string }; duplicates: unknown }>(
      ideaRoute,
      team.auditor,
      '/x',
      { params: { id } },
    );
    expect(detail.data!.idea.id).toBe(id);
    const [row] = await ctx.db
      .select()
      .from(marketingIdeas)
      .where(eq(marketingIdeas.id, id as never));
    expect(row!.status).toBe('archived');
  });
});
