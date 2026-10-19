import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  APPLICATION_STAGE_LABELS,
  APPLICATION_STAGES,
  CANDIDATE_SOURCES,
  REQUISITION_EMPLOYMENT_TYPES,
  REQUISITION_STATUS_LABELS,
  REQUISITION_STATUSES,
  type ApplicationStage,
  type RequisitionStatus,
} from '../../../domain/hr/recruitment';
import { formOptions } from '../../../server/options';
import {
  listApplications,
  listCandidates,
  listMyInterviews,
  listRequisitions,
} from '../../../server/hr/recruitment';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { ListControls, listParams, Pager, type SearchParams } from './_components/lifecycle-ui';

export const dynamic = 'force-dynamic';

const BASE = '/ops/hr/recruitment';
const TABS = [
  { key: 'requisitions', label: 'Requisitions' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'applications', label: 'Applications' },
  { key: 'interviews', label: 'My interviews' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const opts = (values: readonly string[], labels?: Record<string, string>) =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? humanise(v) }));

export default async function RecruitmentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await gate('ops:recruitment:read', BASE);
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === sp.tab)?.key ?? 'requisitions';
  return (
    <Frame access={access} active="recruitment">
      <PageHeader
        title="Recruitment"
        description="Requisitions, candidates, applications and interviews. Offers are recorded here; Elevate OS never sends them."
      />
      <nav className="el-subnav" aria-label="Recruitment views">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`${BASE}?tab=${t.key}`}
            aria-current={t.key === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      <Section>
        {tab === 'requisitions' ? <Requisitions user={access.user} sp={sp} /> : null}
        {tab === 'candidates' ? <Candidates user={access.user} sp={sp} /> : null}
        {tab === 'applications' ? <Applications user={access.user} sp={sp} /> : null}
        {tab === 'interviews' ? <Interviews user={access.user} /> : null}
      </Section>
    </Frame>
  );
}

async function Requisitions({ user, sp }: { user: AuthenticatedUser; sp: SearchParams }) {
  const status = REQUISITION_STATUSES.find((s) => s === sp.status);
  const sort =
    (['code', 'title', 'status', 'updated'] as const).find((s) => s === sp.sort) ?? 'updated';
  const r = await load((db) =>
    listRequisitions(db, user, { ...listParams(sp), q: sp.q, status, sort }),
  );
  if (!r.ok) return r.view;
  const manage = can(user, 'ops:recruitment:manage');
  return (
    <div className="el-stack">
      <ListControls
        action={BASE}
        params={sp}
        keep={['tab']}
        searchLabel="Title or REQ code"
        filter={{
          name: 'status',
          label: 'Status',
          options: opts(REQUISITION_STATUSES, REQUISITION_STATUS_LABELS),
        }}
        sorts={[
          { value: 'updated', label: 'Last change' },
          { value: 'code', label: 'Code' },
          { value: 'title', label: 'Title' },
          { value: 'status', label: 'Status' },
        ]}
      />
      <DataTable
        caption="Requisitions"
        rows={r.data.rows}
        rowKey={(x) => x.id}
        empty={
          <EmptyState
            title={sp.q || status ? 'No requisitions match' : 'No requisitions yet'}
            description={
              manage
                ? 'Request one below; a recruitment decider approves it before it opens.'
                : undefined
            }
          />
        }
        columns={[
          {
            key: 'code',
            header: 'Requisition',
            render: (x) => <a href={`${BASE}/requisitions/${x.id}`}>{x.code}</a>,
          },
          { key: 'title', header: 'Title' },
          {
            key: 'departmentName',
            header: 'Department',
            render: (x) => x.departmentName ?? 'Not set',
          },
          { key: 'openings', header: 'Openings', numeric: true },
          { key: 'hired', header: 'Hired', numeric: true },
          { key: 'openApplications', header: 'Open applications', numeric: true },
          {
            key: 'recruiterName',
            header: 'Recruiter',
            render: (x) => x.recruiterName ?? <StatusBadge tone="warning">Unassigned</StatusBadge>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (x) => (
              <StatusBadge tone={statusTone(x.status)}>
                {REQUISITION_STATUS_LABELS[x.status as RequisitionStatus]}
              </StatusBadge>
            ),
          },
        ]}
      />
      <Pager
        base={BASE}
        params={sp}
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        noun="requisitions"
      />
      {manage ? (
        <NewRequisition allScope={scopeFor(user, 'ops:recruitment:manage') === 'all'} />
      ) : null}
    </div>
  );
}

