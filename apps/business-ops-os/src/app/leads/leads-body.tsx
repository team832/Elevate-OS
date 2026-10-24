import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, isIsoDate, type AdmissionStatus } from '../../domain';
import { listDuplicateQueue } from '../../server/lead-duplicates';
import { NOT_STAGED } from '../../server/lead-funnel';
import { listLeadStages, type LeadStage } from '../../server/lead-stages';
import { getLead, LEAD_LIST_FLAGS, listLeads } from '../../server/leads';
import { formOptions } from '../../server/options';
import { StatCard } from '../../ui/charts';
import { fmtDateTime, statusTone } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { LeadCreateForm } from '../../ui/lead-create-form';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import { SampleBadge } from '../admissions/_components/demo-bits';
import { LEAD_ACTS, LeadActModal, type LeadAct } from './lead-acts';
import { BookDemoLink, LEAD_CONTACT_FIELDS, LeadMeta, leadTabs } from './lead-record';
import { FunnelDrill } from './funnel-drill';
import { stageLabel } from './lead-stage-record';
import { salesCallsPath } from './sales-calls-body';
import '../ops.css';

type Params = Record<string, string | undefined>;

export interface LeadsBodyProps {
  user: AuthenticatedUser;
  /** The host app's browser basePath: '/ops' or '/marketing'. */
  base: string;
  searchParams: Params;
  /** The host's area tabs under the title. */
  tabs?: ReactNode;
}
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

/** `<base>/leads`: the lead list with stage figures, merge review and pop-ups. */
export function LeadsBody({ user, base, searchParams: sp, tabs }: LeadsBodyProps) {
  return (
    <>
      <PageHeader
        title="Leads"
        description={
          <>
            Enquiries and who owns them. Duplicates are flagged for review, never merged
            automatically. <a href={salesCallsPath(base)}>Sales calls</a> ·{' '}
            <a href={`${base}/leads/stages`}>Lead stages</a>
          </>
        }
        actions={
          can(user, 'ops:leads:write') ? (
            <ButtonLink
              variant="primary"
              href={listHref(`${base}/leads`, sp, { new: '1', open: undefined, act: undefined })}
            >
              New lead
            </ButtonLink>
          ) : undefined
        }
        tabs={tabs}
      />
      <Section>
        <Body user={user} sp={sp} base={base} />
      </Section>
    </>
  );
}

async function Body({ user, sp, base }: { user: AuthenticatedUser; sp: Params; base: string }) {
  const BASE = `${base}/leads`;
  // Funnel drill-down from a dashboard figure: the same query that counted it.
  if (sp.from && sp.to && isIsoDate(sp.from) && isIsoDate(sp.to))
    return <FunnelDrill user={user} base={base} sp={sp} from={sp.from} to={sp.to} />;
  const act = LEAD_ACTS.find((a) => a === sp.act);
  const r = await load(async (db) => {
    const [leads, duplicates, open, opts, stages] = await Promise.all([
      listLeads(db, user, { q: sp.q }),
      can(user, 'ops:leads:merge') ? listDuplicateQueue(db, user) : null,
      sp.open ? getLead(db, user, sp.open) : null,
      sp.new || act ? formOptions(db) : null,
      listLeadStages(db, user),
    ]);
    return { leads, duplicates, open, opts, stages };
  });
  if (!r.ok) return r.view;
  const { leads, duplicates, open, opts, stages } = r.data;
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
              current={sp.stage === stage}
            />
          </li>
        ))}
      </ul>
      <LeadList sp={sp} rows={leads} base={base} stages={stages} />
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
          base={base}
        />
      ) : open ? (
        <RecordModal
          id="lead-modal"
          title={open.lead.studentName}
          meta={<LeadMeta d={open} />}
          fullHref={`${BASE}/${open.lead.id}`}
          closeHref={closeHref}
          returnId={open.lead.id}
          tabs={leadTabs(open, user, (a: LeadAct) => listHref(BASE, sp, { act: a }), 3, base)}
        >
          <div className="el-inline-form">
            <BookDemoLink d={open} user={user} base={base} />
          </div>
        </RecordModal>
      ) : sp.new && opts && can(user, 'ops:leads:write') ? (
        <NewLead closeHref={listHref(BASE, sp, { new: undefined })} opts={opts} base={base} />
      ) : null}
    </div>
  );
}

type LeadRow = Awaited<ReturnType<typeof listLeads>>[number];

function LeadList({
  sp,
  rows: all,
  base,
  stages,
}: {
  sp: Params;
  rows: LeadRow[];
  base: string;
  stages: LeadStage[];
}) {
  const BASE = `${base}/leads`;
  const flag = LEAD_LIST_FLAGS.get(sp.flag ?? '');
  const stage = sp.stage && sp.stage in ADMISSION_STATUS_LABELS ? sp.stage : undefined;
  const leadStage = sp.leadStage === NOT_STAGED ? null : sp.leadStage;
  const rows = all.filter(
    (l) =>
      (!flag || flag(l)) &&
      (!stage || l.status === stage) &&
      (!sp.leadStage || l.stageKey === leadStage),
  );
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Student name or lead code', value: sp.q }}
        filters={[
          {
            name: 'leadStage',
            label: 'Lead stage',
            type: 'select',
            value: sp.leadStage,
            options: [
              ...stages.map((s) => ({ value: s.key, label: s.label })),
              { value: NOT_STAGED, label: 'Not staged' },
            ],
          },
          {
            name: 'stage',
            label: 'Admission status',
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
            key: 'status',
            header: 'Admission',
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

const INTEREST = 'Interest and source';

function NewLead({
  closeHref,
  opts,
  base,
}: {
  closeHref: string;
  opts: Awaited<ReturnType<typeof formOptions>>;
  base: string;
}) {
  return (
    <FormModal
      id="new-lead"
      title="New lead"
      meta="Student name and at least one phone or email. Indian numbers are normalised to +91."
      closeHref={closeHref}
    >
      <LeadCreateForm
        base={base}
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

/** `<base>/leads/<id>`: one lead in full; `?act=<flow>` opens an edit flow. */
export function LeadBody({ user, base, id, searchParams }: LeadsBodyProps & { id: string }) {
  const act = LEAD_ACTS.find((a) => a === searchParams.act);
  return (
    <Section>
      <LeadDetail user={user} id={id} act={act} base={base} />
    </Section>
  );
}

async function LeadDetail({
  user,
  id,
  act,
  base,
}: {
  user: AuthenticatedUser;
  id: string;
  act?: (typeof LEAD_ACTS)[number];
  base: string;
}) {
  const r = await load(async (db) =>
    Promise.all([getLead(db, user, id), act ? formOptions(db) : null]),
  );
  if (!r.ok) return r.view;
  const [d, options] = r.data;
  const self = `${base}/leads/${d.lead.id}`;
  return (
    <div className="el-stack">
      <PageHeader
        title={d.lead.studentName}
        meta={<LeadMeta d={d} />}
        description={
          <>
            Received {fmtDateTime(d.lead.firstReceivedAt)} · <a href={`${base}/leads`}>All leads</a>
          </>
        }
        actions={<BookDemoLink d={d} user={user} base={base} />}
      />
      {leadTabs(d, user, (a) => `${self}?act=${a}`, 2, base).map((t) => (
        <div key={t.key} className="el-stack">
          {t.content}
        </div>
      ))}
      {act && options ? (
        <LeadActModal act={act} d={d} options={options} user={user} closeHref={self} base={base} />
      ) : null}
    </div>
  );
}
