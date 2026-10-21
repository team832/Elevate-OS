/**
 * Admission page: the application, the final approval (number, approver, password re-check),
 * the Academic setup state, the documents, and the legacy flag with its reconciliation form.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { APPLICATION_STATUS_LABELS } from '../../../domain/applications';
import { admissionConfirmation } from '../../../server/applications-confirm';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { DetailTable, Segment } from '../../../ui/sections';

export async function AdmissionConfirmation({
  user,
  admissionId,
  status,
}: {
  user: AuthenticatedUser;
  admissionId: string;
  status: string;
}) {
  const r = await load((db) => admissionConfirmation(db, user, admissionId));
  if (!r.ok) return r.view;
  const c = r.data;
  const api = `/ops/api/v1/admissions/${admissionId}`;
  return (
    <>
      {c.legacy?.state === 'required' ? (
        <Alert tone="warning" title="Legacy — verification required">
          Admitted before final confirmation existed: no approval, signed form or payment evidence
          is on record. An approver records what was checked; nothing is invented.
          {c.canReconcile ? (
            <ActionForm
              action={`${api}/legacy-verification`}
              submitLabel="Record legacy verification"
              fields={[
                {
                  name: 'note',
                  label: 'Evidence checked (at least 10 characters)',
                  type: 'textarea',
                  required: true,
                },
              ]}
            />
          ) : null}
        </Alert>
      ) : null}
      <Segment title="Application and confirmation" flush>
        <DetailTable
          rows={[
            {
              label: 'Application',
              value: c.application ? (
                <a href={`/ops/admissions/applications/${c.application.id}`}>
                  {c.application.reference} · version {c.application.version} ·{' '}
                  {APPLICATION_STATUS_LABELS[c.application.status]}
                </a>
              ) : status === 'admission_pending' && can(user, 'ops:admissions:write') ? (
                <ActionForm
                  action="/ops/api/v1/applications"
                  submitLabel="Start application (direct admission)"
                  extra={{ admissionId }}
                  redirectTo="/ops/admissions/applications/{id}"
                  compact
                />
              ) : (
                'None'
              ),
            },
            {
              label: 'Admission number',
              value: c.approval ? (
                <strong>{c.approval.admissionNumber}</strong>
              ) : c.bundleNumber ? (
                `${c.bundleNumber} (given to the primary programme case of this bundle)`
              ) : c.legacyNumber ? (
                `${c.legacyNumber} (legacy, before final confirmation existed)`
              ) : (
                'Given only when an approver confirms the admission'
              ),
            },
            c.approval && {
              label: 'Confirmed',
              value: `${fmtDateTime(c.approval.approvedAt)} by ${c.approval.approvedByName ?? '—'} (version ${c.approval.applicationVersion}; password re-entered ${fmtDateTime(c.approval.reauthVerifiedAt)})`,
            },
            c.academicSetup && {
              label: 'Academic setup',
              value: (
                <StatusBadge tone={status === 'enrolled' ? 'success' : 'info'}>
                  {c.academicSetup}
                </StatusBadge>
              ),
            },
            c.legacy?.state === 'verified' && {
              label: 'Legacy verification',
              value: `Verified ${fmtDateTime(c.legacy.verifiedAt)} by ${c.legacy.verifiedByName ?? '—'}`,
            },
            c.approval && {
              label: 'Documents',
              value: (
                <>
                  <a href={`${api}/acknowledgement`}>Admission acknowledgement (PDF)</a> ·{' '}
                  <a href={`${api}/id-card`}>ID card (PDF)</a>
                </>
              ),
            },
          ]}
        />
      </Segment>
    </>
  );
}