async function NewRequisition({ allScope }: { allScope: boolean }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Request a requisition"
      description={
        allScope
          ? 'Saved as a draft. Someone with recruitment decision rights, other than you, approves it to open.'
          : 'Saved as a draft with you as the recruiter. A recruitment decider approves it to open.'
      }
    >
      <ActionForm
        action="/ops/api/v1/hr/requisitions"
        submitLabel="Save draft requisition"
        redirectTo={`${BASE}/requisitions/{id}`}
        fields={[
          { name: 'title', label: 'Job title', required: true },
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: r.data.departments,
          },
          {
            name: 'employmentType',
            label: 'Employment type',
            type: 'select',
            required: true,
            options: opts(REQUISITION_EMPLOYMENT_TYPES),
          },
          { name: 'openings', label: 'Openings', type: 'number', defaultValue: '1' },
          { name: 'location', label: 'Location' },
          ...(allScope
            ? [
                {
                  name: 'recruiterStaffId',
                  label: 'Recruiter',
                  type: 'select' as const,
                  options: r.data.staff,
                },
              ]
            : []),
          {
            name: 'hiringManagerStaffId',
            label: 'Hiring manager',
            type: 'select',
            options: r.data.staff,
            hint: 'Becomes the new employee’s manager unless changed at conversion.',
          },
          { name: 'roleDescription', label: 'Role description', type: 'textarea' },
        ]}
      />
    </Card>
  );
}

async function Candidates({ user, sp }: { user: AuthenticatedUser; sp: SearchParams }) {
  const status = (['active', 'anonymised'] as const).find((s) => s === sp.status);
  const sort = (['code', 'name', 'updated'] as const).find((s) => s === sp.sort) ?? 'updated';
  const retention = sp.retention === 'due' ? ('due' as const) : undefined;
  const r = await load((db) =>
    listCandidates(db, user, { ...listParams(sp), q: sp.q, status, sort, retention }),
  );
  if (!r.ok) return r.view;
  const manage = can(user, 'ops:recruitment:manage');
  return (
    <div className="el-stack">
      <ListControls
        action={BASE}
        params={sp}
        keep={['tab', 'retention']}
        searchLabel="Name or CAND code"
        filter={{ name: 'status', label: 'Status', options: opts(['active', 'anonymised']) }}
        sorts={[
          { value: 'updated', label: 'Last change' },
          { value: 'code', label: 'Code' },
          { value: 'name', label: 'Name' },
        ]}
      />
      <p className="el-field-hint">
        {r.data.retentionDays === null
          ? 'Retention of unsuccessful candidates is not decided yet (owner decision, D-028), so nobody is flagged for anonymisation.'
          : `Unsuccessful candidates are flagged ${r.data.retentionDays} days after their last application closed. `}
        {r.data.retentionDays !== null ? (
          <a href={`${BASE}?tab=candidates&retention=due`}>Show candidates due for anonymisation</a>
        ) : null}
      </p>
      <DataTable
        caption="Candidates (contact details are only on the candidate page, for their recruiter and HR)"
        rows={r.data.rows}
        rowKey={(x) => x.id}
        empty={
          <EmptyState
            title={sp.q || status || retention ? 'No candidates match' : 'No candidates yet'}
          />
        }
        columns={[
          {
            key: 'code',
            header: 'Candidate',
            render: (x) => <a href={`${BASE}/candidates/${x.id}`}>{x.code}</a>,
          },
          { key: 'fullName', header: 'Name' },
          { key: 'source', header: 'Source', render: (x) => humanise(x.source) },
          {
            key: 'recruiterName',
            header: 'Recruiter',
            render: (x) => x.recruiterName ?? 'Unassigned',
          },
          { key: 'openApplications', header: 'Open applications', numeric: true },
          {
            key: 'status',
            header: 'Status',
            render: (x) => (
              <>
                <StatusBadge tone={x.status === 'anonymised' ? 'neutral' : 'info'}>
                  {humanise(x.status)}
                </StatusBadge>{' '}
                {x.retention === 'due' ? (
                  <StatusBadge tone="warning">Due for anonymisation</StatusBadge>
                ) : null}
              </>
            ),
          },
        ]}
      />
      <Pager
        base={BASE}
        params={sp}
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        noun="candidates"
      />
      {manage ? (
        <NewCandidate allScope={scopeFor(user, 'ops:recruitment:manage') === 'all'} />
      ) : null}
    </div>
  );
}

