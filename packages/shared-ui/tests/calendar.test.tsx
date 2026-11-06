/** F4-08: the shared month/week calendar (IST days, kind labels, real links, phones get a day list, prints as a month). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import type { IsoDate } from '@elevate/shared-types';
import { Calendar, calendarRange, type CalendarItem } from '../src/index';

const today = '2026-11-06' as IsoDate;
const href = (q: { view: string; date: string }) => `/ops/calendar?view=${q.view}&date=${q.date}`;
const cal = (items: CalendarItem[], query: { view?: string; date?: string } = {}) =>
  render(<Calendar range={calendarRange(query, today)} items={items} href={href} today={today} />);
/** The markup of one day's cell. */
const cell = (html: string, day: string) =>
  html.match(new RegExp(`<td[^>]*><h3[^>]*><time dateTime="${day}">.*?</td>`))?.[0] ?? '';

describe('calendarRange', () => {
  it.each([
    ['November 2026: 30 days', {}, '2026-11-01', '2026-11-30', 30],
    ['February 2028 (leap year)', { date: '2028-02-10' }, '2028-02-01', '2028-02-29', 29],
    ['a week, Monday first', { view: 'week', date: '2026-11-06' }, '2026-11-02', '2026-11-08', 7],
    [
      'a week across a month end',
      { view: 'week', date: '2026-12-31' },
      '2026-12-28',
      '2027-01-03',
      7,
    ],
    ['a bad date falls back to today', { date: '2026-02-30' }, '2026-11-01', '2026-11-30', 30],
  ])('%s', (_label, query, from, to, days) => {
    const r = calendarRange(query, today);
    expect([r.from, r.to, r.days.length]).toEqual([from, to, days]);
  });

  it.each([
    [{}, '2026-10-01', '2026-12-01'],
    [{ date: '2026-01-31' }, '2025-12-01', '2026-02-01'],
    [{ view: 'week', date: '2026-11-06' }, '2026-10-30', '2026-11-13'],
  ])('previous and next of %j', (query, prev, next) => {
    expect(calendarRange(query, today)).toMatchObject({ prev, next });
  });
});

