/**
 * HR Overview counts for work reports (fixed interface, PLAN.md): missing end-of-day reports for
 * yesterday, missing weekly reports for the last week, and reports of the staff HR manages
 * waiting for review (never the viewer's own). Each count is the total of the very query behind
 * the list its link opens.
 */
import type { Database } from '@elevate/database';
import { addDays, istToday, type IsoDate } from '../domain/dates';
import type { Actor } from './context';
import { eodInbox } from './eod-review';
import type { HrCount } from './hr-overview';
import { workReportList } from './work-reports';

export async function hrReportCounts(db: Database, user: Actor): Promise<HrCount[]> {
  const now = new Date();
  const yesterday = addDays(istToday(now), -1);
  const lastWeek = addDays(istToday(now), -7);
  const missing = async (kind: 'day' | 'week', date: IsoDate) =>
    (await workReportList(db, user, { kind, date, standing: 'missing', page: 1 })).total;
  const eod = await missing('day', yesterday);
  const weekly = await missing('week', lastWeek);
  const waiting = await eodInbox(db, user, { status: 'submitted', page: 1 }, 1, { hr: true });
  return [
    {
      key: 'reports_missing_eod',
      label: 'Missing end-of-day reports (yesterday)',
      value: eod,
      href: `/ops/hr/reports?kind=day&date=${yesterday}&standing=missing`,
    },
    {
      key: 'reports_missing_weekly',
      label: 'Missing weekly reports (last week)',
      value: weekly,
      href: `/ops/hr/reports?kind=week&date=${lastWeek}&standing=missing`,
    },
    {
      key: 'reports_awaiting_review',
      label: 'Reports waiting for review',
      value: waiting.total,
      href: '/ops/hr/reports?view=waiting',
    },
  ];
}
