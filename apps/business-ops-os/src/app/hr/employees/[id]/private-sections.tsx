/**
 * Sensitive sections of the employee profile: private HR details (OPS-034) and
 * employment documents (OPS-035). Rendered only when the page has established
 * that the caller may see them; every route checks again on the server.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can, requirePermission, type Permission } from '@elevate/authorization';
import { Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import {
  DOCUMENT_KINDS,
  IDENTITY_REFERENCE_KINDS,
  RETENTION_CLASSES,
} from '../../../../domain/hr/documents';
import { staffIdForUser } from '../../../../server/context';
import { listDocuments } from '../../../../server/hr/documents';
import { getPrivateRecord } from '../../../../server/hr/private';
import { ActionForm } from '../../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { hrTone, options } from '../../../../ui/hr-records';

const mayManage = async (
  user: AuthenticatedUser,
  permission: Permission,
  staffId: string,
  db: Parameters<typeof staffIdForUser>[0],
) => {
  if (!can(user, permission)) return false;
  if (requirePermission(user, permission) === 'all') return true;
  return (await staffIdForUser(db, user.id)) === staffId;
};

export async function PrivateSection({
  user,
  staffId,
}: {
  user: AuthenticatedUser;
  staffId: string;
}) {
  const r = await load(async (db) => ({
    p: await getPrivateRecord(db, user, staffId),
    manage: await mayManage(user, 'ops:employee_private:manage', staffId, db),
  }));
  if (!r.ok) return r.view;
  const { p, manage } = r.data;
  const d = p.details;
  const base = `/ops/api/v1/hr/employees/${staffId}`;
  return (
    <Card
      title="Private HR details"
      description="Visible only to HR managers and the employee. Never shown in the directory, lists or exports; the audit trail records which fields changed, not their values."
    >
      <div className="el-stack">
        <div className="el-grid">
          <div>
            <p className="el-field-hint">Legal name</p>
            <p>{p.legalName ?? 'Not recorded'}</p>
            <p className="el-field-hint">Personal email</p>
            <p>{d?.personalEmail ?? 'Not recorded'}</p>
            <p className="el-field-hint">Personal phone</p>
            <p>{d?.personalPhone ?? 'Not recorded'}</p>
          </div>
          <div>
            <p className="el-field-hint">Address</p>
            <p>
              {d && (d.addressLine1 || d.city)
                ? [d.addressLine1, d.addressLine2, d.city, d.state, d.postalCode, d.country]
                    .filter(Boolean)
                    .join(', ')
                : 'Not recorded'}
            </p>
            {d?.updatedAt ? (
              <p className="el-field-hint">Last changed {fmtDateTime(d.updatedAt)}</p>
            ) : null}
          </div>
        </div>
        {manage ? (
          <details>
            <summary>Edit private details</summary>
            <ActionForm
              action={`${base}/private`}
              method="PUT"
              submitLabel="Save private details"
              variant="secondary"
              fields={[
                {
                  name: 'legalName',
                  label: 'Legal name (as on employment documents)',
                  defaultValue: p.legalName ?? '',
                },
                {
                  name: 'personalEmail',
                  label: 'Personal email',
                  type: 'email',
                  defaultValue: d?.personalEmail ?? '',
                },
                {
                  name: 'personalPhone',
                  label: 'Personal phone',
                  type: 'tel',
                  defaultValue: d?.personalPhone ?? '',
                },
                {
                  name: 'addressLine1',
                  label: 'Address line 1',
                  defaultValue: d?.addressLine1 ?? '',
                },
                {
                  name: 'addressLine2',
                  label: 'Address line 2',
                  defaultValue: d?.addressLine2 ?? '',
                },
                { name: 'city', label: 'City', defaultValue: d?.city ?? '' },
                { name: 'state', label: 'State', defaultValue: d?.state ?? '' },
                { name: 'postalCode', label: 'PIN code', defaultValue: d?.postalCode ?? '' },
                { name: 'country', label: 'Country', defaultValue: d?.country ?? '' },
              ]}
            />
          </details>
        ) : null}

        <h3>Emergency contacts</h3>
        <DataTable
          rows={p.emergencyContacts}
          rowKey={(c) => c.id}
          empty={<EmptyState title="No emergency contact recorded" />}
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'relationship', header: 'Relationship' },
            { key: 'phone', header: 'Phone' },
            {
              key: 'isPrimary',
              header: '',
              render: (c) => (c.isPrimary ? <StatusBadge tone="info">Primary</StatusBadge> : null),
            },
            {
              key: 'act',
              header: '',
              render: (c) =>
                manage ? (
                  <ActionForm
                    action={`${base}/emergency-contacts/${c.id}`}
                    method="DELETE"
                    submitLabel="Remove contact"
                    variant="danger"
                    compact
                  />
                ) : null,
            },
          ]}
        />
        {manage ? (
          <details>
            <summary>Add an emergency contact</summary>
            <ActionForm
              action={`${base}/emergency-contacts`}
              submitLabel="Add contact"
              variant="secondary"
              fields={[
                { name: 'name', label: 'Name', required: true },
                { name: 'relationship', label: 'Relationship', required: true },
                { name: 'phone', label: 'Phone', type: 'tel', required: true },
                { name: 'isPrimary', label: 'Primary contact', type: 'checkbox' },
              ]}
            />
          </details>
        ) : null}

        <h3>Identity document references</h3>
        <p className="el-field-hint">
          Only the type and at most the last four characters are kept (OD-014). Never type a full
          identity number: it is refused.
        </p>
        <DataTable
          rows={p.identityReferences}
          rowKey={(i) => i.id}
          empty={<EmptyState title="No identity reference recorded" />}
          columns={[
            { key: 'kind', header: 'Document', render: (i) => humanise(i.kind) },
            { key: 'masked', header: 'Reference' },
            { key: 'notes', header: 'Notes', render: (i) => i.notes ?? '—' },
            {
              key: 'status',
              header: 'Status',
              render: (i) => (
                <StatusBadge tone={i.status === 'active' ? 'success' : 'neutral'}>
                  {humanise(i.status)}
                </StatusBadge>
              ),
            },
            {
              key: 'act',
              header: '',
              render: (i) =>
                manage && i.status === 'active' ? (
                  <ActionForm
                    action={`${base}/identity-references/${i.id}`}
                    method="PATCH"
                    submitLabel="Retire reference"
                    variant="secondary"
                    extra={{ status: 'retired' }}
                    compact
                  />
                ) : null,
            },
          ]}
        />
        {manage ? (
          <details>
            <summary>Record an identity reference</summary>
            <ActionForm
              action={`${base}/identity-references`}
              submitLabel="Record reference"
              variant="secondary"
              fields={[
                {
                  name: 'kind',
                  label: 'Document type',
                  type: 'select',
                  required: true,
                  options: options(IDENTITY_REFERENCE_KINDS),
                },
                {
                  name: 'last4',
                  label: 'Last four characters (optional)',
                  hint: 'At most 4 letters or digits.',
                },
                { name: 'notes', label: 'Notes', hint: 'For example: original seen and returned.' },
              ]}
            />
          </details>
        ) : null}
      </div>
    </Card>
  );
}

export async function DocumentsSection({
  user,
  staffId,
}: {
  user: AuthenticatedUser;
  staffId: string;
}) {
  const r = await load(async (db) => ({
    d: await listDocuments(db, user, staffId),
    manage: await mayManage(user, 'ops:employee_documents:manage', staffId, db),
  }));
  if (!r.ok) return r.view;
  const { d, manage } = r.data;
  const storageReady = d.storage.connection === 'connected';
  const active = d.documents.filter((x) => x.status === 'active');
  return (
    <Card
      title="Documents"
      description="Document records only: where each document is kept, its retention class and status."
    >
      <div className="el-stack">
        {!storageReady ? (
          <p className="el-field-hint">
            File storage is not configured (D-014), so files cannot be uploaded or downloaded yet.
            Record where the paper or file is kept instead.
          </p>
        ) : null}
        {d.hiddenPrivateCount > 0 ? (
          <p className="el-field-hint">
            {d.hiddenPrivateCount} identity document record(s) are hidden: they need access to
            private HR details.
          </p>
        ) : null}
        <DataTable
          rows={d.documents}
          rowKey={(x) => x.id}
          empty={<EmptyState title="No documents recorded" />}
          columns={[
            { key: 'title', header: 'Document' },
            { key: 'kind', header: 'Type', render: (x) => humanise(x.kind) },
            {
              key: 'where',
              header: 'Kept at',
              render: (x) =>
                x.storageKind === 'reference' ? (
                  (x.externalReference ?? '—')
                ) : storageReady && x.status !== 'deleted' ? (
                  <a href={`/ops/api/v1/hr/documents/${x.id}/download?redirect=1`}>
                    Download (link expires in 5 minutes)
                  </a>
                ) : (
                  'Stored file — download unavailable while storage is not configured'
                ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (x) => (
                <>
                  <StatusBadge tone={hrTone(x.status)}>{humanise(x.status)}</StatusBadge>
                  {x.expired ? <StatusBadge tone="warning">Expired</StatusBadge> : null}
                </>
              ),
            },
            {
              key: 'retentionClass',
              header: 'Retention class',
              render: (x) => humanise(x.retentionClass),
            },
            { key: 'expiresOn', header: 'Expires', render: (x) => fmtDate(x.expiresOn) },
            { key: 'uploadedAt', header: 'Recorded', render: (x) => fmtDateTime(x.uploadedAt) },
            {
              key: 'act',
              header: '',
              render: (x) => (manage ? <DocumentActions doc={x} userId={user.id} /> : null),
            },
          ]}
        />
        {manage ? (
          <details>
            <summary>Record a document</summary>
            <ActionForm
              action={`/ops/api/v1/hr/employees/${staffId}/documents`}
              submitLabel="Record document"
              variant="secondary"
              extra={{ storageKind: 'reference' }}
              fields={[
                {
                  name: 'kind',
                  label: 'Type',
                  type: 'select',
                  required: true,
                  options: options(DOCUMENT_KINDS),
                },
                { name: 'title', label: 'Title', required: true },
                {
                  name: 'externalReference',
                  label: 'Where it is kept',
                  required: true,
                  hint: 'For example: HR cabinet B, file 12.',
                },
                {
                  name: 'retentionClass',
                  label: 'Retention class',
                  type: 'select',
                  options: options(RETENTION_CLASSES),
                  hint: 'Default follows the type. Retention periods are not decided yet.',
                },
                { name: 'expiresOn', label: 'Expires on', type: 'date' },
                {
                  name: 'supersedesId',
                  label: 'Replaces document',
                  type: 'select',
                  options: active.map((a) => ({ value: a.id, label: a.title })),
                },
              ]}
            />
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function DocumentActions({
  doc,
  userId,
}: {
  doc: { id: string; status: string; deletionRequestedBy: string | null };
  userId: string;
}) {
  const action = `/ops/api/v1/hr/documents/${doc.id}/status`;
  if (doc.status === 'deletion_requested')
    return doc.deletionRequestedBy === userId ? (
      <span className="el-field-hint">Deletion requested by you; another HR manager decides.</span>
    ) : (
      <div className="el-stack">
        <ActionForm
          action={action}
          submitLabel="Approve deletion"
          variant="danger"
          extra={{ action: 'approve_deletion' }}
          fields={[
            {
              name: 'confirm',
              label: 'I confirm this document record is marked deleted',
              type: 'checkbox',
            },
          ]}
          compact
        />
        <ActionForm
          action={action}
          submitLabel="Reject deletion"
          variant="secondary"
          extra={{ action: 'reject_deletion' }}
          fields={[{ name: 'reason', label: 'Reason', required: true }]}
          compact
        />
      </div>
    );
  if (doc.status === 'retention_hold')
    return (
      <ActionForm
        action={action}
        submitLabel="Release hold"
        variant="secondary"
        extra={{ action: 'release_hold' }}
        compact
      />
    );
  if (doc.status === 'deleted') return null;
  return (
    <div className="el-stack">
      <ActionForm
        action={action}
        submitLabel="Place retention hold"
        variant="secondary"
        extra={{ action: 'hold' }}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        compact
      />
      <ActionForm
        action={action}
        submitLabel="Request deletion"
        variant="danger"
        extra={{ action: 'request_deletion' }}
        fields={[{ name: 'reason', label: 'Reason', required: true }]}
        compact
      />
    </div>
  );
}
