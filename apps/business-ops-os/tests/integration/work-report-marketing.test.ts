/**
 * Marketing facts in a monthly work report (brief 23 Oct 2026 §15): fetched from Marketing OS for
 * Marketing & Growth staff, frozen into the submitted version, missing (never 0) when Marketing
 * cannot be read, and shown in the context rows the view, PDF and CSV use.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase } from '@elevate/testing';
import { departments, opsEodReportVersions, staffMembers } from '@elevate/database';
import { metric, type MarketingMonthlySnapshotV1 } from '@elevate/shared-contracts';
import { toIsoDateTime, type IsoDate } from '@elevate/shared-types';
import type { EodFacts } from '../../src/domain/eod';
import { periodOf } from '../../src/domain/work-report';
import { contextRows } from '../../src/server/eod-export';
import { collectFacts, factsHash } from '../../src/server/eod-facts';
import { saveDraft, submitReport } from '../../src/server/eod-reports';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const state = vi.hoisted(() => ({ approved: 2 as number | null, calls: [] as string[] }));
vi.mock('@elevate/server-kit', async (real) => {
  const mod = await real<typeof import('@elevate/server-kit')>();
  return {
    ...mod,
    fetchInternal: (
      url: string,
      ...rest: Parameters<typeof mod.fetchInternal> extends [unknown, ...infer R] ? R : never
    ) => {
      if (!url.includes('/marketing/api/internal/v1/reports/monthly'))
        return mod.fetchInternal(url, ...rest);
      state.calls.push(url);
      const fetchedAt = new Date().toISOString();
      return Promise.resolve(
        state.approved === null
          ? { status: 'unavailable', reason: 'Marketing OS did not answer', fetchedAt }
          : { status: 'available', data: snapshot(state.approved), fetchedAt },
      );
    },
  };
});

const meta = {
  definition: 'Sample definition',
  window: { from: '2026-09-01', to: '2026-09-30' },
  unit: 'count',
} as const;
const snapshot = (approved: number): MarketingMonthlySnapshotV1 => ({
  version: 1,
  cutoffAt: toIsoDateTime(),
  isSample: true,
  targets: [
    {
      targetId: '11111111-1111-4111-8111-111111111111',
      scope: 'employee',
      metricKey: 'qualified_leads',
      target: 10,
      actual: metric.ok(4, { ...meta, window: { from: '2026-08-15', to: '2026-09-14' } }),
    },
  ],
  funnel: [
    {
      key: 'lead_stages',
      label: 'Leads by stage reached',
      count: metric.missing('Not connected', meta),
    },
  ],
  callOutcomes: [],
  campaigns: [],
  content: {
    planned: metric.ok(3, meta),
    approved: metric.ok(approved, meta),
    published: metric.ok(1, meta),
  },
  optimisation: [],
});

const ctx = setupTestDatabase();
let lead: StaffUser;
let marketer: StaffUser;
let counsellor: StaffUser;
const MONTH = periodOf('month', '2026-09-15' as IsoDate);

beforeAll(async () => {
  await setupReference(ctx.db);
  lead = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Lead' });
  marketer = await staffUser(ctx.db, ['marketing_contributor'], {
    managerId: lead.staffId,
    name: 'Sample Marketer',
  });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Counsellor' });
  const [dept] = await ctx.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'MARKETING_GROWTH'));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: dept!.id })
    .where(eq(staffMembers.id, marketer.staffId));
});

describe('marketing facts in monthly work reports', () => {
  it('only Marketing & Growth staff get them, and only for a month', async () => {
    state.calls = [];
    expect((await collectFacts(ctx.db, counsellor.staffId, MONTH)).marketing).toBeUndefined();
    expect(
      (await collectFacts(ctx.db, marketer.staffId, periodOf('week', '2026-09-15' as IsoDate)))
        .marketing,
    ).toBeUndefined();
    expect(state.calls).toEqual([]);
    const f = await collectFacts(ctx.db, marketer.staffId, MONTH);
    expect(f.marketing).toMatchObject({ status: 'available' });
    expect(state.calls[0]).toContain(`staffId=${marketer.staffId}&month=2026-09`);
  });

  it('a submitted version keeps the marketing facts unchanged after the source changes', async () => {
    state.approved = 2;
    // Through the services: the marketer reaches these routes from the Marketing workspace mount.
    const draft = await saveDraft(ctx.db, marketer, {
      reportDate: '2026-09-15' as IsoDate,
      periodKind: 'month',
    });
    const id = draft.id;
    expect((await submitReport(ctx.db, marketer, id, {})).submittedVersion.version).toBe(1);
    const read = async () =>
      (
        await ctx.db
          .select()
          .from(opsEodReportVersions)
          .where(eq(opsEodReportVersions.reportId, id as never))
      )[0]!.snapshot as EodFacts;
    const frozen = await read();
    expect(frozen.marketing).toMatchObject({
      status: 'available',
      snapshot: { content: { approved: { value: 2 } } },
    });
    state.approved = 5;
    expect(await read()).toEqual(frozen);
    const fresh = await collectFacts(ctx.db, marketer.staffId, MONTH);
    expect(factsHash(fresh)).not.toBe(factsHash(frozen)); // "Source changed since submission"
    state.approved = 2;
    expect(factsHash(await collectFacts(ctx.db, marketer.staffId, MONTH))).toBe(factsHash(frozen));
    expect(contextRows(frozen)).toContainEqual([
      'Content owned',
      '3 planned · 2 approved · 1 published',
    ]);
    expect(contextRows(frozen)).toContainEqual([
      'Leads by stage reached',
      'Not available (Not connected)',
    ]);
    // Sample facts are labelled; a target shows its own period, not the report month.
    expect(contextRows(frozen)).toContainEqual([
      'SAMPLE DATA',
      'These marketing facts include fictional sample records.',
    ]);
    expect(contextRows(frozen)).toContainEqual([
      'Marketing targets',
      'qualified leads: 4 of 10 (2026-08-15 to 2026-09-14)',
    ]);
  });

  it('when Marketing OS cannot be read the facts are missing, never zeros', async () => {
    state.approved = null;
    const f = await collectFacts(ctx.db, marketer.staffId, MONTH);
    expect(f.marketing).toMatchObject({ status: 'missing', reason: 'Marketing OS did not answer' });
    const rows = contextRows(f);
    expect(rows).toContainEqual([
      'Marketing facts',
      'Source unavailable: Marketing OS (Marketing OS did not answer). Not counted.',
    ]);
    expect(rows.some(([label]) => label === 'Content owned')).toBe(false);
  });
});
