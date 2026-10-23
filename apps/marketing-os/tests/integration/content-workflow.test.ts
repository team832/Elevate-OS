import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, marketingContentVersions } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { POST as createIdeaRoute } from '../../src/app/api/v1/ideas/route';
import { POST as createItemRoute } from '../../src/app/api/v1/ideas/[id]/content-items/route';
import { GET as itemRoute } from '../../src/app/api/v1/content-items/[id]/route';
import { POST as versionRoute } from '../../src/app/api/v1/content-items/[id]/versions/route';
import { POST as submitRoute } from '../../src/app/api/v1/content-items/[id]/submit/route';
import { POST as withdrawRoute } from '../../src/app/api/v1/content-items/[id]/withdraw/route';
import { POST as decisionRoute } from '../../src/app/api/v1/content-items/[id]/decision/route';
import { POST as commentRoute } from '../../src/app/api/v1/content-items/[id]/comments/route';
import { PUT as assignRoute } from '../../src/app/api/v1/content-items/[id]/assignments/route';
import { POST as placeRoute } from '../../src/app/api/v1/content-items/[id]/placements/route';
import type { ContentItemDetail } from '../../src/server';
import {
  allChecklistCodes,
  call,
  makeTeam,
  seedRegistry,
  uniqueTitle,
  type Team,
} from '../helpers';

const ctx = setupTestDatabase();
let team: Team;

beforeAll(async () => {
  await seedRegistry(ctx.db);
  team = await makeTeam(ctx.db);
});

async function newItem(body: string, author = team.contributor, course = 'CLAT') {
  const idea = await call<{ idea: { id: string; code: string } }>(
    createIdeaRoute,
    author,
    '/marketing/api/v1/ideas',
    {
      json: { coursePrefix: course, title: uniqueTitle() },
    },
  );
  expect(idea.status).toBe(201);
  const item = await call<{ id: string; state: string }>(createItemRoute, author, '/x', {
    params: { id: idea.data!.idea.id },
    json: { title: 'Fictional caption for tests', format: 'caption', initialVersion: { body } },
  });
  expect(item.status).toBe(201);
  const placed = await call(placeRoute, author, '/x', {
    params: { id: item.data!.id },
    json: { accountCode: 'IGC' },
  });
  expect(placed.status).toBe(201);
  return { ideaId: idea.data!.idea.id, ideaCode: idea.data!.idea.code, itemId: item.data!.id };
}

async function detail(id: string, user = team.manager) {
  const res = await call<ContentItemDetail>(itemRoute, user, '/x', { params: { id } });
  expect(res.status).toBe(200);
  return res.data!;
}

