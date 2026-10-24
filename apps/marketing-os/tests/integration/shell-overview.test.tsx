/**
 * MKT-SHELL (brief 23 Oct 2026 §9, §10, §13): campaign edit permission and audit, Personal
 * Settings on the caller's own row only, and Overview figures that equal the lists they open.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  opsLeadSources,
  opsLeadStages,
  marketingCalendarItems,
  programmes,
  staffMembers,
  userPreferences,
} from '@elevate/database';
import { workRoutes } from '@elevate/business-ops-os/work';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { toIsoDate } from '@elevate/shared-types';
import { PATCH as patchCampaign } from '../../src/app/api/v1/campaigns/[id]/route';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { POST as leadStage } from '../../src/app/api/v1/leads/[id]/stage/route';
import LeadsPage from '../../src/app/leads/page';
import { POST as createFollowUp } from '../../src/app/api/v1/follow-ups/route';
import { GET as getPrefs, PUT as putPrefs } from '../../src/app/api/v1/settings/personal/route';
import DashboardPage from '../../src/app/page';
import FollowUpsPage from '../../src/app/follow-ups/page';
import TasksPage from '../../src/app/tasks/page';
import CampaignPage from '../../src/app/campaigns/[id]/page';
import PersonalSettingsPage from '../../src/app/settings/personal/page';
import { createCampaign } from '../../src/server';
import { preferencesBody, saveMyPreferences } from '../../src/server/preferences';
import CalendarPage from '../../src/app/calendar/page';
import MyDayPage from '../../src/app/my-day/page';
import { call, makeTeam, seedRegistry, type Team } from '../helpers';

const ctx = setupTestDatabase();
const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@elevate/database', async (real) => ({
  ...(await real<typeof import('@elevate/database')>()),
  getDb: () => ctx.db,
}));
vi.mock('../../src/ui/shell', async (real) => ({
  ...(await real<typeof import('../../src/ui/shell')>()),
  MarketingPage: (p: { children: (u: unknown) => unknown }) => p.children(state.user),
  Section: (p: { load: () => unknown }) => p.load(),
}));

type Staff = TestUser & { staffId: string };
const render = async (page: Promise<React.ReactNode>, user: TestUser) => {
  state.user = user;
  return (await new Response((await prerender(await page)).prelude).text()).replaceAll(
    '<!-- -->',
    '',
  );
};
const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });

let team: Team;
let departmentId: string;
let hr: Staff;
let manager: Staff;
let ravi: Staff;
let meena: Staff;

async function person(
  role: 'hr_manager' | 'marketing_manager' | 'marketing_contributor',
  name: string,
  managerId?: string,
): Promise<Staff> {
  const user = await createTestUser(ctx.db, { roles: [role] });
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({
      userId: user.id,
      fullName: name,
      departmentId: departmentId as never,
      managerId: managerId as never,
    })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}

beforeAll(async () => {
  await seedRegistry(ctx.db);
  team = await makeTeam(ctx.db);
  const [dept] = await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoUpdate({ target: departments.code, set: { name: 'Marketing & Growth' } })
    .returning({ id: departments.id });
  departmentId = dept!.id;
  hr = await person('hr_manager', 'Sample HR Manager');
  manager = await person('marketing_manager', 'Sample Marketing Manager');
  ravi = await person('marketing_contributor', 'Sample Marketer Ravi', manager.staffId);
  meena = await person('marketing_contributor', 'Sample Marketer Meena', manager.staffId);
  // Overdue tasks: two for Ravi, one for Meena (HR assigns from Business Operations).
  for (const [who, n] of [
    [ravi, 2],
    [meena, 1],
  ] as const)
    for (let i = 0; i < n; i += 1)
      expect(
        (
          await call(workRoutes['staff-tasks'].POST, hr, '/ops/api/v1/staff-tasks', {
            json: {
              title: `Sample overdue task ${who.staffId.slice(0, 4)} ${i}`,
              details: 'Sample work for the Overview test.',
              staffId: who.staffId,
              dueOn: '2020-01-0' + (i + 1),
            },
          })
        ).status,
      ).toBe(201);
  // Follow-ups: two missed, one due today.
  await ctx.db
    .insert(opsLeadSources)
    .values({ code: 'UNKNOWN', label: 'Unknown' })
    .onConflictDoNothing();
  // Reference rows the SEED would add: two lead stages (a new lead starts at "New").
  await ctx.db.insert(opsLeadStages).values([
    { key: 'new', label: 'New', sortOrder: 10 },
    { key: 'contacted', label: 'Contacted', sortOrder: 20 },
  ]);
  const second = await call<{ lead: { id: string } }>(
    createLead,
    manager,
    '/marketing/api/v1/leads',
    {
      json: { studentName: 'Sample Second Lead', studentEmail: 'sample.second@example.test' },
    },
  );
  expect(
    (
      await call(leadStage, manager, '/x', {
        json: { stageKey: 'contacted' },
        params: { id: second.data!.lead.id },
      })
    ).status,
  ).toBe(200);
  const lead = await call<{ lead: { id: string } }>(
    createLead,
    manager,
    '/marketing/api/v1/leads',
    {
      json: { studentName: 'Sample Shell Lead', studentEmail: 'sample.shell@example.test' },
    },
  );
  for (const dueDate of ['2020-02-01', '2020-02-02', toIsoDate()])
    expect(
      (
        await call(createFollowUp, manager, '/marketing/api/v1/follow-ups', {
          json: {
            leadId: lead.data!.lead.id,
            kind: 'general',
            dueDate,
            ownerStaffId: manager.staffId,
          },
        })
      ).status,
    ).toBe(201);
});

describe('campaign edit and status change (marketing:campaigns:write)', () => {
  let id: string;
  let courseId: string;
  beforeAll(async () => {
    id = (
      await createCampaign(ctx.db, team.manager, {
        code: 'SHELL-EDIT',
        name: 'Sample shell campaign',
        status: 'draft',
      })
    ).id;
    const [p] = await ctx.db
      .insert(programmes)
      .values({ code: 'SHELLTEST', name: 'Sample Shell Course', status: 'active' })
      .returning({ id: programmes.id });
    courseId = p!.id;
  });
  const patch = (user: TestUser | null, json: unknown, campaignId = id) =>
    call<Record<string, unknown>>(patchCampaign, user, '/x', {
      method: 'PATCH',
      json,
      params: { id: campaignId },
    });

  it.each([
    ['signed out', null, 401],
    ['a marketing employee', 'contributor', 403],
    ['the director (reads, never edits)', 'director', 403],
    ['a teacher', 'teacher', 403],
  ] as const)('%s cannot edit (%s → %i)', async (_, who, status) => {
    expect((await patch(who ? team[who] : null, { status: 'active' })).status).toBe(status);
  });

  it.each([
    ['dates out of order', { startsOn: '2026-11-02', endsOn: '2026-11-01' }],
    ['an unknown channel', { channels: ['fax'] }],
    ['an unknown field', { budget: 100 }],
    ['nothing to change', {}],
  ])('rejects %s with 400', async (_, json) => {
    expect((await patch(team.manager, json)).status).toBe(400);
  });

  it('404 for an unknown campaign; 400 for an unknown or retired course', async () => {
    expect(
      (await patch(team.manager, { status: 'active' }, '00000000-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
    expect(
      (await patch(team.manager, { programmeId: '00000000-0000-4000-8000-000000000000' })).status,
    ).toBe(400);
    const [retired] = await ctx.db
      .insert(programmes)
      .values({ code: 'SHELLOLD', name: 'Sample Retired Course', status: 'retired' })
      .returning({ id: programmes.id });
    expect((await patch(team.manager, { programmeId: retired!.id })).status).toBe(400);
  });

  it.each([
    ['draft', 'ended', 409],
    ['draft', 'active', 200],
    ['active', 'draft', 409],
    ['active', 'ended', 200],
    ['ended', 'active', 409],
    ['cancelled', 'active', 409],
  ] as const)('status %s to %s answers %i', async (from, to, status) => {
    const c = await createCampaign(ctx.db, team.manager, {
      code: `SHELL-${from}-${to}`.toUpperCase(),
      name: 'Sample transition campaign',
      status: from,
    });
    expect((await patch(team.manager, { status: to }, c.id)).status).toBe(status);
  });

  it('a manager edits course, audience, channels and status; the change is audited old → new', async () => {
    const res = await patch(team.manager, {
      status: 'active',
      programmeId: courseId,
      audience: 'Sample Class 12 students',
      channels: ['instagram', 'whatsapp', 'instagram'],
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      status: 'active',
      programmeId: courseId,
      audience: 'Sample Class 12 students',
      channels: ['instagram', 'whatsapp'],
    });
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'campaign.status_changed')));
    expect(audit).toMatchObject({
      before: { status: 'draft', audience: null },
      after: { status: 'active' },
    });
  });
});

describe('Personal Settings: own row only (core.user_preferences)', () => {
  const body = {
    marketing: {
      dashboard: { period: 'this_week', owner: null, campaign: null, course: null },
      calendarView: 'week',
      workingHours: { start: '09:30', end: '18:00', days: ['mon', 'tue'] },
      focusBlocks: [{ day: 'wed', start: '10:00', end: '12:00', label: 'Scripts' }],
      checklist: [{ label: 'Reply to sample comments', done: false }],
      goals: ['Sample goal: two reels a week'],
    },
    notifications: { reminderIntervalHours: 4, popUps: false },
  };

  it.each([
    ['signed out', null, 401],
    ['without Marketing access', 'teacher', 403],
  ] as const)('%s is refused (%i)', async (_, who, status) => {
    expect((await call(getPrefs, who ? team[who] : null, '/x')).status).toBe(status);
    expect(
      (await call(putPrefs, who ? team[who] : null, '/x', { method: 'PUT', json: body })).status,
    ).toBe(status);
  });

  it('the service itself refuses a user without Marketing access', async () => {
    await expect(
      saveMyPreferences(ctx.db, team.teacher, preferencesBody.parse(body)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('saves the caller’s row, keeps other workspaces’ keys, and audits it', async () => {
    await ctx.db
      .insert(userPreferences)
      .values({ userId: team.contributor.id, settings: { academic: { kept: true } } });
    const res = await call<typeof body>(putPrefs, team.contributor, '/x', {
      method: 'PUT',
      json: body,
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject(body);
    const [row] = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, team.contributor.id));
    expect(row!.settings).toMatchObject({
      academic: { kept: true },
      notifications: { reminderIntervalHours: 4 },
    });
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, team.contributor.id),
          eq(auditEvents.action, 'user_preferences.updated'),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it('another user never reads or writes that row: no user id is accepted, theirs stay defaults', async () => {
    const other = await call<{ marketing: { goals: string[]; calendarView: string } }>(
      getPrefs,
      team.manager2,
      '/x',
    );
    expect(other.data!.marketing).toMatchObject({ goals: [], calendarView: 'month' });
    expect(
      (
        await call(putPrefs, team.manager2, '/x', {
          method: 'PUT',
          json: { ...body, userId: team.contributor.id },
        })
      ).status,
    ).toBe(400);
    const [row] = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, team.contributor.id));
    expect((row!.settings as typeof body).marketing.goals).toEqual([
      'Sample goal: two reels a week',
    ]);
  });

  it.each([
    ['an end before the start', { workingHours: { start: '18:00', end: '09:00', days: ['mon'] } }],
    ['a reminder interval HR does not offer', null],
  ])('rejects %s with 400', async (_, marketing) => {
    const json = marketing
      ? { ...body, marketing: { ...body.marketing, ...marketing } }
      : { ...body, notifications: { reminderIntervalHours: 3, popUps: true } };
    expect((await call(putPrefs, team.manager2, '/x', { method: 'PUT', json })).status).toBe(400);
  });
});

/** The figure and drill-down link of one Overview tile. */
function tileOf(html: string, label: string) {
  const m = new RegExp(
    `href="([^"]+)" class="el-stat el-kpi"><span class="el-stat-label">${label}</span><span class="el-stat-value">(\\d+)<`,
  ).exec(html);
  expect(m, `tile ${label}`).not.toBeNull();
  const url = new URL(m![1]!.replaceAll('&amp;', '&'), 'http://localhost');
  return { value: Number(m![2]), path: url.pathname, query: Object.fromEntries(url.searchParams) };
}
/** The visible note under one Overview tile. */
const noteOf = (html: string, label: string) =>
  new RegExp(
    `${label}</span><span class="el-stat-value">[^<]*</span><span class="el-stat-note">([^<]*)<`,
  ).exec(html)?.[1];
