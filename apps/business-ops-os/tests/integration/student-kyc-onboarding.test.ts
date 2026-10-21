/**
 * Student profile KYC and onboarding (owner brief §8, acceptance 13, 21): identity documents
 * masked-only and permissioned, guardian primary flag, sibling links without merging, onboarding
 * checklist from versioned templates with audited status changes and material issues.
 * Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import {
  auditEvents,
  opsAdmissions,
  opsGuardians,
  opsKycDocuments,
  opsOnboardingItems,
  students,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as getStudent } from '../../src/app/api/v1/students/[id]/route';
import { POST as addGuardian } from '../../src/app/api/v1/students/[id]/guardians/route';
import { PATCH as editGuardian } from '../../src/app/api/v1/students/[id]/guardians/[guardianId]/route';
import { GET as readKyc, POST as recordDoc } from '../../src/app/api/v1/students/[id]/kyc/route';
import { POST as verifyDoc } from '../../src/app/api/v1/students/[id]/kyc/[documentId]/route';
import { POST as linkSibling } from '../../src/app/api/v1/students/[id]/siblings/route';
import {
  GET as readOnboarding,
  POST as changeChecklist,
} from '../../src/app/api/v1/students/[id]/onboarding/route';
import { POST as itemStatus } from '../../src/app/api/v1/students/[id]/onboarding/[itemId]/route';
import { POST as material } from '../../src/app/api/v1/students/[id]/materials/route';
import {
  GET as listTemplates,
  POST as publishTemplate,
} from '../../src/app/api/v1/onboarding-templates/route';
import { istToday } from '../../src/domain';
import { publishTemplateVersion } from '../../src/server/onboarding';
import { PROPOSED_TEMPLATE, seedOnboardingTemplates } from '../../seed/onboarding-templates';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { get, pendingCase, post } from './admissions-fixtures';

const ctx = setupTestDatabase();
let counsellor: StaffUser;
let counsellor2: StaffUser;
let manager: StaffUser;
let coordinator: TestUser;
let director: TestUser;

/** A lead walked to admission_pending, then admitted onto a new canonical student (fixture). */
async function admittedStudent(programmeCode = 'CLAT', studentId?: string, owner = counsellor) {
  const c = await pendingCase(owner, { programmeCode });
  const id =
    studentId ??
    (await ctx.db.insert(students).values({ fullName: 'Kyc Test Student' }).returning())[0]!.id;
  await ctx.db
    .update(opsAdmissions)
    .set({
      studentId: id as never,
      status: 'admitted',
      admittedAt: new Date(),
      admissionDate: istToday(new Date()),
    })
    .where(eq(opsAdmissions.id, c.admissionId as never));
  return { studentId: id as string, admissionId: c.admissionId };
}

const patch = (user: { token: string }, json: unknown) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'PATCH', json });
const doc = (user: { token: string }, id: string, body: unknown) =>
  callRoute<{ id: string; verificationStatus: string }>(recordDoc, post(user, body), { id });
const auditOf = (entityId: string, action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'KYC Manager' });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'KYC Counsellor' });
  counsellor2 = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Other Counsellor' });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  director = await createTestUser(ctx.db, { roles: ['director'] });
});

