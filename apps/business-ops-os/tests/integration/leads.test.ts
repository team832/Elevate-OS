import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import {
  auditEvents,
  opsAdmissions,
  opsDuplicateFlags,
  opsFollowUps,
  opsLeads,
} from '@elevate/database';
import { GET as listLeads, POST as createLead } from '../../src/app/api/v1/leads/route';
import { GET as getLead, PATCH as patchLead } from '../../src/app/api/v1/leads/[id]/route';
import { POST as checkDuplicates } from '../../src/app/api/v1/leads/check-duplicates/route';
import { POST as assign } from '../../src/app/api/v1/leads/[id]/assign/route';
import { POST as accept } from '../../src/app/api/v1/leads/[id]/accept/route';
import { POST as activity } from '../../src/app/api/v1/leads/[id]/activities/route';
import { POST as enquiry } from '../../src/app/api/v1/leads/[id]/enquiries/route';
import { POST as merge } from '../../src/app/api/v1/leads/[id]/merge/route';
import { GET as history } from '../../src/app/api/v1/leads/[id]/history/route';
import { POST as dismissFlag } from '../../src/app/api/v1/leads/duplicates/[id]/route';
import { e164, phone, setupReference, staffUser, uniqueEmail, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
/** The other request of a staged race: it saves its lead when this one asks for a lead code. */
const race = vi.hoisted(() => ({ other: null as null | ((tx: never) => Promise<unknown>) }));
vi.mock('../../src/server/context', async (real) => {
  const mod = await real<typeof import('../../src/server/context')>();
  return {
    ...mod,
    nextCode: async (...a: Parameters<typeof mod.nextCode>) => {
      const other = a[1] === 'lead' ? race.other : null;
      race.other = null;
      await other?.(a[0] as never);
      return mod.nextCode(...a);
    },
  };
});
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

const status = async (
  route: Parameters<typeof callRoute>[0],
  req: Request,
  params?: Record<string, string>,
) => (await callRoute(route, req, params)).status;
const leadRow = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, id as never))
  )[0];

async function newLead(user: StaffUser, over: Record<string, unknown> = {}) {
  return callRoute<Created>(
    createLead,
    post(user, '/ops/api/v1/leads', {
      studentName: 'Riya Test',
      studentPhone: phone(),
      programmeCode: 'CLAT',
      sourceCode: 'WALK_IN',
      ...over,
    }),
  );
}

