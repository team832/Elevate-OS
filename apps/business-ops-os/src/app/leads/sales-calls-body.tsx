/**
 * `<base>/sales-calls` (Marketing) and `/ops/leads/sales-calls`: the call log (owner brief
 * 23 Oct 2026 §11). Staff call from their own phone and record the call here; the app never
 * places or records calls. Own scope: a marketing employee sees calls on their own leads.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { OPS_ACTIVITY_OUTCOMES } from '@elevate/database';
import { ButtonLink, EmptyState, PageHeader } from '@elevate/shared-ui';
import { isIsoDate } from '../../domain';
import { listCalls } from '../../server/lead-calls';
import { listLeads } from '../../server/leads';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { fmtDateTime, humanise } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { SampleBadge } from '../admissions/_components/demo-bits';
import { CALL_FIELDS, CALL_NOTE, callColumns } from './lead-stage-record';
import '../ops.css';

type Params = Record<string, string | undefined>;
const PAGE_SIZE = 25;
const DIRECTIONS = ['outbound', 'inbound'] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const day = (v: string | undefined) => (v && isIsoDate(v) ? v : undefined);
const pick = <T extends string>(list: readonly T[], v: string | undefined) =>
  list.find((x) => x === v);

/** Where the call log lives in each workspace. */
export const salesCallsPath = (base: string) =>
  base === '/ops' ? '/ops/leads/sales-calls' : `${base}/sales-calls`;

export function SalesCallsBody({
  user,
  base,
  searchParams: sp,
  tabs,
}: {
  user: AuthenticatedUser;
  base: string;
  searchParams: Params;
  tabs?: ReactNode;
}) {
  const self = salesCallsPath(base);
  return (
    <>
      <PageHeader
        title="Sales calls"
        description={
          <>
            {CALL_NOTE} Next steps live in <a href={`${base}/follow-ups`}>Follow-ups</a>.
          </>
        }
        actions={
          can(user, 'ops:leads:write') ? (
            <ButtonLink variant="primary" href={listHref(self, sp, { new: '1' })}>
              Log a call
            </ButtonLink>
          ) : undefined
        }
        tabs={tabs}
      />
      <Section>
        <Calls user={user} base={base} sp={sp} self={self} />
      </Section>
    </>
  );
}

async function Calls({
  user,
  base,
  sp,
  self,
}: {
  user: AuthenticatedUser;
  base: string;
  sp: Params;
  self: string;
}) {
  const team = can(user, 'ops:leads:assign');
  const filters = {
    from: day(sp.from),
    to: day(sp.to),
    direction: pick(DIRECTIONS, sp.direction),
    outcome: pick(OPS_ACTIVITY_OUTCOMES, sp.outcome),
    staffId: team && UUID.test(sp.staff ?? '') ? sp.staff : undefined,
  };
  const adding = Boolean(sp.new) && can(user, 'ops:leads:write');
  const r = await load(async (db) => ({
    calls: await listCalls(db, user, filters),
    leads: adding ? await listLeads(db, user) : [],
    staff: team ? (await formOptions(db)).staff : [],
  }));
  if (!r.ok) return r.view;
  const q = sp.q?.trim().toLowerCase();
  const calls = q
    ? r.data.calls.filter((c) => `${c.leadCode} ${c.studentName}`.toLowerCase().includes(q))
    : r.data.calls;
  const { leads, staff } = r.data;
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <div className="el-stack">
      <details className="el-explain">
        <summary>How this list is defined</summary>
        Every call someone logged on a lead you may work, newest first (up to 500). Direction,
        duration and outcome are what the caller typed in; a call without a duration was not timed.
        Calls to leads marked Do not contact cannot be logged.
      </details>
      <SearchPanel
        action={self}
        search={{ name: 'q', label: 'Student name or lead code', value: sp.q }}
        filters={[
          { name: 'from', label: 'From', type: 'date', value: filters.from },
          { name: 'to', label: 'To', type: 'date', value: filters.to },
          {
            name: 'direction',
            label: 'Direction',
            type: 'select',
            value: filters.direction,
            options: options(DIRECTIONS),
          },
          {
            name: 'outcome',
            label: 'Outcome',
            type: 'select',
            value: filters.outcome,
            options: options(OPS_ACTIVITY_OUTCOMES),
          },
          ...(team
            ? [
                {
                  name: 'staff',
                  label: 'Logged by',
                  type: 'select' as const,
                  value: filters.staffId,
                  options: staff,
                },
              ]
            : []),
        ]}
      />
      <RecordTable
        caption={`${calls.length} call${calls.length === 1 ? '' : 's'}`}
        rows={calls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        rowKey={(c) => c.id}
        rowHref={(c) => `${base}/leads/${c.leadId}`}
        linkColumn="lead"
        empty={
          <EmptyState
            title="No calls logged"
            description="Log a call after you speak to a lead, or clear a filter."
          />
        }
        columns={[
          { key: 'occurredAt', header: 'When', render: (c) => fmtDateTime(c.occurredAt) },
          {
            key: 'lead',
            header: 'Lead',
            render: (c) => (
              <>
                {c.leadCode}: {c.studentName} <SampleBadge show={c.isSample} />
              </>
            ),
          },
          { key: 'outcome', header: 'Outcome', render: (c) => humanise(c.outcome) },
          ...callColumns<(typeof calls)[number]>(),
          { key: 'staffName', header: 'Logged by', render: (c) => c.staffName ?? 'Not recorded' },
        ]}
      />
      <Pager basePath={self} params={sp} page={page} pageSize={PAGE_SIZE} total={calls.length} />
      {adding ? (
        <FormModal
          id="log-call"
          title="Log a call"
          meta={CALL_NOTE}
          closeHref={listHref(self, sp, { new: undefined })}
        >
          {leads.length ? (
            <ActionForm
              action={`${base}/api/v1/leads/calls`}
              submitLabel="Log call"
              redirectTo={listHref(self, sp, { new: undefined })}
              secondary={<a href={listHref(self, sp, { new: undefined })}>Cancel</a>}
              fields={[
                {
                  name: 'leadId',
                  label: 'Lead',
                  type: 'select',
                  required: true,
                  defaultValue: sp.lead,
                  options: leads.map((l) => ({
                    value: l.id,
                    label: `${l.code}: ${l.studentName}${l.doNotContact ? ' (do not contact)' : ''}`,
                  })),
                  section: 'Call',
                },
                {
                  name: 'outcome',
                  label: 'Outcome',
                  type: 'select',
                  required: true,
                  options: options(OPS_ACTIVITY_OUTCOMES),
                  section: 'Call',
                },
                { name: 'occurredAt', label: 'When', type: 'datetime', section: 'Call' },
                { name: 'note', label: 'Notes', type: 'textarea', section: 'Call' },
                ...CALL_FIELDS.map((f) =>
                  f.name === 'direction' ? { ...f, required: true, defaultValue: 'outbound' } : f,
                ),
              ]}
            />
          ) : (
            <EmptyState
              title="No leads to call"
              description="You can log calls on leads you own. Ask your manager to assign leads to you."
            />
          )}
        </FormModal>
      ) : null}
    </div>
  );
}
