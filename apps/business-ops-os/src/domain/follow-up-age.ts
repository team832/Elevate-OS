/** How late or near a follow-up is, in IST calendar days: "Overdue · 29 days (22 Sept)". Pure. */
import { daysBetween, type IsoDate } from './dates';

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function followUpAge(dueDate: string, today: IsoDate): string {
  const late = daysBetween(dueDate as IsoDate, today);
  const age =
    late > 0
      ? `Overdue · ${days(late)}`
      : late === 0
        ? 'Due today'
        : late === -1
          ? 'Due tomorrow'
          : `Due in ${days(-late)}`;
  const date = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dueDate}T00:00:00Z`));
  return `${age} (${date})`;
}
