import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { OPS_CERTIFICATE_STATUSES } from '@elevate/database';
import { ButtonLink, PageHeader } from '@elevate/shared-ui';
import {
  certificateListQuery,
  listCertificates,
  type CertificateListQuery,
} from '../../server/certificates';
import { humanise } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { FilterForm, listHref, Pager } from '../../ui/list-controls';
import { CertificateTable } from './certificate-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Certificates' };

const BASE = '/ops/certificates';
const filters = ({ type, status }: CertificateListQuery) => ({ type, status });

/** /ops/certificates — the certificate register (F4-02, ops:students:read, own scope). */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:students:read', BASE);
  const q = certificateListQuery.parse(await searchParams);
  return (
    <Frame access={access} active="certificates">
      <PageHeader
        title="Certificates"
        description="Every certificate issued, newest first. Certificates are issued from a student record (Documents tab); a revoked one stays here with the reason."
        actions={
          <ButtonLink href={listHref('/ops/api/v1/certificates', filters(q))}>
            Download spreadsheet (CSV)
          </ButtonLink>
        }
      />
      <Section label="Loading certificates…">
        <Register user={access.user} q={q} />
      </Section>
    </Frame>
  );
}

async function Register({ user, q }: { user: AuthenticatedUser; q: CertificateListQuery }) {
  const r = await load((db) => listCertificates(db, user, q));
  if (!r.ok) return r.view;
  const d = r.data;
  return (
    <div className="el-stack">
      <FilterForm
        action={BASE}
        submitLabel="Show these certificates"
        resetHref={BASE}
        fields={[
          { name: 'type', label: 'Type', type: 'select', options: d.types, value: q.type },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: OPS_CERTIFICATE_STATUSES.map((s) => ({ value: s, label: humanise(s) })),
            value: q.status,
          },
        ]}
      />
      <CertificateTable
        caption={`${d.total} certificate(s)`}
        rows={d.rows}
        revoke={can(user, 'ops:certificates:issue')}
        studentLinks
        empty={
          q.type || q.status
            ? 'No certificate matches these filters.'
            : 'No certificate has been issued yet. Issue one from a student record, Documents tab.'
        }
      />
      <Pager
        basePath={BASE}
        params={filters(q)}
        page={d.page}
        pageSize={d.pageSize}
        total={d.total}
      />
    </div>
  );
}
