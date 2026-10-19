import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../../../domain';
import { FEE_BALANCE_LABELS, formatPaise } from '../../../domain/fees';
import { getStudent } from '../../../server/students';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:students:read', `/ops/students/${id}`);
  return (
    <Frame access={access} active="students">
      <p>
        <a href="/ops/students">All students</a>
      </p>
      <Section label="Loading student…">
        <Profile user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

const statusLabel = (s: string) => ADMISSION_STATUS_LABELS[s as AdmissionStatus] ?? humanise(s);

async function Profile({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load((db) => getStudent(db, user, id));
  if (!r.ok) return r.view;
  const d = r.data;
  const a = d.admission;
  const p = d.person;
  const h = d.handoff;
  const canWrite = can(user, 'ops:admissions:write');
  return (
    <div className="el-stack">
      <PageHeader
        title={p.fullName}
        description={
          <>
            Admission <a href={`/ops/admissions/${a.id}`}>{a.code}</a> · lead{' '}
            <a href={`/ops/leads/${p.leadId}`}>{p.leadCode}</a> ·{' '}
            {d.programme?.code ?? 'no programme'}
            {d.programme ? ` (${d.programme.name})` : ''}
          </>
        }
      />
      <div className="el-grid">
        <Card title="Admission">
          <p>
            <StatusBadge
              tone={
                a.state === 'enrolled' ? 'success' : a.state === 'withdrawn' ? 'neutral' : 'info'
              }
            >
              {a.stateLabel}
            </StatusBadge>
          </p>
          <p>Admission owner: {d.owner?.fullName ?? 'Unassigned'}</p>
          <p>Admitted on: {fmtDate(a.admissionDate)}</p>
          <p>
            Mode: {humanise(a.deliveryMode)} · intended start {fmtDate(a.intendedStartDate)}
          </p>
          {a.state === 'withdrawn' ? (
            <p>
              Withdrawn: {a.statusReasonLabel ?? 'reason not coded'}
              {a.statusReason ? ` — ${a.statusReason}` : ''}
            </p>
          ) : null}
          {d.otherAdmissions.length ? (
            <p className="el-field-hint">
              Other admission cases of this person:{' '}
              {d.otherAdmissions.map((o, i) => (
                <span key={o.id}>
                  {i ? ', ' : ''}
                  <a href={`/ops/admissions/${o.id}`}>{o.code}</a> ({statusLabel(o.status)})
                </span>
              ))}
            </p>
          ) : null}
        </Card>
        <Card
          title="Academic OS record"
          description="Academic OS owns the student and enrolment. Business Ops stores only the ids Academic returned."
        >
          {d.academic.path ? (
            <>
              <p>
                <a href={d.academic.path}>Open the student in Academic OS</a>
              </p>
              <p className="el-field-hint">
                Enrolled {fmtDateTime(d.academic.enrolledAt)}
                {d.academic.existingStudent ? ' · Academic reused an existing student record' : ''}
              </p>
            </>
          ) : (
            <p>Not linked yet: Academic OS has not confirmed an enrolment.</p>
          )}
        </Card>
      </div>

      <Card
        title="Enrolment handoff"
        description="Requests to Academic OS. Enrolled only after Academic confirms. A new request is allowed only when the previous one can no longer enrol the student (rejected, or failed after every automatic retry)."
      >
        <p>
          <StatusBadge tone={h.view.tone}>{h.view.label}</StatusBadge>
          {h.view.detail ? ` ${h.view.detail}` : ''}
        </p>
        {h.replies.some((x) => x.opsStatus && x.opsStatus !== 'processed') ? (
          <Alert tone="danger" title="Business Ops could not apply Academic's reply">
            {h.replies
              .filter((x) => x.opsStatus && x.opsStatus !== 'processed')
              .map((x) => `${x.type} (${x.opsStatus}): ${x.opsError ?? 'no error recorded'}`)
              .join('; ')}
          </Alert>
        ) : null}
        <DataTable
          rows={h.attempts}
          rowKey={(x) => x.id}
          empty={
            <EmptyState
              title="No attempts recorded"
              description={
                h.attempt > 0
                  ? `Requested before attempts were tracked (attempt ${h.attempt}, ${fmtDateTime(h.requestedAt)}).`
                  : 'Enrolment has not been requested.'
              }
            />
          }
          columns={[
            { key: 'n', header: 'Attempt', render: (x) => x.attempt },
            { key: 'kind', header: 'Why', render: (x) => humanise(x.kind) },
            {
              key: 'by',
              header: 'Requested',
              render: (x) => `${fmtDateTime(x.requestedAt)} by ${x.requestedByName ?? 'unknown'}`,
            },
            {
              key: 'outcome',
              header: 'Outcome',
              render: (x) => (
                <StatusBadge tone={statusTone(x.outcome === 'confirmed' ? 'enrolled' : x.outcome)}>
                  {humanise(x.outcome)}
                </StatusBadge>
              ),
            },
            {
              key: 'detail',
              header: 'Detail',
              render: (x) =>
                [
                  x.rejectionCode ? `${x.rejectionCode}: ${x.rejectionReason}` : null,
                  x.reason,
                  x.note,
                ]
                  .filter(Boolean)
                  .join(' · '),
            },
          ]}
        />
        {canWrite && h.retry.allowed && h.retry.via === 'retry' ? (
          <ActionForm
            action={`/ops/api/v1/admissions/${a.id}/enrolment-retry`}
            submitLabel="Send a new enrolment request"
            fields={[
              {
                name: 'reason',
                label: 'Why it is safe to try again',
                required: true,
                hint: 'Academic OS gave up on the previous request, so it created nothing. The new attempt keeps the same admission.',
              },
            ]}
          />
        ) : null}
        {canWrite && h.retry.allowed && h.retry.via === 'request' ? (
          <p>
            <a href={`/ops/admissions/${a.id}`}>Request enrolment from the admission page</a>
          </p>
        ) : null}
      </Card>

      <div className="el-grid">
        <Card
          title="Contact and consent"
          description="Private: students may be minors (ops:student_private:read)."
        >
          {p.privateFields === 'visible' ? (
            <>
              <p>
                Student: {p.studentPhone ?? '—'} · {p.studentEmail ?? '—'}
              </p>
              <p>
                Guardian: {p.guardianName ?? '—'} ({humanise(p.guardianRelationship)}) ·{' '}
                {p.guardianPhone ?? '—'} · {p.guardianEmail ?? '—'}
              </p>
              <p>City: {p.city ?? '—'}</p>
              {p.consent ? (
                <p>
                  Consent {p.consent.status} by {p.consent.by}; channels:{' '}
                  {p.consent.allowedChannels.length ? p.consent.allowedChannels.join(', ') : 'none'}
                  {p.consent.preferredContact
                    ? `; contact the ${p.consent.preferredContact} first`
                    : ''}{' '}
                  <span className="el-field-hint">({fmtDateTime(p.consent.recordedAt)})</span>
                </p>
              ) : (
                <p>Consent and communication preferences: not recorded.</p>
              )}
              {canWrite ? (
                <ActionForm
                  action={`/ops/api/v1/admissions/${a.id}/contact-preferences`}
                  method="PUT"
                  submitLabel="Save consent and preferences"
                  variant="secondary"
                  fields={[
                    {
                      name: 'consentStatus',
                      label: 'Consent to contact',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'given', label: 'Given' },
                        { value: 'refused', label: 'Refused' },
                        { value: 'withdrawn', label: 'Withdrawn' },
                      ],
                    },
                    {
                      name: 'consentBy',
                      label: 'Given or refused by',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'guardian', label: 'Guardian' },
                        { value: 'student', label: 'Student' },
                        { value: 'both', label: 'Both' },
                      ],
                    },
                    {
                      name: 'allowedChannels',
                      label: 'Allowed channels (call, whatsapp, sms, email; comma separated)',
                      type: 'list',
                      hint: 'Leave empty unless consent is given.',
                    },
                    {
                      name: 'preferredContact',
                      label: 'Contact first',
                      type: 'select',
                      options: [
                        { value: 'guardian', label: 'Guardian' },
                        { value: 'student', label: 'Student' },
                      ],
                    },
                    { name: 'note', label: 'Note' },
                  ]}
                />
              ) : null}
            </>
          ) : (
            <Alert tone="info" title="Restricted">
              Your roles can see this student&apos;s admission and handoff, not their contact or
              consent details.
            </Alert>
          )}
          <p>
            Stage: {humanise(p.currentStage)} · board {p.schoolBoard ?? '—'}
          </p>
        </Card>
        <Card title="Fees (manually recorded)">
          {d.fees ? (
            <>
              <p>{FEE_BALANCE_LABELS[d.fees.balanceState]}</p>
              <p>
                Due {formatPaise(d.fees.duePaise)} · received {formatPaise(d.fees.netReceivedPaise)}{' '}
                (checked by a second person: {formatPaise(d.fees.verifiedNetReceivedPaise)}) ·
                balance {formatPaise(d.fees.balancePaise)}
              </p>
              <p className="el-field-hint">{d.fees.disclaimer}</p>
              <p>
                <a href={`/ops/admissions/${a.id}#fees`}>See and record fee entries</a>
              </p>
            </>
          ) : (
            <p>Fee records need ops:fees:read.</p>
          )}
        </Card>
      </div>

      <Card
        title="Status history"
        description="Every pipeline change, with coded reasons where given."
      >
        <DataTable
          rows={d.history}
          rowKey={(t) => t.id}
          columns={[
            { key: 'at', header: 'When', render: (t) => fmtDateTime(t.at) },
            {
              key: 'move',
              header: 'Change',
              render: (t) =>
                `${t.fromStatus ? statusLabel(t.fromStatus) : '—'} → ${statusLabel(t.toStatus)}`,
            },
            {
              key: 'by',
              header: 'By',
              render: (t) =>
                t.actorType === 'system' ? 'Academic OS reply' : (t.actorName ?? 'user'),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (t) => [t.reasonLabel, t.reason].filter(Boolean).join(' — '),
            },
          ]}
        />
      </Card>

      <div className="el-grid">
        <Card title="Enquiries">
          <DataTable
            rows={d.enquiries}
            rowKey={(e) => `${e.receivedAt.toString()}-${e.sourceCode}`}
            empty={<EmptyState title="No enquiries recorded" />}
            columns={[
              { key: 'at', header: 'Received', render: (e) => fmtDateTime(e.receivedAt) },
              { key: 'source', header: 'Source', render: (e) => e.sourceLabel },
              {
                key: 'programme',
                header: 'Programme',
                render: (e) => e.programmeCode ?? 'Undecided',
              },
            ]}
          />
        </Card>
        <Card title="Counselling">
          <DataTable
            rows={d.counselling}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No counselling sessions" />}
            columns={[
              { key: 'at', header: 'When', render: (s) => fmtDateTime(s.scheduledAt) },
              { key: 'who', header: 'Counsellor', render: (s) => s.counsellorName },
              { key: 'status', header: 'Status', render: (s) => humanise(s.status) },
              { key: 'outcome', header: 'Outcome', render: (s) => s.outcome ?? '' },
            ]}
          />
        </Card>
        <Card title="Demo">
          <DataTable
            rows={d.demos}
            rowKey={(x) => x.id}
            empty={
              <EmptyState
                title="No demo booked"
                description="The demo can be skipped with a reason while the setting allows it."
              />
            }
            columns={[
              { key: 'days', header: 'Days', render: (x) => x.dayDates.map(fmtDate).join(', ') },
              { key: 'status', header: 'Status', render: (x) => humanise(x.status) },
              {
                key: 'fee',
                header: 'Demo fee',
                render: (x) =>
                  `${humanise(x.feeStatus)} (terms ${x.feeTermsState.replace(/_/g, ' ')})`,
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
