import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, ButtonLink, Card, DataTable, EmptyState, Subnav } from '@elevate/shared-ui';
import { redirect } from 'next/navigation';
import { toAppPath } from '@elevate/server-kit/next';
import { addDays, daysBetween, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import {
  CALENDAR_STATUSES,
  CALENDAR_STATUS_LABELS,
  CALENDAR_VIEWS,
  CHANNEL_LABELS,
  ITEM_TYPE_LABELS,
  calendarMovable,
  calendarStates,
  calendarWindow,
  istTime,
  type CalendarView,
} from '../../domain/calendar';
import {
  MODULE,
  formatIst,
  isOneOf,
  istDate,
  istMidnightUtc,
  modulePath,
  weekLabel,
  weekdayIndex,
} from '../../domain';
import { contentFilter, listCalendar } from '../../server';
import {
  calendarOptions,
  linkedPlacementIds,
  listCalendarItems,
  type CalendarListRow,
} from '../../server/calendar';
import { PlacementBadge } from '../../ui/badges';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';
import { moveItemAction } from './actions';
import { CalendarDrag } from './calendar-drag';
import { CalendarStatusBadge, Choice, SampleBadge } from './item-ui';
import './calendar.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Marketing calendar' };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VIEW_LABELS: Record<CalendarView, string> = { month: 'Month', week: 'Week', list: 'List' };
const ist = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options });
const dayLabel = ist({ weekday: 'short', day: 'numeric', month: 'short' });
const monthLabel = ist({ month: 'long', year: 'numeric' });
const uuidOrUndefined = (v: string | undefined) =>
  v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
/** A published entry sits on its publication time, everything else on its planned time. */
const whenOf = (r: {
  publishedAt: Date | null;
  plannedAt?: Date | null;
  scheduledAt?: Date | null;
}) => r.publishedAt ?? r.plannedAt ?? r.scheduledAt ?? null;

