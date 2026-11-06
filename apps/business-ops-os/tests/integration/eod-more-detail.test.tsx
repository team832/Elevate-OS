/**
 * F4-11: "Ask for more detail" (note required, reviewer only, author resubmits, audited), the late
 * filing window and the EOD deadline reminder sent by the task-reminders job. Fictional people only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  notifications,
  opsEodReportVersions,
  opsEodReports,
  opsSettings,
  opsWorkSchedules,
} from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as draftRoute } from '../../src/app/api/v1/eod-reports/route';
import { GET as reportRoute } from '../../src/app/api/v1/eod-reports/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/eod-reports/[id]/submit/route';
import { POST as reviewRoute } from '../../src/app/api/v1/eod-reports/[id]/review/route';
import { ReportEditor, ReportPane } from '../../src/app/tasks/reports/_components/report-views';
import { addDays, istToday } from '../../src/domain/dates';
import { periodOf } from '../../src/domain/work-report';
import { runTaskReminders } from '../../src/server/task-reminders';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const today = istToday(new Date());
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
let lead: StaffUser; // the authors' reporting manager
let reviewer: StaffUser; // operations_manager: EOD reviewer
let other: StaffUser; // a colleague: neither recipient nor reviewer
let teacher: StaffUser; // files from the Academic workspace

type Report = { id: string; status: string; version: number };
const draft = (u: TestUser, json: Record<string, unknown> = {}) =>
  callRoute<Report>(
    draftRoute,
    authedRequest(u, '/ops/api/v1/eod-reports', {
      method: 'POST',
      json: { reportDate: today, summary: 'Sample day', ...json },
    }),
  );
const post = (route: typeof submitRoute, u: TestUser, id: string, json: unknown = {}) =>
  callRoute<Report & { submittedVersion: { id: string; version: number } }>(
    route,
    authedRequest(u, `/ops/api/v1/eod-reports/${id}/x`, { method: 'POST', json }),
    { id },
  );
const ask = (u: TestUser, id: string, text?: string) =>
  post(reviewRoute, u, id, { kind: 'more_detail_requested', ...(text ? { text } : {}) });
const author = () => staffUser(ctx.db, ['admissions_counsellor'], { managerId: lead.staffId });
const setWindow = (days: number | null) =>
  ctx.db
    .insert(opsSettings)
    .values({ key: 'eod.late_filing_window', value: { days }, decisionState: 'proposed' })
    .onConflictDoUpdate({ target: opsSettings.key, set: { value: { days } } });
/** A fresh author's report for `day`, submitted to `lead`. */
async function submitted(day: string = today) {
  const a = await author();
  const r = await draft(a, { reportDate: day });
  expect(r.status).toBe(200);
  expect((await post(submitRoute, a, r.data!.id)).status).toBe(200);
  return { a, id: r.data!.id };
}

beforeAll(async () => {
  await setupReference(ctx.db);
  lead = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Lead' });
  reviewer = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  other = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Colleague' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher' });
});

