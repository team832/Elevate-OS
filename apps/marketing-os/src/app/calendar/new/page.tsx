import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Button, Card, Field, TextInput } from '@elevate/shared-ui';
import { modulePath } from '../../../domain';
import { calendarOptions } from '../../../server/calendar';
import { MarketingPage, Section, type SearchParams } from '../../../ui/shell';
import { createItemAction } from '../actions';
import { ItemFields } from '../item-ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New calendar item' };

export default async function NewCalendarItemPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <MarketingPage
      permission="marketing:calendar:write"
      path={modulePath('calendar/new')}
      active="calendar"
      title="New calendar item"
      description="With a planned time the item starts as Planned; without one it stays an Idea until you plan it."
      searchParams={await searchParams}
    >
      {() => (
        <Section
          load={async () => (
            <Card>
              <form action={createItemAction} className="el-stack">
                <ItemFields options={await calendarOptions(getDb())} />
                <Field id="plannedAt" label="Planned date and time (IST)">
                  <TextInput id="plannedAt" name="plannedAt" type="datetime-local" />
                </Field>
                <div>
                  <Button type="submit">Save calendar item</Button>
                </div>
              </form>
            </Card>
          )}
        />
      )}
    </MarketingPage>
  );
}