describe('Calendar', () => {
  it('a month is a grid with weekday column headings and one heading per day', () => {
    const html = cal([]);
    expect(html).toContain('<h2 id="el-cal-title">November 2026</h2>');
    expect(html).toContain('<table class="el-cal-grid" aria-labelledby="el-cal-title">');
    expect(html.match(/<th scope="col">/g)).toHaveLength(7);
    expect(html).toContain('<th scope="col"><abbr title="Monday">Mon</abbr></th>');
    expect(html.match(/<h3 class="el-cal-date">/g)).toHaveLength(30);
    // 1 Nov 2026 is a Sunday: six blank cells before it, none after the 30th (a Monday) beyond the week.
    expect(html.match(/<td class="el-cal-pad"><\/td>/g)).toHaveLength(6 + 6);
    expect(cell(html, '2026-11-06')).toContain(
      '<span class="el-cal-dlong">Friday, 6 Nov 2026</span>',
    );
  });

  it('marks today for screen readers and sight', () => {
    expect(cal([])).toMatch(
      /<td aria-current="date"[^>]*><h3 class="el-cal-date"><time dateTime="2026-11-06">/,
    );
  });

  it('places an instant on its IST day: 23:30 UTC on the 5th is 5 am on the 6th', () => {
    const html = cal([
      {
        id: 'a',
        kind: 'meeting',
        title: 'Parent meeting',
        start: new Date('2026-11-05T23:30:00Z'),
        href: '/ops/meetings?open=a',
      },
      {
        id: 'b',
        kind: 'class',
        title: 'B1 Quant',
        start: new Date('2026-11-06T18:29:00Z'),
        href: '/academic/teaching/attendance/b',
      },
      {
        id: 'c',
        kind: 'test',
        title: 'Mock 3',
        start: new Date('2026-11-06T18:30:00Z'),
        href: '/academic/assessments/c',
      },
    ]);
    const sixth = cell(html, '2026-11-06');
    expect(sixth).toContain('5:00 am');
    expect(sixth).toContain('11:59 pm');
    expect(sixth).not.toContain('Mock 3');
    expect(cell(html, '2026-11-07')).toContain('Mock 3');
    expect(cell(html, '2026-11-05')).not.toContain('Parent meeting');
  });

  it('every item says its kind and links to its record; whole-day items come first', () => {
    const html = cal([
      {
        id: 'm',
        kind: 'meeting',
        title: 'Counselling',
        start: new Date('2026-11-06T04:30:00Z'),
        href: '/ops/meetings?open=m',
      },
      {
        id: 'h',
        kind: 'holiday',
        title: 'Guru Nanak Jayanti',
        start: '2026-11-06',
        href: '/ops/my-attendance',
      },
      { id: 's', kind: 'closure', title: 'Centre closed', start: '2026-11-06', sample: true },
    ]);
    const sixth = cell(html, '2026-11-06');
    expect(sixth).toContain(
      '<a class="el-cal-item" data-kind="holiday" href="/ops/my-attendance"><span class="el-cal-kind">Holiday</span> Guru Nanak Jayanti</a>',
    );
    expect(sixth).toContain(
      '<a class="el-cal-item" data-kind="meeting" href="/ops/meetings?open=m"><span class="el-cal-kind">Meeting</span> <span class="el-cal-time">10:00 am</span> Counselling</a>',
    );
    // No record page: plain text, never a dead link; fictional records carry the badge.
    expect(sixth).toContain(
      '<span class="el-cal-item" data-kind="closure"><span class="el-cal-kind">Closure</span> Centre closed<span class="el-badge el-badge-sample">SAMPLE DATA</span></span>',
    );
    expect(sixth.indexOf('Guru Nanak')).toBeLessThan(sixth.indexOf('Counselling'));
  });

  it('a multi-day item shows on each of its days inside the range', () => {
    const html = cal([
      {
        id: 'l',
        kind: 'leave',
        title: 'Sample Teacher: Casual leave',
        start: '2026-10-30',
        until: '2026-11-02',
        href: '/x',
      },
    ]);
    expect(cell(html, '2026-11-01')).toContain('Casual leave');
    expect(cell(html, '2026-11-02')).toContain('Casual leave');
    expect(cell(html, '2026-11-03')).not.toContain('Casual leave');
    expect(html.match(/Casual leave/g)).toHaveLength(2);
  });

  it('a day with no data is empty, not "0"; a month with none says so once', () => {
    const html = cal([]);
    expect(cell(html, '2026-11-10')).toMatch(
      /<td data-empty=""><h3 class="el-cal-date">.*<\/h3><\/td>/,
    );
    expect(cell(html, '2026-11-10')).not.toMatch(/>0</);
    expect(html).toContain('<p class="el-cal-empty">Nothing in November 2026.</p>');
    expect(cal([{ id: 'x', kind: 'task', title: 'Report', start: '2026-11-10' }])).not.toContain(
      'el-cal-empty',
    );
  });

  it('navigates by query string: previous, today, next and month/week', () => {
    const html = cal([]);
    expect(html).toContain(
      '<a href="/ops/calendar?view=month&amp;date=2026-10-01">Previous month</a>',
    );
    expect(html).toContain('<a href="/ops/calendar?view=month&amp;date=2026-11-06">Today</a>');
    expect(html).toContain('<a href="/ops/calendar?view=month&amp;date=2026-12-01">Next month</a>');
    expect(html).toContain('<a href="/ops/calendar?view=week&amp;date=2026-11-06">Week</a>');
    expect(html).toMatch(
      /<a href="\/ops\/calendar\?view=month&amp;date=2026-11-06" aria-current="page">Month<\/a>/,
    );
  });

  it('a source cut short says so, with its total when known, instead of dropping rows silently', () => {
    const html = render(
      <Calendar
        range={calendarRange({}, today)}
        items={[]}
        href={href}
        today={today}
        cut={[
          { what: 'tests', shown: 1000, total: 1500 },
          { what: 'classes', shown: 1000, total: null },
        ]}
      />,
    );
    expect(html).toContain('Showing the first 1,000 of 1,500 tests in this month.');
    expect(html).toContain('Showing the first 1,000 classes in this month; there may be more.');
    expect(cal([])).not.toContain('Showing the first');
  });

  it('a month day shows four items and links "+M more" to its week; the week shows them all', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      kind: 'task' as const,
      title: `Task ${i}`,
      start: '2026-11-06',
    }));
    const day = cell(cal(ten), '2026-11-06');
    expect(day.match(/<li>/g)).toHaveLength(4);
    expect(day.match(/<li class="el-cal-over">/g)).toHaveLength(6);
    expect(day).toContain(
      '<a class="el-cal-more" href="/ops/calendar?view=week&amp;date=2026-11-06">+6 more</a>',
    );
    const week = cal(ten, { view: 'week', date: '2026-11-06' });
    expect(week.match(/<li>/g)).toHaveLength(10);
    expect(week).not.toMatch(/el-cal-over|el-cal-more/);
  });

  it('a week is one row of seven days', () => {
    const html = cal([], { view: 'week', date: '2026-11-06' });
    expect(html).toContain('<h2 id="el-cal-title">Week of 2 Nov 2026</h2>');
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html).toContain('Previous week');
    expect(html).toContain('Nothing in the week of 2 Nov 2026.');
  });
});

describe('calendar stylesheet', () => {
  const css = readFileSync(new URL('../src/css/calendar.css', import.meta.url), 'utf8');

  it('phones get a day list (only days with items); print and wide screens the month grid', () => {
    expect(css).toMatch(/\.el-cal-grid td\[data-empty\],\s*\.el-cal-pad \{\s*display: none;/);
    expect(css).toContain('@media print, (min-width: 720px) {');
  });

  it('phones list every item; the month grid and paper hide the rest behind "+M more"', () => {
    const [phone, grid] = css.split('@media print, (min-width: 720px) {');
    expect(phone).toMatch(/\.el-cal-more \{\s*display: none;/);
    expect(grid).toMatch(/\.el-cal-over \{\s*display: none;/);
    expect(grid).toMatch(/\.el-cal-more \{\s*display: inline-block;/);
  });

  it('prints without the navigation, using tokens only', () => {
    expect(css.split('@media print {')[1]).toMatch(/\.el-cal-nav \{\s*display: none;/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
