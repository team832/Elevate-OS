/**
 * Workspace overview data (apps/platform/src/server/overview-adapter.ts):
 * every widget is loaded with the signed-in user's permissions, missing is never
 * shown as zero, and sample (fictional) data is always flagged as such.
 */
import { describe, expect, it } from 'vitest';
import type { RoleKey } from '@elevate/shared-types';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  filterFollowUps,
  filterPriorities,
  istWeek,
  loadAttention,
  loadFollowUps,
  loadInbox,
  loadMetrics,
  loadPipeline,
  loadPriorities,
  loadTodayClasses,
  mapPipeline,
  parsePriorityTab,
  type OverviewDeps,
  type PriorityRow,
  type Widget,
} from '../../src/server/overview-adapter';

const ctx = setupTestDatabase();
// Tuesday 20 Oct 2026, 10:00 IST
const now = new Date('2026-10-20T04:30:00Z');

const deps = async (roles: RoleKey[]): Promise<OverviewDeps> => ({
  db: ctx.db,
  user: await createTestUser(ctx.db, { roles }),
  now,
});

const byKey = <T extends { key: string }>(items: T[], key: string) => {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
};

describe('overview — permissions are respected', () => {
  it('a teacher sees no Business Ops figures: Not available with a reason, never 0', async () => {
    const d = await deps(['teacher']);
    const inbox = loadInbox(d);
    expect(await inbox).toMatchObject({ status: 'unavailable' });

    const metrics = await loadMetrics(d, inbox);
    for (const key of ['activeEnquiries', 'staffPresent', 'pendingApprovals']) {
      const m = byKey(metrics, key).metric;
      expect(m.status).toBe('missing');
      expect(m.value).toBeNull();
      expect(m.status === 'missing' && m.reason).toMatch(/role/i);
    }

    for (const w of [await loadPipeline(d), await loadFollowUps(d, undefined)])
      expect(w).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/role/) });
    // teachers hold ops:tasks:read (own tasks), so the priorities widget is shown — as sample data
    expect(await loadPriorities(d, 'today')).toMatchObject({ status: 'ok', source: 'sample' });

    const attention = await loadAttention(d, inbox);
    expect(attention.map((a) => a.key)).toEqual([
      'admissionDecisions',
      'attendanceCorrections',
      'contentApprovals',
    ]);
    for (const a of attention) {
      expect(a.count).toBeNull();
      expect(a.reason).toBeTruthy();
    }
  });

  it('a marketing contributor (no Academic timetable) gets "unavailable" for today’s classes, not an empty list', async () => {
    const d = await deps(['marketing_contributor']);
    expect(await loadTodayClasses(d)).toMatchObject({ status: 'unavailable' });
  });

  it('an operations manager gets the live approvals inbox count', async () => {
    const d = await deps(['operations_manager']);
    const inbox = loadInbox(d);
    const box = await inbox;
    expect(box).toMatchObject({ status: 'ok', source: 'live' });
    const pending = byKey(await loadMetrics(d, inbox), 'pendingApprovals');
    expect(pending.source).toBe('live');
    // a measured, empty inbox is a real 0 (sources exist and loaded)
    expect(pending.metric).toMatchObject({ status: 'ok', value: 0 });
  });

  it('a marketing manager sees the live count of content in review', async () => {
    const d = await deps(['marketing_manager']);
    const content = byKey(await loadAttention(d, loadInbox(d)), 'contentApprovals');
    expect(content.count).toBe(0);
    expect(content.reason).toBeUndefined();
  });

  it('an academic coordinator gets live students and classes (measured 0 shows as 0)', async () => {
    const d = await deps(['academic_coordinator']);
    const students = byKey(await loadMetrics(d, loadInbox(d)), 'studentsEnrolled');
    expect(students).toMatchObject({ source: 'live', metric: { status: 'ok', value: 0 } });
    expect(await loadTodayClasses(d)).toMatchObject({ status: 'ok', source: 'live', data: [] });
  });
});

