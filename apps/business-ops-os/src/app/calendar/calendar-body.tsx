import type { Principal } from '@elevate/authorization';
import { Alert, Calendar, calendarRange } from '@elevate/shared-ui';
import { istToday } from '../../domain/dates';
import { opsCalendar } from '../../server/calendar';
import { load } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';

type Params = Record<string, string | undefined>;

/** F4-08: the month or week of the viewer's Ops items; `?view=month|week&date=YYYY-MM-DD`. */
export async function CalendarBody({ user, sp }: { user: Principal; sp: Params }) {
  const today = istToday(new Date());
  const range = calendarRange(sp, today);
  const r = await load((db) => opsCalendar(db, user, range));
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      {r.data.testsUnavailable ? (
        <Alert tone="warning" title="Tests are not shown">
          Academic OS could not be read ({r.data.testsUnavailable}), so tests are missing from this
          calendar, not cancelled.
        </Alert>
      ) : null}
      <Calendar
        range={range}
        items={r.data.items}
        cut={r.data.cut}
        today={today}
        href={(q) => listHref('/ops/calendar', sp, q)}
      />
    </div>
  );
}
