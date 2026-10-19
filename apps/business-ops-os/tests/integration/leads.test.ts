import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { opsAdmissions, opsDuplicateFlags, opsFollowUps, opsLeads } from '@elevate/database';
import { GET as listLeads, POST as createLead } from '../../src/app/api/v1/leads/route';
import { GET as getLead } from '../../src/app/api/v1/leads/[id]/route';
import { POST as checkDuplicates } from '../../src/app/api/v1/leads/check-duplicates/route';
import { POST as assign } from '../../src/app/api/v1/leads/[id]/assign/route';
import { POST as accept } from '../../src/app/api/v1/leads/[id]/accept/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as enquiry } from '../../src/app/api/v1/leads/[id]/enquiries/route';
import { POST as merge } from '../../src/app/api/v1/leads/[id]/merge/route';
import { GET as history } from '../../src/app/api/v1/leads/[id]/history/route';
import { e164, phone, setupReference, staffUser, uniqueEmail, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let otherCounsellor: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  otherCounsellor = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: manager.staffId,
  });
});

type Created = {
  lead: { id: string; code: string; studentPhone: string | null };
  admission: { id: string; status: string };
  duplicates: { code: string; level: string; accessible: boolean; studentName: string | null }[];
};

const post = (
  user: { token: string },
  path: string,
  json: unknown,
  headers?: Record<string, string>,
) => authedRequest(user, path, { method: 'POST', json, headers });

async function newLead(user: StaffUser, over: Record<string, unknown> = {}) {
  return callRoute<Created>(
    createLead,
    post(user, '/ops/api/v1/leads', {
      studentName: 'Riya Test (fictional)',
      studentPhone: phone(),
      programmeCode: 'CLAT',
      sourceCode: 'WALK_IN',
      ...over,
    }),
  );
}

describe('POST /ops/api/v1/leads', () => {
  it('401 without a session, 403 for auditor and teacher, 400 with field paths for bad input', async () => {
    expect(
      (await callRoute(createLead, buildRequest('/ops/api/v1/leads', { json: {} }))).status,
    ).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await callRoute(createLead, post(auditor, '/ops/api/v1/leads', {}))).status).toBe(403);
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await callRoute(createLead, post(teacher, '/ops/api/v1/leads', {}))).status).toBe(403);
    const bad = await newLead(counsellor, { studentPhone: '12345' });
    expect(bad.status).toBe(400);
    expect(bad.error?.details).toEqual([expect.objectContaining({ path: ['studentPhone'] })]);
    const none = await newLead(counsellor, { studentPhone: null });
    expect(none.status).toBe(400);
  });

  it('201: normalises contacts, owns the lead for the counsellor, opens an admission and a first-contact follow-up', async () => {
    const raw = phone();
    const res = await newLead(counsellor, {
      studentPhone: raw,
      studentEmail: '  Riya.T@Example.TEST ',
    });
    expect(res.status).toBe(201);
    expect(res.data?.lead.studentPhone).toBe(e164(raw));
    const [lead] = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, res.data!.lead.id as never));
    expect(lead).toMatchObject({
      studentEmail: 'riya.t@example.test',
      ownerStaffId: counsellor.staffId,
    });
    expect(lead?.acceptedAt).not.toBeNull();
    expect(res.data?.admission.status).toBe('new');
    const fus = await ctx.db.select().from(opsFollowUps).where(eq(opsFollowUps.leadId, lead!.id));
    expect(fus).toEqual([
      expect.objectContaining({
        kind: 'first_contact',
        ownerStaffId: counsellor.staffId,
        source: 'rule',
      }),
    ]);
  });

  it('exact duplicate (same phone typed differently) → 409 with matches; acknowledged → 201 + flag; never merged', async () => {
    const raw = phone();
    const first = await newLead(counsellor, { studentPhone: raw });
    const dup = await newLead(counsellor, {
      studentPhone: `+91 ${raw.slice(1, 6)} ${raw.slice(6)}`,
      studentName: 'Another Name (fictional)',
    });
    expect(dup.status).toBe(409);
    expect(
      (dup.error?.details as { duplicates: { code: string; level: string }[] }).duplicates[0],
    ).toMatchObject({ code: first.data!.lead.code, level: 'exact' });
    const ok = await newLead(counsellor, {
      studentPhone: raw,
      acknowledgeDuplicates: { reason: 'Twin sibling, different student' },
    });
    expect(ok.status).toBe(201);
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, ok.data!.lead.id as never));
    expect(flags).toEqual([
      expect.objectContaining({
        level: 'exact',
        status: 'open',
        acknowledgement: 'Twin sibling, different student',
      }),
    ]);
    const [orig] = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, first.data!.lead.id as never));
    expect(orig?.mergedIntoLeadId).toBeNull();
  });

  it('a shared guardian phone only is a POSSIBLE duplicate: saved with a warning, not blocked', async () => {
    const guardian = phone();
    await newLead(counsellor, { studentName: 'Kabir Shah (fictional)', guardianPhone: guardian });
    const res = await newLead(counsellor, {
      studentName: 'Anaya Shah (fictional)',
      guardianPhone: guardian,
    });
    expect(res.status).toBe(201);
    expect(res.data?.duplicates[0]).toMatchObject({ level: 'possible' });
  });

  it('duplicate preview hides names of leads the counsellor cannot open', async () => {
    const raw = phone();
    await newLead(otherCounsellor, { studentPhone: raw, studentName: 'Hidden Person (fictional)' });
    const res = await callRoute<{ matches: Created['duplicates'] }>(
      checkDuplicates,
      post(counsellor, '/ops/api/v1/leads/check-duplicates', {
        studentName: 'Someone (fictional)',
        studentPhone: raw,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.data?.matches[0]).toMatchObject({
      level: 'exact',
      accessible: false,
      studentName: null,
    });
  });
});

