/** A student record's certificates (F4-02, Documents tab): the register rows, issue and revoke. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { listCertificates } from '../../../server/certificates';
import { ActionForm } from '../../../ui/action-form';
import { load } from '../../../ui/frame';
import { Segment } from '../../../ui/sections';
import { CertificateTable } from '../../certificates/certificate-table';
import type { Profile } from './profile-sections';

export async function StudentCertificates({ d, user }: { d: Profile; user: AuthenticatedUser }) {
  const studentId = d.identity?.id;
  if (!studentId) return null;
  const r = await load((db) => listCertificates(db, user, { studentId }, 100));
  if (!r.ok) return <Segment title="Certificates">{r.view}</Segment>;
  const issue = can(user, 'ops:certificates:issue');
  return (
    <Segment
      title="Certificates"
      flush
      description="Numbered per type and financial year. Printing again gives the same number marked Duplicate."
    >
      <CertificateTable
        rows={r.data.rows}
        revoke={issue}
        empty="No certificate has been issued for this student."
      />
      {!issue ? null : r.data.wordingApproved ? (
        <ActionForm
          action="/ops/api/v1/certificates"
          submitLabel="Issue certificate"
          successText="Certificate issued."
          fields={[
            {
              name: 'type',
              label: 'Certificate',
              type: 'select',
              required: true,
              options: r.data.types,
            },
            {
              name: 'admissionId',
              label: 'Programme',
              type: 'select',
              required: true,
              options: d.cases.map((c) => ({ value: c.id, label: c.programme?.name ?? c.code })),
            },
          ]}
        />
      ) : (
        <p className="el-field-hint">
          Certificates can be issued once the owner approves their wording in Settings (Certificate
          types and wording).
        </p>
      )}
    </Segment>
  );
}
