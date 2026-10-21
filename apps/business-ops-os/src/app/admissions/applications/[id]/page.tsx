/**
 * Admission application, full page (deep link of the list pop-up). `?edit=1`, `?sign=1` and
 * `?confirm=1` open the short focused forms (save details, confirm signatures, confirm admission).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { istToday } from '../../../../domain';
import { AdmissionsNav } from '../../../../ui/admissions-nav';
import { ActionForm } from '../../../../ui/action-form';
import { Frame, gate, Section } from '../../../../ui/frame';
import { FormModal } from '../../../../ui/record-modal';
import {
  ApplicationDetail,
  ApplicationMeta,
  PAPER_FIELDS,
  PaperAnswers,
  loadApplication,
  taskItems,
  type ApplicationView,
} from '../_components/application-detail';
import { ConfirmAdmissionForm } from '../_components/confirm-admission-form';
import { CLASS_CATEGORY_LABELS, CLASS_CATEGORY_OPTIONS } from '../../../../domain/demos';
import { DELIVERY_MODE_LABELS } from '../../../../domain/applications';
import { fmtDate, fmtPaise, humanise } from '../../../../ui/format';
import { DetailTable, Segment, TaskList } from '../../../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Application' };

export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const page = `/ops/admissions/applications/${id}`;
  const access = await gate('ops:admissions:read', page);
  const q = await searchParams;
  return (
    <Frame access={access} active="applications">
      <Section label="Loading application…">
        <Application user={access.user} id={id} page={page} modal={q} />
      </Section>
    </Frame>
  );
}

async function Application({
  user,
  id,
  page,
  modal,
}: {
  user: AuthenticatedUser;
  id: string;
  page: string;
  modal: Record<string, string | undefined>;
}) {
  const r = await loadApplication(user, id);
  const tabs = <AdmissionsNav current="applications" user={user} />;
  if (!r.ok)
    return (
      <>
        <PageHeader title="Application" tabs={tabs} />
        {r.view}
      </>
    );
  const d = r.data;
  return (
    <>
      <PageHeader
        title={d.snapshot.student.fullName}
        meta={<ApplicationMeta d={d} />}
        description={<a href="/ops/admissions/applications">All applications</a>}
        tabs={tabs}
      />
      <ApplicationDetail d={d} level={2} page={page} />
      {modal.edit && d.can.write ? <EditModal d={d} page={page} /> : null}
      {modal.sign && d.can.write && d.application.status === 'form_generated' ? (
        <SignModal d={d} page={page} />
      ) : null}
      {modal.confirm && d.can.confirm && d.application.status === 'signatures_confirmed' ? (
        <FormModal id="confirm-admission" title="Confirm admission" closeHref={page}>
          <p>
            You are confirming <strong>{d.snapshot.student.fullName}</strong>, application{' '}
            {d.application.reference} version {d.application.currentVersion}. The server checks
            everything again, gives the admission number and asks Academic OS to set up the
            enrolment. Who may confirm is a proposed setting awaiting the owner’s decision.
          </p>
          {d.confirmationGaps.length ? (
            <TaskList
              caption="What still blocks confirmation"
              items={taskItems(
                d,
                page,
                d.tasks.filter((t) => t.state !== 'completed'),
              )}
            />
          ) : (
            <>
              <CheckAnswers d={d} page={page} />
              <ConfirmAdmissionForm
                applicationId={d.application.id}
                version={d.application.currentVersion}
                cancelHref={page}
              />
            </>
          )}
        </FormModal>
      ) : null}
    </>
  );
}

/** "Check your answers" before the irreversible step: exactly what is approved (version, signatures). */
function CheckAnswers({ d, page }: { d: ApplicationView; page: string }) {
  const s = d.snapshot;
  const st = s.student;
  const g = s.guardians?.find((x) => x.isPrimary) ?? s.guardians?.[0];
  const sig = d.signatures.find(
    (x) => !x.invalidatedAt && x.version === d.application.currentVersion,
  );
  const fee = s.feeAgreement;
  const change = d.can.write ? <a href={`${page}?edit=1`}>Change</a> : null;
  return (
    <>
      <Segment title="Student" level={3} flush actions={change}>
        {s.kycRestricted ? (
          <p className="el-field-hint">
            {st.fullName}. Details hidden: you do not have permission to view private student
            details.
          </p>
        ) : (
          <DetailTable
            rows={[
              { label: 'Name', value: st.fullName },
              {
                label: 'Date of birth',
                value: st.dateOfBirth ? fmtDate(st.dateOfBirth) : 'Not recorded',
              },
              {
                label: 'Class / category',
                value:
                  (st.currentStage && CLASS_CATEGORY_LABELS[st.currentStage]) || 'Not recorded',
              },
              {
                label: 'School and city',
                value: [st.previousSchool, st.city].filter(Boolean).join(', ') || 'Not recorded',
              },
            ]}
          />
        )}
      </Segment>
      {s.kycRestricted ? null : (
        <Segment title="Guardian" level={3} flush>
          <DetailTable
            rows={[
              {
                label: 'Name',
                value: g ? `${g.fullName} (${humanise(g.relationship)})` : 'No guardian recorded',
              },
              {
                label: 'Contact',
                value: g ? [g.phone, g.email].filter(Boolean).join(' · ') || 'Not recorded' : '—',
              },
            ]}
          />
        </Segment>
      )}
      <PaperAnswers d={d} level={3} />
      <Segment title="Programme and batch" level={3} flush>
        <DetailTable
          rows={[
            { label: 'Programmes', value: s.programmes.map((x) => x.name).join(' + ') },
            { label: 'Academic year', value: s.academicYear ?? 'Not set' },
            { label: 'Start date', value: s.startDate ? fmtDate(s.startDate) : 'Not recorded' },
            {
              label: 'Mode',
              value: (s.deliveryMode && DELIVERY_MODE_LABELS[s.deliveryMode]) || 'Not recorded',
            },
            {
              label: 'Batch',
              value: s.intendedBatchId ? 'Chosen (Academic OS)' : 'To be assigned by Academic OS',
            },
          ]}
        />
      </Segment>
      <Segment title="Annual fee" level={3} flush>
        {fee === undefined ? (
          <p className="el-field-hint">Hidden: you do not have permission to read fees.</p>
        ) : fee === null ? (
          <p>No approved fee agreement.</p>
        ) : (
          <DetailTable
            rows={[
              { label: 'Annual tuition', value: fmtPaise(fee.totalPaise) },
              ...fee.instalments.map((i) => ({
                label: `Instalment ${i.sequence} (${Math.round((i.amountPaise * 100) / fee.totalPaise)}%)`,
                value: `${fmtPaise(i.amountPaise)} due ${fmtDate(i.dueDate)}`,
              })),
              {
                label: 'Registration fee (separate)',
                value:
                  s.registrationFeePaise === null ? 'Not set' : fmtPaise(s.registrationFeePaise),
              },
            ]}
          />
        )}
      </Segment>
      <Segment title="Signed form" level={3} flush>
        <DetailTable
          rows={[
            { label: 'Version', value: d.application.currentVersion },
            {
              label: 'Signatures',
              value: sig
                ? `Signed ${fmtDate(sig.signedOn)} by ${sig.signers.map((x) => x.name).join(', ')}; confirmed by ${sig.confirmedByName ?? '—'}`
                : 'Not confirmed',
            },
          ]}
        />
      </Segment>
    </>
  );
}

