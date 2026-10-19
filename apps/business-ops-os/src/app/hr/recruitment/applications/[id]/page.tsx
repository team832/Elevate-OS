import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  APPLICATION_STAGE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_RECOMMENDATIONS,
  OFFER_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  type ApplicationStage,
  type InterviewRecommendation,
  type OfferStatus,
} from '../../../../../domain/hr/recruitment';
import { formOptions } from '../../../../../server/options';
import { getApplication } from '../../../../../server/hr/recruitment';
import { ActionForm } from '../../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../../ui/frame';
import { HistoryPanel } from '../../_components/lifecycle-ui';

export const dynamic = 'force-dynamic';

const STAGE_ACTIONS: Record<ApplicationStage, string> = {
  applied: '',
  screening: 'Move to screening',
  interview: 'Shortlist for interview',
  offer: 'Select candidate (offer stage)',
  hired: '',
  rejected: 'Reject',
  withdrawn: 'Record withdrawal',
};
const OFFER_ACTIONS: Record<OfferStatus, string> = {
  draft: '',
  approved: 'Approve offer',
  extended: 'Mark as given to the candidate',
  accepted: 'Record acceptance',
  declined: 'Record decline',
  withdrawn: 'Withdraw offer',
  expired: 'Mark expired',
};
const OFFER_REASON: OfferStatus[] = ['declined', 'withdrawn'];

