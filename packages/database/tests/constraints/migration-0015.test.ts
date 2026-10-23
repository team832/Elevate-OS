/**
 * Migration 0015 on a database holding 0014-shaped rows: blocked / on_hold become a flag and the
 * status returns to the latest open status on record (R4); submission, approval and original
 * deadline columns are filled from facts already on record; old EOD reports become day reports.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate';
import { LATER, NOW, insert, seedBase, type Row } from './helpers';

const { entries } = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: { tag: string }[] };
const apply = async (pg: PGlite, tag: string) => {
  for (const s of readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  ))
    if (s.trim()) await pg.exec(s);
};
const UPDATED = '2026-10-20T10:00:00.000Z';

describe('0015 backfills on 0014 data', () => {
  const pg = new PGlite();
  const ids: Record<string, string> = {};
  afterAll(() => pg.close());

  beforeAll(async () => {
    const at0015 = entries.findIndex((e) => e.tag === '0015_hr_staff_workspaces');
    for (const { tag } of entries.slice(0, at0015)) await apply(pg, tag);
    const base = await seedBase(pg);
    const task = (o: Row) =>
      insert(pg, 'ops.staff_tasks', {
        staff_id: base.staff,
        title: 'Sample task',
        due_on: '2026-10-25',
        due_time: '17:00',
        created_by: base.user,
        updated_at: UPDATED,
        ...o,
      });
    const event = (task_id: string, o: Row) =>
      insert(pg, 'ops.task_events', { task_id, actor_user_id: base.user, ...o });
    ids.blockedAfterProgress = await task({ status: 'blocked', reason: 'Waiting for fee slip' });
    await event(ids.blockedAfterProgress, {
      kind: 'status_changed',
      to_status: 'in_progress',
      occurred_at: NOW,
    });
    await event(ids.blockedAfterProgress, {
      kind: 'status_changed',
      to_status: 'blocked',
      occurred_at: LATER,
      reason: 'Waiting for fee slip',
    });
    ids.onHoldUntouched = await task({ status: 'on_hold', reason: 'Owner away' });
    ids.onHoldHalfDone = await task({
      status: 'on_hold',
      reason: 'Owner away',
      progress_percent: 40,
    });
    ids.submitted = await task({ status: 'in_review' });
    await event(ids.submitted, {
      kind: 'submitted_for_review',
      to_status: 'in_review',
      occurred_at: NOW,
    });
    await event(ids.submitted, {
      kind: 'submitted_for_review',
      to_status: 'in_review',
      occurred_at: LATER,
    });
    ids.reviewNoEvent = await task({ status: 'in_review' });
    ids.approved = await task({ status: 'done', completed_at: LATER, progress_percent: 100 });
    await event(ids.approved, { kind: 'review_approved', to_status: 'done', occurred_at: LATER });
    await insert(pg, 'ops.eod_reports', {
      staff_id: base.staff,
      report_date: '2026-10-20',
      snapshot: '{}',
      created_by: base.user,
    });
    ids.inactive = await insert(pg, 'core.staff_members', {
      full_name: 'Sample Former',
      status: 'inactive',
    });
    await insert(pg, 'ops.staff_profiles', { staff_id: base.staff });
    await insert(pg, 'ops.staff_profiles', { staff_id: ids.inactive });
    await apply(pg, entries[at0015]!.tag);
  });

  const task = async (id: string) =>
    (
      await pg.query<Row>(
        `SELECT status, reason, blocked_kind, blocked_reason, blocked_at::text, first_submitted_at::text,
                last_submitted_at::text, approved_at::text, original_due_on::text, original_due_time::text
           FROM ops.staff_tasks WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const iso = (t: string) => new Date(t).toISOString();

  it.each([
    [
      'blocked after progress → in_progress, flag kept',
      'blockedAfterProgress',
      {
        status: 'in_progress',
        reason: null,
        blocked_kind: 'blocked',
        blocked_reason: 'Waiting for fee slip',
      },
    ],
    [
      'on hold, no history, 0% → pending',
      'onHoldUntouched',
      { status: 'pending', blocked_kind: 'on_hold', blocked_reason: 'Owner away' },
    ],
    [
      'on hold, no history, 40% → in_progress',
      'onHoldHalfDone',
      { status: 'in_progress', blocked_kind: 'on_hold' },
    ],
    [
      'not blocked → no flag',
      'submitted',
      { status: 'in_review', blocked_kind: null, blocked_at: null },
    ],
    [
      'original deadline = deadline on record',
      'approved',
      { original_due_on: '2026-10-25', original_due_time: '17:00:00' },
    ],
  ] as const)('%s', async (_name, key, expected) => {
    expect(await task(ids[key]!)).toMatchObject(expected);
  });

  it('takes blocked_at from the blocking event, else the last change', async () => {
    expect(iso((await task(ids.blockedAfterProgress!))!.blocked_at as string)).toBe(iso(LATER));
    expect(iso((await task(ids.onHoldUntouched!))!.blocked_at as string)).toBe(UPDATED);
  });

  it('fills first / latest submission and approval from the history', async () => {
    const submitted = (await task(ids.submitted!))!;
    expect(
      [submitted.first_submitted_at, submitted.last_submitted_at].map((t) => iso(t as string)),
    ).toEqual([iso(NOW), iso(LATER)]);
    const noEvent = (await task(ids.reviewNoEvent!))!;
    expect(iso(noEvent.first_submitted_at as string)).toBe(UPDATED);
    expect(iso((await task(ids.approved!))!.approved_at as string)).toBe(iso(LATER));
  });

  it('makes old EOD reports day reports and maps employment status', async () => {
    const reports = await pg.query(
      `SELECT period_kind, period_start::text, period_end::text, report_date::text FROM ops.eod_reports`,
    );
    expect(reports.rows).toEqual([
      {
        period_kind: 'day',
        period_start: '2026-10-20',
        period_end: '2026-10-20',
        report_date: '2026-10-20',
      },
    ]);
    const profiles = await pg.query<{ status: string; employment_status: string }>(
      `SELECT m.status, p.employment_status FROM ops.staff_profiles p JOIN core.staff_members m ON m.id = p.staff_id ORDER BY 1`,
    );
    expect(profiles.rows).toEqual([
      { status: 'active', employment_status: 'active' },
      { status: 'inactive', employment_status: 'not_recorded' },
    ]);
  });
});
