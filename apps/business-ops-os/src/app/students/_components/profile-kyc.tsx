/**
 * Profile tab "KYC and guardians" (owner brief §8, acceptance 21). Restricted to staff with
 * `ops:student_private:read` (checked again on the server): contact and consent, guardians,
 * identity documents (type, masked reference, verification — never full numbers or scans),
 * sibling links and the KYC history (audit rows, values masked). Forms open by `?action=`
 * (document / reject / sibling). Server component.
 */
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { CLASS_CATEGORY_LABELS } from '../../../domain/demos';
import { getStudentKyc } from '../../../server/kyc';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime, humanise } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { FormModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { GuardiansSegment, type Profile } from './profile-sections';

const VERIFY_TONE = { unverified: 'warning', verified: 'success', rejected: 'danger' } as const;

/** "field: old → new" for each changed fact of an audit row (values are already masked). */
function changes(before: unknown, after: unknown) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === null || v === undefined ? 'none' : String(v));
  const lines = Object.keys(a)
    .filter((k) => !/Ids?$/.test(k) && k !== 'fields' && show(a[k]) !== show(b[k]))
    .map((k) =>
      k in b ? `${humanise(k)}: ${show(b[k])} → ${show(a[k])}` : `${humanise(k)}: ${show(a[k])}`,
    );
  if ((a.demotedGuardianIds as unknown[] | undefined)?.length)
    lines.push('the previous primary guardian is no longer primary');
  return lines.join('; ');
}

export async function KycTab({
  d,
  user,
  action,
  documentId,
  base,
}: {
  d: Profile;
  user: AuthenticatedUser;
  action?: string;
  documentId?: string;
  base: string;
}) {
  const identityId = d.identity?.id;
  if (d.person.privateFields !== 'visible' || !identityId)
    return (
      <Alert tone="info" title="Restricted">
        {identityId
          ? 'KYC, guardians and identity documents need permission to see this student’s private details.'
          : 'This admission has no canonical student record yet, so no KYC can be recorded.'}
      </Alert>
    );
  const r = await load((db) => getStudentKyc(db, user, identityId));
  if (!r.ok) return r.view;
  const { documents, documentTypes, siblings, history } = r.data;
  const here = listHref(base, { tab: 'kyc' });
  const done = here.replace(/^\/ops/, '');
  const api = `/ops/api/v1/students/${identityId}`;
  const write = can(user, 'ops:guardians:write');
  const verify = can(user, 'ops:kyc:verify');
  const liveGuardians = d.guardians === 'hidden' ? [] : d.guardians.filter((g) => !g.archivedAt);
  const current = documents.filter((x) => x.current);
  const cancel = <a href={here}>Cancel</a>;
  const forms: Record<string, { title: string; form: ReactNode } | false> = {
    document: write && {
      title: 'Record an identity document',
      form: (
        <ActionForm
          action={`${api}/kyc`}
          submitLabel="Record document"
          redirectTo={done}
          secondary={cancel}
          fields={[
            {
              name: 'subjectType',
              label: 'Whose document',
              type: 'select',
              required: true,
              options: [
                { value: 'student', label: 'The student' },
                { value: 'guardian', label: 'A guardian' },
              ],
              section: 'Document',
            },
            {
              name: 'guardianId',
              label: 'Guardian (for a guardian’s document)',
              type: 'select',
              options: liveGuardians.map((g) => ({ value: g.id, label: g.fullName })),
              section: 'Document',
            },
            {
              name: 'documentType',
              label: 'Document type',
              type: 'select',
              required: true,
              options: documentTypes.types.map((t) => ({ value: t.code, label: t.label })),
              section: 'Document',
            },
            {
              name: 'maskedReference',
              label: 'Masked reference',
              required: true,
              hint: 'Last 4 digits only, the rest as X (e.g. XXXX-XXXX-1234). Full numbers are refused and never stored.',
              section: 'Document',
            },
          ]}
        />
      ),
    },
    reject: verify &&
      Boolean(documentId) && {
        title: 'Reject a document',
        form: (
          <ActionForm
            action={`${api}/kyc/${documentId}`}
            submitLabel="Reject document"
            variant="danger"
            redirectTo={done}
            extra={{ status: 'rejected' }}
            secondary={cancel}
            fields={[
              {
                name: 'note',
                label: 'Why',
                type: 'textarea',
                required: true,
                section: 'Rejection',
              },
            ]}
          />
        ),
      },
    sibling: write && {
      title: 'Link a sibling',
      form: (
        <ActionForm
          action={`${api}/siblings`}
          submitLabel="Link sibling"
          redirectTo={done}
          secondary={cancel}
          fields={[
            {
              name: 'siblingStudentId',
              label: 'Sibling’s student record ID',
              required: true,
              hint: 'Open the sibling’s profile and copy the ID from the address bar. Linking never merges the two records.',
              section: 'Sibling',
            },
            { name: 'note', label: 'Note', type: 'textarea', section: 'Sibling' },
          ]}
        />
      ),
    },
  };
  const form = action ? forms[action] : undefined;
  return (
    <>
      <ContactSegment d={d} user={user} />
      <GuardiansSegment d={d} base={base} />
      <Segment
        title="Identity documents"
        flush
        description={`Masked reference and verification only; no document is mandatory. Types: ${documentTypes.decisionState} setting.`}
        actions={
          write ? (
            <a href={listHref(base, { tab: 'kyc', action: 'document' })}>Record a document</a>
          ) : null
        }
      >
        <RecordTable
          caption="Current documents"
          rows={current}
          rowKey={(x) => x.id}
          empty="No identity document recorded."
          columns={[
            { key: 'who', header: 'Whose', render: (x) => x.guardianName ?? 'Student' },
            { key: 'type', header: 'Type', render: (x) => x.typeLabel },
            { key: 'ref', header: 'Masked reference', render: (x) => x.maskedReference },
            {
              key: 'state',
              header: 'Verification',
              render: (x) => (
                <>
                  <StatusBadge tone={VERIFY_TONE[x.verificationStatus]}>
                    {humanise(x.verificationStatus)}
                  </StatusBadge>
                  {x.verifiedAt
                    ? ` by ${x.verifiedByName ?? 'unknown'}, ${fmtDateTime(x.verifiedAt)}`
                    : ''}
                  {x.verificationNote ? `: ${x.verificationNote}` : ''}
                </>
              ),
            },
            ...(verify
              ? [
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (x: (typeof current)[number]) =>
                      x.verificationStatus === 'unverified' ? (
                        <>
                          <ActionForm
                            action={`${api}/kyc/${x.id}`}
                            submitLabel="Verify"
                            labelSuffix={` ${x.guardianName ?? 'student'} ${x.typeLabel}`}
                            compact
                            variant="secondary"
                            extra={{ status: 'verified' }}
                          />
                          <a href={listHref(base, { tab: 'kyc', action: 'reject', doc: x.id })}>
                            Reject
                          </a>
                        </>
                      ) : (
                        'Decided'
                      ),
                  },
                ]
              : []),
          ]}
        />
        {documents.length > current.length ? (
          <RecordTable
            caption="Replaced documents (kept for the history)"
            rows={documents.filter((x) => !x.current)}
            rowKey={(x) => x.id}
            columns={[
              { key: 'who', header: 'Whose', render: (x) => x.guardianName ?? 'Student' },
              { key: 'type', header: 'Type', render: (x) => x.typeLabel },
              { key: 'ref', header: 'Masked reference', render: (x) => x.maskedReference },
              { key: 'state', header: 'Was', render: (x) => humanise(x.verificationStatus) },
              { key: 'when', header: 'Replaced', render: (x) => fmtDateTime(x.supersededAt) },
            ]}
          />
        ) : null}
      </Segment>
      <Segment
        title="Siblings"
        flush
        description="Linked by staff only; a shared parent phone never links or merges students."
        actions={
          write ? (
            <a href={listHref(base, { tab: 'kyc', action: 'sibling' })}>Link a sibling</a>
          ) : null
        }
      >
        <RecordTable
          rows={siblings}
          rowKey={(x) => x.id}
          empty="No sibling linked."
          columns={[
            {
              key: 'name',
              header: 'Sibling',
              render: (x) => <a href={`/ops/students/${x.studentId}`}>{x.fullName}</a>,
            },
            { key: 'note', header: 'Note', render: (x) => x.note ?? '—' },
            { key: 'when', header: 'Linked', render: (x) => fmtDateTime(x.createdAt) },
          ]}
        />
      </Segment>
      <Segment
        title="KYC history"
        flush
        description="Guardian, document and sibling changes from the audit trail, newest first. Contacts are masked."
      >
        <RecordTable
          rows={history}
          rowKey={(x) => x.id}
          empty="No KYC changes recorded."
          columns={[
            { key: 'at', header: 'When', render: (x) => fmtDateTime(x.at) },
            {
              key: 'what',
              header: 'What',
              render: (x) => humanise(x.action.replace(/[._]/g, ' ')),
            },
            { key: 'change', header: 'Change', render: (x) => changes(x.before, x.after) || '—' },
            { key: 'by', header: 'By', render: (x) => x.actorName },
          ]}
        />
      </Segment>
      {form ? (
        <FormModal id="kyc-form" title={form.title} meta={d.person.fullName} closeHref={here}>
          {form.form}
        </FormModal>
      ) : null}
    </>
  );
}

