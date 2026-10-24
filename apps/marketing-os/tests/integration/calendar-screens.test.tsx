/** Calendar, Deliverables and idea screens (brief §12, §13): views, empty states, badges, scope of controls. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { marketingCalendarItems, marketingPlacements, programmes } from '@elevate/database';
import { setupTestDatabase, type TestUser } from '@elevate/testing';
import { toIsoDate } from '@elevate/shared-types';
import CalendarPage from '../../src/app/calendar/page';
import CalendarItemPage from '../../src/app/calendar/[id]/page';
import DeliverablesPage from '../../src/app/deliverables/page';
import IdeaDetailPage from '../../src/app/ideas/[id]/page';
import IdeasPage from '../../src/app/ideas/page';
import { IDEA_SCOPE_LABELS, IDEA_STATUS_LABELS } from '../../src/domain';
import {
  calendarCounts,
  calendarListHref,
  changeIdeaStatus,
  createContentItem,
  createIdea,
  createPlacement,
} from '../../src/server';
import { seedRegistry, uniqueTitle } from '../helpers';
import { marketingStaff, type Staff } from './marketing-people';

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

const render = async (page: Promise<React.ReactNode>, user: TestUser) => {
  state.user = user;
  return (await new Response((await prerender(await page)).prelude).text()).replaceAll(
    '<!-- -->',
    '',
  );
};
const sp = (v: Record<string, string>) => ({ searchParams: Promise.resolve(v) });

let manager: Staff;
let anika: Staff;
let itemId: string;
const today = toIsoDate();

beforeAll(async () => {
  await seedRegistry(ctx.db);
  manager = await marketingStaff(ctx.db, 'marketing_manager', 'Sample Manager Meera');
  anika = await marketingStaff(ctx.db, 'marketing_contributor', 'Sample Marketer Anika');
});

describe('Marketing calendar screens', () => {
  it.each(['month', 'week', 'list'])(
    '%s view with an empty calendar says what to do next',
    async (view) => {
      const html = await render(CalendarPage(sp({ view })), anika);
      expect(html).toContain('Nothing planned for');
      expect(html).toContain('Add a calendar item');
    },
  );

  it('shows an item on its day with today marked, the sample badge, and drag only for schedulers', async () => {
    const [row] = await ctx.db
      .insert(marketingCalendarItems)
      .values({
        title: 'Sample CLAT current-affairs recap',
        itemType: 'short_video',
        status: 'planned',
        plannedAt: new Date(`${today}T18:30:00+05:30`),
        originalPlannedAt: new Date(`${today}T18:30:00+05:30`),
        ownerStaffId: anika.staffId as never,
        isSample: true,
        createdBy: anika.id,
      })
      .returning();
    itemId = row!.id;
    const month = await render(CalendarPage(sp({ view: 'month' })), manager);
    expect(month).toContain('Sample CLAT current-affairs recap');
    expect(month).toContain('Sample data');
    expect(month).toMatch(/aria-current="date"[^>]*>.*· Today/s);
    expect(month).toContain('draggable="true"');
    expect(await render(CalendarPage(sp({ view: 'week' })), anika)).not.toContain(
      'draggable="true"',
    );
    const list = await render(CalendarPage(sp({ view: 'list' })), anika);
    expect(list).toContain('data-label="Owner">Sample Marketer Anika<');
    expect(list).toContain('data-label="Publication">Not published<');
  });

  it('a scheduled post is named by its content title (code as secondary text) in month and list views', async () => {
    const { idea } = await createIdea(ctx.db, manager, {
      coursePrefix: 'CLAT',
      title: uniqueTitle(),
    });
    const item = await createContentItem(ctx.db, manager, idea.id, {
      title: 'Sample CLAT reading tips post',
      format: 'post',
    });
    const { placement } = await createPlacement(ctx.db, manager, item.id, { accountCode: 'IGC' });
    await ctx.db
      .update(marketingPlacements)
      .set({ status: 'scheduled', scheduledAt: new Date(`${today}T19:00:00+05:30`) })
      .where(eq(marketingPlacements.id, placement.id));
    for (const view of ['month', 'list']) {
      const html = await render(CalendarPage(sp({ view })), manager);
      expect(html).toContain(`/content/${item.id}">Sample CLAT reading tips post</a>`);
      expect(html).not.toContain(`/content/${item.id}">${placement.code}</a>`);
    }
  });

  it('item page: the owner gets production steps, never approval; a manager gets Move', async () => {
    const own = await render(
      CalendarItemPage({ params: Promise.resolve({ id: itemId }), ...sp({}) }),
      anika,
    );
    expect(own).toContain('Start production');
    expect(own).not.toContain('>Approve<');
    expect(own).not.toContain('Move item');
    const mgr = await render(
      CalendarItemPage({ params: Promise.resolve({ id: itemId }), ...sp({}) }),
      manager,
    );
    expect(mgr).toContain('Move item');
    expect(mgr).toContain('Originally planned');
  });

  it('Deliverables: managers see the team list, employees only their own view', async () => {
    const team = await render(DeliverablesPage(sp({})), manager);
    expect(team).toContain('Team deliverables (1)');
    expect(team).toContain('Sample CLAT current-affairs recap');
    expect(await render(DeliverablesPage(sp({})), anika)).not.toContain('Team deliverables');
    expect(await render(DeliverablesPage(sp({ status: 'published' })), manager)).toContain(
      'No deliverables in this period',
    );
  });
});

describe('Calendar drill-downs', () => {
  it('?open=<id> opens the item page', async () => {
    await expect(render(CalendarPage(sp({ open: itemId })), anika)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
  });

  it('a dashboard count equals its drill-down list for a period that is not a month', async () => {
    const at = (d: string) => new Date(`${d}T10:00:00+05:30`);
    const plan = (title: string, day: string, status: 'planned' | 'submitted' | 'published') =>
      ctx.db.insert(marketingCalendarItems).values({
        title,
        itemType: 'article',
        status,
        plannedAt: at(day),
        originalPlannedAt: at(day),
        ownerStaffId: anika.staffId as never,
        createdBy: anika.id,
        ...(status === 'published'
          ? {
              approvedAt: at(day),
              approvedBy: manager.id,
              publishedAt: at(day),
              publishedBy: manager.id,
              publicationEvidence: 'Sample',
            }
          : {}),
      });
    await plan('Sample drill A', '2026-11-03', 'planned');
    await plan('Sample drill B', '2026-11-09', 'submitted');
    await plan('Sample drill C', '2026-11-05', 'published');
    await plan('Sample drill D', '2026-11-10', 'planned');
    const counts = await calendarCounts(
      ctx.db,
      { from: new Date('2026-11-03T00:00:00+05:30'), to: new Date('2026-11-10T00:00:00+05:30') },
      anika.staffId,
    );
    expect(counts).toEqual({ due: 2, awaitingReview: 1 });
    const rows = async (q: Parameters<typeof calendarListHref>[0]) => {
      const params = Object.fromEntries(new URL(calendarListHref(q), 'http://x').searchParams);
      const html = await render(CalendarPage(sp(params)), manager);
      return (html.match(/data-label="Title"/g) ?? []).length;
    };
    const period = { from: '2026-11-03', to: '2026-11-09', owner: anika.staffId };
    expect(await rows({ ...period, due: true })).toBe(counts.due);
    expect(await rows({ ...period, status: 'submitted' })).toBe(counts.awaitingReview);
    const [course] = await ctx.db
      .insert(programmes)
      .values({ code: 'SAMPLE_IPMAT_CAL', name: 'Sample IPMAT', status: 'active' })
      .returning({ id: programmes.id });
    await ctx.db
      .update(marketingCalendarItems)
      .set({ programmeId: course!.id })
      .where(eq(marketingCalendarItems.title, 'Sample drill A'));
    const byCourse = await calendarCounts(
      ctx.db,
      { from: new Date('2026-11-03T00:00:00+05:30'), to: new Date('2026-11-10T00:00:00+05:30') },
      anika.staffId,
      undefined,
      course!.id,
    );
    expect(byCourse.due).toBe(1);
    expect(await rows({ ...period, course: course!.id, due: true })).toBe(byCourse.due);
  });
});

describe('Idea screen', () => {
  it('the ideas board and an idea page show status and scope names, never codes', async () => {
    const { idea } = await createIdea(ctx.db, anika, {
      coursePrefix: 'GEN',
      title: uniqueTitle('Sample exam-day checklist'),
      scopePrefixes: ['CLAT'],
    });
    await changeIdeaStatus(ctx.db, anika, idea.id, { status: 'in_development' });
    for (const html of [
      await render(IdeasPage(sp({})), manager),
      await render(
        IdeaDetailPage({ params: Promise.resolve({ id: idea.id }), ...sp({}) }),
        manager,
      ),
    ]) {
      expect(html).toContain(IDEA_STATUS_LABELS.in_development);
      expect(html).toContain(IDEA_SCOPE_LABELS[idea.scope]);
      expect(html).not.toMatch(
        />(in development|changes requested|single exam|cross exam|local sikar)[< ]/,
      );
    }
  });

  it('an approved idea offers "Plan it"; the creator sees why they cannot review their own', async () => {
    const { idea } = await createIdea(ctx.db, anika, {
      coursePrefix: 'GEN',
      title: uniqueTitle('Sample teacher-led doubt-solving session'),
      scopePrefixes: ['CLAT'],
    });
    await changeIdeaStatus(ctx.db, anika, idea.id, { status: 'submitted' });
    const waiting = await render(
      IdeaDetailPage({ params: Promise.resolve({ id: idea.id }), ...sp({}) }),
      anika,
    );
    expect(waiting).toContain('Another approver must review an idea you own or created.');
    await changeIdeaStatus(ctx.db, manager, idea.id, { status: 'approved' });
    const html = await render(
      IdeaDetailPage({ params: Promise.resolve({ id: idea.id }), ...sp({}) }),
      anika,
    );
    expect(html).toContain('Plan it');
    expect(html).toContain('Calendar item type');
  });
});