describe('F4-11 ask for more detail', () => {
  it('needs a note, and only the person it was sent to or an EOD reviewer may ask', async () => {
    const { a, id } = await submitted();
    const blank = await ask(lead, id);
    expect(blank.status).toBe(400);
    expect(JSON.stringify(blank.error!.details)).toContain('Write what you need');
    expect((await ask(other, id, 'More please')).status).toBe(404);
    expect((await ask(a, id, 'More please')).status).toBe(403);
    expect((await ask(reviewer, id, 'Which batches did you call?')).status).toBe(200);
  });

  it.each([
    ['submitted', 'more_detail_requested', 200, 'more_detail_requested'],
    ['more_detail_requested', 'more_detail_requested', 409, 'more_detail_requested'],
    ['more_detail_requested', 'acknowledged', 409, 'more_detail_requested'],
    ['more_detail_requested', 'revision_requested', 409, 'more_detail_requested'],
    ['more_detail_requested', 'comment', 200, 'more_detail_requested'],
    ['acknowledged', 'more_detail_requested', 409, 'acknowledged'],
    ['revision_requested', 'more_detail_requested', 409, 'revision_requested'],
  ] as const)('from %s, %s → %i, stays or becomes %s', async (from, kind, code, after) => {
    const { id } = await submitted();
    if (from !== 'submitted')
      expect((await post(reviewRoute, lead, id, { kind: from, text: 'Sample note' })).status).toBe(
        200,
      );
    const res = await post(reviewRoute, lead, id, { kind, text: 'Sample note' });
    expect(res.status).toBe(code);
    const [row] = await ctx.db
      .select()
      .from(opsEodReports)
      .where(eq(opsEodReports.id, id as never));
    expect(row!.status).toBe(after);
  });

  it('the author sees the note, edits and resubmits: submitted again as version 2, all audited', async () => {
    const { a, id } = await submitted();
    expect((await ask(lead, id, 'Which batches did you call?')).status).toBe(200);
    const view = await callRoute<{ status: string; trail: { kind: string; text: string }[] }>(
      reportRoute,
      authedRequest(a, `/ops/api/v1/eod-reports/${id}`),
      { id },
    );
    expect(view.data!.status).toBe('more_detail_requested');
    expect(view.data!.trail[0]).toMatchObject({
      kind: 'more_detail_requested',
      text: 'Which batches did you call?',
    });
    const [note] = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, a.id), eq(notifications.kind, 'eod.more_detail_requested')),
      );
    expect(note).toMatchObject({ body: 'Which batches did you call?' });
    const edited = await draft(a, { summary: 'Called DEMO-B1 and DEMO-B2' });
    expect(edited.status).toBe(200);
    const again = await post(submitRoute, a, id, { expectedVersion: edited.data!.version });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ status: 'submitted', submittedVersion: { version: 2 } });
    const [v2] = await ctx.db
      .select()
      .from(opsEodReportVersions)
      .where(
        and(eq(opsEodReportVersions.reportId, id as never), eq(opsEodReportVersions.version, 2)),
      );
    expect(v2!.revisionRequestEventId).not.toBeNull();
    const audited = await ctx.db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, id));
    expect(audited.map((x) => x.action)).toEqual(
      expect.arrayContaining(['eod_report.more_detail_requested', 'eod_report.submitted']),
    );
    expect(
      audited.find((x) => x.action === 'eod_report.more_detail_requested')!.metadata,
    ).toMatchObject({
      text: 'Which batches did you call?',
    });
  });
});

describe('F4-11 late filing window (Proposed 2 days after the 20:00 deadline)', () => {
  it('a first filing after the window is refused, naming the window; inside it is accepted', async () => {
    const a = await author();
    const late = await draft(a, { reportDate: addDays(today, -3) });
    expect(late.status).toBe(409);
    expect(late.error!.message).toMatch(
      /^Reports can be filed up to 2 days after the deadline\. Filing for .+ closed at .+ IST\.$/,
    );
    expect((await draft(a, { reportDate: addDays(today, -1) })).status).toBe(200);
  });

  it('a draft saved in time cannot be submitted after it; a report sent back always can', async () => {
    await setWindow(null); // no limit while the reports are filed
    const old = addDays(today, -4);
    const a = await author();
    const kept = await draft(a, { reportDate: old });
    const { a: b, id } = await submitted(old);
    await setWindow(2);
    expect((await post(submitRoute, a, kept.data!.id)).status).toBe(409);
    expect((await ask(lead, id, 'Add the call outcomes')).status).toBe(200);
    expect((await draft(b, { reportDate: old, summary: 'Outcomes added' })).status).toBe(200);
    expect((await post(submitRoute, b, id)).data).toMatchObject({ status: 'submitted' });
  });
});

