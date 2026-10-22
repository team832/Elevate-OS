/**
 * One admission application: what still blocks confirmation, the next action, the content of the
 * current version, and its history (versions, printed forms, signature confirmations, approval).
 * Used by the full page and by the `?open=` pop-up of the list. Server component.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert, StatusBadge, type Tone } from '@elevate/shared-ui';
import {
  partLabels,
  type ApplicationStatus,
  type ApplicationTask,
} from '../../../../domain/applications';
import { DOCUMENT_STATE_LABELS } from '../../../../domain/admission-form';
import { CLASS_CATEGORY_LABELS } from '../../../../domain/demos';
import { getApplication } from '../../../../server/applications-read';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, fmtPaise, humanise } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment, TaskList } from '../../../../ui/sections';
import { RecordJourney } from '../../_components/journey';
import { FormDownload } from './form-download';

export const APP_TONE: Record<ApplicationStatus, Tone> = {
  draft: 'warning',
  ready_for_review: 'info',
  form_generated: 'info',
  signatures_confirmed: 'info',
  admission_confirmed: 'success',
  withdrawn: 'neutral',
};

/** Journey stage each status is at (Demo 0, Application 1, Signed 2, Confirmed 3; 4 = all done). */
const STEP: Record<Exclude<ApplicationStatus, 'withdrawn'>, number> = {
  draft: 1,
  ready_for_review: 1,
  form_generated: 2,
  signatures_confirmed: 3,
  admission_confirmed: 4,
};

export const loadApplication = (user: AuthenticatedUser, id: string) =>
  load((db) => getApplication(db, user, id));
export type ApplicationView = Extract<
  Awaited<ReturnType<typeof loadApplication>>,
  { ok: true }
>['data'];

const missing = (v: string | null | undefined) => v || 'Not recorded';

/** Where each confirmation task is fixed (printing the form is the button on this page). */
const taskHref = (d: ApplicationView, page: string): Record<ApplicationTask, string | null> => {
  const admission = `/ops/admissions/${d.admission.id}`;
  return {
    details: d.can.write ? `${page}?edit=1` : null,
    fee_agreement: admission,
    documents: admission,
    declarations: '/ops/settings?group=admissions',
    form: null,
    signatures: d.can.write ? `${page}?sign=1` : null,
    payment: admission,
  };
};

/** Gaps fixed on the lead, not in the application form (Gap.fix). */
const FIX = {
  contact: ['act=details', 'Edit contact details'],
  counsellor: ['act=assign', 'Assign the lead owner (counsellor)'],
} as const;

/** The task list: each gap fixed elsewhere links there; "Go to this task" only when the form fixes something. */
export const taskItems = (d: ApplicationView, page: string, tasks = d.tasks) =>
  tasks.map((t) => ({
    ...t,
    href: t.missing.length && t.missing.every((g) => g.fix) ? null : taskHref(d, page)[t.task],
    missing: t.missing.map((g) =>
      g.fix ? (
        <>
          {g.message}.{' '}
          <a href={`/ops/leads/${d.admission.leadId}?${FIX[g.fix][0]}`}>{FIX[g.fix][1]}</a>
        </>
      ) : (
        g.message
      ),
    ),
  }));