const captionCount = (html: string, noun: string) =>
  Number(new RegExp(`<caption[^>]*>(\\d+) ${noun}`).exec(html)?.[1]);

describe('Overview figures equal the lists they open (§10, §27)', () => {
  it.each([
    ['everyone in scope', {}, 3],
    ['one owner', { owner: 'ravi' }, 2],
  ])(
    'overdue tasks, %s: the tile equals the task tracker with the same filters',
    async (_, f, expected) => {
      const q: Record<string, string> = 'owner' in f ? { owner: ravi.staffId } : {};
      const t = tileOf(await render(DashboardPage(sp(q)), manager), 'Overdue tasks');
      expect(t.value).toBe(expected);
      expect(t.path).toBe('/marketing/tasks');
      const list = await render(TasksPage(sp(t.query)), manager);
      expect(captionCount(list, 'task')).toBe(t.value);
    },
  );

  it('missed follow-ups: the tile equals the follow-up list it opens', async () => {
    const t = tileOf(await render(DashboardPage(sp()), manager), 'Missed follow-ups');
    expect(t.value).toBe(2);
    const list = await render(FollowUpsPage(sp(t.query)), manager);
    expect(captionCount(list, 'follow-up')).toBe(2);
  });

  it('leads awaiting first contact: the tile equals the lead list it opens', async () => {
    const t = tileOf(await render(DashboardPage(sp()), manager), 'Leads awaiting first contact');
    expect(t.value).toBe(2);
    const list = await render(LeadsPage(sp(t.query)), manager);
    expect(captionCount(list, 'lead')).toBe(2);
  });

  it('lead stage funnel: each stage count equals the "reached in the period" list it opens', async () => {
    const today = toIsoDate();
    const html = await render(DashboardPage(sp({ from: today, to: today })), manager);
    const rows = [
      ...html.matchAll(/<a href="([^"]+reached=1)">([^<]+)<\/a><\/td><td[^>]*>(\d+)</g),
    ];
    expect(rows.map((r) => [r[2], Number(r[3])])).toEqual([
      ['New', 2],
      ['Contacted', 1],
    ]);
    for (const [, href, , n] of rows) {
      const url = new URL(href!.replaceAll('&amp;', '&'), 'http://localhost');
      const list = await render(LeadsPage(sp(Object.fromEntries(url.searchParams))), manager);
      expect(captionCount(list, 'lead')).toBe(Number(n));
    }
  });

  it('with no stages in another period the funnel says so instead of drawing zeros', async () => {
    const html = await render(DashboardPage(sp({ from: '2020-01-01', to: '2020-01-31' })), manager);
    expect(html).toContain('No lead reached a stage in this period.');
  });

  it('campaign and course filters: calendar counts apply both, and so does the list they open', async () => {
    const today = toIsoDate();
    const camp = await createCampaign(ctx.db, team.manager, {
      code: 'SHELL-CAL',
      name: 'Sample calendar campaign',
      status: 'active',
    });
    const [course] = await ctx.db
      .insert(programmes)
      .values({ code: 'SHELLCAL', name: 'Sample Calendar Course', status: 'active' })
      .returning({ id: programmes.id });
    const at = new Date();
    for (const [campaignId, programmeId] of [
      [camp.id, course!.id],
      [camp.id, null],
      [null, course!.id],
    ])
      await ctx.db.insert(marketingCalendarItems).values({
        title: 'Sample calendar item',
        itemType: 'social_post',
        plannedAt: at,
        originalPlannedAt: at,
        campaignId: campaignId as never,
        programmeId: programmeId as never,
        createdBy: manager.id,
      });
    const q = { from: today, to: today, campaign: camp.id, course: course!.id };
    const html = await render(DashboardPage(sp(q)), manager);
    const t = tileOf(html, 'Calendar items due');
    expect(t.value).toBe(1);
    expect(t.query).toMatchObject({ campaign: camp.id, course: course!.id });
    expect(noteOf(html, 'Calendar items due')).not.toContain('Not filtered by');
    const list = await render(CalendarPage(sp(t.query)), manager);
    expect(captionCount(list, 'calendar item')).toBe(1);
    // Every other tile says which active filters it does not apply.
    expect(noteOf(html, 'Overdue tasks')).toContain('Not filtered by period, campaign, course');
    expect(noteOf(html, 'Leads awaiting first contact')).toContain(
      'Not filtered by period, campaign, course',
    );
    expect(noteOf(html, 'Content awaiting review')).toContain('Not filtered by period, course');
    expect(noteOf(html, 'Missed follow-ups')).toContain('Not filtered by period, campaign, course');
  });

  it('a course filter keeps campaigns that cover every course', async () => {
    const all = await createCampaign(ctx.db, team.manager, {
      code: 'SHELL-ALLCOURSES',
      name: 'Sample all-course campaign',
      status: 'active',
    });
    const [course] = await ctx.db
      .insert(programmes)
      .values({ code: 'SHELLRUN', name: 'Sample Running Course', status: 'active' })
      .returning({ id: programmes.id });
    const html = await render(DashboardPage(sp({ course: course!.id })), manager);
    expect(html).toContain(`/marketing/campaigns/${all.id}`);
  });

  it('with no filter in the URL the saved defaults apply; a URL filter wins', async () => {
    await ctx.db.insert(userPreferences).values({
      userId: manager.id,
      settings: {
        marketing: {
          dashboard: { period: 'this_week', owner: meena.staffId, campaign: null, course: null },
        },
      },
    });
    const html = await render(DashboardPage(sp()), manager);
    expect(tileOf(html, 'Overdue tasks').value).toBe(1);
    expect(html).toContain('your default filters');
    const explicit = await render(DashboardPage(sp({ owner: ravi.staffId })), manager);
    expect(tileOf(explicit, 'Overdue tasks').value).toBe(2);
    expect(explicit).not.toContain('your default filters');
  });

  it('empty sources say what is missing instead of drawing zeros', async () => {
    const html = await render(DashboardPage(sp()), manager);
    expect(html).toContain('No target overlaps this period.');
    const calendar = tileOf(html, 'Calendar items due');
    expect(calendar).toMatchObject({
      value: 0,
      path: '/marketing/calendar',
      query: { view: 'list' },
    });
  });
});