function EditModal({ d, page }: { d: ApplicationView; page: string }) {
  const s = d.snapshot.student as Partial<Record<string, string | null>>;
  const kyc = !d.snapshot.kycRestricted;
  const field = (name: string, label: string, extra: object = {}) => ({
    name: `student.${name}`,
    label,
    defaultValue: s[name] ?? undefined,
    section: 'Student KYC',
    ...extra,
  });
  return (
    <FormModal id="edit-application" title="Edit application details" closeHref={page}>
      <p className="el-field-hint">
        Saving a change to anything the form prints makes a new version: the application goes back
        to draft and any signature confirmation is invalidated. The student's phone and email and
        the guardian are edited on the lead (
        <a href={`/ops/leads/${d.admission.leadId}?act=details`}>Edit contact details</a>); the fee
        agreement on the admission.
      </p>
      <ActionForm
        action={`/ops/api/v1/applications/${d.application.id}`}
        method="PATCH"
        submitLabel="Save application"
        extra={{ version: d.application.currentVersion }}
        redirectTo={page}
        secondary={<a href={page}>Cancel</a>}
        fields={[
          {
            name: 'academicYear',
            label: 'Academic year (e.g. 2026-27)',
            defaultValue: d.application.academicYear ?? undefined,
            section: 'Programme',
          },
          {
            name: 'intendedStartDate',
            label: 'Start date',
            type: 'date',
            defaultValue: d.snapshot.startDate ?? undefined,
            section: 'Programme',
          },
          {
            name: 'deliveryMode',
            label: 'Mode',
            type: 'select',
            options: ['offline', 'online'].map((v) => ({
              value: v,
              label: DELIVERY_MODE_LABELS[v]!,
            })),
            defaultValue: d.snapshot.deliveryMode ?? undefined,
            section: 'Programme',
          },
          ...(kyc
            ? [
                field('preferredName', 'Preferred name'),
                field('dateOfBirth', 'Date of birth', { type: 'date' }),
                field('currentStage', 'Class / category', {
                  type: 'select',
                  options: CLASS_CATEGORY_OPTIONS,
                }),
                field('previousSchool', 'School'),
                field('schoolBoard', 'School board'),
                field('city', 'City'),
                field('address', 'Address', { type: 'textarea' }),
                field('emergencyContactName', 'Emergency contact name'),
                field('emergencyContactPhone', 'Emergency contact phone', { type: 'tel' }),
                ...PAPER_FIELDS.map(([name, text, section]) => ({
                  name: `form.${name}`,
                  label: text,
                  defaultValue: (d.snapshot.form?.[name] as string | null) ?? undefined,
                  section,
                })),
                {
                  name: 'resultPublicityConsent',
                  label:
                    'Result publicity consent given (Terms clause 8). Leave unticked unless the family agreed in writing.',
                  type: 'checkbox' as const,
                  defaultValue: String(Boolean(d.snapshot.form?.resultPublicityConsent?.given)),
                  section: 'Consent',
                },
              ]
            : []),
        ]}
      />
    </FormModal>
  );
}

