import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState } from '@elevate/shared-ui';
import { KIND_LABELS, periodLabel } from '../../../domain/work-report';
import { periodOfRow } from '../../../server/eod-reports';
import { eodInbox } from '../../../server/eod-review';
import { fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { ReportPane } from '../../tasks/reports/_components/report-views';

type Params = Record<string, string | undefined>;
const BASE = '/ops/hr/reports';

/** Submitted reports of the staff HR manages, not yet reviewed (the HR Overview count's list). */
export async function Waiting({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const page = Number(sp.page) || 1;
  const r = await load((db) =>
    eodInbox(db, user, { status: 'submitted', page }, undefined, { hr: true }),
  );
  if (!r.ok) return r.view;
  const list = r.data;
  return (
    <div className="el-stack">
      <RecordTable
        caption={`${list.total} report${list.total === 1 ? '' : 's'} waiting for review`}
        rows={list.rows}
        rowKey={(x) => x.id}
        rowHref={(x) => listHref(BASE, sp, { open: x.id })}
        linkColumn="staffName"
        empty={
          <EmptyState
            title="Nothing is waiting"
            description="Every submitted report has been reviewed."
          />
        }
        columns={[
          { key: 'staffName', header: 'Employee' },
          { key: 'department', header: 'Department', render: (x) => x.department ?? 'Not set' },
          {
            key: 'period',
            header: 'Period',
            render: (x) => `${KIND_LABELS[x.periodKind]}: ${periodLabel(periodOfRow(x))}`,
          },
          { key: 'submittedAt', header: 'Submitted', render: (x) => fmtDateTime(x.submittedAt) },
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {sp.open ? (
        <ReportPane
          user={user}
          id={sp.open}
          base="/ops"
          closeHref={listHref(BASE, sp, { open: undefined })}
        />
      ) : null}
    </div>
  );
}