describe('overview — missing is never zero', () => {
  it('a failed inbox becomes "Not available", never 0', async () => {
    const d = await deps(['operations_manager']);
    const failed: Promise<Widget<never>> = Promise.resolve({ status: 'error', message: 'x' });
    const pending = byKey(await loadMetrics(d, failed), 'pendingApprovals');
    expect(pending.metric.status).toBe('missing');
    expect(pending.metric.value).toBeNull();
    for (const a of (await loadAttention(d, failed)).slice(0, 2)) expect(a.count).toBeNull();
  });

  it('Active enquiries and Staff present are not available (no shared source yet)', async () => {
    const d = await deps(['operations_manager']);
    const metrics = await loadMetrics(d, loadInbox(d));
    for (const key of ['activeEnquiries', 'staffPresent'])
      expect(byKey(metrics, key).metric).toMatchObject({ status: 'missing', value: null });
  });
});

describe('overview — sample data is flagged', () => {
  it('pipeline, follow-ups and priorities are sample, fictional and labelled', async () => {
    const d = await deps(['operations_manager']);
    for (const w of [
      await loadPipeline(d),
      await loadFollowUps(d, undefined),
      await loadPriorities(d, 'all'),
    ]) {
      expect(w.status).toBe('ok');
      if (w.status === 'ok') {
        expect(w.source).toBe('sample');
        expect(w.note).toMatch(/Fictional/);
      }
    }
    const f = await loadFollowUps(d, undefined);
    if (f.status !== 'ok') throw new Error('expected follow-ups');
    for (const r of f.data.rows) {
      expect(r.student).toContain('(fictional)');
      expect(r.owner).toContain('(fictional)');
    }
  });
});

describe('overview — filters and tabs change the records shown', () => {
  it('follow-up filter matches student, programme, owner or next step', async () => {
    const d = await deps(['admissions_counsellor']);
    const all = await loadFollowUps(d, undefined);
    const clat = await loadFollowUps(d, 'clat');
    const none = await loadFollowUps(d, 'no such student');
    if (all.status !== 'ok' || clat.status !== 'ok' || none.status !== 'ok')
      throw new Error('ok expected');
    expect(clat.data.rows.length).toBeGreaterThan(0);
    expect(clat.data.rows.length).toBeLessThan(all.data.rows.length);
    expect(clat.data.rows.every((r) => r.programme === 'CLAT')).toBe(true);
    expect(none.data.rows).toEqual([]);
    expect(none.data.total).toBe(all.data.total);
    expect(filterFollowUps(all.data.rows, '  ')).toHaveLength(all.data.rows.length);
  });

  it('priority tabs: Today = due today or overdue; This week = by Sunday; All = everything', () => {
    const rows: PriorityRow[] = [
      { id: 'a', title: 'overdue', owner: 'x', due: '2026-10-19', status: 'Open' },
      { id: 'b', title: 'today', owner: 'x', due: '2026-10-20', status: 'Open' },
      { id: 'c', title: 'sunday', owner: 'x', due: '2026-10-25', status: 'Open' },
      { id: 'd', title: 'next week', owner: 'x', due: '2026-10-26', status: 'Open' },
    ];
    expect(istWeek(now)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(filterPriorities(rows, 'today', now).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterPriorities(rows, 'week', now).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(filterPriorities(rows, 'all', now).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(parsePriorityTab('week')).toBe('week');
    expect(parsePriorityTab('nonsense')).toBe('today');
  });

  it('tab counts match the rows each tab shows', async () => {
    const d = await deps(['operations_manager']);
    for (const tab of ['today', 'week', 'all'] as const) {
      const w = await loadPriorities(d, tab);
      if (w.status !== 'ok') throw new Error('ok expected');
      expect(w.data.rows).toHaveLength(w.data.counts[tab]);
    }
  });
});

describe('overview — pipeline mapping', () => {
  it('maps Business Ops statuses onto the five overview stages (lost / on hold excluded)', () => {
    const stages = mapPipeline({
      new: 1,
      contacted: 2,
      counselling_scheduled: 1,
      counselled: 1,
      demo_scheduled: 1,
      demo_attended: 1,
      admission_pending: 1,
      admitted: 1,
      enrolment_requested: 1,
      enrolled: 5,
      lost: 9,
      on_hold: 9,
    });
    expect(stages.map((s) => [s.label, s.count])).toEqual([
      ['New', 1],
      ['Contacted', 2],
      ['Counselling', 4],
      ['Application', 3],
      ['Enrolled', 5],
    ]);
    expect(mapPipeline({}).every((s) => s.count === 0)).toBe(true);
  });
});