describe('own scope, assignment and contact', () => {
  it('counsellors see only their own leads; others get 403; managers see all', async () => {
    const mine = await newLead(counsellor);
    const theirs = await newLead(otherCounsellor);
    const list = await callRoute<{ id: string }[]>(
      listLeads,
      authedRequest(counsellor, '/ops/api/v1/leads'),
    );
    const ids = list.data!.map((l) => l.id);
    expect(ids).toContain(mine.data!.lead.id);
    expect(ids).not.toContain(theirs.data!.lead.id);
    expect(
      (await callRoute(getLead, authedRequest(counsellor, '/x'), { id: theirs.data!.lead.id }))
        .status,
    ).toBe(403);
    expect(
      (await callRoute(getLead, authedRequest(manager, '/x'), { id: theirs.data!.lead.id })).status,
    ).toBe(200);
  });

  it('assignment: counsellor 403; manager assigns → handoff pending → owner accepts', async () => {
    const lead = await newLead(manager, { ownerStaffId: null });
    const id = lead.data!.lead.id;
    expect(
      (
        await callRoute(assign, post(counsellor, '/x', { ownerStaffId: counsellor.staffId }), {
          id,
        })
      ).status,
    ).toBe(403);
    expect(
      (await callRoute(assign, post(manager, '/x', { ownerStaffId: counsellor.staffId }), { id }))
        .status,
    ).toBe(200);
    const detail = await callRoute<{ assignment: string }>(
      getLead,
      authedRequest(counsellor, '/x'),
      { id },
    );
    expect(detail.data?.assignment).toBe('handoff_pending');
    expect((await callRoute(accept, post(otherCounsellor, '/x', {}), { id })).status).toBe(403);
    expect((await callRoute(accept, post(counsellor, '/x', {}), { id })).status).toBe(200);
    expect(
      (await callRoute<{ assignment: string }>(getLead, authedRequest(counsellor, '/x'), { id }))
        .data?.assignment,
    ).toBe('accepted');
  });

  it('BR-OPS-4: an unanswered call changes nothing; a two-way contact moves new → contacted once', async () => {
    const lead = await newLead(counsellor);
    const id = lead.data!.lead.id;
    const miss = await callRoute<{ successful: boolean }>(
      activity,
      post(counsellor, '/x', { kind: 'call', outcome: 'no_answer' }),
      { id },
    );
    expect(miss.data?.successful).toBe(false);
    const hit = await callRoute<{ admissionsMovedToContacted: string[] }>(
      activity,
      post(counsellor, '/x', { kind: 'call', outcome: 'connected_two_way' }),
      { id },
    );
    expect(hit.status).toBe(201);
    expect(hit.data?.admissionsMovedToContacted).toEqual([lead.data!.admission.id]);
    const again = await callRoute<{ admissionsMovedToContacted: string[] }>(
      activity,
      post(counsellor, '/x', { kind: 'whatsapp', outcome: 'replied' }),
      { id },
    );
    expect(again.data?.admissionsMovedToContacted).toEqual([]);
  });

  it('a new enquiry for another programme opens a second admission case', async () => {
    const lead = await newLead(counsellor);
    const res = await callRoute<{ admission: { id: string } | null }>(
      enquiry,
      post(counsellor, '/x', { sourceCode: 'WEBINAR', programmeCode: 'IPMAT' }),
      { id: lead.data!.lead.id },
    );
    expect(res.status).toBe(201);
    expect(res.data?.admission).not.toBeNull();
    const same = await callRoute<{ admission: unknown }>(
      enquiry,
      post(counsellor, '/x', { sourceCode: 'REFERRAL', programmeCode: 'CLAT' }),
      { id: lead.data!.lead.id },
    );
    expect(same.data?.admission).toBeNull();
  });
});

describe('merge review (explicit, audited)', () => {
  it('counsellor 403; manager merges source into target keeping both enquiries; history records it', async () => {
    const raw = phone();
    const target = await newLead(counsellor, { studentPhone: raw, studentEmail: null });
    const source = await newLead(counsellor, {
      studentPhone: raw,
      studentEmail: uniqueEmail(),
      acknowledgeDuplicates: { reason: 'Checking later' },
    });
    const sid = source.data!.lead.id;
    expect(
      (
        await callRoute(
          merge,
          post(counsellor, '/x', { targetLeadId: target.data!.lead.id, note: 'same person' }),
          { id: sid },
        )
      ).status,
    ).toBe(403);
    const res = await callRoute(
      merge,
      post(manager, '/x', {
        targetLeadId: target.data!.lead.id,
        note: 'Same person, confirmed by phone',
      }),
      { id: sid },
    );
    expect(res.status).toBe(200);
    const [src] = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, sid as never));
    expect(src?.mergedIntoLeadId).toBe(target.data!.lead.id);
    const [tgt] = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, target.data!.lead.id as never));
    expect(tgt?.studentEmail).toBe(src?.studentEmail);
    const detail = await callRoute<{ enquiries: unknown[] }>(
      getLead,
      authedRequest(manager, '/x'),
      { id: target.data!.lead.id },
    );
    expect(detail.data?.enquiries).toHaveLength(2);
    const [srcAdmission] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.leadId, sid as never));
    expect(srcAdmission?.status).toBe('lost');
    const h = await callRoute<{ action: string }[]>(history, authedRequest(manager, '/x'), {
      id: sid,
    });
    expect(h.data?.map((e) => e.action)).toEqual(
      expect.arrayContaining(['lead.created', 'lead.merged', 'admission.transitioned']),
    );
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, sid as never));
    expect(flags[0]?.status).toBe('merged');
  });
});
