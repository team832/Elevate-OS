/** The certificate register's rows (F4-02): the register page and a student record's Documents tab. */
import { StatusBadge } from '@elevate/shared-ui';
import type { CertificateListItem } from '../../server/certificates';
import { ActionForm } from '../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../ui/format';
import { RecordTable } from '../../ui/record-table';

export function CertificateTable({
  rows,
  revoke,
  caption,
  empty,
  studentLinks = false,
}: {
  rows: readonly CertificateListItem[];
  /** `ops:certificates:issue`: a Revoke form on issued rows. */
  revoke: boolean;
  caption?: string;
  empty: string;
  /** Link each row to the student record (the register). */
  studentLinks?: boolean;
}) {
  return (
    <RecordTable
      caption={caption}
      rows={rows}
      rowKey={(r) => r.c.id}
      rowHref={studentLinks ? (r) => `/ops/students/${r.admissionId}?tab=reports` : undefined}
      linkColumn="student"
      sampleOf={(r) => r.isSample}
      empty={empty}
      columns={[
        ...(studentLinks
          ? [{ key: 'student', header: 'Student', render: (r: CertificateListItem) => r.student }]
          : []),
        { key: 'number', header: 'Certificate no.', render: (r) => r.c.certificateNumber },
        { key: 'type', header: 'Type', render: (r) => r.typeLabel },
        { key: 'programme', header: 'Programme', render: (r) => r.programme ?? 'Not recorded' },
        {
          key: 'issued',
          header: 'Issued',
          render: (r) => `${fmtDate(r.c.issueDate)} by ${r.issuedByName ?? '—'}`,
        },
        {
          key: 'status',
          header: 'Status',
          render: (r) =>
            r.c.revokedAt ? (
              <>
                <StatusBadge tone="danger">Revoked</StatusBadge>
                <br />
                <span className="el-field-hint">
                  {fmtDateTime(r.c.revokedAt)}: {r.c.revokeReason}
                </span>
              </>
            ) : (
              <StatusBadge tone="success">Issued</StatusBadge>
            ),
        },
        {
          key: 'pdf',
          header: 'PDF',
          render: (r) => (
            <a href={`/ops/api/v1/certificates/${r.c.id}`}>
              {r.c.printCount ? 'Print again (Duplicate)' : 'Download'}
              <span className="el-visually-hidden"> {r.c.certificateNumber}</span>
            </a>
          ),
        },
        ...(revoke
          ? [
              {
                key: 'revoke',
                header: 'Revoke',
                render: (r: CertificateListItem) =>
                  r.c.revokedAt ? null : (
                    <ActionForm
                      action={`/ops/api/v1/certificates/${r.c.id}`}
                      submitLabel="Revoke"
                      labelSuffix={` ${r.c.certificateNumber}`}
                      fields={[{ name: 'reason', label: 'Why revoke it', required: true }]}
                      successText="Revoked."
                      compact
                      variant="danger"
                    />
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}
