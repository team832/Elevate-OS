import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IsoDate } from '../../src/domain/dates';
import { followUpAge } from '../../src/domain/follow-up-age';
import { AttendanceCell, FollowUpCell } from '../../src/app/admissions/_components/demo-bits';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const TODAY = '2026-10-21' as IsoDate;

describe('followUpAge', () => {
  it.each([
    ['2026-09-22', 'Overdue · 29 days (22 Sept)'],
    ['2026-10-20', 'Overdue · 1 day (20 Oct)'],
    ['2026-10-21', 'Due today (21 Oct)'],
    ['2026-10-22', 'Due tomorrow (22 Oct)'],
    ['2026-10-25', 'Due in 4 days (25 Oct)'],
    ['2025-10-21', 'Overdue · 365 days (21 Oct 2025)'],
  ])('%s → %s', (due, text) => expect(followUpAge(due, TODAY)).toBe(text));
});

describe('AttendanceCell', () => {
  const past = new Date(Date.now() - 60_000);
  const cell = (attendance: string, startsAt: Date, write = true, recordedAt: Date | null = null) =>
    renderToStaticMarkup(
      <AttendanceCell
        action="/ops/api/v1/demos/d/sessions/s"
        label="Day 1, class 1"
        s={{ attendance, startsAt, recordedAt }}
        recorder="Sample Counsellor"
        write={write}
      />,
    );

  it('offers the four one-tap buttons for a started, unrecorded class', () => {
    const html = cell('scheduled', past);
    expect(html).toContain('aria-label="Record attendance: Day 1, class 1"');
    for (const label of ['Present', 'Late', 'Absent', 'Excused'])
      expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('Mark all');
  });

  it.each([
    ['class not started', 'scheduled', new Date(Date.now() + 3_600_000), true],
    ['no write permission', 'scheduled', past, false],
    ['already recorded', 'present', past, true],
  ])('shows the badge only when %s', (_, attendance, startsAt, write) =>
    expect(cell(attendance, startsAt, write)).not.toContain('<button'),
  );

  it('shows who recorded it and when', () =>
    expect(cell('late', past, true, new Date('2026-10-21T05:00:00Z'))).toMatch(
      /Late.*by Sample Counsellor, 21 Oct 2026, 10:30 am IST/,
    ));
});

describe('FollowUpCell', () => {
  const f = { id: 'f1', dueDate: '2020-01-01', state: 'overdue', title: 'Call parent' };
  it('shows the age, and Done only for staff who may close it', () => {
    expect(renderToStaticMarkup(<FollowUpCell followUp={f} />)).toMatch(/Overdue · \d+ days/);
    expect(renderToStaticMarkup(<FollowUpCell followUp={f} />)).not.toContain('Done');
    const done = renderToStaticMarkup(<FollowUpCell followUp={f} canClose />);
    expect(done).toContain(
      '>Done<span class="el-visually-hidden"> for Call parent</span></button>',
    );
    expect(done).toContain('Mark done<span class="el-visually-hidden">: Call parent</span>');
  });
});
