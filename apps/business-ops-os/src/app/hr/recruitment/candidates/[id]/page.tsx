import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  APPLICATION_STAGE_LABELS,
  CANDIDATE_SOURCES,
  type ApplicationStage,
} from '../../../../../domain/hr/recruitment';
import { DECISION_STATE_LABELS } from '../../../../../domain/policies';
import { getCandidate } from '../../../../../server/hr/recruitment';
import { ActionForm } from '../../../../../ui/action-form';
import { fmtDateTime, humanise, statusTone } from '../../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../../ui/frame';
import { HistoryPanel } from '../../_components/lifecycle-ui';

export const dynamic = 'force-dynamic';

const RETENTION_TEXT = {
  not_decided:
    'No retention period has been decided (owner decision D-028), so this candidate is not flagged.',
  not_closed: 'Not every application is closed yet.',
  due: 'The retention period has passed: anonymise this candidate.',
  not_due: 'Still within the retention period.',
} as const;

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:recruitment:read', `/ops/hr/recruitment/candidates/${id}`);
  return (
    <Frame access={access} active="recruitment">
      <p>
        <a href="/ops/hr/recruitment?tab=candidates">Back to candidates</a>
      </p>
      <Section>
        <Detail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getCandidate(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const c = d.candidate;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${c.code} — ${c.fullName}`}
        description={`Source: ${humanise(c.source)}${c.sourceDetail ? ` (${c.sourceDetail})` : ''}`}
      />
      <p>
        <StatusBadge tone={c.status === 'anonymised' ? 'neutral' : 'info'}>
          {humanise(c.status)}
        </StatusBadge>{' '}
        Recruiter: {c.recruiterName ?? 'unassigned'}
      </p>
      {c.status === 'anonymised' ? (
        <Alert tone="info" title="Personal data removed">
          Anonymised {fmtDateTime(c.anonymisedAt)}. Stage history and decisions are kept.
        </Alert>
      ) : null}
      <Card title="Contact and consent">
        {d.contacts ? (
          <dl className="el-stack">
            <div>
              <dt>Email</dt>
              <dd>{d.contacts.email ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{d.contacts.phone ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Privacy notice</dt>
              <dd>
                {c.privacyNoticeAt ? `Given ${fmtDateTime(c.privacyNoticeAt)}` : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Consent note</dt>
              <dd>{c.consentNote ?? 'None'}</dd>
            </div>
          </dl>
        ) : (
          <p>Contact details are shown only to this candidate’s recruiter and to HR.</p>
        )}
      </Card>
      <Card title="Applications">
        <DataTable
          rows={d.applications}
          rowKey={(a) => a.id}
          empty={
            <EmptyState
              title="No applications you can see"
              description="Add an application from an open requisition’s page."
            />
          }
          columns={[
            {
              key: 'requisitionCode',
              header: 'Requisition',
              render: (a) => (
                <a href={`/ops/hr/recruitment/applications/${a.id}`}>
                  {a.requisitionCode} {a.requisitionTitle}
                </a>
              ),
            },
            {
              key: 'stage',
              header: 'Stage',
              render: (a) => (
                <StatusBadge tone={statusTone(a.stage)}>
                  {APPLICATION_STAGE_LABELS[a.stage as ApplicationStage]}
                </StatusBadge>
              ),
            },
            {
              key: 'stageChangedAt',
              header: 'Since',
              render: (a) => fmtDateTime(a.stageChangedAt),
            },
          ]}
        />
      </Card>
      {d.canManage ? (
        <Card title="Edit candidate">
          <ActionForm
            action={`/ops/api/v1/hr/candidates/${c.id}`}
            method="PATCH"
            submitLabel="Save candidate"
            variant="secondary"
            fields={[
              { name: 'fullName', label: 'Full name', defaultValue: c.fullName },
              {
                name: 'email',
                label: 'Email',
                type: 'email',
                defaultValue: d.contacts?.email ?? '',
              },
              { name: 'phone', label: 'Phone', type: 'tel', defaultValue: d.contacts?.phone ?? '' },
              {
                name: 'source',
                label: 'Source',
                type: 'select',
                defaultValue: c.source,
                options: CANDIDATE_SOURCES.map((s) => ({ value: s, label: humanise(s) })),
              },
              { name: 'sourceDetail', label: 'Source detail', defaultValue: c.sourceDetail ?? '' },
              {
                name: 'privacyNoticeGiven',
                label: 'Privacy notice given',
                type: 'checkbox',
                defaultValue: c.privacyNoticeAt ? 'true' : 'false',
              },
              { name: 'consentNote', label: 'Consent note', defaultValue: c.consentNote ?? '' },
            ]}
          />
        </Card>
      ) : null}
      {c.status === 'active' ? (
        <Card
          title="Data minimisation"
          description={`Retention setting: ${DECISION_STATE_LABELS[d.anonymisation.retentionSetting.decisionState]}. ${RETENTION_TEXT[d.anonymisation.retention]}`}
        >
          {!d.anonymisation.canAnonymise ? (
            <p>Only an HR manager or another recruitment decider can anonymise a candidate.</p>
          ) : d.anonymisation.eligible ? (
            <ActionForm
              action={`/ops/api/v1/hr/candidates/${c.id}/anonymise`}
              submitLabel="Anonymise this candidate"
              variant="danger"
              fields={[
                {
                  name: 'confirm',
                  label:
                    'I understand the name, email, phone, consent note and interview notes are removed for good',
                  type: 'checkbox',
                },
              ]}
            />
          ) : (
            <p>Cannot anonymise yet: {d.anonymisation.reason}</p>
          )}
        </Card>
      ) : null}
      <HistoryPanel rows={d.history} />
    </div>
  );
}