describe('identity documents (acceptance 21)', () => {
  it('masked reference only; a new entry is unverified and replaces the old one', async () => {
    const s = await admittedStudent();
    const body = {
      subjectType: 'student',
      documentType: 'aadhaar',
      maskedReference: 'XXXX-XXXX-1234',
    };
    expect(
      (
        await callRoute(recordDoc, buildRequest('/x', { method: 'POST', json: body }), {
          id: s.studentId,
        })
      ).status,
    ).toBe(401);
    expect((await doc(coordinator, s.studentId, body)).status).toBe(403);
    for (const maskedReference of ['1234 5678 9012', '123456789012', 'ABCDE1234F'])
      expect((await doc(counsellor, s.studentId, { ...body, maskedReference })).status).toBe(400);
    expect(
      (await doc(counsellor, s.studentId, { ...body, documentType: 'ration_card' })).status,
    ).toBe(400);
    expect((await doc(counsellor, s.studentId, { ...body, subjectType: 'guardian' })).status).toBe(
      400,
    );
    const first = await doc(counsellor, s.studentId, body);
    expect(first.status).toBe(201);
    expect(first.data?.verificationStatus).toBe('unverified');
    const second = await doc(counsellor, s.studentId, {
      ...body,
      maskedReference: 'XXXX-XXXX-9876',
    });
    expect(second.status).toBe(201);
    const rows = await ctx.db
      .select()
      .from(opsKycDocuments)
      .where(eq(opsKycDocuments.studentId, s.studentId as never));
    expect(rows.find((r) => r.id === first.data!.id)?.supersededById).toBe(second.data!.id);
    expect(rows.filter((r) => !r.supersededAt)).toHaveLength(1);
    expect(await auditOf(s.studentId, 'kyc.document_recorded')).toHaveLength(2);
  });

  it('verification needs ops:kyc:verify; only once; rejection needs a note', async () => {
    const s = await admittedStudent();
    const d = await doc(counsellor, s.studentId, {
      subjectType: 'student',
      documentType: 'pan',
      maskedReference: 'XXXXX1234X',
    });
    const verify = (user: { token: string }, json: unknown) =>
      callRoute<{ verificationStatus: string; verifiedBy: string }>(verifyDoc, post(user, json), {
        id: s.studentId,
        documentId: d.data!.id,
      });
    expect((await verify(counsellor, { status: 'verified' })).status).toBe(403);
    expect((await verify(manager, { status: 'rejected' })).status).toBe(400);
    const ok = await verify(manager, { status: 'verified' });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ verificationStatus: 'verified', verifiedBy: manager.id });
    expect((await verify(manager, { status: 'rejected', note: 'Blurred copy' })).status).toBe(409);
    expect(await auditOf(s.studentId, 'kyc.document_verified')).toHaveLength(1);
  });

  it('unauthorised roles cannot read documents: 403 on the KYC route, nothing in the profile', async () => {
    const s = await admittedStudent();
    await doc(counsellor, s.studentId, {
      subjectType: 'student',
      documentType: 'passport',
      maskedReference: 'XXXXXX789',
    });
    expect((await callRoute(readKyc, get(coordinator), { id: s.studentId })).status).toBe(403);
    expect((await callRoute(readKyc, get(director), { id: s.studentId })).status).toBe(403);
    const own = await callRoute<{ documents: { maskedReference: string }[]; history: unknown[] }>(
      readKyc,
      get(counsellor),
      { id: s.studentId },
    );
    expect(own.status).toBe(200);
    expect(own.data?.documents[0]?.maskedReference).toBe('XXXXXX789');
    expect(own.data?.history.length).toBeGreaterThan(0);
    const profile = await callRoute(getStudent, get(coordinator), { id: s.studentId });
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.data)).not.toContain('XXXXXX789');
  });
});

describe('guardians: exactly one live primary', () => {
  it('first is primary; the flag moves; the primary cannot be archived or unset while others exist', async () => {
    const s = await admittedStudent();
    const add = (body: object) =>
      callRoute<{ id: string; isPrimary: boolean }>(
        addGuardian,
        post(counsellor, {
          fullName: 'Guardian One',
          relationship: 'mother',
          phone: '098765 11111',
          ...body,
        }),
        { id: s.studentId },
      );
    const g1 = await add({});
    expect(g1.data?.isPrimary).toBe(true);
    const g2 = await add({
      fullName: 'Guardian Two',
      relationship: 'father',
      isPrimary: true,
      isEmergency: true,
      address: 'Test Lane 1',
    });
    expect(g2.status).toBe(201);
    const edit = (gid: string, body: object) =>
      callRoute(editGuardian, patch(counsellor, body), { id: s.studentId, guardianId: gid });
    expect((await edit(g2.data!.id, { archived: true })).status).toBe(400);
    expect((await edit(g2.data!.id, { isPrimary: false })).status).toBe(400);
    expect((await edit(g1.data!.id, { isPrimary: true })).status).toBe(200);
    expect((await edit(g2.data!.id, { archived: true })).status).toBe(200);
    const live = await ctx.db
      .select()
      .from(opsGuardians)
      .where(
        and(eq(opsGuardians.studentId, s.studentId as never), isNull(opsGuardians.archivedAt)),
      );
    expect(live.map((g) => [g.id, g.isPrimary])).toEqual([[g1.data!.id, true]]);
    const history = JSON.stringify(await auditOf(s.studentId, 'guardian.added'));
    expect(history).not.toContain('9876511111');
    expect(history).not.toContain('Test Lane');
  });
});