describe('F4-11 EOD deadline reminder (task-reminders job)', () => {
  const MON = '2026-09-14';
  const SUN = '2026-09-13';
  const remindersOf = (u: TestUser) =>
    ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, u.id), eq(notifications.kind, 'eod.deadline_soon')));

  beforeAll(async () => {
    const nine = { start: '09:00', end: '17:00' };
    await ctx.db.insert(opsWorkSchedules).values({
      name: 'Sample default schedule',
      weeklyPattern: {
        mon: nine,
        tue: nine,
        wed: nine,
        thu: nine,
        fri: nine,
        sat: nine,
        sun: null,
      },
      isDefault: true,
      createdBy: reviewer.id,
    });
  });

  it('once per day per person, only inside the hour before 20:00, not on a weekly off or once submitted', async () => {
    await setWindow(null);
    const { a: sent } = await submitted(MON);
    const a = await author();
    await runTaskReminders(ctx.db, { now: ist(MON, '18:55') });
    await runTaskReminders(ctx.db, { now: ist(SUN, '19:10') });
    expect(await remindersOf(a)).toHaveLength(0);
    for (const t of ['19:05', '19:40', '19:59'])
      await runTaskReminders(ctx.db, { now: ist(MON, t) });
    const [r, ...more] = await remindersOf(a);
    expect(more).toHaveLength(0);
    expect(r).toMatchObject({
      title: 'End-of-day report due by 20:00 IST',
      link: `/ops/tasks?tab=eod&date=${MON}`,
    });
    expect(await remindersOf(sent)).toHaveLength(0);
    await runTaskReminders(ctx.db, { now: ist('2026-09-15', '19:30') });
    expect(await remindersOf(a)).toHaveLength(2);
  });

  it('opens in the person’s own workspace, and nothing is sent when no reminder time is set', async () => {
    const links = async () => (await remindersOf(teacher)).map((n) => n.link);
    await runTaskReminders(ctx.db, { now: ist('2026-09-16', '19:30') });
    expect(await links()).toContain('/academic/tasks?tab=eod&date=2026-09-16');
    const before = (await links()).length;
    await ctx.db.insert(opsSettings).values({
      key: 'eod.deadline_reminder',
      value: { minutesBefore: null },
      decisionState: 'proposed',
    });
    await runTaskReminders(ctx.db, { now: ist('2026-09-17', '19:30') });
    expect(await links()).toHaveLength(before);
    await ctx.db.delete(opsSettings).where(eq(opsSettings.key, 'eod.deadline_reminder'));
  });
});

describe('F4-11 screens (shared work code: Ops, Academic and Marketing)', () => {
  it('the author sees the note and can edit; the reviewer gets "Ask for more detail" while submitted', async () => {
    await setWindow(2);
    const { a, id } = await submitted();
    const pane = await html(
      <ReportPane user={lead} id={id} closeHref="/academic/tasks/inbox" base="/academic" />,
    );
    expect(pane).toContain('Ask for more detail');
    expect(pane).toContain(`/academic/api/v1/eod-reports/${id}/pdf`);
    await ask(lead, id, 'Which batches did you call?');
    const after = await html(
      <ReportPane user={lead} id={id} closeHref="/ops/tasks/inbox" base="/ops" />,
    );
    expect(after).not.toContain('Ask for more detail');
    const mine = await html(
      <ReportEditor user={a} base="/marketing" period={periodOf('day', today)} />,
    );
    expect(mine).toContain('More detail requested');
    expect(mine).toContain('Which batches did you call?');
    expect(mine).toContain('Save draft');
  });

  it('a day whose window has closed says so and offers no form', async () => {
    const a = await author();
    const out = await html(
      <ReportEditor user={a} base="/ops" period={periodOf('day', addDays(today, -3))} />,
    );
    expect(out).toContain('Filing closed');
    expect(out).toContain('Reports can be filed up to 2 days after the deadline.');
    expect(out).not.toContain('Save draft');
  });
});
