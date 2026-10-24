/**
 * Manager-wide deliverables (brief §9 "Content and Deliverables"): every calendar item of the team
 * in a period, filtered by owner, status and campaign — the same query as the calendar's list view.
 */
import { Button, Card, DataTable, EmptyState, Field, TextInput } from '@elevate/shared-ui';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import {
  CALENDAR_STATUSES,
  CALENDAR_STATUS_LABELS,
  ITEM_TYPE_LABELS,
  calendarStates,
  calendarWindow,
} from '../../domain/calendar';
import { formatIst, isOneOf, istMidnightUtc, modulePath } from '../../domain';
import type { Database } from '@elevate/database';
import { calendarOptions, listCalendarItems } from '../../server/calendar';
import { CalendarStatusBadge, Choice, SampleBadge } from '../calendar/item-ui';

type Params = Record<string, string | undefined>;
const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export async function TeamDeliverables({ db, sp }: { db: Database; sp: Params }) {
  const month = calendarWindow('month', toIsoDate());
  const from = (isIsoDate(sp.from) ? sp.from : month.from) as IsoDate;
  const to = (isIsoDate(sp.to) && sp.to >= from ? sp.to : month.to) as IsoDate;
  const status = isOneOf(CALENDAR_STATUSES, sp.status) ? sp.status : undefined;
  const filters = { ownerStaffId: uuid(sp.owner), campaignId: uuid(sp.campaign), status };
  const rows = await listCalendarItems(db, {
    from: istMidnightUtc(from),
    to: istMidnightUtc(addDays(to, 1)),
    ...filters,
  });
  const options = await calendarOptions(db);
  return (
    <Card
      title={`Team deliverables (${rows.length})`}
      description="Every calendar item planned or published in the period, whoever owns it."
    >
      <form method="get" className="el-inline-form">
        <Field id="from" label="From (IST)">
          <TextInput id="from" name="from" type="date" defaultValue={from} />
        </Field>
        <Field id="to" label="To (IST)">
          <TextInput id="to" name="to" type="date" defaultValue={to} />
        </Field>
        <Choice
          id="owner"
          label="Owner"
          value={filters.ownerStaffId}
          empty="Everyone"
          options={options.owners.map((o) => [o.id, o.name])}
        />
        <Choice
          id="status"
          label="Status"
          value={status}
          empty="Any status"
          options={CALENDAR_STATUSES.map((s) => [s, CALENDAR_STATUS_LABELS[s]])}
        />
        <Choice
          id="campaign"
          label="Campaign"
          value={filters.campaignId}
          empty="Any campaign"
          options={options.campaigns.map((c) => [c.id, c.code])}
        />
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>
      <DataTable
        compact
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            title="No deliverables in this period"
            description="Change the period or filters, or plan items on the Marketing calendar."
            action={<a href={modulePath('calendar')}>Open the calendar</a>}
          />
        }
        columns={[
          { key: 'when', header: 'Planned (IST)', render: (r) => formatIst(r.plannedAt) },
          {
            key: 'title',
            header: 'Deliverable',
            render: (r) => (
              <>
                <a href={modulePath(`calendar/${r.id}`)}>{r.title}</a>{' '}
                <SampleBadge sample={r.isSample} />
              </>
            ),
          },
          { key: 'type', header: 'Type', render: (r) => ITEM_TYPE_LABELS[r.itemType] },
          { key: 'owner', header: 'Owner', render: (r) => r.ownerName ?? 'No owner' },
          { key: 'campaign', header: 'Campaign', render: (r) => r.campaignCode ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (r) => <CalendarStatusBadge status={r.status} />,
          },
          { key: 'review', header: 'Review', render: (r) => calendarStates(r.status).review },
          {
            key: 'publication',
            header: 'Publication',
            render: (r) => calendarStates(r.status).publication,
          },
        ]}
      />
    </Card>
  );
}