async function NewCandidate({ allScope }: { allScope: boolean }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Add a candidate"
      description="Keep it to what recruitment needs: name, one way to reach them, where they came from. Email and phone are checked for duplicates."
    >
      <ActionForm
        action="/ops/api/v1/hr/candidates"
        submitLabel="Add candidate"
        redirectTo={`${BASE}/candidates/{id}`}
        fields={[
          { name: 'fullName', label: 'Full name', required: true },
          { name: 'email', label: 'Email', type: 'email' },
          {
            name: 'phone',
            label: 'Phone',
            type: 'tel',
            hint: 'Indian numbers with or without +91.',
          },
          {
            name: 'source',
            label: 'Source',
            type: 'select',
            required: true,
            options: opts(CANDIDATE_SOURCES),
          },
          {
            name: 'sourceDetail',
            label: 'Source detail',
            hint: 'e.g. who referred them, which portal.',
          },
          ...(allScope
            ? [
                {
                  name: 'recruiterStaffId',
                  label: 'Recruiter',
                  type: 'select' as const,
                  options: r.data.staff,
                },
              ]
            : []),
          {
            name: 'privacyNoticeGiven',
            label: 'The candidate has been told how their data is used and kept',
            type: 'checkbox',
          },
          {
            name: 'consentNote',
            label: 'Consent note',
            hint: 'e.g. "agreed to be considered for future openings".',
          },
        ]}
      />
    </Card>
  );
}

async function Applications({ user, sp }: { user: AuthenticatedUser; sp: SearchParams }) {
  const stage = APPLICATION_STAGES.find((s) => s === sp.stage);
  const sort = (['stage', 'updated', 'candidate'] as const).find((s) => s === sp.sort) ?? 'updated';
  const r = await load((db) =>
    listApplications(db, user, { ...listParams(sp), q: sp.q, stage, sort, view: 'all' }),
  );
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      <ListControls
        action={BASE}
        params={sp}
        keep={['tab']}
        searchLabel="Candidate or requisition"
        filter={{
          name: 'stage',
          label: 'Stage',
          options: opts(APPLICATION_STAGES, APPLICATION_STAGE_LABELS),
        }}
        sorts={[
          { value: 'updated', label: 'Last stage change' },
          { value: 'stage', label: 'Stage' },
          { value: 'candidate', label: 'Candidate name' },
        ]}
      />
      <DataTable
        caption="Applications"
        rows={r.data.rows}
        rowKey={(x) => x.id}
        empty={
          <EmptyState
            title={sp.q || stage ? 'No applications match' : 'No applications yet'}
            description="Applications are added from an open requisition’s page."
          />
        }
        columns={[
          {
            key: 'candidateCode',
            header: 'Candidate',
            render: (x) => (
              <a href={`${BASE}/applications/${x.id}`}>
                {x.candidateCode} {x.candidateName}
              </a>
            ),
          },
          {
            key: 'requisitionCode',
            header: 'Requisition',
            render: (x) => `${x.requisitionCode} ${x.requisitionTitle}`,
          },
          {
            key: 'stage',
            header: 'Stage',
            render: (x) => (
              <StatusBadge tone={statusTone(x.stage)}>
                {APPLICATION_STAGE_LABELS[x.stage as ApplicationStage]}
              </StatusBadge>
            ),
          },
          { key: 'stageChangedAt', header: 'Since', render: (x) => fmtDateTime(x.stageChangedAt) },
          {
            key: 'interviewer',
            header: 'Your role',
            render: (x) => (x.interviewer ? 'Interviewer' : ''),
          },
        ]}
      />
      <Pager
        base={BASE}
        params={sp}
        page={r.data.page}
        pageSize={r.data.pageSize}
        total={r.data.total}
        noun="applications"
      />
    </div>
  );
}

async function Interviews({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listMyInterviews(db, user));
  if (!r.ok) return r.view;
  return (
    <DataTable
      caption="Interviews where you are on the panel"
      rows={r.data}
      rowKey={(x) => x.interviewId}
      empty={
        <EmptyState
          title="You are not on any interview panel"
          description="Recruiters add you to a panel when they schedule an interview."
        />
      }
      columns={[
        { key: 'scheduledAt', header: 'When', render: (x) => fmtDateTime(x.scheduledAt) },
        {
          key: 'candidateCode',
          header: 'Candidate',
          render: (x) => (
            <a href={`${BASE}/applications/${x.applicationId}`}>
              {x.candidateCode} {x.candidateName}
            </a>
          ),
        },
        { key: 'requisitionTitle', header: 'Role' },
        { key: 'mode', header: 'Mode', render: (x) => humanise(x.mode) },
        {
          key: 'status',
          header: 'Interview',
          render: (x) => (
            <StatusBadge tone={statusTone(x.status)}>{humanise(x.status)}</StatusBadge>
          ),
        },
        {
          key: 'submittedAt',
          header: 'Your feedback',
          render: (x) =>
            x.submittedAt ? (
              'Given'
            ) : x.status === 'cancelled' || x.status === 'no_show' ? (
              'Not needed'
            ) : (
              <StatusBadge tone="warning">Due</StatusBadge>
            ),
        },
      ]}
    />
  );
}