describe('siblings', () => {
  it('a link never merges records; duplicates and self-links are refused', async () => {
    const a = await admittedStudent();
    const b = await admittedStudent();
    const link = (user: { token: string }, from: string, to: string) =>
      callRoute(linkSibling, post(user, { siblingStudentId: to }), { id: from });
    expect((await link(coordinator, a.studentId, b.studentId)).status).toBe(403);
    expect((await link(counsellor, a.studentId, a.studentId)).status).toBe(400);
    expect((await link(counsellor, a.studentId, b.studentId)).status).toBe(201);
    expect((await link(counsellor, b.studentId, a.studentId)).status).toBe(409);
    // Another counsellor's student, or an unknown id: the same 404 (nothing leaks).
    const other = await admittedStudent('CLAT', undefined, counsellor2);
    expect((await link(counsellor, a.studentId, other.studentId)).status).toBe(404);
    expect((await link(counsellor, a.studentId, crypto.randomUUID())).status).toBe(404);
    const both = await ctx.db.select().from(students);
    expect(both.filter((x) => [a.studentId, b.studentId].includes(x.id))).toHaveLength(2);
    const [admA] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, a.admissionId as never));
    expect(admA?.studentId).toBe(a.studentId);
    const kyc = await callRoute<{ siblings: { studentId: string }[] }>(readKyc, get(counsellor), {
      id: b.studentId,
    });
    expect(kyc.data?.siblings.map((x) => x.studentId)).toEqual([a.studentId]);
  });
});

type Item = {
  id: string;
  itemKey: string;
  label: string;
  templateVersion: number | null;
  status: string;
  kind: string;
};
const checklist = async (user: { token: string }, id: string) =>
  (
    await callRoute<{ items: Item[]; materials: { complete: boolean | null } }>(
      readOnboarding,
      get(user),
      { id },
    )
  ).data!;

