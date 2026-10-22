import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader, StatusBadge } from '@elevate/shared-ui';
import { isIsoDate } from '../../../domain';
import { INSTALMENT_STATUS_LABELS } from '../../../domain/fee-plans';
import { MANUAL_FEE_DISCLAIMER } from '../../../domain/fees';
import { listOutstanding, type OutstandingView } from '../../../server/fee-collections';
import { FeesNav } from '../../../ui/admissions-nav';
import { StatCard } from '../../../ui/charts';
import { fmtDate, fmtPaise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Outstanding instalments' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/fees/outstanding';
const VIEW_LABELS: Record<OutstandingView, string> = {
  due: 'Due by today',
  overdue: 'Overdue',
  upcoming: 'Not yet due',
};

/** /ops/fees/outstanding — tuition instalments with money still owed (read only, ops:fees:read). */
export default async function OutstandingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:fees:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="fees">
      <PageHeader
        title="Outstanding instalments"
        description="Tuition instalments of active fee agreements with money still owed, oldest due date first. To record a payment, open the student's fees."
        tabs={<FeesNav current="outstanding" user={access.user} />}
      />
      <Section label="Loading outstanding instalments…">
        <Outstanding user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Outstanding({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const status = (Object.keys(VIEW_LABELS) as OutstandingView[]).find((v) => v === sp.status);
  const params = {
    status,
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
  };
  const page = Math.max(1, Number.parseInt(sp.page ?? '', 10) || 1);
  const r = await load((db) => listOutstanding(db, user, { ...params, page }));
  if (!r.ok) return r.view;
  const d = r.data;
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Outstanding instalments">
        {(Object.entries(VIEW_LABELS) as [OutstandingView, string][]).map(([v, label]) => (
          <li key={v}>
            <StatCard
              label={label}
              value={d.views[v].count}
              note={`${fmtPaise(d.views[v].owedPaise)} still owed`}
              href={listHref(BASE, {}, { status: v })}
              current={status === v}
            />
          </li>
        ))}
      </ul>
      <form method="get" action={BASE} className="el-inline-form" aria-label="Filter by due date">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {(['from', 'to'] as const).map((name) => (
          <div key={name} className="el-field">
            <label htmlFor={`due-${name}`}>{name === 'from' ? 'Due from' : 'Due to'}</label>
            <input
              id={`due-${name}`}
              name={name}
              type="date"
              className="el-input"
              defaultValue={params[name]}
            />
          </div>
        ))}
        <button type="submit" className="el-button el-button-secondary">
          Show these due dates
        </button>
        <a href={BASE}>Clear filters</a>
      </form>
      <p className="el-field-hint">
        {MANUAL_FEE_DISCLAIMER} An instalment without a due date is never overdue.
      </p>
      <RecordTable
        caption={`${d.total} instalment(s) · ${fmtPaise(d.owedPaise)} still owed${status ? ` · ${VIEW_LABELS[status]}` : ''}`}
        rows={d.rows}
        rowKey={(i) => i.id}
        rowHref={(i) => `/ops/students/${i.studentId}?tab=fees`}
        linkColumn="student"
        empty={
          d.any
            ? 'No instalment matches these filters.'
            : 'Nothing is owed on any active fee agreement you may see.'
        }
        columns={[
          { key: 'student', header: 'Student', render: (i) => i.studentName ?? 'Not linked' },
          {
            key: 'instalment',
            header: 'Instalment',
            render: (i) => `${i.sequence} of ${i.of} · ${i.plan}`,
          },
          {
            key: 'due',
            header: 'Due',
            render: (i) => (i.dueDate ? fmtDate(i.dueDate) : 'No due date'),
          },
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            render: (i) => fmtPaise(i.amountPaise),
          },
          {
            key: 'owed',
            header: 'Still owed',
            numeric: true,
            render: (i) => fmtPaise(i.remainingPaise),
          },
          {
            key: 'status',
            header: 'Status',
            render: (i) => (
              <StatusBadge tone={statusTone(i.status)}>
                {INSTALMENT_STATUS_LABELS[i.status]}
              </StatusBadge>
            ),
          },
        ]}
      />
      <Pager basePath={BASE} params={params} page={d.page} pageSize={d.pageSize} total={d.total} />
    </div>
  );
}
