/**
 * Overview (brief 22 Oct 2026 §5, §9) and the Fees area views: blocks follow permissions,
 * sources that cannot be read say so (never 0), links open the records; Collections and
 * Outstanding paginate on the server and refuse readers without ops:fees:read. Fictional data.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsStaffSubjectCapabilities,
  type Database,
} from '@elevate/database';
import { metric } from '@elevate/shared-contracts';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { addDays, istToday } from '../../src/domain';
import { OverviewBlocks } from '../../src/app/_components/overview-blocks';
import { listCollections, listOutstanding } from '../../src/server/fee-collections';
import { buildOverview } from '../../src/server/overview';
import { review, reviewsPayload, stubAcademic } from './academic-stub';
import { signedApplication, type People } from './application-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
let manager: StaffUser;
let counsellor: StaffUser;
let other: StaffUser;
let teacher: StaffUser;
let director: TestUser;
let finance: TestUser;
let marketing: TestUser;
let coordinator: TestUser;
let people: People;
let signed: Awaited<ReturnType<typeof signedApplication>>;

const today = istToday(new Date());
const range = { from: addDays(today, -6), to: today };

const down = { fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch };
const m = (value: number) => metric.ok(value, { definition: 'test', window: range, unit: 'count' });
const academicUp = {
  fetchImpl: (async (url: RequestInfo | URL) =>
    String(url).includes('/academic/')
      ? Response.json({
          data: {
            contract: 'academic.delivery_summary',
            version: 1,
            generatedAt: new Date().toISOString(),
            window: range,
            metrics: Object.fromEntries(
              [
                'activeStudents',
                'activeBatches',
                'classesPlanned',
                'classesDelivered',
                'classesCancelled',
                'attendanceRate',
                'assessmentsPlanned',
                'assessmentsConducted',
                'studentsAtRisk',
                'syllabusCompletionRate',
              ].map((k) => [k, m(k === 'classesDelivered' ? 17 : 1)]),
            ),
            programmes: [],
          },
        })
      : new Response('nope', { status: 503 })) as typeof fetch,
};

afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  other = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Overview Teacher' });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  finance = await createTestUser(ctx.db, { roles: ['finance_officer'] });
  marketing = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  people = { counsellor, manager, director };
  signed = await signedApplication(ctx.db, people, { name: 'Sample Overview Student' });
  await ctx.db
    .insert(opsStaffSubjectCapabilities)
    .values([{ staffId: teacher.staffId, subject: 'Quant', sourceNote: 'test' }] as never);
});

const BLOCKS = [
  'funnel',
  'report',
  'pipeline',
  'collections',
  'outstanding',
  'crossModule',
  'reviews',
  'team',
  'kpis',
] as const;

const SECTIONS = [
  'demos',
  'confirmations',
  'fees',
  'onboarding',
  'teaching',
  'team',
  'marketing',
  'follow-ups',
];

describe('overview blocks follow permissions', () => {
  it.each([
    ['operations_manager', () => manager, BLOCKS, SECTIONS],
    [
      'finance_officer',
      () => finance,
      ['funnel', 'report', 'pipeline', 'collections', 'outstanding', 'team'],
      ['demos', 'confirmations', 'fees', 'onboarding', 'team', 'marketing'],
    ],
    [
      'admissions_counsellor',
      () => counsellor,
      ['funnel', 'report', 'pipeline', 'collections', 'outstanding', 'reviews', 'team'],
      ['demos', 'confirmations', 'fees', 'onboarding', 'teaching', 'team', 'marketing'],
    ],
    ['marketing_manager (no fees, admissions or dashboard)', () => marketing, ['team'], ['team']],
  ] as const)('%s', async (_, user, parts, sections) => {
    stubAcademic({ reviews: 'down' });
    const o = await buildOverview(db(), user(), range, { summaries: down });
    for (const k of BLOCKS) expect(o[k] !== null, k).toBe((parts as readonly string[]).includes(k));
    const out = renderToStaticMarkup(<OverviewBlocks o={o} />);
    for (const id of SECTIONS)
      expect(out.includes(`id="${id}"`), id).toBe((sections as readonly string[]).includes(id));
  });
});

describe('sources that cannot be read', () => {
  it('Academic, Marketing and reviews down: "Source unavailable", never 0', async () => {
    stubAcademic({ reviews: 'down' });
    const o = await buildOverview(db(), manager, range, { summaries: down });
    expect(o.crossModule).toMatchObject({
      ok: true,
      data: { academic: { status: 'unavailable' } },
    });
    expect(o.reviews).toMatchObject({ ok: true, data: { status: 'unavailable' } });
    const out = renderToStaticMarkup(<OverviewBlocks o={o} />);
    expect(out).toContain('Source unavailable (checked');
    expect(out).toContain('Academic OS could not be read (HTTP 503)');
    expect(out).toContain('Marketing OS could not be read (HTTP 503)');
    expect(out).not.toContain('Classes delivered');
    expect(out).toMatch(/Teacher reviews published.*Source unavailable/);
  });

  it('Academic up: delivery figures and reviews published in the range are counted', async () => {
    stubAcademic({
      reviews: reviewsPayload([
        review({
          authorStaffId: teacher.staffId as never,
          submittedAt: new Date().toISOString() as never,
        }),
        review({
          authorStaffId: teacher.staffId as never,
          submittedAt: '2020-01-01T05:00:00.000Z' as never,
        }),
      ]),
    });
    const o = await buildOverview(db(), manager, range, { summaries: academicUp });
    expect(o.reviews).toMatchObject({ ok: true, data: { status: 'available', total: 1 } });
    const out = renderToStaticMarkup(<OverviewBlocks o={o} />);
    expect(out).toContain('Classes delivered');
    expect(out).toContain('>17<');
    expect(out).toContain('Marketing OS could not be read');
  });

  it('a range over 92 days explains the task figures instead of failing', async () => {
    const o = await buildOverview(
      db(),
      manager,
      { from: addDays(today, -200), to: today },
      {
        summaries: down,
      },
    );
    expect(o.team).toMatchObject({ ok: false, reason: expect.stringContaining('92 days') });
  });
});

describe('overview links open the records', () => {
  it('each block links to its list, keeping the range', async () => {
    stubAcademic({ reviews: 'down' });
    const o = await buildOverview(db(), manager, range, { summaries: down });
    const out = renderToStaticMarkup(<OverviewBlocks o={o} />).replaceAll('&amp;', '&');
    const q = `from=${range.from}&to=${range.to}`;
    for (const href of [
      `/ops/reports/admissions?${q}`,
      '/ops/admissions/applications?status=signatures_confirmed',
      `/ops/fees/collections?${q}`,
      '/ops/fees/outstanding?status=overdue',
      '/ops/admissions/overview#overdue-onboarding',
      `/ops/academic-summary?${q}`,
      `/ops/tasks/reports?${q}`,
      `/ops/marketing-summary?${q}`,
    ])
      expect(out).toContain(`href="${href}`);
  });
});

describe('Fees area: Collections and Outstanding', () => {
  it('403 without ops:fees:read', async () => {
    await expect(listCollections(db(), coordinator, { ...range, page: 1 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(listOutstanding(db(), marketing, { page: 1 })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('collections: server pages of 25, status filter, net total, own scope', async () => {
    const [a] = await ctx.db
      .select({ leadId: opsAdmissions.leadId })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, signed.admissionId as never));
    await ctx.db.insert(opsFeeRecords).values(
      Array.from({ length: 27 }, (_, i) => ({
        code: `FEE-8${String(i).padStart(5, '0')}`,
        admissionId: signed.admissionId as never,
        leadId: a!.leadId,
        kind: 'received' as const,
        chargeCategory: 'registration' as const,
        amountPaise: 100_00,
        paymentDate: today,
        status: i === 0 ? ('voided' as const) : ('recorded' as const),
        voidReason: i === 0 ? 'test-only typo' : null,
        voidedBy: i === 0 ? manager.id : null,
        voidedAt: i === 0 ? new Date() : null,
        recordedBy: manager.id,
      })) as never,
    );
    const p1 = await listCollections(db(), finance, { ...range, page: 1 });
    expect(p1).toMatchObject({ total: 27, pageSize: 25 });
    expect(p1.rows).toHaveLength(25);
    expect((await listCollections(db(), finance, { ...range, page: 2 })).rows).toHaveLength(2);
    expect(p1.collected?.netPaise).toBe(26 * 100_00); // the voided entry never counts
    expect(
      (await listCollections(db(), finance, { ...range, status: 'voided', page: 1 })).total,
    ).toBe(1);
    const before = { from: addDays(today, -60), to: addDays(today, -30) };
    expect((await listCollections(db(), finance, { ...before, page: 1 })).total).toBe(0);
    expect((await listCollections(db(), other, { ...range, page: 1 })).total).toBe(0);
    expect(p1.rows[0]!.studentId).toBe(signed.studentId);
  });

  it('outstanding: views count due, overdue and upcoming instalments; own scope', async () => {
    let o = await listOutstanding(db(), finance, { page: 1 });
    expect(o.views).toMatchObject({
      due: { count: 0 },
      overdue: { count: 0 },
      upcoming: { count: 3 },
    });
    const [plan] = await ctx.db
      .select({ id: opsFeePlans.id })
      .from(opsFeePlans)
      .where(eq(opsFeePlans.admissionId, signed.admissionId as never));
    await ctx.db
      .update(opsFeeInstalments)
      .set({ dueDate: addDays(today, -3) })
      .where(eq(opsFeeInstalments.planId, plan!.id));
    o = await listOutstanding(db(), finance, { status: 'overdue', page: 1 });
    expect(o.views.overdue.count).toBe(3);
    expect(o.rows[0]).toMatchObject({ studentId: signed.studentId, status: 'overdue' });
    expect((await listOutstanding(db(), finance, { status: 'upcoming', page: 1 })).total).toBe(0);
    expect((await listOutstanding(db(), other, { page: 1 })).any).toBe(false);
    expect((await listOutstanding(db(), finance, { page: 2 })).rows).toHaveLength(0);
  });
});