describe('POST /ops/api/v1/leads', () => {
  it('401 without a session, 403 for auditor and teacher, 400 with field paths for bad input', async () => {
    expect(await status(createLead, buildRequest('/ops/api/v1/leads', { json: {} }))).toBe(401);
    for (const role of ['auditor', 'teacher'] as const) {
      const user = await createTestUser(ctx.db, { roles: [role] });
      expect(await status(createLead, post(user, '/ops/api/v1/leads', {}))).toBe(403);
    }
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
    const lead = await leadRow(res.data!.lead.id);
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
      studentName: 'Another Name',
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
    expect((await leadRow(first.data!.lead.id))?.mergedIntoLeadId).toBeNull();
  });

  it('a shared guardian phone only is a POSSIBLE duplicate: saved with a warning, not blocked', async () => {
    const guardian = phone();
    await newLead(counsellor, { studentName: 'Kabir Shah', guardianPhone: guardian });
    const res = await newLead(counsellor, {
      studentName: 'Anaya Shah',
      guardianPhone: guardian,
    });
    expect(res.status).toBe(201);
    expect(res.data?.duplicates[0]).toMatchObject({ level: 'possible' });
  });

  it('duplicate preview hides names of leads the counsellor cannot open', async () => {
    const raw = phone();
    await newLead(otherCounsellor, { studentPhone: raw, studentName: 'Hidden Person' });
    const res = await callRoute<{ matches: Created['duplicates'] }>(
      checkDuplicates,
      post(counsellor, '/ops/api/v1/leads/check-duplicates', {
        studentName: 'Someone',
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

describe('duplicate warnings are shaped for the viewer (HAT-005)', () => {
  type Warning = Record<string, unknown>;
  const check = async (user: StaffUser, body: Warning) =>
    (
      await callRoute<{ matches: Warning[] }>(
        checkDuplicates,
        post(user, '/ops/api/v1/leads/check-duplicates', body),
      )
    ).data!.matches;
  const refused = async (user: StaffUser, body: Warning) =>
    ((await newLead(user, body)).error?.details as { duplicates: Warning[] }).duplicates;
  const ROUTES = [
    ['POST /leads/check-duplicates', check],
    ['the 409 of POST /leads', refused],
  ] as const;
  const DETAIL = ['leadId', 'code', 'nameSimilarity', 'signals', 'ownerName'];

  it.each(ROUTES)(
    '%s: a lead the caller cannot open is only a warning; one they can open has the detail',
    async (_, ask) => {
      const raw = phone();
      const { data } = await newLead(otherCounsellor, {
        studentPhone: raw,
        studentName: 'Hidden Person',
      });
      const body = { studentName: 'Hidden Person', studentPhone: raw };
      expect(await ask(counsellor, body)).toEqual([
        { accessible: false, level: 'exact', studentName: null },
      ]);
      for (const reader of [otherCounsellor, manager]) {
        const [seen] = await ask(reader, body);
        for (const field of DETAIL) expect(seen).toHaveProperty(field);
        expect(seen).toMatchObject({
          accessible: true,
          leadId: data!.lead.id,
          code: data!.lead.code,
          studentName: 'Hidden Person',
          nameSimilarity: 1,
        });
      }
    },
  );

  it.each([
    ['student', 'studentPhone', 'exact'],
    ['guardian', 'guardianPhone', 'possible'],
  ])(
    'a %s phone on a hidden lead answers the same for a wrong and a right name',
    async (_, field, level) => {
      const raw = phone();
      await newLead(otherCounsellor, { [field]: raw, studentName: 'Hidden Person' });
      for (const studentName of ['Completely Different', 'Hidden', 'Hidden Person'])
        expect(await check(counsellor, { studentName, [field]: raw })).toEqual([
          { accessible: false, level, studentName: null },
        ]);
    },
  );

  it('several hidden leads on one phone give one warning, so the count stays hidden', async () => {
    const raw = phone();
    await newLead(otherCounsellor, { studentPhone: raw });
    await newLead(otherCounsellor, {
      studentPhone: raw,
      acknowledgeDuplicates: { reason: 'Twin sibling, different student' },
    });
    expect(await check(counsellor, { studentName: 'Someone', studentPhone: raw })).toHaveLength(1);
    expect(await check(manager, { studentName: 'Someone', studentPhone: raw })).toHaveLength(2);
  });

  it('name and school alone: hidden from own scope, shown to a reader, still flagged for merge review', async () => {
    const probe = { studentName: 'Zara Hidden', previousSchool: `Test School ${phone()}` };
    await newLead(otherCounsellor, probe);
    expect(await check(counsellor, probe)).toEqual([]);
    expect(await check(manager, probe)).toEqual([
      expect.objectContaining({ accessible: true, level: 'possible' }),
    ]);
    const saved = await newLead(counsellor, probe);
    expect(saved.status).toBe(201);
    expect(saved.data?.duplicates).toEqual([]);
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, saved.data!.lead.id as never));
    expect(flags).toEqual([expect.objectContaining({ level: 'possible', status: 'open' })]);
  });

  it.each(ROUTES)(
    "%s: each check is audited in the actor's name, without a phone number or a name",
    async (_, ask) => {
      const raw = phone();
      const { data } = await newLead(otherCounsellor, {
        studentPhone: raw,
        studentName: 'Hidden Person',
      });
      await ask(counsellor, { studentName: 'Guessed Name', studentPhone: raw });
      const rows = await ctx.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, counsellor.id),
            eq(auditEvents.action, 'lead.duplicate_check'),
          ),
        );
      const row = rows.find((r) =>
        (r.metadata as { matchedLeadIds: string[] }).matchedLeadIds.includes(data!.lead.id),
      );
      expect(row?.metadata).toMatchObject({ searchedOn: ['studentPhone'], results: 1 });
      const text = JSON.stringify(row);
      for (const secret of [raw, e164(raw), 'Guessed Name', 'Hidden Person'])
        expect(text).not.toContain(secret);
    },
  );
});

describe('a saved duplicate flag is shaped for the reader too (HAT-005)', () => {
  type Row = Record<string, unknown>;
  const flagged = async (first: StaffUser, second: StaffUser) => {
    const raw = phone();
    const older = (await newLead(first, { studentPhone: raw })).data!.lead;
    const newer = (
      await newLead(second, {
        studentPhone: raw,
        acknowledgeDuplicates: { reason: 'Twin sibling, different student' },
      })
    ).data!.lead;
    return { older, newer };
  };
  const PATHS = [
    [
      'the flag list',
      async (user: StaffUser, id: string) =>
        (await callRoute<{ duplicates: Row[] }>(getLead, authedRequest(user, '/x'), { id })).data!
          .duplicates,
    ],
    [
      'the history',
      async (user: StaffUser, id: string) =>
        (await callRoute<Row[]>(history, authedRequest(user, '/x'), { id })).data!,
    ],
  ] as const;
  const DIRECTIONS = [
    ['the newer lead, whose flag points out', 'newer', 'older', () => counsellor],
    ['the older lead, whose flag points in', 'older', 'newer', () => otherCounsellor],
  ] as const;
  const CASES = PATHS.flatMap(([path, read]) =>
    DIRECTIONS.map(([where, own, other, reader]) => [path, where, read, own, other, reader] as const),
  );
  const secretsOf = (lead: { id: string; code: string }) => [lead.id, lead.code, 'student_phone'];

  it.each(CASES)('%s of %s has nothing of a lead the reader cannot open', async (...c) => {
    const [, , read, own, other, reader] = c;
    const pair = await flagged(otherCounsellor, counsellor);
    const text = JSON.stringify(await read(reader(), pair[own].id));
    for (const secret of secretsOf(pair[other])) expect(text).not.toContain(secret);
  });

  it.each(DIRECTIONS)('%s still warns that a flag exists', async (_, own, __, reader) => {
    const pair = await flagged(otherCounsellor, counsellor);
    const { data } = await callRoute<{ duplicates: Row[] }>(getLead, authedRequest(reader(), '/x'), {
      id: pair[own].id,
    });
    expect(data!.duplicates).toEqual([{ level: 'exact', status: 'open', otherAccessible: false }]);
  });

  it.each(CASES)('%s of %s keeps the detail for a reader of both leads', async (...c) => {
    const [, , read, own, other] = c;
    for (const [first, reader] of [
      [counsellor, counsellor],
      [otherCounsellor, manager],
    ] as const) {
      const pair = await flagged(first, counsellor);
      const text = JSON.stringify(await read(reader, pair[own].id));
      // The older lead's own history names no match: only the newer one was created with a flag.
      if (c[0] === 'the flag list' || own === 'newer') {
        expect(text).toContain(pair[other].code);
        expect(text).toContain('student_phone');
      }
    }
  });

  it('a dismissed flag keeps its status for the owner, and its audit row hides the other lead', async () => {
    const pair = await flagged(otherCounsellor, counsellor);
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, pair.newer.id as never));
    expect(
      await status(
        dismissFlag,
        post(manager, '/x', { decision: 'dismissed', note: 'Two different people' }),
        { id: flags[0]!.id },
      ),
    ).toBe(200);
    const [, readHistory] = PATHS[1];
    const rows = await readHistory(counsellor, pair.newer.id);
    expect(rows.find((r) => r.action === 'duplicate.dismissed')?.after).toMatchObject({
      status: 'dismissed',
    });
    const text = JSON.stringify(rows);
    for (const secret of [...secretsOf(pair.older), 'Two different people'])
      expect(text).not.toContain(secret);
    expect(JSON.stringify(await readHistory(manager, pair.newer.id))).toContain(pair.older.id);
  });

  it('several hidden flags are one warning, so the count stays hidden', async () => {
    const raw = phone();
    await newLead(otherCounsellor, { studentPhone: raw });
    const ack = { acknowledgeDuplicates: { reason: 'Twin sibling, different student' } };
    await newLead(otherCounsellor, { studentPhone: raw, ...ack });
    const mine = await newLead(counsellor, { studentPhone: raw, ...ack });
    const { data } = await callRoute<{ duplicates: Row[] }>(getLead, authedRequest(counsellor, '/x'), {
      id: mine.data!.lead.id,
    });
    expect(data!.duplicates).toHaveLength(1);
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
    const id = { id: theirs.data!.lead.id };
    expect(await status(getLead, authedRequest(counsellor, '/x'), id)).toBe(403);
    expect(await status(getLead, authedRequest(manager, '/x'), id)).toBe(200);
  });

  it.each([{ stageKey: 'contacted' }, { stage: 'contacted' }])(
    'PATCH refuses %o with 400 (stage changes go through the stage route); details still save',
    async (stage) => {
      const id = { id: (await newLead(counsellor)).data!.lead.id };
      const patch = (json: unknown) =>
        callRoute(patchLead, authedRequest(counsellor, '/x', { method: 'PATCH', json }), id);
      expect((await patch({ notes: 'Sample note', ...stage })).status).toBe(400);
      expect((await patch({ notes: 'Sample note' })).status).toBe(200);
    },
  );

  it('campaign references show only to roles allowed to see marketing attribution', async () => {
    const lead = await newLead(counsellor, { campaignRef: 'test-only-campaign' });
    const id = { id: lead.data!.lead.id };
    const later = { sourceCode: 'WEBINAR', contentRef: 'test-only-campaign' };
    expect(await status(enquiry, post(counsellor, '/x', later), id)).toBe(201);
    const as = async (user: StaffUser) =>
      JSON.stringify((await callRoute(getLead, authedRequest(user, '/x'), id)).data);
    // Neither the enquiry nor the audit history (enquiry.created) shows it to the counsellor.
    expect(await as(counsellor)).not.toContain('test-only-campaign');
    expect(await as(manager)).toContain('test-only-campaign');
  });

  it('assignment: counsellor 403; manager assigns → handoff pending → owner accepts', async () => {
    const lead = await newLead(manager, { ownerStaffId: null });
    const id = lead.data!.lead.id;
    const owner = { ownerStaffId: counsellor.staffId };
    const assignment = async () =>
      (await callRoute<{ assignment: string }>(getLead, authedRequest(counsellor, '/x'), { id }))
        .data?.assignment;
    expect(await status(assign, post(counsellor, '/x', owner), { id })).toBe(403);
    expect(await status(assign, post(manager, '/x', owner), { id })).toBe(200);
    expect(await assignment()).toBe('handoff_pending');
    expect(await status(accept, post(otherCounsellor, '/x', {}), { id })).toBe(403);
    expect(await status(accept, post(counsellor, '/x', {}), { id })).toBe(200);
    expect(await assignment()).toBe('accepted');
  });

  it('BR-OPS-4: an unanswered call changes nothing; a two-way contact moves new → contacted once and closes the first-contact follow-up', async () => {
    const lead = await newLead(counsellor);
    const id = lead.data!.lead.id;
    const firstContact = async () =>
      (
        await ctx.db
          .select()
          .from(opsFollowUps)
          .where(and(eq(opsFollowUps.leadId, id as never), eq(opsFollowUps.kind, 'first_contact')))
      )[0]!;
    const miss = await callRoute<{ successful: boolean }>(
      activity,
      post(counsellor, '/x', { kind: 'call', outcome: 'no_answer' }),
      { id },
    );
    expect(miss.data?.successful).toBe(false);
    expect((await firstContact()).status).toBe('open');
    const hit = await callRoute<{ admissionsMovedToContacted: string[] }>(
      activity,
      post(counsellor, '/x', { kind: 'call', outcome: 'connected_two_way' }),
      { id },
    );
    expect(hit.status).toBe(201);
    expect(hit.data?.admissionsMovedToContacted).toEqual([lead.data!.admission.id]);
    const done = await firstContact();
    expect(done).toMatchObject({
      status: 'done',
      outcome: 'First successful contact (call)',
      completedBy: counsellor.id,
    });
    expect(
      await ctx.db.$count(
        auditEvents,
        and(eq(auditEvents.entityId, done.id), eq(auditEvents.action, 'followup.completed')),
      ),
    ).toBe(1);
    const again = await callRoute<{ admissionsMovedToContacted: string[] }>(
      activity,
      post(counsellor, '/x', { kind: 'whatsapp', outcome: 'replied' }),
      { id },
    );
    expect(again.data?.admissionsMovedToContacted).toEqual([]);
  });

  it('flags: a new lead is new this week and awaiting contact until a two-way contact', async () => {
    const id = (await newLead(counsellor)).data!.lead.id;
    const ids = async (flag: string) =>
      (
        await callRoute<{ id: string }[]>(
          listLeads,
          authedRequest(counsellor, `/ops/api/v1/leads?flag=${flag}`),
        )
      ).data?.map((l) => l.id);
    expect(await ids('new_this_week')).toContain(id);
    expect(await ids('awaiting_contact')).toContain(id);
    await callRoute(
      activity,
      post(counsellor, '/x', { kind: 'call', outcome: 'connected_two_way' }),
      {
        id,
      },
    );
    expect(await ids('awaiting_contact')).not.toContain(id);
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
    const asCounsellor = { targetLeadId: target.data!.lead.id, note: 'same person' };
    expect(await status(merge, post(counsellor, '/x', asCounsellor), { id: sid })).toBe(403);
    const res = await callRoute(
      merge,
      post(manager, '/x', {
        targetLeadId: target.data!.lead.id,
        note: 'Same person, confirmed by phone',
      }),
      { id: sid },
    );
    expect(res.status).toBe(200);
    const src = await leadRow(sid);
    expect(src?.mergedIntoLeadId).toBe(target.data!.lead.id);
    const call = { kind: 'call', outcome: 'no_answer' };
    expect(await status(activity, post(manager, '/x', call), { id: sid })).toBe(409);
    expect(await status(accept, post(manager, '/x', {}), { id: sid })).toBe(409);
    expect((await leadRow(target.data!.lead.id))?.studentEmail).toBe(src?.studentEmail);
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

describe('duplicate check under races and volume', () => {
  it('a lead another request saved while this one waited for the code lock gives 409, not a second lead (C4-1)', async () => {
    const raw = phone();
    // PGlite runs one transaction at a time, so the race is staged inside the lock request.
    race.other = (tx: typeof ctx.db) =>
      tx.insert(opsLeads).values({
        code: 'LEAD-700000',
        studentName: 'Sample Parallel Lead',
        studentPhone: e164(raw),
        firstReceivedAt: new Date(),
        isSample: true,
        createdBy: counsellor.id,
      });
    expect((await newLead(counsellor, { studentPhone: raw })).status).toBe(409);
    expect(await ctx.db.$count(opsLeads, eq(opsLeads.studentPhone, e164(raw)))).toBe(1);
  });

  it('an exact phone match is found past 2,000 leads with a school (C4-2)', async () => {
    await ctx.db.execute(sql`
      insert into ops.leads (code, student_name, student_email, previous_school, first_received_at, is_sample, created_by)
      select 'LEAD-' || (900000 + g), 'Sample School Lead ' || g, 'sample.school.' || g || '@example.test',
             'Sample Public School', now(), true, ${manager.id}
      from generate_series(1, 2001) g`);
    const raw = phone();
    expect((await newLead(counsellor, { studentPhone: raw })).status).toBe(201);
    const dup = await newLead(counsellor, {
      studentPhone: raw,
      studentName: 'Another Name',
      previousSchool: 'Sample Public School',
    });
    expect(dup.status).toBe(409);
  });
});