describe('content production and approval', () => {
  it('runs draft → in_review → changes_requested → in_review → approved with history', async () => {
    const { itemId } = await newItem(
      'CLAT legal reasoning: one principle, one fact pattern, one answer.',
    );
    const submitted = await call<{ item: { state: string } }>(submitRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: {},
    });
    expect(submitted.status).toBe(200);
    expect(submitted.data!.item.state).toBe('in_review');

    const changes = await call(decisionRoute, team.manager, '/x', {
      params: { id: itemId },
      json: { decision: 'request_changes', comment: 'Tighten the hook.' },
    });
    expect(changes.status).toBe(200);
    expect((await detail(itemId)).item.state).toBe('changes_requested');

    const v2 = await call(versionRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: {
        body: 'Legal reasoning in 60 seconds: principle, facts, answer.',
        changeNote: 'Tighter hook',
      },
    });
    expect(v2.status).toBe(201);
    expect(
      (await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} }))
        .status,
    ).toBe(200);

    const d = await detail(itemId);
    const approve = await call<{ item: { state: string; approvedVersionId: string } }>(
      decisionRoute,
      team.manager,
      '/x',
      {
        params: { id: itemId },
        json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d.ruleCheck) },
      },
    );
    expect(approve.status).toBe(200);
    expect(approve.data!.item.state).toBe('approved');
    expect(approve.data!.item.approvedVersionId).toBe(d.currentVersion!.id);

    const after = await detail(itemId, team.auditor);
    expect(after.versions).toHaveLength(2);
    expect(after.approvals.map((a) => a.status)).toEqual(['rejected', 'approved']);
    expect(after.approvals[0]!.comment).toBe('Tighten the hook.');
    const audit = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, itemId));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'content_item.created',
        'content_item.submitted',
        'content_item.changes_requested',
        'content_item.approved',
      ]),
    );
  });

  it('returns 403 when a contributor tries to approve', async () => {
    const { itemId } = await newItem('A fictional draft about CLAT sections.', team.manager);
    await call(submitRoute, team.manager, '/x', { params: { id: itemId }, json: {} });
    const res = await call(decisionRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: { decision: 'approve' },
    });
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('FORBIDDEN');
  });

  it('refuses self-approval (requester) and author approval', async () => {
    const own = await newItem('A fictional manager draft about the CLAT pattern.', team.manager);
    await call(submitRoute, team.manager, '/x', { params: { id: own.itemId }, json: {} });
    const d = await detail(own.itemId);
    const self = await call(decisionRoute, team.manager, '/x', {
      params: { id: own.itemId },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d.ruleCheck) },
    });
    expect(self.status).toBe(403);

    // The director wrote nothing, but if the requester is someone else and the author approves → 403.
    const authored = await newItem(
      'Another fictional draft written by the second manager.',
      team.manager2,
    );
    // The contributor works on it (own scope: assigned content only), so they may submit it.
    await call(assignRoute, team.manager2, '/x', {
      method: 'PUT',
      params: { id: authored.itemId },
      json: { role: 'editor', userId: team.contributor.id },
    });
    await call(submitRoute, team.contributor, '/x', { params: { id: authored.itemId }, json: {} });
    const d2 = await detail(authored.itemId);
    const byAuthor = await call(decisionRoute, team.manager2, '/x', {
      params: { id: authored.itemId },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d2.ruleCheck) },
    });
    expect(byAuthor.status).toBe(403);
    const byDirector = await call(decisionRoute, team.director, '/x', {
      params: { id: authored.itemId },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d2.ruleCheck) },
    });
    expect(byDirector.status).toBe(200);
  });

  it('blocks approval when a banned phrase matches, until a new version removes it', async () => {
    const { itemId } = await newItem('Our toppers got AIR 12 — 100% results guaranteed.');
    await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} });
    const d = await detail(itemId);
    expect(d.ruleCheck!.blocking.map((b) => b.ruleCode)).toContain('CR-006');
    const blocked = await call<unknown>(decisionRoute, team.manager, '/x', {
      params: { id: itemId },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d.ruleCheck) },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.error?.code).toBe('INVALID_STATE_TRANSITION');
    expect(JSON.stringify(blocked.error?.details)).toContain('BRAND_RULE_BLOCK');
    expect((await detail(itemId)).item.state).toBe('in_review');
  });

  it('requires every checklist item to be acknowledged (400 lists the missing codes)', async () => {
    const { itemId } = await newItem('A plain fictional explainer of the CLAT exam pattern.');
    await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} });
    const res = await call(decisionRoute, team.manager, '/x', {
      params: { id: itemId },
      json: { decision: 'approve' },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.error?.details)).toContain('AP-001');
  });

  it('blocks content showing students without a consent reference (CO-001, OD-008)', async () => {
    const { itemId } = await newItem('Fictional classroom clip.');
    await call(versionRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: {
        body: 'Fictional classroom clip v2.',
        assets: [{ fileName: 'class.mp4', mimeType: 'video/mp4', showsStudents: true }],
      },
    });
    await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} });
    const d = await detail(itemId);
    expect(d.ruleCheck!.blocking.map((b) => b.ruleCode)).toContain('SYS-CONSENT');
  });

  it('keeps approved versions immutable: an edit creates a new version and voids approval', async () => {
    const { itemId } = await newItem('Fictional approved copy about NLU fees.');
    await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} });
    const d = await detail(itemId);
    await call(decisionRoute, team.manager, '/x', {
      params: { id: itemId },
      json: { decision: 'approve', acknowledgedRuleCodes: allChecklistCodes(d.ruleCheck) },
    });
    const approved = await detail(itemId);
    const approvedVersion = approved.currentVersion!;
    const edit = await call<{
      approvalVoided: boolean;
      item: { state: string; approvedVersionId: string | null };
    }>(versionRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: { body: 'Edited after approval.' },
    });
    expect(edit.status).toBe(201);
    expect(edit.data!.approvalVoided).toBe(true);
    expect(edit.data!.item.state).toBe('in_review');
    expect(edit.data!.item.approvedVersionId).toBeNull();
    const [stored] = await ctx.db
      .select()
      .from(marketingContentVersions)
      .where(eq(marketingContentVersions.id, approvedVersion.id));
    expect(stored!.body).toBe(approvedVersion.body);
    expect(stored!.contentHash).toBe(approvedVersion.contentHash);
  });

  it('rejects illegal transitions with INVALID_STATE_TRANSITION', async () => {
    const { itemId } = await newItem('Fictional draft never submitted.');
    const res = await call(withdrawRoute, team.contributor, '/x', { params: { id: itemId } });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('INVALID_STATE_TRANSITION');
    await call(submitRoute, team.contributor, '/x', { params: { id: itemId }, json: {} });
    const editInReview = await call(versionRoute, team.contributor, '/x', {
      params: { id: itemId },
      json: { body: 'x' },
    });
    expect(editInReview.error?.code).toBe('INVALID_STATE_TRANSITION');
    const withdrawn = await call<{ state: string }>(withdrawRoute, team.contributor, '/x', {
      params: { id: itemId },
    });
    expect(withdrawn.data!.state).toBe('draft');
  });

  it('keeps comments and assignments; auditor and teacher cannot write', async () => {
    const { itemId } = await newItem('Fictional item for comments.');
    expect(
      (
        await call(commentRoute, team.director, '/x', {
          params: { id: itemId },
          json: { body: 'Looks fine.' },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(commentRoute, team.auditor, '/x', {
          params: { id: itemId },
          json: { body: 'no' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(commentRoute, team.teacher, '/x', {
          params: { id: itemId },
          json: { body: 'no' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(commentRoute, null, '/x', { params: { id: itemId }, json: { body: 'no' } }))
        .status,
    ).toBe(401);
    // Assigning grants access (own scope), so it is a manager action, even for yourself.
    const json = { role: 'writer', userId: team.contributor.id };
    const self = await call(assignRoute, team.contributor, '/x', {
      method: 'PUT',
      params: { id: itemId },
      json,
    });
    expect(self.status).toBe(403);
    const assign = await call(assignRoute, team.manager, '/x', {
      method: 'PUT',
      params: { id: itemId },
      json,
    });
    expect(assign.status).toBe(200);
    const d = await detail(itemId);
    expect(d.comments).toHaveLength(1);
    expect(d.assignments[0]).toMatchObject({ role: 'writer', userId: team.contributor.id });
    const bad = await call(assignRoute, team.manager, '/x', {
      method: 'PUT',
      params: { id: itemId },
      json: { role: 'boss' },
    });
    expect(bad.status).toBe(400);
  });
});
