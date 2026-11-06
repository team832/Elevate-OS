/**
 * F4-08 calendar: a month or a week of calendar days (Monday first) holding items from the pages
 * that own them. A day is a `YYYY-MM-DD` in IST; an instant lands on its IST day with its IST time.
 * Each item says its kind in words and links to its record (plain text when it has none). On
 * phones it is a list of the days that hold something; on paper and wide screens the month grid.
 */
import {
  addDays,
  fmtDay,
  isIsoDate,
  TIMEZONE,
  toIsoDate,
  type IsoDate,
} from '@elevate/shared-types';
import { SampleBadge } from './data';
import { Subnav } from './layout';
import { Alert } from './states';
import '../css/calendar.css';

export const CALENDAR_KINDS = {
  class: 'Class',
  test: 'Test',
  task: 'Task due',
  leave: 'Leave',
  holiday: 'Holiday',
  closure: 'Closure',
  meeting: 'Meeting',
  demo: 'Demo',
} as const;
export type CalendarKind = keyof typeof CALENDAR_KINDS;
export type CalendarView = 'month' | 'week';

export interface CalendarItem {
  id: string;
  kind: CalendarKind;
  title: string;
  /** An instant (shown on its IST day, with its time) or a whole calendar day. */
  start: Date | string;
  /** Last day of a multi-day item (leave), inclusive. */
  until?: string;
  href?: string;
  sample?: boolean;
}

export type CalendarRange = ReturnType<typeof calendarRange>;
/** A source that returned only part of the range: its first `shown` of `total` rows (null = unknown). */
export type CalendarCut = { what: string; shown: number; total: number | null };
/** The cut, when `shown` is short of `total`; `total` null = the source stopped at its limit, total unknown. */
export const calendarCut = (what: string, shown: number, total: number | null): CalendarCut[] =>
  total === null || shown < total ? [{ what, shown, total }] : [];

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const monday = (d: IsoDate) => addDays(d, -((utc(d).getUTCDay() + 6) % 7));
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01` as IsoDate;

/** The days a `?view=month|week&date=YYYY-MM-DD` query shows (today's month by default) and the dates either side. */
export function calendarRange(query: { view?: string; date?: string }, today: IsoDate) {
  const view: CalendarView = query.view === 'week' ? 'week' : 'month';
  const date = isIsoDate(query.date) ? query.date : today;
  const from = view === 'week' ? monday(date) : firstOfMonth(date);
  const next = view === 'week' ? addDays(date, 7) : firstOfMonth(addDays(from, 31));
  const to = view === 'week' ? addDays(from, 6) : addDays(next, -1);
  const prev = view === 'week' ? addDays(date, -7) : firstOfMonth(addDays(from, -1));
  const days = Array.from({ length: view === 'week' ? 7 : Number(to.slice(8)) }, (_, i) =>
    addDays(from, i),
  );
  return { view, date, from, to, days, prev, next };
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
});

/** Items by IST day, inside the range; whole-day items first, then by time. */
function byDay(items: readonly CalendarItem[], range: CalendarRange) {
  const days = new Map<string, CalendarItem[]>();
  const at = (i: CalendarItem) => (typeof i.start === 'string' ? -Infinity : i.start.getTime());
  for (const item of [...items].sort((a, b) => at(a) - at(b))) {
    const first = typeof item.start === 'string' ? item.start : toIsoDate(item.start);
    for (let d = first as IsoDate; d <= (item.until ?? first); d = addDays(d, 1))
      if (d >= range.from && d <= range.to) days.set(d, [...(days.get(d) ?? []), item]);
  }
  return days;
}

function Item({ item }: { item: CalendarItem }) {
  const body = (
    <>
      <span className="el-cal-kind">{CALENDAR_KINDS[item.kind]}</span>{' '}
      {typeof item.start === 'string' ? null : (
        <>
          <span className="el-cal-time">{TIME.format(item.start)}</span>{' '}
        </>
      )}
      {item.title}
      {item.sample ? <SampleBadge /> : null}
    </>
  );
  return item.href ? (
    <a className="el-cal-item" data-kind={item.kind} href={item.href}>
      {body}
    </a>
  ) : (
    <span className="el-cal-item" data-kind={item.kind}>
      {body}
    </span>
  );
}

export function Calendar({
  range,
  items,
  href,
  today,
  cut = [],
}: {
  range: CalendarRange;
  items: readonly CalendarItem[];
  /** Sources cut short: each says so above the grid, so nothing is dropped silently. */
  cut?: readonly CalendarCut[];
  /** The page's own link for a view and date (keeps its other query values). */
  href: (q: { view: CalendarView; date: IsoDate }) => string;
  today: IsoDate;
}) {
  const days = byDay(items, range);
  const week = range.view === 'week';
  const title = week ? `Week of ${fmtDay(range.from)}` : MONTH.format(utc(range.from));
  const cells: (IsoDate | null)[] = [
    ...Array<null>((utc(range.from).getUTCDay() + 6) % 7).fill(null),
    ...range.days,
  ];
  while (cells.length % 7) cells.push(null);
  const unit = week ? 'week' : 'month';
  return (
    <section className="el-cal">
      <div className="el-cal-head">
        <h2 id="el-cal-title">{title}</h2>
        <nav className="el-cal-nav" aria-label="Calendar dates">
          <a href={href({ view: range.view, date: range.prev })}>Previous {unit}</a>
          <a href={href({ view: range.view, date: today })}>Today</a>
          <a href={href({ view: range.view, date: range.next })}>Next {unit}</a>
        </nav>
        <Subnav
          label="Calendar view"
          items={[
            [href({ view: 'month', date: range.date }), 'Month'],
            [href({ view: 'week', date: range.date }), 'Week'],
          ]}
          current={href({ view: range.view, date: range.date })}
        />
      </div>
      {cut.map((c) => (
        <Alert key={c.what} tone="warning">
          {`Showing the first ${c.shown.toLocaleString('en-IN')}${c.total === null ? '' : ` of ${c.total.toLocaleString('en-IN')}`} ${c.what} in this ${unit}${c.total === null ? '; there may be more' : ''}.`}
        </Alert>
      ))}
      {days.size ? null : (
        <p className="el-cal-empty">
          Nothing in {week ? `the week of ${fmtDay(range.from)}` : title}.
        </p>
      )}
      <table className="el-cal-grid" aria-labelledby="el-cal-title">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col">
                <abbr title={d}>{d.slice(0, 3)}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <tr key={w}>
              {cells.slice(w * 7, w * 7 + 7).map((day, i) => {
                if (!day) return <td key={i} className="el-cal-pad"></td>;
                const list = days.get(day) ?? [];
                return (
                  <td
                    key={day}
                    aria-current={day === today ? 'date' : undefined}
                    data-empty={list.length ? undefined : ''}
                  >
                    <h3 className="el-cal-date">
                      <time dateTime={day}>
                        <span className="el-cal-dnum" aria-hidden="true">
                          {Number(day.slice(8))}
                        </span>
                        <span className="el-cal-dlong">{`${LONG_DAY.format(utc(day))}, ${fmtDay(day)}`}</span>
                      </time>
                    </h3>
                    {list.length ? (
                      <ul>
                        {list.map((item) => (
                          <li key={item.kind + item.id}>
                            <Item item={item} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
