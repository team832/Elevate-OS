import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { approvals, auditEvents } from '@elevate/database';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  decideApproval,
  defineApprovalPolicy,
  listApprovalHistory,
  requestApproval,
  withdrawApproval,
  withTransaction,
} from '../src/index';

const ctx = setupTestDatabase();

const publishPolicy = defineApprovalPolicy({
  key: 'marketing.content.publish',
  module: 'marketing',
  subjectType: 'content_item',
  deciderPermission: 'marketing:content:approve',
  requesterPermission: 'marketing:content:write',
  allowSelfApproval: false,
  description: 'Nothing is published without an explicit yes from someone else.',
});
const selfOkPolicy = defineApprovalPolicy({
  ...publishPolicy,
  key: 'marketing.content.minor_edit',
  allowSelfApproval: true,
});

const SUBJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('approvals', () => {
  it('requester cannot approve their own request unless the policy allows self-approval', async () => {
    const manager = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
    const pending = await requestApproval(ctx.db, {
      policy: publishPolicy,
      subjectId: SUBJECT,
      requestedBy: manager,
      comment: 'Ready',
    });
    await expect(
      decideApproval(ctx.db, {
        policy: publishPolicy,
        approvalId: pending.id,
        decider: manager,
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const selfOk = await requestApproval(ctx.db, {
      policy: selfOkPolicy,
      subjectId: SUBJECT,
      requestedBy: manager,
    });
    const decided = await decideApproval(ctx.db, {
      policy: selfOkPolicy,
      approvalId: selfOk.id,
      decider: manager,
      decision: 'approved',
    });
    expect(decided.status).toBe('approved');
  });

  it('another approver with the permission can decide; the decision is audited', async () => {
    const contributor = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
    const director = await createTestUser(ctx.db, { roles: ['director'] });
    const subject = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const pending = await requestApproval(ctx.db, {
      policy: publishPolicy,
      subjectId: subject,
      requestedBy: contributor,
    });

    // contributor lacks marketing:content:approve
    const other = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
    await expect(
      decideApproval(ctx.db, {
        policy: publishPolicy,
        approvalId: pending.id,
        decider: other,
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const approved = await withTransaction(ctx.db, (tx) =>
      decideApproval(tx, {
        policy: publishPolicy,
        approvalId: pending.id,
        decider: director,
        decision: 'approved',
        comment: 'Go',
      }),
    );
    expect(approved).toMatchObject({ status: 'approved', decidedBy: director.id, comment: 'Go' });
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, pending.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['approval.decided', 'approval.requested']);

    await expect(
      decideApproval(ctx.db, {
        policy: publishPolicy,
        approvalId: pending.id,
        decider: director,
        decision: 'rejected',
        comment: 'x',
      }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('rejections need a reason; only one pending request per subject; history is preserved', async () => {
    const contributor = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
    const manager = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
    const subject = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const first = await requestApproval(ctx.db, {
      policy: publishPolicy,
      subjectId: subject,
      requestedBy: contributor,
    });
    await expect(
      requestApproval(ctx.db, {
        policy: publishPolicy,
        subjectId: subject,
        requestedBy: contributor,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      decideApproval(ctx.db, {
        policy: publishPolicy,
        approvalId: first.id,
        decider: manager,
        decision: 'rejected',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await decideApproval(ctx.db, {
      policy: publishPolicy,
      approvalId: first.id,
      decider: manager,
      decision: 'rejected',
      comment: 'Fix the claim',
    });

    const second = await requestApproval(ctx.db, {
      policy: publishPolicy,
      subjectId: subject,
      requestedBy: contributor,
      comment: 'Fixed',
    });
    await withdrawApproval(ctx.db, {
      policy: publishPolicy,
      approvalId: second.id,
      actor: contributor,
    });
    const third = await requestApproval(ctx.db, {
      policy: publishPolicy,
      subjectId: subject,
      requestedBy: contributor,
    });
    await decideApproval(ctx.db, {
      policy: publishPolicy,
      approvalId: third.id,
      decider: manager,
      decision: 'approved',
    });

    const history = await listApprovalHistory(ctx.db, {
      module: 'marketing',
      subjectType: 'content_item',
      subjectId: subject,
    });
    expect(history.map((h) => h.status)).toEqual(['rejected', 'withdrawn', 'approved']);
    expect(
      await ctx.db.select().from(approvals).where(eq(approvals.subjectId, subject)),
    ).toHaveLength(3);
  });

  it('requester must hold the requester permission when the policy sets one', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    await expect(
      requestApproval(ctx.db, {
        policy: publishPolicy,
        subjectId: 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        requestedBy: teacher,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