describe('screens: campaign page and Personal Settings', () => {
  it('a manager sees the editor and lead outcomes counted from Ops records; the director only reads', async () => {
    const { id } = await createCampaign(ctx.db, team.manager, {
      code: 'SHELL-VIEW',
      name: 'Sample view campaign',
      status: 'draft',
    });
    const page = (u: TestUser) =>
      render(CampaignPage({ params: Promise.resolve({ id }), ...sp() }), u);
    const html = await page(team.manager);
    expect(html).toContain('Edit campaign');
    expect(html).toContain('<dt>Leads</dt><dd>0</dd><dt>Had a demo</dt><dd>0</dd>');
    expect(html).toContain('All or several courses');
    expect(await page(team.director)).not.toContain('Edit campaign');
  });

  it('Personal Settings says what it can never change and starts from defaults', async () => {
    const html = await render(PersonalSettingsPage(sp()), team.auditor);
    expect(html).toContain('never change HR deadlines, task assignments, permissions');
    expect(html).toContain('Not saved yet.');
    expect(html).toContain('Reminders HR requires are always sent');
  });
});

describe('My Day', () => {
  it('calendar items due: the count equals the calendar list its link opens, overdue included', async () => {
    const day = 86_400_000;
    for (const offset of [-2, 1, 30])
      await ctx.db.insert(marketingCalendarItems).values({
        title: `Sample Ravi item ${offset}`,
        itemType: 'article',
        plannedAt: new Date(Date.now() + offset * day),
        originalPlannedAt: new Date(Date.now() + offset * day),
        ownerStaffId: ravi.staffId as never,
        createdBy: manager.id,
      });
    const html = await render(MyDayPage(sp()), ravi);
    const m =
      /<h2>Calendar items due \((\d+)\)<\/h2>[\s\S]*?<a href="([^"]+)">Open in the calendar/.exec(
        html,
      );
    expect(Number(m![1])).toBe(2);
    const url = new URL(m![2]!.replaceAll('&amp;', '&'), 'http://localhost');
    const list = await render(CalendarPage(sp(Object.fromEntries(url.searchParams))), ravi);
    expect(captionCount(list, 'calendar item')).toBe(2);
  });
});
