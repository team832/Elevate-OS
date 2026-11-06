/**
 * Student and parent portal (F4-13), end to end on PGlite with real Academic data:
 * - every page and the receipt file show only the login's live linked students: any other id,
 *   a malformed id or two ids is 404 (page by page);
 * - setup code once → password → sign-in sets only the portal cookie; staff and portal sessions
 *   never open each other; a staff user is sent away from /portal;
 * - setting portal.enabled off → "not open yet", sign-in refused, files 404;
 * - shared sign-in limit; published results only, ranks only when Academic shows them.
 * next/headers and next/navigation are stubbed; sessions, data and limits are real. Fictional data.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHmac } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  createSession,
  getUserFromRequest,
  hashPassword,
  issueSetupCode,
  LoginThrottle,
  PORTAL_COOKIE,
  SESSION_COOKIE,
  validatePortalSession,
} from '@elevate/authentication';
import {
  academicClassSessions,
  academicSettings,
  academicStudents,
  programmes,
  staffMembers,
  loginAttempts,
  opsGuardians,
  opsSettings,
  portalAccounts,
  students,
  userRoles,
  users,
} from '@elevate/database';
import {
  createAssignment,
  createBatch,
  createCourse,
  createSessions,
  createStudent,
  createSubject,
  enrolManually,
  recordAttendance,
} from '@elevate/academic-os/server';
import { addDays, toIsoDate, type UserId } from '@elevate/shared-types';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  testSessionSecret,
} from '@elevate/testing';
import { POST as createTest } from '../../../academic-os/src/app/api/v1/assessments/route';
import { POST as addKey } from '../../../academic-os/src/app/api/v1/assessments/[id]/answer-keys/route';
import { POST as saveAttempts } from '../../../academic-os/src/app/api/v1/assessments/[id]/attempts/route';
import { POST as finalise } from '../../../academic-os/src/app/api/v1/assessments/[id]/finalise/route';
import { POST as publish } from '../../../academic-os/src/app/api/v1/assessments/[id]/publish/route';

const jar = vi.hoisted(() => ({
  portal: undefined as string | undefined,
  staff: undefined as string | undefined,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value =
        name === 'elevate_portal' ? jar.portal : name === 'elevate_session' ? jar.staff : undefined;
      return value ? { value } : undefined;
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({}),
}));
// Receipts (FX-DOCS) are stubbed: this file tests who may fetch which payment's file.
const receipts = vi.hoisted(() => ({
  owners: new Map<string, string>(),
  rendered: [] as string[],
  counted: [] as unknown[],
  adults: new Set<string>(),
}));
vi.mock('@elevate/business-ops-os/server', async (original) => ({
  ...(await original<typeof import('@elevate/business-ops-os/server')>()),
  feeRecordStudentId: async (_db: unknown, id: string) => receipts.owners.get(id) ?? null,
  receiptFor: async (_db: unknown, id: string) =>
    receipts.owners.has(id) ? { receiptNumber: 'R/2026-27/0001' } : null,
  renderReceiptPdf: async (_db: unknown, id: string, _size: unknown, counted: unknown) => {
    receipts.rendered.push(id);
    receipts.counted.push(counted);
    return new TextEncoder().encode('%PDF-1.7 test-only');
  },
  // Ages come from Ops enquiries (tested there); here: who counts as 18 or over.
  isAdultStudent: async (_db: unknown, id: string) => receipts.adults.has(id),
}));

const { portalLogin, portalSetup } = await import('../../src/server/portal');
const { GET: receiptRoute } = await import('../../src/app/api/v1/portal/receipts/[id]/route');
const { GET: meRoute } = await import('../../src/app/api/v1/auth/me/route');
const { loginHandler } = await import('../../src/server/auth');
const { PUT: rolesRoute } = await import('../../src/app/api/v1/admin/users/[id]/roles/route');
type Page = (p: {
  searchParams: Promise<{ student?: string | string[] }>;
}) => Promise<ReactElement>;
const PAGES: (readonly [string, Page])[] = [
  ['home', (await import('../../src/app/portal/page')).default],
  ['attendance', (await import('../../src/app/portal/attendance/page')).default],
  ['tests', (await import('../../src/app/portal/tests/page')).default],
  ['homework', (await import('../../src/app/portal/homework/page')).default],
  ['fees', (await import('../../src/app/portal/fees/page')).default],
  ['timetable', (await import('../../src/app/portal/timetable/page')).default],
];
const page = (name: string) => PAGES.find(([n]) => n === name)![1];

const ctx = setupTestDatabase();
type Route = Parameters<typeof callRoute>[0];
const PASSWORD = 'test-only-portal-password';
const today = toIsoDate(new Date());
let asha: string; // student A
let ravi: string; // student B (another family)
let kabir: string; // Asha's brother
let ashaLogin: { id: UserId; token: string };
let parent: { id: UserId; token: string }; // guardian of Asha and Kabir
let staffToken: string;

async function guardianRow(studentId: string, createdBy: string) {
  const [g] = await ctx.db
    .insert(opsGuardians)
    .values({
      studentId: studentId as never,
      fullName: 'Meera Verma (fictional)',
      relationship: 'mother',
      createdBy: createdBy as never,
    })
    .returning();
  return g!.id;
}

async function portalLoginFor(
  login: string,
  links: { studentId: string; kind: 'student' | 'guardian' }[],
) {
  const [u] = await ctx.db
    .insert(users)
    .values({
      email: `${login}@portal.invalid`,
      displayName: login,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  await ctx.db.insert(userRoles).values({ userId: u!.id, role: links[0]!.kind });
  for (const l of links)
    await ctx.db.insert(portalAccounts).values({
      userId: u!.id,
      studentId: l.studentId as never,
      kind: l.kind,
      guardianId: l.kind === 'guardian' ? await guardianRow(l.studentId, u!.id) : null,
      createdBy: u!.id,
    });
  const s = await createSession(ctx.db, { userId: u!.id, secret: testSessionSecret() });
  return { id: u!.id as UserId, token: s.token };
}

const openPortal = (enabled: boolean) =>
  ctx.db
    .insert(opsSettings)
    .values({ key: 'portal.enabled', value: { enabled }, decisionState: 'proposed' })
    .onConflictDoUpdate({ target: opsSettings.key, set: { value: { enabled } } });

const form = (path: string, fields: Record<string, string>, ip = '198.51.100.1', origin?: string) =>
  new Request(`http://localhost:3003${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip,
      ...(origin ? { origin } : {}),
    },
    body: new URLSearchParams(fields),
  });
const render = async (name: string, student?: string | string[]) =>
  renderToStaticMarkup(await page(name)({ searchParams: Promise.resolve({ student }) }));

beforeAll(async () => {
  const core = await ctx.db
    .insert(students)
    .values([
      { fullName: 'Asha Verma (fictional)' },
      { fullName: 'Ravi Kapoor (fictional)' },
      { fullName: 'Kabir Verma (fictional)' },
    ])
    .returning();
  [asha, ravi, kabir] = core.map((s) => s.id as string) as [string, string, string];
  ashaLogin = await portalLoginFor('asha.1001', [{ studentId: asha, kind: 'student' }]);
  parent = await portalLoginFor('meera.2002', [
    { studentId: asha, kind: 'guardian' },
    { studentId: kabir, kind: 'guardian' },
  ]);
  await portalLoginFor('ravi.3003', [{ studentId: ravi, kind: 'student' }]);
  staffToken = (await createTestUser(ctx.db, { roles: ['director'] })).token;
  await openPortal(true);

  // Academic: Asha and Ravi in one batch; two held classes (Asha absent in the second); one
  // published test and one finalised but unpublished; a class in three days.
  const coordUser = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  const coord = { user: coordUser, requestId: 'portal-test' };
  await ctx.db
    .insert(programmes)
    .values({ code: 'PORTALP', name: 'Portal programme (fictional)', status: 'active' });
  const course = await createCourse(ctx.db, coord, {
    programmeCode: 'PORTALP',
    code: 'PORTAL-C',
    familyCode: 'PORTAL-F',
    version: 1,
    name: 'Test course (fictional)',
    classMinutes: 75,
    classMinutesStatus: 'locked',
    status: 'active',
  });
  const quant = await createSubject(ctx.db, coord, course.id, {
    code: 'QUANT',
    name: 'Quant',
    sortOrder: 0,
  });
  const batch = await createBatch(ctx.db, coord, {
    code: 'PORTAL-B',
    name: 'Test batch (fictional)',
    courseId: course.id,
    startDate: '2026-09-01',
    status: 'active',
  });
  const [teacher] = await ctx.db
    .insert(staffMembers)
    .values({ fullName: 'Tina Teacher (fictional)', status: 'active' })
    .returning();
  await createAssignment(ctx.db, coord, {
    batchId: batch.id,
    subjectId: quant.id,
    staffMemberId: teacher!.id,
  });
  const [a, r] = [
    await createStudent(ctx.db, coord, { fullName: 'Asha Verma (fictional)' }),
    await createStudent(ctx.db, coord, { fullName: 'Ravi Kapoor (fictional)' }),
  ];
  for (const [s, core] of [
    [a, asha],
    [r, ravi],
  ] as const) {
    await ctx.db
      .update(academicStudents)
      .set({ coreStudentId: core as never })
      .where(eq(academicStudents.id, s.id));
    await enrolManually(ctx.db, coord, {
      studentId: s.id,
      batchId: batch.id,
      startDate: '2026-09-01',
      reason: 'Test (fictional)',
    });
  }
  const cls = (date: string) => ({
    batchId: batch.id,
    subjectId: quant.id,
    teacherStaffId: teacher!.id,
    sessionType: 'teaching' as const,
    date,
    startTime: '09:00',
    durationMinutes: 75,
  });
  const { sessions } = await createSessions(ctx.db, coord, [
    cls('2026-09-07'),
    cls('2026-09-08'),
    cls(addDays(today, 3)),
  ]);
  const [s1, s2] = sessions.map((s) => s.id as string) as [string, string];
  await ctx.db
    .update(academicClassSessions)
    .set({ status: 'held' })
    .where(inArray(academicClassSessions.id, [s1, s2] as never[]));
  for (const [sessionId, ashaMark] of [
    [s1, 'present'],
    [s2, 'absent'],
  ] as const)
    await recordAttendance(ctx.db, coord, sessionId, {
      marks: [
        { studentId: a.id, status: ashaMark },
        { studentId: r.id, status: 'present' },
      ],
    });
  const post = <T>(route: Route, json: unknown, id?: string) =>
    callRoute<T>(
      route,
      authedRequest(coordUser, '/academic/api/v1/x', { method: 'POST', json }),
      id ? { id } : {},
    );
  for (const [n, title, published] of [
    [1, 'Published test (fictional)', true],
    [2, 'Unpublished test (fictional)', false],
  ] as const) {
    const t = await post<{ id: string }>(createTest, {
      code: `PORTAL-T${n}`,
      title,
      kind: 'chapter_test',
      batchId: batch.id,
      subjectId: quant.id,
      scheduledDate: '2026-09-20',
      marksPerCorrect: '1',
      marksPerWrong: '0',
      marksUnattempted: '0',
      sections: [{ code: 'QA', name: 'Quant', questionCount: 4 }],
    });
    const id = t.data!.id;
    await post(addKey, { answers: { QA: ['A', 'B', 'C', 'D'] } }, id);
    await post(
      saveAttempts,
      {
        attempts: [
          {
            studentId: a.id,
            status: 'submitted',
            keyVersion: 1,
            responses: { QA: ['A', 'B', 'C', null] },
          },
          {
            studentId: r.id,
            status: 'submitted',
            keyVersion: 1,
            responses: { QA: ['A', 'B', 'C', 'D'] },
          },
        ],
      },
      id,
    );
    expect((await post(finalise, undefined, id)).status).toBe(201);
    if (published) expect((await post(publish, undefined, id)).status).toBe(200);
  }
  receipts.owners.set('00000000-0000-4000-8000-00000000000a', asha);
  receipts.owners.set('00000000-0000-4000-8000-00000000000b', ravi);
}, 120_000);

afterEach(() => {
  jar.portal = undefined;
  jar.staff = undefined;
});

describe('every page shows only the login’s own students', () => {
  it.each(PAGES)(
    '%s: the own student renders; another student, a bad id or two ids is 404',
    async (name) => {
      jar.portal = ashaLogin.token;
      const own = await render(name);
      expect(own).toContain('Asha Verma');
      expect(await render(name, asha)).toContain('Asha Verma');
      for (const other of [ravi, kabir, 'not-a-uuid', [asha, ravi]])
        await expect(render(name, other)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(own).not.toContain('Ravi');
    },
  );

  it.each(PAGES)('%s: a parent sees each linked child, never another family’s', async (name) => {
    jar.portal = parent.token;
    expect(await render(name, kabir)).toContain('Kabir Verma');
    expect(await render(name, asha)).toContain('Asha Verma');
    await expect(render(name, ravi)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each(PAGES)('%s: signed out → portal sign-in; a staff user → staff home', async (name) => {
    await expect(render(name)).rejects.toThrow(/NEXT_REDIRECT \/portal\/login\?next=%2Fportal/);
    jar.staff = staffToken;
    await expect(render(name)).rejects.toThrow(/^NEXT_REDIRECT \/$/);
  });

  it('C1: a link whose guardian is archived is hidden, even if it was never switched off', async () => {
    const [link] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(
        and(eq(portalAccounts.userId, parent.id), eq(portalAccounts.studentId, kabir as never)),
      );
    await ctx.db
      .update(opsGuardians)
      .set({ archivedAt: new Date() })
      .where(eq(opsGuardians.id, link!.guardianId! as never));
    try {
      jar.portal = parent.token;
      await expect(render('attendance', kabir)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(await render('attendance', asha)).toContain('Asha Verma');
    } finally {
      await ctx.db
        .update(opsGuardians)
        .set({ archivedAt: null })
        .where(eq(opsGuardians.id, link!.guardianId! as never));
    }
  });

  it('M3: a guardian stops seeing a child aged 18 or over while the setting is off; the student still does', async () => {
    receipts.adults.add(asha);
    try {
      jar.portal = parent.token;
      await expect(render('attendance', asha)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(await render('attendance', kabir)).toContain('Kabir Verma');
      jar.portal = ashaLogin.token;
      expect(await render('attendance')).toContain('Asha Verma');
      await ctx.db.insert(opsSettings).values({
        key: 'portal.guardian_access_to_adults',
        value: { allowed: true },
        decisionState: 'proposed',
      });
      jar.portal = parent.token;
      expect(await render('attendance', asha)).toContain('Asha Verma');
    } finally {
      receipts.adults.clear();
      await ctx.db
        .delete(opsSettings)
        .where(eq(opsSettings.key, 'portal.guardian_access_to_adults'));
    }
  });

  it('home lets a parent with two children choose one', async () => {
    jar.portal = parent.token;
    const home = await render('home');
    expect(home).toContain('Choose a student');
    expect(home).toContain(`/portal?student=${asha}`);
    expect(home).toContain(`/portal?student=${kabir}`);
  });

  it('a switched-off link is gone at once', async () => {
    const [kabirLink] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.studentId, kabir as never));
    await ctx.db
      .update(portalAccounts)
      .set({ disabledAt: new Date(), disabledBy: parent.id })
      .where(eq(portalAccounts.id, kabirLink!.id));
    jar.portal = parent.token;
    await expect(render('attendance', kabir)).rejects.toThrow('NEXT_NOT_FOUND');
    await ctx.db
      .update(portalAccounts)
      .set({ disabledAt: null, disabledBy: null })
      .where(eq(portalAccounts.id, kabirLink!.id));
  });
});

describe('what the pages say', () => {
  it('attendance per batch and the recent absence; unpublished results never show; ranks only once Academic shows them', async () => {
    jar.portal = ashaLogin.token;
    const attendance = await render('attendance');
    expect(attendance).toContain('Test batch (fictional)');
    expect(attendance).toContain('50%');
    expect(attendance).toContain('8 Sept 2026');
    const tests = await render('tests');
    expect(tests).toContain('Published test (fictional)');
    expect(tests).not.toContain('Unpublished test');
    expect(tests).toContain('3 of 4');
    expect(tests).toContain('Not shown');
    await ctx.db
      .insert(academicSettings)
      .values({
        key: 'progress.show_rank_percentile',
        value: { show: true },
        status: 'approved',
        description: 'test',
      })
      .onConflictDoUpdate({
        target: academicSettings.key,
        set: { value: { show: true }, status: 'approved' },
      });
    expect(await render('tests')).toContain('2 of 2 ranked');
    expect(await render('timetable')).toContain('Tina Teacher (fictional)');
  });
});

describe('receipt files', () => {
  const get = (token: string | undefined, id: string) =>
    receiptRoute(
      new Request(`http://localhost:3003/api/v1/portal/receipts/${id}`, {
        headers: token ? { cookie: `${PORTAL_COOKIE}=${token}` } : {},
      }),
      { params: Promise.resolve({ id }) },
    );

  it('only a payment of a linked student downloads; anything else is 404 and never rendered', async () => {
    const own = await get(ashaLogin.token, '00000000-0000-4000-8000-00000000000a');
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('application/pdf');
    expect(own.headers.get('cache-control')).toBe('no-store');
    expect(receipts.counted).toEqual([false]); // M4: a portal download is not a staff print
    receipts.rendered.length = 0;
    for (const id of ['00000000-0000-4000-8000-00000000000b', crypto.randomUUID(), 'x'])
      for (const token of [ashaLogin.token, parent.token])
        expect((await get(token, id)).status).toBe(404);
    expect(receipts.rendered).toEqual([]);
    expect((await get(undefined, '00000000-0000-4000-8000-00000000000a')).status).toBe(401);
    expect((await get(staffToken, '00000000-0000-4000-8000-00000000000a')).status).toBe(401);
  });
});

describe('setup, sign-in and the staff boundary', () => {
  const location = (res: Response) => res.headers.get('location');

  it('a setup code works once; sign-in then sets only the portal cookie, which no staff route accepts', async () => {
    const [u] = await ctx.db
      .insert(users)
      .values({ email: 'neha.4004@portal.invalid', displayName: 'Neha (fictional)' })
      .returning();
    await ctx.db.insert(userRoles).values({ userId: u!.id, role: 'guardian' });
    await ctx.db.insert(portalAccounts).values({
      userId: u!.id,
      studentId: ravi as never,
      kind: 'guardian',
      guardianId: await guardianRow(ravi, u!.id),
      createdBy: u!.id,
    });
    const { code } = await issueSetupCode(ctx.db, {
      userId: u!.id as UserId,
      createdBy: u!.id as UserId,
    });
    const fields = {
      login: 'neha.4004',
      code: code.toLowerCase(),
      password: PASSWORD,
      confirm: PASSWORD,
    };
    // I3: the code works only with its own login.
    expect(
      location(await portalSetup(form('/api/v1/portal/setup', { ...fields, login: 'asha.1001' }))),
    ).toBe('/portal/setup?error=invalid');
    expect(
      location(
        await portalSetup(form('/api/v1/portal/setup', { ...fields, confirm: 'other-password-x' })),
      ),
    ).toBe('/portal/setup?error=mismatch');
    expect(
      location(
        await portalSetup(
          form('/api/v1/portal/setup', { ...fields, password: 'short', confirm: 'short' }),
        ),
      ),
    ).toBe('/portal/setup?error=short');
    expect(location(await portalSetup(form('/api/v1/portal/setup', fields)))).toBe(
      '/portal/login?done=1',
    );
    expect(location(await portalSetup(form('/api/v1/portal/setup', fields)))).toBe(
      '/portal/setup?error=invalid',
    );

    const res = await portalLogin(
      form(
        '/api/v1/portal/login',
        { login: 'Neha.4004', password: PASSWORD, next: '/portal/fees' },
        '198.51.100.2',
      ),
    );
    expect(location(res)).toBe('/portal/fees');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^elevate_portal=.+HttpOnly/);
    expect(cookie).not.toContain(`${SESSION_COOKIE}=`);
    const token = decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!);
    expect((await validatePortalSession(ctx.db, token, testSessionSecret()))?.id).toBe(u!.id);
    expect(
      await getUserFromRequest(authedRequest({ token }, '/api/v1/auth/me'), ctx.db),
    ).toBeNull();
    expect((await callRoute(meRoute, authedRequest({ token }, '/api/v1/auth/me'))).status).toBe(
      401,
    );
    // An outside `next` never leaves the portal.
    const away = await portalLogin(
      form(
        '/api/v1/portal/login',
        { login: 'neha.4004', password: PASSWORD, next: '/admin/users' },
        '198.51.100.2',
      ),
    );
    expect(location(away)).toBe('/portal');
  });

  it('staff sign-in refuses a portal login; portal sign-in refuses a staff email and another site', async () => {
    const staff = await callRoute(
      loginHandler,
      new Request('http://localhost:3003/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'asha.1001@portal.invalid', password: PASSWORD }),
      }),
    );
    expect(staff.status).toBe(403);
    const asStaff = await portalLogin(
      form(
        '/api/v1/portal/login',
        { login: 'director@example.test', password: PASSWORD },
        '198.51.100.3',
      ),
    );
    expect(location(asStaff)).toBe('/portal/login?error=invalid&next=%2Fportal');
    const crossSite = await portalLogin(
      form(
        '/api/v1/portal/login',
        { login: 'asha.1001', password: PASSWORD },
        '198.51.100.3',
        'https://evil.example',
      ),
    );
    expect(crossSite.status).toBe(403);
  });

  it('the staff role editor never grants a portal role, and leaves portal logins alone (M-5)', async () => {
    const admin = await createTestUser(ctx.db, { roles: ['platform_admin'] });
    const staff = await createTestUser(ctx.db, { roles: ['teacher'] });
    const put = (id: string, roles: string[]) =>
      callRoute(rolesRoute, authedRequest(admin, '/x', { method: 'PUT', json: { roles } }), { id });
    expect((await put(staff.id, ['teacher', 'guardian'])).status).toBe(400);
    expect((await put(ashaLogin.id, ['teacher'])).status).toBe(409);
  });

  it('five wrong passwords lock the login for 15 minutes (shared limit), even with the right one after', async () => {
    const attempt = (password: string) =>
      portalLogin(
        form('/api/v1/portal/login', { login: 'asha.1001', password }, '198.51.100.4'),
      ).then(location);
    for (let i = 0; i < 5; i++)
      expect(await attempt('test-only-wrong-password')).toContain('error=invalid');
    expect(await attempt(PASSWORD)).toContain('error=locked');
  });

  it('M5: portal failures never count in the staff per-address bucket', async () => {
    const ip = '198.51.100.4'; // the address of the lock test above
    const staffKey = createHmac('sha256', testSessionSecret())
      .update(`login-ip|${ip}`)
      .digest('hex');
    expect(
      await ctx.db.select().from(loginAttempts).where(eq(loginAttempts.keyHash, staffKey)),
    ).toEqual([]);
  });

  it('I3: one login’s setup code locks after 5 wrong codes from 5 addresses; every setup stops at the global ceiling', async () => {
    const wrong = (i: number, login = 'ravi.3003') =>
      portalSetup(
        form(
          '/api/v1/portal/setup',
          { login, code: 'ZZZZ ZZZZ', password: PASSWORD, confirm: PASSWORD },
          `192.0.2.${i}`,
        ),
      ).then(location);
    for (let i = 1; i <= 5; i++) expect(await wrong(i)).toBe('/portal/setup?error=invalid');
    expect(await wrong(6)).toBe('/portal/setup?error=locked');
    const all = new LoginThrottle('portal-setup-all');
    for (let i = 0; i < 200; i++) await all.recordFailure(ctx.db, 'all');
    try {
      expect(await wrong(7, 'meera.2002')).toBe('/portal/setup?error=locked');
    } finally {
      await all.reset(ctx.db, 'all');
    }
  });

  it('with the portal off: pages say it is not open, sign-in and setup refuse, files are 404', async () => {
    await openPortal(false);
    try {
      jar.portal = ashaLogin.token;
      for (const [name] of PAGES)
        expect(await render(name)).toContain('The portal is not open yet');
      const login = await portalLogin(
        form('/api/v1/portal/login', { login: 'ravi.3003', password: PASSWORD }, '198.51.100.5'),
      );
      expect(location(login)).toBe('/portal/login?error=closed&next=%2Fportal');
      const setup = await portalSetup(
        form('/api/v1/portal/setup', {
          login: 'ravi.3003',
          code: 'ABCDEFGH',
          password: PASSWORD,
          confirm: PASSWORD,
        }),
      );
      expect(location(setup)).toBe('/portal/setup?error=closed');
      const file = await receiptRoute(
        new Request('http://localhost:3003/x', {
          headers: { cookie: `${PORTAL_COOKIE}=${ashaLogin.token}` },
        }),
        { params: Promise.resolve({ id: '00000000-0000-4000-8000-00000000000a' }) },
      );
      expect(file.status).toBe(404);
    } finally {
      await openPortal(true);
    }
  });
});
