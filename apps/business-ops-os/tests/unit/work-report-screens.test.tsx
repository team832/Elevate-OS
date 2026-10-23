import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IsoDate } from '../../src/domain/dates';
import { buildEodFacts } from '../../src/domain/eod';
import { WorkReportFacts } from '../../src/app/tasks/reports/_components/report-facts';

const W = { from: '2026-10-19', to: '2026-10-25' } as { from: IsoDate; to: IsoDate };
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const week = (over: Partial<Parameters<typeof buildEodFacts>[0]> = {}) =>
  buildEodFacts({
    staffId: 's',
    reportDate: '2026-10-19',
    periodKind: 'week',
    periodEnd: '2026-10-25',
    now: ist('2026-10-28', '10:00'),
    tasks: [],
    events: [],
    updates: [],
    academic: { status: 'unavailable', reason: 'Could not reach the source', fetchedAt: '' },
    attendance: { status: 'unavailable', reason: 'HR attendance could not be read' },
    ...over,
  });

describe('WorkReportFacts', () => {
  it('every figure carries its definition; nothing due is not 0%; sources say unavailable', () => {
    const out = renderToStaticMarkup(<WorkReportFacts f={week()} base="/academic" />);
    expect(out.match(/How this is counted/g)).toHaveLength(6);
    expect(out).toContain('On-time submission rate');
    expect(out).toContain('Nothing was due');
    expect(out).not.toContain('0%');
    expect(out).toContain('Source unavailable: Academic OS');
    expect(out).toContain('Source unavailable: HR attendance could not be read');
    expect(out).toContain('Campaign results are not part of this report');
    expect(out).not.toMatch(/rank/i);
  });

  it('optional Academic figures appear only when the contract reports them', () => {
    const m = (value: number) => ({
      status: 'ok' as const,
      value,
      definition: 'x',
      window: W,
      unit: 'count' as const,
    });
    const data = {
      contract: 'academic.teacher_activity' as const,
      version: 1 as const,
      generatedAt: '2026-10-28T04:30:00.000Z' as never,
      staffId: 's' as never,
      window: W,
      assignments: [],
      sessions: { planned: m(5), delivered: m(4), cancelled: m(1), substituted: m(0) },
      logsPending: m(1),
      attendancePending: m(0),
      markingPending: m(0),
      reviews: { submitted: m(0), draft: m(0) },
      unavailability: [],
    };
    const plain = renderToStaticMarkup(
      <WorkReportFacts
        f={week({ academic: { status: 'available', fetchedAt: '2026-10-28T04:30:00.000Z', data } })}
        base="/academic"
      />,
    );
    expect(plain).toContain('4 of 5 scheduled classes delivered');
    expect(plain).not.toContain('assessments prepared');
    expect(plain).not.toContain('Topics covered');
    const more = renderToStaticMarkup(
      <WorkReportFacts
        f={week({
          academic: {
            status: 'available',
            fetchedAt: '2026-10-28T04:30:00.000Z',
            data: {
              ...data,
              topicsCovered: [
                {
                  batchCode: 'DEMO-B1',
                  subjectName: 'Sample Maths',
                  chapterTitle: 'Integration',
                  classes: 2,
                },
              ],
              assessments: { prepared: m(1), marked: m(2) },
            },
          },
        })}
        base="/academic"
      />,
    );
    expect(more).toContain('assessments prepared 1 · assessments marked 2');
    expect(more).toContain('DEMO-B1 Sample Maths: Integration (2)');
  });
});