/** Header badges: status, version, sample data. */
export function ApplicationMeta({ d }: { d: ApplicationView }) {
  const a = d.application;
  return (
    <>
      <StatusBadge tone={APP_TONE[a.status]}>{a.statusLabel}</StatusBadge> {a.reference} · version{' '}
      {a.currentVersion}
      {a.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
    </>
  );
}

/** The next step for this status, as a working action (or a link to the page that has it). */
function NextStep({ d, page }: { d: ApplicationView; page: string }) {
  const a = d.application;
  const api = `/ops/api/v1/applications/${a.id}`;
  if (a.status === 'admission_confirmed')
    return (
      <p>
        Confirmed. <a href={`/ops/admissions/${d.admission.id}`}>Open the admission</a> for the
        number, acknowledgement, ID card and Academic setup.
      </p>
    );
  if (a.status === 'withdrawn') return <p>Withdrawn. The history is kept.</p>;
  if (!d.can.write && !d.can.confirm)
    return <p>You can view this application but not change it.</p>;
  return (
    <div className="el-inline-form">
      {d.can.write && a.status === 'draft' ? (
        <>
          <a href={`${page}?edit=1`}>Edit details</a>
          <ActionForm
            action={`${api}/ready`}
            submitLabel="Mark ready for review"
            extra={{ version: a.currentVersion }}
            compact
          />
        </>
      ) : null}
      {d.can.printForm &&
      ['ready_for_review', 'form_generated', 'signatures_confirmed'].includes(a.status) ? (
        <FormDownload applicationId={a.id} label="Print admission form (PDF)" />
      ) : null}
      {d.can.write && a.status === 'form_generated' ? (
        <a href={`${page}?sign=1`}>Confirm signatures</a>
      ) : null}
      {d.can.write && a.status !== 'draft' ? (
        <a href={`${page}?edit=1`}>Edit details (new version)</a>
      ) : null}
      {d.can.confirm && a.status === 'signatures_confirmed' && !d.confirmationGaps.length ? (
        <a className="el-button el-button-primary" href={`${page}?confirm=1`}>
          Confirm admission
        </a>
      ) : null}
    </div>
  );
}

/** The owner's paper form answers kept on the application: [field, label, form section]. */
export const PAPER_FIELDS = [
  ['gender', 'Gender', 'Student KYC'],
  ['whatsapp', 'WhatsApp', 'Student KYC'],
  ['guardianOccupation', 'Parent / guardian occupation', 'Parent / guardian'],
  ['guardianOfficeAddress', 'Parent / guardian office address', 'Parent / guardian'],
  ['guardianAlternateContact', 'Alternate contact', 'Parent / guardian'],
  ['qualification', 'Class / qualification', 'Academic details'],
  ['yearOfPassing', 'Year of passing (e.g. 2026)', 'Academic details'],
  ['percentageOrGrade', 'Percentage / grade', 'Academic details'],
  ['subjectsOrStream', 'Subjects / stream', 'Academic details'],
  ['batchTiming', 'Batch timing', 'Programme'],
] as const;

/** The paper-form answers and the result-publicity consent (private: hidden without permission). */
export function PaperAnswers({ d, level }: { d: ApplicationView; level: 2 | 3 }) {
  const f = d.snapshot.form;
  if (!f) return null;
  const consent = f.resultPublicityConsent;
  return (
    <Segment title="Paper form answers" level={level} flush>
      <DetailTable
        rows={[
          ...PAPER_FIELDS.map(([name, text]) => ({
            label: text,
            value: missing(f[name]),
          })),
          {
            label: 'Result publicity consent',
            value: consent?.given
              ? `Given (recorded ${fmtDateTime(consent.recordedAt)})`
              : consent
                ? `Not given (recorded ${fmtDateTime(consent.recordedAt)})`
                : 'Not given (default)',
          },
        ]}
      />
    </Segment>
  );
}

export function ApplicationDetail({
  d,
  level,
  page,
}: {
  d: ApplicationView;
  level: 2 | 3;
  page: string;
}) {
  const a = d.application;
  const s = d.snapshot;
  const fee = s.feeAgreement;
  return (
    <div className="el-stack">
      {a.status === 'withdrawn' ? null : (
        <RecordJourney at={STEP[a.status]} from={a.origin === 'demo' ? 0 : 1} />
      )}
      {d.stale ? (
        <Alert tone="warning" title={`Details changed since version ${a.currentVersion}`}>
          Changed: {partLabels(d.changedSinceSaved)}. Save the application to create a new version;
          the form must then be printed and signed again.
        </Alert>
      ) : null}
      <Segment
        title={
          a.status === 'admission_confirmed'
            ? 'Confirmation'
            : 'Before the admission can be confirmed'
        }
        level={level}
        description="Checked again on the server when an approver confirms with their password. Completing these steps never admits the student by itself."
      >
        {d.tasks.length ? (
          <TaskList caption="Confirmation tasks" items={taskItems(d, page)} />
        ) : null}
        {a.status !== 'admission_confirmed' && !d.confirmationGaps.length ? (
          <p>Nothing is missing. An approver can confirm the admission.</p>
        ) : null}
        <NextStep d={d} page={page} />
      </Segment>
      <Segment title="Student and guardians" level={level} flush>
        {s.kycRestricted ? (
          <p className="el-field-hint">
            {s.student.fullName}. KYC and guardian details need permission to view private student
            details.
          </p>
        ) : (
          <DetailTable
            rows={[
              { label: 'Student', value: s.student.fullName },
              { label: 'Date of birth', value: missing(s.student.dateOfBirth) },
              {
                label: 'Class / category',
                value: missing(
                  s.student.currentStage && CLASS_CATEGORY_LABELS[s.student.currentStage],
                ),
              },
              { label: 'School', value: missing(s.student.previousSchool) },
              { label: 'City', value: missing(s.student.city) },
              { label: 'Address', value: missing(s.student.address) },
              {
                label: 'Phone / email',
                value: missing([s.student.phone, s.student.email].filter(Boolean).join(' · ')),
              },
              {
                label: 'Emergency contact',
                value: missing(
                  [s.student.emergencyContactName, s.student.emergencyContactPhone]
                    .filter(Boolean)
                    .join(' · '),
                ),
              },
              {
                label: 'Guardians',
                value: s.guardians?.length ? (
                  <ul>
                    {s.guardians.map((g) => (
                      <li key={`${g.id}-${g.fullName}`}>
                        {g.fullName} ({humanise(g.relationship)}
                        {g.isPrimary ? ', primary' : ''}
                        {g.isEmergency ? ', emergency' : ''}){' '}
                        {[g.phone, g.email].filter(Boolean).join(' · ')}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'No guardian recorded'
                ),
              },
            ]}
          />
        )}
      </Segment>
      <PaperAnswers d={d} level={level} />
      <Segment
        title="Documents (paper form section 05)"
        level={level}
        flush
        description="Recorded on the student profile (type, masked reference, verification). Photos and scans are not stored."
      >
        <DetailTable
          rows={d.documents.map((x) => ({
            label: x.label,
            value: (
              <StatusBadge
                tone={
                  x.state === 'verified' ? 'success' : x.state === 'rejected' ? 'danger' : 'neutral'
                }
              >
                {DOCUMENT_STATE_LABELS[x.state]}
              </StatusBadge>
            ),
          }))}
        />
      </Segment>
      <Segment title="Programme and fee agreement" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Programmes',
              value: s.programmes.map((p) => p.name).join(' + ') || 'None chosen',
            },
            { label: 'Academic year', value: missing(s.academicYear) },
            { label: 'Start date', value: s.startDate ? fmtDate(s.startDate) : 'Not recorded' },
            { label: 'Mode', value: missing(humanise(s.deliveryMode)) },
            fee === undefined
              ? { label: 'Fee agreement', value: 'Needs permission to read fees' }
              : {
                  label: 'Annual fee agreement',
                  value: fee
                    ? `${fee.label}: ${fmtPaise(fee.totalPaise)} in ${fee.instalments.length} instalment(s) (${fee.instalments.map((i) => `${fmtPaise(i.amountPaise)} due ${fmtDate(i.dueDate)}`).join('; ')})`
                    : 'No approved agreement (active fee plan) yet',
                },
            {
              label: 'Registration fee',
              value:
                s.registrationFeePaise === null
                  ? 'Not set (no charge assumed)'
                  : fmtPaise(s.registrationFeePaise),
            },
            {
              label: 'Declarations',
              value: s.declarations
                ? `Version ${s.declarations.version}`
                : 'Not configured — owner to supply the approved text',
            },
            {
              label: 'Payment before admission',
              value: `${humanise(d.paymentGate.value.rule)} (${d.paymentGate.decisionState})`,
            },
          ]}
        />
      </Segment>
      <Segment
        title="Version history"
        level={level}
        flush
        description="Every change to what the form prints is a new version; signatures belong to one version."
      >
        <RecordTable
          rows={d.versions}
          rowKey={(v) => String(v.version)}
          columns={[
            { key: 'v', header: 'Version', render: (v) => v.version },
            { key: 'at', header: 'Saved', render: (v) => fmtDateTime(v.createdAt) },
            { key: 'by', header: 'By', render: (v) => v.createdByName ?? '—' },
            {
              key: 'c',
              header: 'Changed',
              render: (v) => (v.version === 1 ? 'First version' : partLabels(v.changed) || '—'),
            },
          ]}
        />
      </Segment>
      <Segment title="Printed forms and signatures" level={level} flush>
        <RecordTable
          rows={d.forms}
          rowKey={(f) => f.id}
          empty={<p className="el-field-hint">No form printed yet.</p>}
          columns={[
            { key: 'v', header: 'Version', render: (f) => f.version },
            {
              key: 'at',
              header: 'Printed',
              render: (f) => `${fmtDateTime(f.generatedAt)} by ${f.generatedByName ?? '—'}`,
            },
            { key: 't', header: 'Template', render: (f) => f.templateVersion },
            {
              key: 'h',
              header: 'SHA-256',
              render: (f) => <code>{f.pdfSha256.slice(0, 12)}…</code>,
            },
            {
              key: 's',
              header: 'Signatures',
              render: (f) => {
                const sig = d.signatures.find((x) => x.formId === f.id);
                if (!sig) return 'Not confirmed';
                const who = sig.signers.map((x) => `${x.name} (${x.role})`).join(', ');
                return sig.invalidatedAt
                  ? `Invalidated: ${sig.invalidatedReason}`
                  : `Signed ${fmtDate(sig.signedOn)} by ${who}; confirmed by ${sig.confirmedByName ?? '—'}`;
              },
            },
          ]}
        />
      </Segment>
      {d.approval ? (
        <Segment title="Final approval" level={level} flush>
          <DetailTable
            rows={[
              { label: 'Admission number', value: <strong>{d.approval.admissionNumber}</strong> },
              {
                label: 'Approved',
                value: `${fmtDateTime(d.approval.approvedAt)} by ${d.approval.approvedByName ?? '—'}`,
              },
              { label: 'Version approved', value: d.approval.applicationVersion },
              {
                label: 'Re-check',
                value: `Password re-entered ${fmtDateTime(d.approval.reauthVerifiedAt)}`,
              },
            ]}
          />
        </Segment>
      ) : null}
      {d.can.write && !['admission_confirmed', 'withdrawn'].includes(a.status) ? (
        <Segment
          title="Withdraw the application"
          level={level}
          description="The family does not go ahead. Nothing is deleted."
        >
          <ActionForm
            action={`/ops/api/v1/applications/${a.id}/withdraw`}
            submitLabel="Withdraw application"
            variant="danger"
            fields={[{ name: 'reason', label: 'Reason', required: true }]}
          />
        </Segment>
      ) : null}
    </div>
  );
}