describe('onboarding checklist (acceptance 13)', () => {
  it('multi-programme union, audited status changes, materials, template v2 never rewrites v1', async () => {
    await publishTemplateVersion(ctx.db, manager, {
      code: 'test_clat',
      programmeCodes: ['CLAT'],
      classCategory: null,
      items: [
        { key: 'id_card', label: 'ID card issued', kind: 'check', dueDays: -2 },
        {
          key: 'clat_books',
          label: 'CLAT books',
          kind: 'material',
          catalogueCode: 'clat_books',
          programmeCode: 'CLAT',
          requiredQuantity: 2,
        },
      ],
    });
    await publishTemplateVersion(ctx.db, manager, {
      code: 'test_class_12',
      programmeCodes: ['CLASS_12'],
      classCategory: 'class_12',
      items: [
        { key: 'id_card', label: 'ID card (duplicate key)', kind: 'check' },
        { key: 'c12_books', label: 'Class 12 books', kind: 'material', programmeCode: 'CLASS_12' },
      ],
    });
    const s = await admittedStudent('CLAT');
    await admittedStudent('CLASS_12', s.studentId);
    const gen = (user: { token: string }) =>
      callRoute<{ added: string[] }>(
        changeChecklist,
        post(user, { action: 'generate', admissionId: s.admissionId }),
        { id: s.studentId },
      );
    expect((await gen(coordinator)).status).toBe(403);
    expect((await gen(counsellor)).data?.added.sort()).toEqual([
      'c12_books',
      'clat_books',
      'id_card',
    ]);
    expect((await gen(counsellor)).data?.added).toEqual([]);
    let list = await checklist(coordinator, s.studentId);
    const byKey = (k: string) => list.items.find((i) => i.itemKey === k)!;
    expect(byKey('id_card').label).toBe('ID card (duplicate key)'); // first template by code wins

    const status = (itemId: string, json: object) =>
      callRoute(itemStatus, post(counsellor, json), { id: s.studentId, itemId });
    expect((await status(byKey('id_card').id, { status: 'blocked' })).status).toBe(400);
    expect(
      (await status(byKey('id_card').id, { status: 'blocked', note: 'Photo pending' })).status,
    ).toBe(201);
    expect(
      (await status(byKey('id_card').id, { status: 'completed', evidenceRef: 'IDC-0042' })).status,
    ).toBe(201);
    expect((await status(byKey('clat_books').id, { status: 'completed' })).status).toBe(400);
    expect(await auditOf(s.admissionId, 'onboarding.item_status')).toHaveLength(2);

    const move = (itemId: string, kind: string, quantity = 1) =>
      callRoute(
        material,
        post(counsellor, { itemId, kind, quantity, issuedOn: '2026-10-21', edition: '2026' }),
        { id: s.studentId },
      );
    expect((await move(byKey('clat_books').id, 'return')).status).toBe(400);
    expect((await move(byKey('id_card').id, 'issue')).status).toBe(400);
    expect((await move(byKey('clat_books').id, 'issue')).status).toBe(201);
    list = await checklist(counsellor, s.studentId);
    expect(byKey('clat_books').status).toBe('in_progress'); // 1 of 2 books: one book is not all
    expect((await status(byKey('clat_books').id, { status: 'completed' })).status).toBe(400);
    expect((await move(byKey('clat_books').id, 'issue')).status).toBe(201);
    list = await checklist(counsellor, s.studentId);
    expect(byKey('clat_books').status).toBe('completed');
    expect(list.materials.complete).toBe(false); // the CLAT set is issued, the Class 12 set is not
    expect((await move(byKey('c12_books').id, 'issue')).status).toBe(201);
    expect((await checklist(counsellor, s.studentId)).materials.complete).toBe(true);

    await publishTemplateVersion(ctx.db, manager, {
      code: 'test_clat',
      programmeCodes: ['CLAT'],
      classCategory: null,
      items: [
        { key: 'clat_books', label: 'CLAT books v2 wording', kind: 'material' },
        { key: 'mock_kit', label: 'Mock test kit', kind: 'material' },
      ],
    });
    expect((await gen(counsellor)).data?.added).toEqual(['mock_kit']);
    list = await checklist(counsellor, s.studentId);
    expect([byKey('clat_books').label, byKey('clat_books').templateVersion]).toEqual([
      'CLAT books',
      1,
    ]);
    expect(byKey('mock_kit').templateVersion).toBe(2);
  });

  it('explicit item added by hand (recorded); 401 / 400; no template → clear message', async () => {
    const s = await admittedStudent('CUET');
    const call = (user: { token: string } | null, json: object) =>
      callRoute(
        changeChecklist,
        user ? post(user, json) : buildRequest('/x', { method: 'POST', json }),
        { id: s.studentId },
      );
    expect((await call(null, { action: 'generate', admissionId: s.admissionId })).status).toBe(401);
    const none = await callRoute<unknown>(
      changeChecklist,
      post(counsellor, { action: 'generate', admissionId: s.admissionId }),
      { id: s.studentId },
    );
    expect(none.status).toBe(400);
    expect(
      (
        await call(counsellor, {
          action: 'add',
          admissionId: s.admissionId,
          itemKey: 'Bad Key',
          label: 'x',
          kind: 'check',
        })
      ).status,
    ).toBe(400);
    const add = {
      action: 'add',
      admissionId: s.admissionId,
      itemKey: 'hostel_form',
      label: 'Hostel form',
      kind: 'check',
    };
    expect((await call(counsellor, add)).status).toBe(201);
    expect((await call(counsellor, add)).status).toBe(409);
    const [row] = await ctx.db
      .select()
      .from(opsOnboardingItems)
      .where(eq(opsOnboardingItems.admissionId, s.admissionId as never));
    expect(row).toMatchObject({ addedExplicitly: true, templateId: null });
    expect(await auditOf(s.admissionId, 'onboarding.item_added')).toHaveLength(1);
  });

  it('templates route: 401 / 403 / 400 / 201, new version retires the old one', async () => {
    const body = {
      code: 'route_tpl',
      programmeCodes: ['CLAT'],
      classCategory: null,
      items: [{ key: 'clat_set', label: 'CLAT set', kind: 'material', programmeCode: 'CLAT' }],
    };
    const publish = (user: { token: string } | null, json: unknown) =>
      callRoute<{ version: number }>(
        publishTemplate,
        user ? post(user, json) : buildRequest('/x', { method: 'POST', json }),
      );
    expect((await publish(null, body)).status).toBe(401);
    expect((await publish(counsellor, body)).status).toBe(403);
    for (const bad of [
      { ...body, programmeCodes: ['NOT_A_PROGRAMME'] },
      { ...body, items: [{ ...body.items[0], programmeCode: 'IPMAT' }] },
      { ...body, items: [{ key: 'id', label: 'ID', kind: 'check', requiredQuantity: 2 }] },
      { ...body, items: [body.items[0], body.items[0]] },
    ])
      expect((await publish(manager, bad)).status).toBe(400);
    expect((await publish(manager, body)).data?.version).toBe(1);
    expect((await publish(manager, body)).data?.version).toBe(2);
    const listed = await callRoute<{ id: string; code: string; version: number; status: string }[]>(
      listTemplates,
      get(manager),
    );
    expect(
      listed.data?.filter((t) => t.code === 'route_tpl').map((t) => [t.version, t.status]),
    ).toEqual([
      [2, 'active'],
      [1, 'retired'],
    ]);
    expect(
      await auditOf(
        listed.data!.find((t) => t.code === 'route_tpl')!.id as never,
        'onboarding.template_published',
      ),
    ).toHaveLength(1);
  });

  it('the proposed template seeds once (one material set per programme) and never overwrites', async () => {
    const first = await seedOnboardingTemplates(ctx.db, manager.id);
    expect(first).toMatchObject({ code: PROPOSED_TEMPLATE.code, version: 1, status: 'active' });
    expect(
      first!.items
        .filter((i) => i.kind === 'material')
        .map((i) => (i as { programmeCode?: string }).programmeCode),
    ).toContain('CLAT');
    expect(await seedOnboardingTemplates(ctx.db, manager.id)).toBeNull();
  });
});

