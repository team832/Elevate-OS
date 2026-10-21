import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, ButtonLink, EmptyState, PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../../domain';
import { MARKETING_INTAKE_STATUS } from '../../server/adapters/marketing-intake';
import {
  LEAD_HANDOFF_STATUSES,
  listLeadHandoffs,
  type LeadHandoffStatus,
} from '../../server/lead-intake';
import { listDuplicateQueue } from '../../server/lead-duplicates';
import { getLead, LEAD_LIST_FLAGS, listLeads } from '../../server/leads';
import { formOptions } from '../../server/options';
import { ActionForm } from '../../ui/action-form';
import { StatCard } from '../../ui/charts';
import { fmtDateTime, humanise, statusTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { LeadCreateForm } from '../../ui/lead-create-form';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { SampleBadge } from '../admissions/_components/demo-bits';
import {
  BookDemoLink,
  LEAD_ACTS,
  LEAD_CONTACT_FIELDS,
  LeadActModal,
  LeadMeta,
  leadTabs,
  type LeadAct,
} from './lead-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/leads';
const PAGE_SIZE = 25;

const FLAG_LABELS: Record<string, string> = {
  new_this_week: 'New this week',
  awaiting_contact: 'Awaiting first contact',
  unassigned: 'Unassigned',
  handoff_pending: 'Handoff not accepted',
  overdue: 'Overdue follow-up',
  missing_next_action: 'No next action',
  duplicate: 'Duplicate review',
};

/** Early pipeline stages shown as filter figures (counts from the same list query). */
const STAGES = [
  'new',
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
] as const satisfies readonly AdmissionStatus[];

const HANDOFF_TONE: Record<LeadHandoffStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  received: 'info',
  accepted: 'success',
  duplicate_review: 'warning',
  failed: 'danger',
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:leads:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="leads">
      <PageHeader
        title="Leads"
        description="Enquiries and who owns them. Duplicates are flagged for review, never merged automatically."
        actions={
          can(access.user, 'ops:leads:write') ? (
            <ButtonLink
              variant="primary"
              href={listHref(BASE, sp, { new: '1', open: undefined, act: undefined })}
            >
              New lead
            </ButtonLink>
          ) : undefined
        }
      />
      <Section>
        <Body user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Body({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const marketing = sp.view === 'marketing';
  const status = LEAD_HANDOFF_STATUSES.find((s) => s === sp.status);
  const act = LEAD_ACTS.find((a) => a === sp.act);
  const r = await load(async (db) => {
    const [leads, handoffs, duplicates, open, opts] = await Promise.all([
      listLeads(db, user, { q: marketing ? undefined : sp.q }),
      listLeadHandoffs(db, user),
      can(user, 'ops:leads:merge') ? listDuplicateQueue(db, user) : null,
      sp.open ? getLead(db, user, sp.open) : null,
      sp.new || act ? formOptions(db) : null,
    ]);
    return { leads, handoffs, duplicates, open, opts };
  });
  if (!r.ok) return r.view;
  const { leads, handoffs, duplicates, open, opts } = r.data;
  const handoffTotal = LEAD_HANDOFF_STATUSES.reduce((n, s) => n + handoffs.counts[s], 0);
  const closeHref = listHref(BASE, sp, { open: undefined, act: undefined });
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Leads by stage">
        {STAGES.map((stage) => (
          <li key={stage}>
            <StatCard
              label={ADMISSION_STATUS_LABELS[stage]}
              value={leads.filter((l) => l.status === stage).length}
              href={listHref(BASE, { stage })}
              current={!marketing && sp.stage === stage}
            />
          </li>
        ))}
      </ul>
      <Tabs
        idBase="lead-views"
        label="Lead views"
        selected={marketing ? 'marketing' : 'all'}
        items={[
          { key: 'all', label: 'All leads', href: BASE, count: leads.length },
          {
            key: 'marketing',
            label: 'From Marketing',
            href: listHref(BASE, { view: 'marketing' }),
            count: handoffTotal,
          },
        ]}
      >
        {marketing ? (
          <Handoffs user={user} sp={sp} status={status} data={handoffs} />
        ) : (
          <LeadList sp={sp} rows={leads} />
        )}
      </Tabs>
      {duplicates ? (
        <Segment
          title="Merge review"
          flush
          description="Open duplicate warnings. Open the lead to merge (audited) or dismiss."
        >
          <RecordTable
            rows={duplicates}
            rowKey={(f) => f.id}
            rowHref={(f) => listHref(BASE, sp, { open: f.leadId, act: undefined })}
            linkColumn="lead"
            empty="No open duplicate warnings."
            columns={[
              { key: 'lead', header: 'New lead', render: (f) => `${f.leadCode}: ${f.leadName}` },
              {
                key: 'matched',
                header: 'Matches',
                render: (f) => `${f.matchedCode}: ${f.matchedName}`,
              },
              {
                key: 'level',
                header: 'Level',
                render: (f) => (
                  <StatusBadge tone={f.level === 'exact' ? 'danger' : 'warning'}>
                    {f.level === 'exact' ? 'Existing contact' : 'Possible duplicate'}
                  </StatusBadge>
                ),
              },
              {
                key: 'signals',
                header: 'Matched on',
                render: (f) => f.signals.join(', ').replace(/_/g, ' '),
              },
              {
                key: 'ack',
                header: 'Creator’s note',
                render: (f) => f.acknowledgement ?? 'None',
              },
            ]}
          />
        </Segment>
      ) : null}
      {open && act && opts ? (
        <LeadActModal
          act={act}
          d={open}
          options={opts}
          user={user}
          closeHref={listHref(BASE, sp, { act: undefined })}
        />
      ) : open ? (
        <RecordModal
          id="lead-modal"
          title={open.lead.studentName}
          meta={<LeadMeta d={open} />}
          fullHref={`${BASE}/${open.lead.id}`}
          closeHref={closeHref}
          returnId={open.lead.id}
          tabs={leadTabs(open, user, (a: LeadAct) => listHref(BASE, sp, { act: a }), 3)}
        >
          <div className="el-inline-form">
            <BookDemoLink d={open} user={user} />
          </div>
        </RecordModal>
      ) : sp.new && opts && can(user, 'ops:leads:write') ? (
        <NewLead closeHref={listHref(BASE, sp, { new: undefined })} opts={opts} />
      ) : null}
    </div>
  );
}

type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];

