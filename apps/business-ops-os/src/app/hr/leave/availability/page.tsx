import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { addDays, istToday, istWeekContaining, type IsoDate } from '../../../../domain/dates';
import { teamAvailability } from '../../../../server/hr/leave';
import { formOptions } from '../../../../server/options';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import {
  FilterDate,
  FilterForm,
  FilterSelect,
  isIso,
  TimeNav,
  timeNavItems,
} from '../../attendance/time-ui';

export const dynamic = 'force-dynamic';

type Sp = Record<string, string | undefined>;
const PART = { full: '', first_half: ' (AM)', second_half: ' (PM)' } as const;

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const access = await gate('ops:leave:read', '/ops/hr/leave/availability');
  const sp = await searchParams;
  const week = istWeekContaining(istToday(new Date()));
  const from = (isIso(sp.from) ? sp.from : week.from) as IsoDate;
  const to = (isIso(sp.to) ? sp.to : addDays(from, 13)) as IsoDate;
  return (
    <Frame access={access} active="leave">
      <PageHeader
        title="Team availability"
        description="Who is on leave and who has a shift each day, for the people in your scope. Pending leave is shown so clashes are visible before approval. Up to 31 days."
      />
      <TimeNav current="/ops/hr/leave/availability" items={timeNavItems(access.user)} />
      <Section label="Loading availability…">
        <Grid user={access.user} from={from} to={to} departmentId={sp.departmentId} />
      </Section>
    </Frame>
  );
}

async function Grid({
  user,
  from,
  to,
  departmentId,
}: {
  user: AuthenticatedUser;
  from: IsoDate;
  to: IsoDate;
  departmentId?: string;
}) {
  const r = await load(async (db) => ({
    grid: await teamAvailability(db, user, { from, to, departmentId: departmentId || undefined }),
    departments: (await formOptions(db)).departments,
  }));
  if (!r.ok) return r.view;
  const { grid, departments } = r.data;
  const day = (d: string) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(
      new Date(`${d}T00:00:00Z`),
    );
  return (
    <div className="el-stack">
      <FilterForm action="/ops/hr/leave/availability" submitLabel="Show dates">
        <FilterDate name="from" label="From" value={from} />
        <FilterDate name="to" label="To" value={to} />
        <FilterSelect
          name="departmentId"
          label="Department"
          value={departmentId}
          anyLabel="All departments"
          options={departments}
        />
      </FilterForm>
      {grid.rows.length === 0 ? (
        <EmptyState title="Nobody in your scope for this selection" />
      ) : (
        <div className="el-table-wrap">
          <table className="el-table">
            <caption>
              On leave: L (approved) or P (pending); S = scheduled shift; blank = not scheduled
            </caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                {grid.dates.map((d) => (
                  <th key={d} scope="col">
                    {day(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.staffId}>
                  <th scope="row">{row.fullName}</th>
                  {row.cells.map((c, i) => (
                    <td key={grid.dates[i]}>
                      {c.state === 'on_leave' ? (
                        <a href={`/ops/hr/leave?view=all&staffId=${row.staffId}`} title={c.code}>
                          {c.status === 'approved' ? 'L' : 'P'}
                          {PART[c.part]}
                        </a>
                      ) : c.state === 'scheduled' ? (
                        'S'
                      ) : (
                        ''
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">On leave / scheduled</th>
                {grid.totals.map((t) => (
                  <td key={t.date}>
                    {t.onLeave} / {t.scheduled}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