/** Contact and consent from the enquiry (private). */
function ContactSegment({ d, user }: { d: Profile; user: AuthenticatedUser }) {
  const p = d.person;
  return (
    <Segment
      title="Contact and consent"
      flush
      description="From the enquiry. Private: students may be minors."
      actions={
        can(user, 'ops:admissions:write') ? (
          <a href={`/ops/admissions/${d.admission.id}`}>Record consent on the admission</a>
        ) : null
      }
    >
      <DetailTable
        rows={[
          { label: 'Student phone', value: p.studentPhone ?? 'Not recorded' },
          { label: 'Student email', value: p.studentEmail ?? 'Not recorded' },
          { label: 'School', value: p.previousSchool ?? 'Not recorded' },
          {
            label: 'Class / category',
            value: (p.currentStage && CLASS_CATEGORY_LABELS[p.currentStage]) || 'Not recorded',
          },
          { label: 'City', value: p.city ?? 'Not recorded' },
          {
            label: 'Guardian on the enquiry',
            value: p.guardianName
              ? `${p.guardianName} (${humanise(p.guardianRelationship)})`
              : 'Not recorded',
          },
          { label: 'Guardian phone', value: p.guardianPhone ?? 'Not recorded' },
          { label: 'Guardian email', value: p.guardianEmail ?? 'Not recorded' },
          {
            label: 'Consent',
            value: p.consent
              ? `${humanise(p.consent.status)} by ${p.consent.by}; channels: ${p.consent.allowedChannels.join(', ') || 'none'} (${fmtDateTime(p.consent.recordedAt)})`
              : 'Not recorded',
          },
        ]}
      />
    </Segment>
  );
}