function LeadList({ sp, rows: all }: { sp: Params; rows: LeadRow[] }) {
  const flag = LEAD_LIST_FLAGS.get(sp.flag ?? '');
  const stage = sp.stage && sp.stage in ADMISSION_STATUS_LABELS ? sp.stage : undefined;
  const rows = all.filter((l) => (!flag || flag(l)) && (!stage || l.status === stage));
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Student name or lead code', value: sp.q }}
        filters={[
          {
            name: 'stage',
            label: 'Stage',
            type: 'select',
            value: stage,
            options: Object.entries(ADMISSION_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            name: 'flag',
            label: 'Needs attention',
            type: 'select',
            value: flag ? sp.flag : undefined,
            options: Object.entries(FLAG_LABELS).map(([value, label]) => ({ value, label })),
          },
        ]}
      />
      <RecordTable
        caption={`${rows.length} lead${rows.length === 1 ? '' : 's'}`}
        rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        rowKey={(l) => l.id}
        rowHref={(l) => listHref(BASE, sp, { open: l.id, act: undefined, new: undefined })}
        linkColumn="studentName"
        empty={
          <EmptyState title="No leads match" description="Clear a filter, or add a new lead." />
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
            key: 'programmeCode',
            header: 'Interest',
            render: (l) => l.programmeName ?? 'Undecided',
          },
          {
            key: 'status',
            header: 'Stage',
            render: (l) =>
              l.status ? (
                <StatusBadge tone={statusTone(l.status)}>
                  {ADMISSION_STATUS_LABELS[l.status]}
                </StatusBadge>
              ) : (
                'No case yet'
              ),
          },
          {
            key: 'owner',
            header: 'Owner',
            render: (l) =>
              l.ownerName ? (
                `${l.ownerName}${l.assignment === 'handoff_pending' ? ' (not accepted)' : ''}`
              ) : (
                <StatusBadge tone="warning">Unassigned</StatusBadge>
              ),
          },
          {
            key: 'flags',
            header: 'Flags',
            render: (l) => (
              <>
                {l.flags.overdue ? (
                  <StatusBadge tone="danger">Overdue follow-up</StatusBadge>
                ) : null}
                {l.flags.missingNextAction ? (
                  <StatusBadge tone="warning">No next action</StatusBadge>
                ) : null}
                {l.flags.openDuplicates ? (
                  <StatusBadge tone="warning">
                    {l.flags.exactDuplicate ? 'Existing contact' : 'Possible duplicate'}
                  </StatusBadge>
                ) : null}
              </>
            ),
          },
          { key: 'receivedAt', header: 'Received', render: (l) => fmtDateTime(l.receivedAt) },
        ]}
      />
      <Pager basePath={BASE} params={sp} page={page} pageSize={PAGE_SIZE} total={rows.length} />
    </div>
  );
}