function SignModal({ d, page }: { d: ApplicationView; page: string }) {
  const current = d.forms.find((f) => f.version === d.application.currentVersion);
  const rule = d.signerRule.value;
  return (
    <FormModal id="confirm-signatures" title="Confirm signatures" closeHref={page}>
      <p>
        Confirm that the printed form of version {d.application.currentVersion} carries the required
        physical signatures. Rule ({d.signerRule.decisionState}): student{' '}
        {rule.student ? 'signs' : 'does not sign'}; a guardian signs{' '}
        {rule.guardian === 'if_under_18'
          ? 'when the student is under 18 or the date of birth is not recorded'
          : rule.guardian}
        .
      </p>
      {current ? (
        <ActionForm
          action={`/ops/api/v1/applications/${d.application.id}/signatures`}
          submitLabel="Confirm signatures"
          extra={{ version: d.application.currentVersion, formId: current.id }}
          redirectTo={page}
          secondary={<a href={page}>Cancel</a>}
          fields={[
            {
              name: 'signedOn',
              label: 'Day written on the form',
              type: 'date',
              required: true,
              defaultValue: istToday(new Date()),
            },
            { name: 'studentSigned', label: 'The student signed', type: 'checkbox' },
            { name: 'guardianSigned', label: 'The parent / guardian signed', type: 'checkbox' },
          ]}
        />
      ) : (
        <p>Print the form of the current version first.</p>
      )}
    </FormModal>
  );
}