type Posts = Awaited<ReturnType<typeof listCalendar>>;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawView = param(sp, 'view');
  const view: CalendarView = isOneOf(CALENDAR_VIEWS, rawView) ? rawView : 'month';
  const rawDate = param(sp, 'date');
  const date = (rawDate && isIsoDate(rawDate) ? rawDate : toIsoDate()) as IsoDate;
  const owner = uuidOrUndefined(param(sp, 'owner'));
  const campaign = uuidOrUndefined(param(sp, 'campaign'));
  const course = uuidOrUndefined(param(sp, 'course'));
  const rawStatus = param(sp, 'status');
  const status = isOneOf(CALENDAR_STATUSES, rawStatus) ? rawStatus : undefined;
  // ?open=<id> (drill-downs from Targets and the dashboard) opens the item's own page.
  const open = uuidOrUndefined(param(sp, 'open'));
  if (open) redirect(toAppPath(modulePath(`calendar/${open}`), MODULE.basePath));
  const due = param(sp, 'due') === '1' ? '1' : undefined;
  const [rawFrom, rawTo] = [param(sp, 'from'), param(sp, 'to')];
  // An exact period (dashboard drill-down) wins over the month or week around `date`.
  const span = isIsoDate(rawFrom) && isIsoDate(rawTo) ? daysBetween(rawFrom, rawTo) : -1;
  const exact = span >= 0 && span <= 366;
  const win =
    exact && isIsoDate(rawFrom) && isIsoDate(rawTo)
      ? { from: rawFrom, to: rawTo, prev: addDays(rawFrom, -span - 1), next: addDays(rawTo, 1) }
      : calendarWindow(view, date);
  const period = (from: IsoDate): Record<string, string> =>
    exact ? { from, to: addDays(from, span) } : { date: from, from: '', to: '' };
  const query = (over: Record<string, string>) =>
    new URLSearchParams(
      Object.entries({
        view,
        date,
        owner,
        status,
        campaign,
        course,
        due,
        ...(exact ? { from: win.from, to: win.to } : {}),
        ...over,
      }).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
  const href = (over: Record<string, string>) => `${modulePath('calendar')}?${query(over)}`;
  const title = exact
    ? `${dayLabel.format(istMidnightUtc(win.from))} to ${dayLabel.format(istMidnightUtc(win.to))} (IST)`
    : view === 'week'
      ? weekLabel(win.from)
      : `${monthLabel.format(istMidnightUtc(win.from))} (IST)`;
  return (
    <MarketingPage
      permission="marketing:calendar:read"
      path={modulePath('calendar')}
      active="calendar"
      title="Marketing calendar"
      description="Planned content, campaigns, events and deliverables by IST date. Social posts from the content workflow appear read-only."
      searchParams={sp}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const range = {
              from: istMidnightUtc(win.from),
              to: istMidnightUtc(addDays(win.to, 1)),
            };
            const filters = {
              ownerStaffId: owner,
              status,
              campaignId: campaign,
              programmeId: course,
              due: !!due,
            };
            const items = await listCalendarItems(db, { ...range, ...filters });
            const undated = await listCalendarItems(db, { undated: true, ...filters });
            const linked = await linkedPlacementIds(db);
            // Posts carry no owner or calendar status, so a filter shows calendar items only.
            const posts: Posts =
              owner || status || campaign || course || due
                ? []
                : (await listCalendar(db, range, await contentFilter(db, user))).filter(
                    (p) => !linked.has(p.id),
                  );
            const options = await calendarOptions(db);
            const canMove = can(user, 'marketing:schedule:manage');
            const canWrite = can(user, 'marketing:calendar:write');
            const filtered = Boolean(owner || status || campaign || course || due);
            const empty = (
              <EmptyState
                title={filtered ? 'Nothing matches these filters' : `Nothing planned for ${title}`}
                description={
                  filtered
                    ? 'Clear the filters to see the whole calendar.'
                    : 'Add an item, or plan an approved idea from the Ideas board.'
                }
                action={
                  canWrite ? (
                    <ButtonLink href={modulePath('calendar/new')}>Add a calendar item</ButtonLink>
                  ) : undefined
                }
              />
            );
            return (
              <div className="el-stack">
                <div className="el-inline-form">
                  <Subnav
                    label="Calendar view"
                    current={href({ view })}
                    items={CALENDAR_VIEWS.map((v) => [href({ view: v }), VIEW_LABELS[v]] as const)}
                  />
                  <a href={href(period(win.prev))}>Previous</a>
                  <strong>{title}</strong>
                  <a href={href(period(win.next))}>Next</a>
                  <a href={href({ date: toIsoDate(), from: '', to: '' })}>Today</a>
                  {canWrite ? (
                    <ButtonLink variant="primary" href={modulePath('calendar/new')}>
                      New item
                    </ButtonLink>
                  ) : null}
                </div>
                <form method="get" className="el-inline-form">
                  <input type="hidden" name="view" value={view} />
                  {Object.entries({
                    date,
                    due,
                    ...(exact ? { from: win.from, to: win.to } : {}),
                  }).map(([k, v]) =>
                    v ? <input key={k} type="hidden" name={k} value={v} /> : null,
                  )}
                  <Choice
                    id="owner"
                    label="Owner"
                    empty="All"
                    value={owner}
                    options={options.owners.map((o) => [o.id, o.name])}
                  />
                  <Choice
                    id="status"
                    label="Status"
                    empty="All"
                    value={status}
                    options={CALENDAR_STATUSES.map((s) => [s, CALENDAR_STATUS_LABELS[s]])}
                  />
                  <Choice
                    id="campaign"
                    label="Campaign"
                    empty="All"
                    value={campaign}
                    options={options.campaigns.map((c) => [c.id, c.code])}
                  />
                  <Choice
                    id="course"
                    label="Course"
                    empty="All"
                    value={course}
                    options={options.courses.map((c) => [c.id, c.name])}
                  />
                  <Button type="submit" variant="secondary">
                    Apply filters
                  </Button>
                </form>
                {canMove && view !== 'list' ? (
                  <p className="el-field-hint">
                    Drag a card to another day to move it, or open it and use “Move to another
                    date”.
                  </p>
                ) : null}
                {items.length + posts.length === 0 ? (
                  empty
                ) : view === 'list' ? (
                  <ListView items={items} posts={posts} />
                ) : (
                  <CalendarDrag move={moveItemAction} back={query({})}>
                    <Grid
                      from={win.from}
                      to={win.to}
                      items={items}
                      posts={posts}
                      canMove={canMove}
                    />
                  </CalendarDrag>
                )}
                {undated.length ? (
                  <Card
                    title={`Not dated yet (${undated.length})`}
                    description="Ideas on the calendar without a planned date. Open one and use Plan to give it a date."
                  >
                    <ul>
                      {undated.map((i) => (
                        <li key={i.id}>
                          <a href={modulePath(`calendar/${i.id}`)}>{i.title}</a> ·{' '}
                          {ITEM_TYPE_LABELS[i.itemType]} · {i.ownerName ?? 'No owner'}{' '}
                          <SampleBadge sample={i.isSample} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}

function Grid({
  from,
  to,
  items,
  posts,
  canMove,
}: {
  from: IsoDate;
  to: IsoDate;
  items: CalendarListRow[];
  posts: Posts;
  canMove: boolean;
}) {
  const byDay = new Map<string, { at: Date; node: ReactNode }[]>();
  const add = (at: Date | null, node: ReactNode) => {
    if (!at) return;
    const day = istDate(at);
    byDay.set(day, [...(byDay.get(day) ?? []), { at, node }]);
  };
  for (const i of items) {
    const at = whenOf(i);
    const movable = canMove && calendarMovable(i.status);
    add(
      at,
      <li
        key={i.id}
        className="mkt-slot"
        draggable={movable || undefined}
        data-item-id={movable ? i.id : undefined}
        data-time={movable && at ? istTime(at) : undefined}
      >
        <span className="mkt-slot-when">{at ? istTime(at) : '—'}</span>
        <a href={modulePath(`calendar/${i.id}`)}>{i.title}</a>
        <span>{ITEM_TYPE_LABELS[i.itemType]}</span>
        <CalendarStatusBadge status={i.status} />
        <SampleBadge sample={i.isSample} />
      </li>,
    );
  }
  for (const p of posts) {
    add(
      whenOf(p),
      <li key={p.id} className="mkt-slot">
        <span className="mkt-slot-when">{istTime(whenOf(p)!)}</span>
        <span>{p.accountCode}</span>
        {p.contentItemId ? <PostLink p={p} /> : <span>{p.code ?? p.legacyCode}</span>}
        <PlacementBadge status={p.status} mode={p.publicationMode} />
      </li>,
    );
  }
  const today = toIsoDate();
  const days: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <>
      <div className="mkt-weekdays" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ol
        className="mkt-calendar"
        aria-label={`Days from ${from} to ${to} (IST)`}
        style={{ '--mkt-start': weekdayIndex(from) + 1 } as CSSProperties}
      >
        {days.map((day) => {
          const list = (byDay.get(day) ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
          return (
            <li
              key={day}
              className="mkt-day"
              data-day={day}
              data-empty={list.length ? undefined : ''}
              aria-current={day === today ? 'date' : undefined}
            >
              <h2 className="mkt-day-head">
                {dayLabel.format(istMidnightUtc(day))}
                {day === today ? ' · Today' : ''}
              </h2>
              {list.length ? <ul className="mkt-day-list">{list.map((e) => e.node)}</ul> : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** A post named by its content title; the placement code stays as a secondary reference. */
const PostLink = ({ p }: { p: Posts[number] }) => (
  <>
    <a href={modulePath(`content/${p.contentItemId}`)}>{p.contentTitle ?? p.code}</a>
    {p.contentTitle ? <span className="el-field-hint"> {p.code}</span> : null}
  </>
);

function ListView({ items, posts }: { items: CalendarListRow[]; posts: Posts }) {
  return (
    <>
      <DataTable
        compact
        caption={`${items.length} calendar item(s)`}
        rows={items}
        rowKey={(i) => i.id}
        empty={
          <EmptyState
            title="No calendar items in this period"
            description="Choose another period, or add a calendar item."
          />
        }
        columns={[
          { key: 'when', header: 'When (IST)', render: (i) => formatIst(whenOf(i)) },
          {
            key: 'title',
            header: 'Title',
            render: (i) => (
              <>
                <a href={modulePath(`calendar/${i.id}`)}>{i.title}</a>{' '}
                <SampleBadge sample={i.isSample} />
              </>
            ),
          },
          { key: 'type', header: 'Type', render: (i) => ITEM_TYPE_LABELS[i.itemType] },
          { key: 'owner', header: 'Owner', render: (i) => i.ownerName ?? 'No owner' },
          {
            key: 'channel',
            header: 'Channel',
            render: (i) => (i.channel ? CHANNEL_LABELS[i.channel] : '—'),
          },
          { key: 'campaign', header: 'Campaign', render: (i) => i.campaignCode ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (i) => <CalendarStatusBadge status={i.status} />,
          },
          {
            key: 'publication',
            header: 'Publication',
            render: (i) => calendarStates(i.status).publication,
          },
        ]}
      />
      {posts.length ? (
        <Card
          title="Social posts (read-only)"
          description="Scheduled and published posts from the content workflow. Open the content item to change them."
        >
          <DataTable
            compact
            rows={posts}
            rowKey={(p) => p.id}
            columns={[
              { key: 'when', header: 'When (IST)', render: (p) => formatIst(whenOf(p)) },
              {
                key: 'code',
                header: 'Post',
                render: (p) => (p.contentItemId ? <PostLink p={p} /> : (p.code ?? p.legacyCode)),
              },
              { key: 'account', header: 'Account', render: (p) => p.accountCode },
              {
                key: 'status',
                header: 'Status',
                render: (p) => <PlacementBadge status={p.status} mode={p.publicationMode} />,
              },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