/** Leads handed off by Marketing OS (receipts of `marketing.lead.handed_off`). */
function Handoffs({
  user,
  sp,
  status,
  data,
}: {
  user: AuthenticatedUser;
  sp: Params;
  status?: LeadHandoffStatus;
  data: Awaited<ReturnType<typeof listLeadHandoffs>>;
}) {
  const q = sp.q?.trim().toLowerCase();
  const items = data.items.filter(
    (h) => (!status || h.status === status) && (!q || h.studentName.toLowerCase().includes(q)),
  );
  const retry = can(user, 'ops:lead_handoffs:manage');
  const book = can(user, 'ops:leads:write');
  return (
    <div className="el-stack">
      <Alert tone="info" title={MARKETING_INTAKE_STATUS.label}>
        {MARKETING_INTAKE_STATUS.detail}
      </Alert>
      {can(user, 'ops:jobs:run') ? (
        <ActionForm
          action="/ops/api/v1/jobs/lead-intake"
          submitLabel="Process waiting handoffs now"
          variant="secondary"
          compact
        />
      ) : null}
      <SearchPanel
        action={BASE}
        hidden={{ view: 'marketing' }}
        search={{ name: 'q', label: 'Student name', value: sp.q }}
        filters={[
          {
            name: 'status',
            label: 'Handoff status',
            type: 'select',
            value: status,
            options: options(LEAD_HANDOFF_STATUSES).map((o) => ({
              ...o,
              label: `${o.label} (${data.counts[o.value as LeadHandoffStatus]})`,
            })),
          },
        ]}
      />
      <RecordTable
        caption={`${items.length} handoff receipt${items.length === 1 ? '' : 's'}`}
        rows={items}
        rowKey={(h) => h.id}
        empty={
          <EmptyState
            title="No handoffs here"
            description="Leads appear here once Marketing OS sends them. Live sync is not configured yet."
          />
        }
        columns={[
          {
            key: 'student',
            header: 'Student',
            render: (h) =>
              h.leadId ? (
                <a href={listHref(BASE, { open: h.leadId })}>{h.studentName}</a>
              ) : (
                h.studentName
              ),
          },
          {
            key: 'status',
            header: 'Handoff',
            render: (h) => (
              <StatusBadge tone={HANDOFF_TONE[h.status]}>{humanise(h.status)}</StatusBadge>
            ),
          },
          { key: 'source', header: 'Source', render: (h) => h.sourceCode },
          {
            key: 'interest',
            header: 'Course interest',
            render: (h) => h.courseInterest ?? 'Not given',
          },
          ...(data.attributionVisible
            ? [
                {
                  key: 'campaign',
                  header: 'Campaign',
                  render: (h: (typeof items)[number]) =>
                    h.attribution?.campaignName ?? h.attribution?.campaignRef ?? 'Not given',
                },
              ]
            : []),
          { key: 'captured', header: 'Captured', render: (h) => fmtDateTime(h.capturedAt) },
          {
            key: 'attempts',
            header: 'Processing',
            render: (h) =>
              `${h.attempts} attempt${h.attempts === 1 ? '' : 's'}${h.duplicateDeliveries ? `, ${h.duplicateDeliveries} repeat(s) ignored` : ''}${h.lastError ? `: ${h.lastError}` : ''}`,
          },
          {
            key: 'action',
            header: 'Next step',
            render: (h) =>
              h.status === 'failed' ? (
                retry ? (
                  <ActionForm
                    action={`/ops/api/v1/leads/handoffs/${h.id}/retry`}
                    submitLabel="Retry handoff"
                    compact
                  />
                ) : (
                  'A manager can retry it'
                )
              ) : h.status === 'duplicate_review' ? (
                <a href={listHref(BASE, { flag: 'duplicate' })}>Review the duplicate</a>
              ) : h.leadId && book ? (
                <a href="/ops/admissions?new=1">Book a demo</a>
              ) : (
                'None'
              ),
          },
        ]}
      />
    </div>
  );
}

const INTEREST = 'Interest and source';

function NewLead({
  closeHref,
  opts,
}: {
  closeHref: string;
  opts: Awaited<ReturnType<typeof formOptions>>;
}) {
  return (
    <FormModal
      id="new-lead"
      title="New lead"
      meta="Student name and at least one phone or email. Indian numbers are normalised to +91."
      closeHref={closeHref}
    >
      <LeadCreateForm
        cancelHref={closeHref}
        fields={[
          ...LEAD_CONTACT_FIELDS,
          {
            name: 'programmeCode',
            label: 'Programme of interest',
            type: 'select',
            options: opts.programmes,
            section: INTEREST,
          },
          {
            name: 'interestMode',
            label: 'Mode',
            type: 'select',
            required: true,
            defaultValue: 'undecided',
            options: options(['offline', 'online', 'undecided']),
            section: INTEREST,
          },
          {
            name: 'sourceCode',
            label: 'First enquiry source',
            type: 'select',
            required: true,
            defaultValue: 'UNKNOWN',
            options: opts.sources,
            hint: 'Leave Unknown when you do not know; it is never guessed.',
            section: INTEREST,
          },
          { name: 'channel', label: 'Account / channel', section: INTEREST },
          {
            name: 'campaignRef',
            label: 'Campaign or activity ID (if identifiable)',
            section: INTEREST,
          },
          {
            name: 'ownerStaffId',
            label: 'Owner (managers only; counsellors own what they create)',
            type: 'select',
            options: opts.staff,
            section: 'Owner and notes',
          },
          { name: 'notes', label: 'Notes', type: 'textarea', section: 'Owner and notes' },
        ]}
      />
    </FormModal>
  );
}
