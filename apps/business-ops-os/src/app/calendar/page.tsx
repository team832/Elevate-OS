import { PageHeader } from '@elevate/shared-ui';
import { Frame, gate, Section } from '../../ui/frame';
import { CalendarBody } from './calendar-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:module:access', '/ops/calendar');
  const sp = await searchParams;
  return (
    <Frame access={access} active="calendar">
      <PageHeader
        title="Calendar"
        description="Meetings, demo classes, tasks due, leave, holidays and tests you may see, by day in IST. Classes are on the Academic OS calendar."
      />
      <Section label="Loading calendar…">
        <CalendarBody user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}
