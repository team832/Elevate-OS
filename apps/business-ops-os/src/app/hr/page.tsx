import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, PageHeader, StatCard } from '@elevate/shared-ui';
import { hrDecisionCounts, staffWorkload } from '../../server/hr-overview';
import { directoryQuery } from '../../server/hr-schemas';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR overview' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/hr';

export default async function HrOverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:hr:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr">
      <PageHeader
        title="HR overview"
        description="What needs a decision today. Every number opens the list it counts."
      />
      <Section label="Loading decisions…">
        <Decisions user={access.user} />
      </Section>
      <Section label="Loading workload…">
        <Workload user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Decisions({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => hrDecisionCounts(db, user));
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      {r.data.map((a) => (
        <Segment key={a.area} title={a.area}>
          {a.status === 'unavailable' ? (
            <Alert tone="warning">
              Source unavailable — these counts could not be read just now.
            </Alert>
          ) : a.counts.length ? (
            <ul className="el-grid ops-kpis">
              {a.counts.map((c) => (
                <li key={c.key}>
                  <StatCard label={c.label} value={c.value} href={c.href} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="el-field-hint">Nothing recorded in this area yet.</p>
          )}
        </Segment>
      ))}
    </div>
  );
}

async function Workload({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const page = directoryQuery.shape.page.catch(1).parse(sp.page);
  const r = await load((db) => staffWorkload(db, user, page));
  if (!r.ok) return r.view;
  if (!r.data) return null;
  const w = r.data;
  return (
    <Segment title="Staff workload" flush>
      <details className="el-explain">
        <summary>How this is counted</summary>
        Open tasks per person: assigned, in progress, submitted or sent back for changes (not
        drafts, approved or cancelled). Listed by name; it is not a ranking or a rating. Every task
        has one accountable assignee, so there is no unassigned work to list.
      </details>
      <RecordTable
        caption={`${w.total} staff member${w.total === 1 ? '' : 's'}`}
        rows={w.rows}
        rowKey={(x) => x.id}
        rowHref={(x) => listHref('/ops/hr/tasks', { staffId: x.id })}
        linkColumn="name"
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'open', header: 'Open tasks', numeric: true },
          { key: 'submitted', header: 'Awaiting review', numeric: true },
        ]}
      />
      <Pager basePath={BASE} params={sp} page={w.page} pageSize={w.pageSize} total={w.total} />
    </Segment>
  );
}