type Data = Awaited<ReturnType<typeof getApplication>>;

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:recruitment:read', `/ops/hr/recruitment/applications/${id}`);
  return (
    <Frame access={access} active="recruitment">
      <p>
        <a href="/ops/hr/recruitment?tab=applications">Back to applications</a>
      </p>
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getApplication(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const stage = d.application.stage as ApplicationStage;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${d.candidate?.code ?? 'Candidate'} ${d.candidate?.fullName ?? ''} → ${d.requisition.code} ${d.requisition.title}`}
      />
      <p>
        <StatusBadge tone={statusTone(stage)}>{APPLICATION_STAGE_LABELS[stage]}</StatusBadge> since{' '}
        {fmtDateTime(d.application.stageChangedAt)}
        {d.application.stageReason ? ` · ${d.application.stageReason}` : ''}
      </p>
      {d.fullView ? (
        <p>
          <a href={`/ops/hr/recruitment/candidates/${d.application.candidateId}`}>
            Candidate record
          </a>{' '}
          · <a href={`/ops/hr/recruitment/requisitions/${d.requisition.id}`}>Requisition</a>
        </p>
      ) : (
        <Alert tone="info" title="You are on the interview panel">
          You can see this application and give your own feedback. Stage changes, offers and contact
          details are for the recruiter and HR.
        </Alert>
      )}
      {d.employee ? (
        <Alert tone="success" title={`Hired as ${d.employee.employeeCode}`}>
          {d.onboardingCase ? (
            <a href={`/ops/hr/onboarding/${d.onboardingCase.id}`}>
              Onboarding case {d.onboardingCase.code}
            </a>
          ) : (
            'No onboarding case found.'
          )}
        </Alert>
      ) : null}
      {d.allowedTargets.length ? (
        <Card
          title="Move the application"
          description="Selection and rejection are recruitment decisions; every change is kept in the stage history."
        >
          <div className="el-grid">
            {d.allowedTargets.map((to) => (
              <ActionForm
                key={to}
                action={`/ops/api/v1/hr/applications/${d.application.id}/transitions`}
                submitLabel={
                  stage === 'interview' && to === 'screening'
                    ? 'Back to screening'
                    : stage === 'offer' && to === 'interview'
                      ? 'Reverse selection'
                      : STAGE_ACTIONS[to]
                }
                extra={{ to }}
                variant={to === 'rejected' ? 'danger' : 'secondary'}
                fields={
                  ['rejected', 'withdrawn'].includes(to) ||
                  (stage === 'interview' && to === 'screening') ||
                  (stage === 'offer' && to === 'interview')
                    ? [{ name: 'reason', label: 'Reason', required: true }]
                    : []
                }
              />
            ))}
          </div>
        </Card>
      ) : null}
      <Interviews d={d} />
      {d.canSchedule ? (
        <Section label="Loading form…">
          <ScheduleInterview applicationId={d.application.id} />
        </Section>
      ) : null}
      {d.fullView ? <Offers d={d} /> : null}
      {d.canConvert ? (
        <Section label="Loading form…">
          <Convert applicationId={d.application.id} />
        </Section>
      ) : null}
      {d.fullView ? (
        <Card title="Stage history">
          <DataTable
            rows={d.stages}
            rowKey={(s) => s.id}
            columns={[
              { key: 'at', header: 'When', render: (s) => fmtDateTime(s.at) },
              {
                key: 'from',
                header: 'From',
                render: (s) =>
                  s.fromStage ? APPLICATION_STAGE_LABELS[s.fromStage as ApplicationStage] : 'New',
              },
              {
                key: 'to',
                header: 'To',
                render: (s) => APPLICATION_STAGE_LABELS[s.toStage as ApplicationStage],
              },
              { key: 'reason', header: 'Reason', render: (s) => s.reason ?? '' },
              { key: 'actorName', header: 'By', render: (s) => s.actorName ?? 'Unknown' },
            ]}
          />
        </Card>
      ) : null}
      {d.fullView ? <HistoryPanel rows={d.history} /> : null}
    </div>
  );
}

function Interviews({ d }: { d: Data }) {
  return (
    <Card title="Interviews">
      {d.interviews.length === 0 ? (
        <EmptyState
          title="No interviews scheduled"
          description={
            d.canSchedule
              ? 'Schedule one below.'
              : 'Interviews are scheduled once the application reaches the interview stage.'
          }
        />
      ) : (
        <div className="el-stack">
          {d.interviews.map((iv) => {
            const mine = iv.panel.find((p) => p.mine);
            const live = iv.status === 'scheduled' || iv.status === 'completed';
            return (
              <div key={iv.id} className="el-stack">
                <h3>
                  {fmtDateTime(iv.scheduledAt)} · {humanise(iv.mode)} · {iv.durationMinutes} min
                  {iv.location ? ` · ${iv.location}` : ''}{' '}
                  <StatusBadge tone={statusTone(iv.status)}>{humanise(iv.status)}</StatusBadge>
                </h3>
                <DataTable
                  rows={iv.panel}
                  rowKey={(p) => p.staffId}
                  columns={[
                    { key: 'fullName', header: 'Interviewer' },
                    {
                      key: 'recommendation',
                      header: 'Recommendation',
                      render: (p) =>
                        p.recommendation
                          ? RECOMMENDATION_LABELS[p.recommendation as InterviewRecommendation]
                          : p.submitted
                            ? 'Given'
                            : 'Not given yet',
                    },
                    {
                      key: 'feedbackNotes',
                      header: 'Notes',
                      render: (p) =>
                        p.feedbackNotes ??
                        (p.submitted && !p.mine ? 'Visible to the recruiter and HR' : ''),
                    },
                    {
                      key: 'submittedAt',
                      header: 'Given',
                      render: (p) => (p.submittedAt ? fmtDateTime(p.submittedAt) : ''),
                    },
                  ]}
                />
                {mine &&
                live &&
                ['applied', 'screening', 'interview', 'offer'].includes(d.application.stage) ? (
                  <ActionForm
                    action={`/ops/api/v1/hr/interviews/${iv.id}/feedback`}
                    submitLabel={mine.submitted ? 'Update my feedback' : 'Submit my feedback'}
                    fields={[
                      {
                        name: 'recommendation',
                        label: 'Recommendation',
                        type: 'select',
                        required: true,
                        defaultValue: mine.recommendation ?? undefined,
                        options: INTERVIEW_RECOMMENDATIONS.map((v) => ({
                          value: v,
                          label: RECOMMENDATION_LABELS[v],
                        })),
                      },
                      {
                        name: 'notes',
                        label: 'Notes on the interview',
                        type: 'textarea',
                        required: true,
                        defaultValue: mine.feedbackNotes ?? '',
                      },
                    ]}
                  />
                ) : null}
                {d.canManage && iv.status === 'scheduled' ? (
                  <ActionForm
                    action={`/ops/api/v1/hr/interviews/${iv.id}`}
                    method="PATCH"
                    submitLabel="Update interview"
                    variant="secondary"
                    compact
                    fields={[
                      {
                        name: 'status',
                        label: 'Outcome',
                        type: 'select',
                        options: [
                          { value: 'completed', label: 'Took place' },
                          { value: 'cancelled', label: 'Cancelled' },
                          { value: 'no_show', label: 'Candidate did not attend' },
                        ],
                      },
                      { name: 'scheduledAt', label: 'New time (IST)', type: 'datetime' },
                      { name: 'reason', label: 'Reason (cancel / no-show)' },
                    ]}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

async function ScheduleInterview({ applicationId }: { applicationId: string }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Schedule an interview"
      description="Panel members are notified in Elevate OS and can give feedback here. No calendar invite or email is sent."
    >
      <ActionForm
        action="/ops/api/v1/hr/interviews"
        submitLabel="Schedule interview"
        extra={{ applicationId }}
        fields={[
          { name: 'scheduledAt', label: 'Date and time (IST)', type: 'datetime', required: true },
          {
            name: 'durationMinutes',
            label: 'Length (minutes)',
            type: 'number',
            defaultValue: '45',
          },
          {
            name: 'mode',
            label: 'Mode',
            type: 'select',
            required: true,
            options: INTERVIEW_MODES.map((m) => ({ value: m, label: humanise(m) })),
          },
          { name: 'location', label: 'Room or meeting reference' },
          {
            name: 'interviewer1',
            label: 'Interviewer',
            type: 'select',
            required: true,
            options: r.data.staff,
          },
          {
            name: 'interviewer2',
            label: 'Second interviewer',
            type: 'select',
            options: r.data.staff,
          },
          {
            name: 'interviewer3',
            label: 'Third interviewer',
            type: 'select',
            options: r.data.staff,
          },
        ]}
      />
    </Card>
  );
}

function Offers({ d }: { d: Data }) {
  return (
    <Card
      title="Offer"
      description="Salary is not stored here: keep a reference to the compensation proposal held by HR records. Elevate OS never sends the offer."
    >
      {d.offers.length === 0 ? (
        <EmptyState
          title="No offer yet"
          description={
            d.canCreateOffer
              ? 'Prepare one below.'
              : 'An offer can be prepared once a decider selects the candidate.'
          }
        />
      ) : (
        <div className="el-stack">
          {d.offers.map((o) => (
            <div key={o.id} className="el-stack">
              <p>
                <StatusBadge tone={statusTone(o.status)}>
                  {OFFER_STATUS_LABELS[o.status as OfferStatus]}
                </StatusBadge>{' '}
                {o.offeredTitle} · start{' '}
                {o.proposedStartDate ? fmtDate(o.proposedStartDate) : 'not set'} · valid until{' '}
                {o.validUntil ? fmtDate(o.validUntil) : 'not set'}
              </p>
              <p className="el-field-hint">
                Prepared by {o.preparedByName ?? 'unknown'}
                {o.approvedByName ? ` · approved by ${o.approvedByName}` : ''}
                {o.compensationReference
                  ? ` · compensation reference ${o.compensationReference}`
                  : ''}
                {o.statusReason ? ` · ${o.statusReason}` : ''}
              </p>
              {o.status === 'draft' && o.targets.every((t) => t !== 'approved') && d.canDecide ? (
                <p className="el-field-hint">
                  You prepared this offer, so another decider must approve it.
                </p>
              ) : null}
              <div className="el-grid">
                {o.targets.map((to) => (
                  <ActionForm
                    key={to}
                    action={`/ops/api/v1/hr/offers/${o.id}/transitions`}
                    submitLabel={
                      o.status === 'draft' && to === 'withdrawn'
                        ? 'Discard draft'
                        : OFFER_ACTIONS[to]
                    }
                    extra={{ to }}
                    variant={
                      to === 'withdrawn' ? 'danger' : to === 'approved' ? 'primary' : 'secondary'
                    }
                    fields={
                      OFFER_REASON.includes(to)
                        ? [{ name: 'reason', label: 'Reason', required: true }]
                        : []
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {d.canCreateOffer ? (
        <ActionForm
          action="/ops/api/v1/hr/offers"
          submitLabel="Prepare draft offer"
          extra={{ applicationId: d.application.id }}
          fields={[
            {
              name: 'offeredTitle',
              label: 'Offered designation',
              required: true,
              defaultValue: d.requisition.title,
            },
            { name: 'proposedStartDate', label: 'Proposed start date', type: 'date' },
            { name: 'validUntil', label: 'Valid until', type: 'date' },
            {
              name: 'compensationReference',
              label: 'Compensation proposal reference',
              hint: 'A reference only, never an amount.',
            },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
        />
      ) : null}
    </Card>
  );
}

async function Convert({ applicationId }: { applicationId: string }) {
  const r = await load((db) => formOptions(db));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Convert to employee"
      description="Creates the employee record (status onboarding) from the accepted offer and opens an onboarding case. Running it again returns the same employee."
    >
      <ActionForm
        action={`/ops/api/v1/hr/applications/${applicationId}/convert`}
        submitLabel="Create employee and start onboarding"
        fields={[
          {
            name: 'managerStaffId',
            label: 'Reporting manager',
            type: 'select',
            options: r.data.staff,
            hint: 'Leave empty to use the requisition’s hiring manager.',
          },
          { name: 'workEmail', label: 'Work email', type: 'email' },
          {
            name: 'workLocation',
            label: 'Work location',
            hint: 'Leave empty to use the requisition location.',
          },
        ]}
      />
    </Card>
  );
}