describe('own scope: another counsellor gets 403 on every new route', () => {
  let s: { studentId: string; admissionId: string };
  let docId: string;
  let itemId: string;
  beforeAll(async () => {
    s = await admittedStudent();
    docId = (
      await doc(counsellor, s.studentId, {
        subjectType: 'student',
        documentType: 'aadhaar',
        maskedReference: 'XXXX-XXXX-4321',
      })
    ).data!.id;
    await callRoute(
      changeChecklist,
      post(counsellor, {
        action: 'add',
        admissionId: s.admissionId,
        itemKey: 'books',
        label: 'Books',
        kind: 'material',
      }),
      { id: s.studentId },
    );
    itemId = (await checklist(counsellor, s.studentId)).items[0]!.id;
  });

  it.each([
    ['GET kyc', () => callRoute(readKyc, get(counsellor2), { id: s.studentId })],
    [
      'POST kyc',
      () =>
        doc(counsellor2, s.studentId, {
          subjectType: 'student',
          documentType: 'pan',
          maskedReference: 'XXXXX1234X',
        }),
    ],
    [
      'POST kyc/[documentId] (no ops:kyc:verify)',
      () =>
        callRoute(verifyDoc, post(counsellor2, { status: 'verified' }), {
          id: s.studentId,
          documentId: docId,
        }),
    ],
    [
      'POST siblings',
      () =>
        callRoute(linkSibling, post(counsellor2, { siblingStudentId: crypto.randomUUID() }), {
          id: s.studentId,
        }),
    ],
    ['GET onboarding', () => callRoute(readOnboarding, get(counsellor2), { id: s.studentId })],
    [
      'POST onboarding',
      () =>
        callRoute(
          changeChecklist,
          post(counsellor2, { action: 'generate', admissionId: s.admissionId }),
          { id: s.studentId },
        ),
    ],
    [
      'POST onboarding/[itemId]',
      () =>
        callRoute(itemStatus, post(counsellor2, { status: 'in_progress' }), {
          id: s.studentId,
          itemId,
        }),
    ],
    [
      'POST materials',
      () =>
        callRoute(
          material,
          post(counsellor2, { itemId, kind: 'issue', quantity: 1, issuedOn: '2026-10-21' }),
          { id: s.studentId },
        ),
    ],
    [
      'POST onboarding-templates (no ops:settings:manage)',
      () =>
        callRoute(
          publishTemplate,
          post(counsellor2, {
            code: 'x_tpl',
            programmeCodes: ['CLAT'],
            classCategory: null,
            items: [{ key: 'id_card', label: 'ID card', kind: 'check' }],
          }),
        ),
    ],
  ])('%s → 403', async (_, call) => {
    expect((await call()).status).toBe(403);
  });
});
