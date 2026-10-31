/**
 * A calendar day taken from an instant is the IST day: `toISOString().slice(0, 10)` gives the UTC
 * day, one day behind between 00:00 and 05:30 IST (HMO-024).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionsTable, SummaryView } from '../../src/ui/feedback-development';
import { STUDENT_COLUMNS } from '../../src/app/students/_components/student-list';
import { publicityConsentLine } from '../../src/server/pdf/admission-documents';

const INSTANTS = [
  ['23:30 IST', '2026-10-31T23:30:00+05:30', '31 Oct 2026'],
  ['00:30 IST', '2026-11-01T00:30:00+05:30', '1 Nov 2026'],
  ['05:00 IST', '2026-11-01T05:00:00+05:30', '1 Nov 2026'],
] as const;

describe('the day shown for an instant is the IST day', () => {
  it.each(INSTANTS)('%s (%s) reads %s', (_label, iso, day) => {
    const at = new Date(iso);
    const agreed = renderToStaticMarkup(
      <ActionsTable rows={[{ id: 'a', action: 'x', status: 'open', agreedAt: at } as never]} />,
    );
    expect(agreed).toContain(day);
    const approved = renderToStaticMarkup(
      <SummaryView
        s={{ approvedAt: at, enough: false, comments: [], categories: [] } as never}
        categories={[]}
      />,
    );
    expect(approved).toContain(`Approved by HR on ${day}`);
    expect(publicityConsentLine(at.toISOString())).toContain(
      day.replace(/^(\d) /, '0$1 '), // the paper prints "01 Nov 2026"
    );
  });

  it('a meeting at 00:30 IST on 2 Nov does not count as 1 Nov beside a follow-up due on 1 Nov', () => {
    const line = STUDENT_COLUMNS.next.render!({
      nextMeeting: {
        startsAt: new Date('2026-11-02T00:30:00+05:30'),
        type: 'counselling',
        staffName: 'Sample Teacher',
      },
      nextFollowUp: { dueDate: '2026-11-01', title: 'Call back' },
    } as never);
    expect(String(line)).toContain('Follow-up');
  });
});

describe('no code takes a UTC day from an instant', () => {
  // Calendar arithmetic and IST wall clocks, where the Date never held a real instant.
  const CALENDAR_MATH = /Date\.UTC\(|\+ ?at \+ 330|at\.getTime\(\) \+ 330|\bdt?\.toISOString/;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === 'node_modules' || e.name === '.next' || e.name === 'tests'
        ? []
        : e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
    );

  it('finds no toISOString().slice(0, n) outside calendar arithmetic', () => {
    const root = resolve(__dirname, '../../../..');
    const found = [...walk(join(root, 'apps')), ...walk(join(root, 'packages'))].flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /toISOString\(\)\.(slice|substring|split)\(/.test(line) && !CALENDAR_MATH.test(line)
            ? [`${relative(root, f)}:${i + 1}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
  });
});
