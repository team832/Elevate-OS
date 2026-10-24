/**
 * Funnel drill-down (`<base>/leads?from=…&to=…&leadStage=…`): the leads behind one figure of the
 * lead funnel, from the same leadFunnelRows query the dashboard counts with.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, StatusBadge } from '@elevate/shared-ui';
import type { IsoDate } from '../../domain';
import { leadFunnelRows, LEAD_FUNNEL_DEFINITION, NOT_STAGED } from '../../server/lead-funnel';
import { leadStageEntries, LEAD_STAGE_ENTRY_DEFINITION } from '../../server/lead-metrics';
import { listLeadStages } from '../../server/lead-stages';
import { fmtDate, fmtDateTime } from '../../ui/format';
import { load } from '../../ui/frame';
import { Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { SampleBadge } from '../admissions/_components/demo-bits';
import { stageLabel } from './lead-stage-record';

type Params = Record<string, string | undefined>;
const PAGE_SIZE = 25;

export async function FunnelDrill({
  user,
  base,
  sp,
  from,
  to,
}: {
  user: AuthenticatedUser;
  base: string;
  sp: Params;
  from: IsoDate;
  to: IsoDate;
}) {
  const BASE = `${base}/leads`;
  if (sp.reached && sp.leadStage) return <ReachedDrill {...{ user, base, sp, from, to }} />;
  const r = await load(async (db) => ({
    rows: await leadFunnelRows(db, user, {
      from,
      to,
      stageKey: sp.leadStage || undefined,
      ownerStaffId: sp.owner || undefined,
      programmeCode: sp.programme || undefined,
      sourceCode: sp.source || undefined,
    }),
    stages: await listLeadStages(db, user),
  }));
  if (!r.ok) return r.view;
  const { rows, stages } = r.data;
  const stage =
    sp.leadStage === NOT_STAGED
      ? 'Not staged'
      : sp.leadStage
        ? stageLabel(stages, sp.leadStage)
        : 'All stages';
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <Segment
      title={`${stage}: leads received ${fmtDate(from)} to ${fmtDate(to)}`}
      flush
      actions={<a href={BASE}>All leads</a>}
    >
      <details className="el-explain">
        <summary>How this list is defined</summary>
        {LEAD_FUNNEL_DEFINITION}
      </details>
      <RecordTable
        caption={`${rows.length} lead${rows.length === 1 ? '' : 's'}`}
        rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        rowKey={(l) => l.id}
        rowHref={(l) => `${BASE}/${l.id}`}
        linkColumn="studentName"
        empty={
          <EmptyState title="No leads in this figure" description="Pick another stage or period." />
        }
        columns={[
          {
            key: 'studentName',
            header: 'Student',
            render: (l) => (
              <>
                {l.studentName} <SampleBadge show={l.isSample} />
              </>
            ),
          },
          { key: 'code', header: 'Lead' },
          {
            key: 'stageKey',
            header: 'Lead stage',
            render: (l) => (
              <>
                {stageLabel(stages, l.stageKey)}{' '}
                {l.doNotContact ? <StatusBadge tone="danger">Do not contact</StatusBadge> : null}
              </>
            ),
          },
          {
            key: 'programmeName',
            header: 'Interest',
            render: (l) => l.programmeName ?? 'Undecided',
          },
          { key: 'ownerName', header: 'Owner', render: (l) => l.ownerName ?? 'Unassigned' },
          { key: 'receivedAt', header: 'Received', render: (l) => fmtDateTime(l.receivedAt) },
        ]}
      />
      <Pager basePath={BASE} params={sp} page={page} pageSize={PAGE_SIZE} total={rows.length} />
    </Segment>
  );
}

/** `…&reached=1`: leads that first entered the stage in the period (stage-entry funnel). */
async function ReachedDrill({
  user,
  base,
  sp,
  from,
  to,
}: {
  user: AuthenticatedUser;
  base: string;
  sp: Params;
  from: IsoDate;
  to: IsoDate;
}) {
  const r = await load(async (db) => ({
    rows: await leadStageEntries(db, user, { from, to, stageKey: sp.leadStage, base }),
    stages: await listLeadStages(db, user),
  }));
  if (!r.ok) return r.view;
  const { rows, stages } = r.data;
  return (
    <Segment
      title={`Reached ${stageLabel(stages, sp.leadStage ?? null)}: ${fmtDate(from)} to ${fmtDate(to)}`}
      flush
      actions={<a href={`${base}/leads`}>All leads</a>}
    >
      <details className="el-explain">
        <summary>How this list is defined</summary>
        {LEAD_STAGE_ENTRY_DEFINITION}
      </details>
      <RecordTable
        caption={`${rows.length} lead${rows.length === 1 ? '' : 's'}`}
        rows={rows}
        rowKey={(e) => e.id}
        rowHref={(e) => e.href ?? `${base}/leads`}
        linkColumn="title"
        empty={
          <EmptyState title="No leads in this figure" description="Pick another stage or period." />
        }
        columns={[
          { key: 'title', header: 'Lead' },
          { key: 'at', header: 'Entered the stage', render: (e) => fmtDateTime(e.at) },
        ]}
      />
    </Segment>
  );
}
