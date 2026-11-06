import type { AuthenticatedUser } from '@elevate/authentication';
import { getDb } from '@elevate/database';
import { Calendar, calendarRange } from '@elevate/shared-ui';
import type { IsoDate } from '@elevate/shared-types';
import { modulePath } from '../../domain';
import { todayIst } from '../../server';
import { academicCalendar } from '../../server/services/calendar';
import { load, LoadError } from '../../ui/shell';

type Params = Record<string, string | string[] | undefined>;
const BASE = modulePath('calendar');

/** F4-08: the month or week of the viewer's classes, tests, closures, leave, own tasks and meetings. */
export async function CalendarBody({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = todayIst() as IsoDate;
  const one = (k: string) => (typeof sp[k] === 'string' ? sp[k] : undefined);
  const range = calendarRange({ view: one('view'), date: one('date') }, today);
  const r = await load(() => academicCalendar(getDb(), user, range));
  if (!r.ok) return <LoadError error={r.error} />;
  return (
    <Calendar
      range={range}
      items={r.data.items}
      cut={r.data.cut}
      today={today}
      href={(q) => `${BASE}?${new URLSearchParams(q)}`}
    />
  );
}
