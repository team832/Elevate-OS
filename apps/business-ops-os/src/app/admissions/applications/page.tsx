/**
 * Admission applications (brief §4, §6): search, status (awaiting information, signatures or
 * approval), sort, 25 per page; `?open=<id>` opens the application in the centred pop-up.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from '../../../domain/applications';
import { listApplications } from '../../../server/applications-read';
import { applicationListQuery } from '../../../server/applications-schemas';
import { formOptions } from '../../../server/options';
import { AdmissionsNav } from '../../../ui/admissions-nav';
import { StatCard } from '../../../ui/charts';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { programmeName } from '../_components/demo-bits';
import {
  APP_TONE,
  ApplicationDetail,
  ApplicationMeta,
  loadApplication,
} from './_components/application-detail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Applications' };

const BASE = '/ops/admissions/applications';
type Params = Record<string, string | undefined>;
const WAITING: { status: ApplicationStatus; label: string }[] = [
  { status: 'draft', label: 'Awaiting information' },
  { status: 'form_generated', label: 'Awaiting signatures' },
  { status: 'signatures_confirmed', label: 'Awaiting approval' },
];

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:admissions:read', BASE);
  const { open, ...params } = await searchParams;
  return (
    <Frame access={access} active="applications">
      <PageHeader
        title="Admission applications"
        description="An application never admits anyone: only an approver's password-confirmed approval does."
        tabs={<AdmissionsNav current="applications" user={access.user} />}
      />
      <Section label="Loading applications…">
        <List user={access.user} params={params} />
      </Section>
      {open ? (
        <Section label="Loading application…">
          <Quick user={access.user} id={open} closeHref={listHref(BASE, params)} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function List({ user, params }: { user: AuthenticatedUser; params: Params }) {
  const query = applicationListQuery.safeParse(params);
  const r = await load((db) =>
    Promise.all([
      listApplications(db, user, query.success ? query.data : applicationListQuery.parse({})),
      formOptions(db),
    ]),
  );
  if (!r.ok) return r.view;
  const [{ items, total, page, pageSize, statusCounts }, { programmes }] = r.data;
  const filtered = Boolean(params.q || params.status || params.programme);
  return (
    <div className="el-stack">
      <ul className="el-grid ops-kpis" aria-label="Applications waiting">
        {WAITING.map((w) => (
          <li key={w.status}>
            <StatCard
              label={w.label}
              value={statusCounts[w.status] ?? 0}
              href={listHref(BASE, params, {
                status: params.status === w.status ? undefined : w.status,
                page: undefined,
              })}
              current={params.status === w.status}
            />
          </li>
        ))}
      </ul>
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Name or application reference', value: params.q }}
        filters={[
          {
            name: 'programme',
            label: 'Programme',
            type: 'select',
            options: programmes,
            value: params.programme,
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: APPLICATION_STATUSES.map((s) => ({
              value: s,
              label: APPLICATION_STATUS_LABELS[s],
            })),
            value: params.status,
          },
          {
            name: 'sort',
            label: 'Sort',
            type: 'select',
            anyLabel: 'Recently changed',
            options: [
              { value: 'oldest', label: 'Oldest first' },
              { value: 'name', label: 'Name A–Z' },
            ],
            value: params.sort,
          },
        ]}
      />
      <RecordTable
        caption={`${total} application${total === 1 ? '' : 's'}`}
        rows={items}
        rowKey={(a) => a.id}
        rowHref={(a) => listHref(BASE, params, { open: a.id })}
        linkColumn="student"
        columns={[
          {
            key: 'student',
            header: 'Student',
            render: (a) => (
              <>
                {a.studentName}
                {a.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
              </>
            ),
          },
          { key: 'ref', header: 'Reference', render: (a) => `${a.reference} · v${a.version}` },
          {
            key: 'programme',
            header: 'Programme',
            render: (a) =>
              a.programmeCode ? programmeName(a.programmeCode, programmes) : 'Not chosen',
          },
          {
            key: 'status',
            header: 'Status',
            render: (a) => <StatusBadge tone={APP_TONE[a.status]}>{a.statusLabel}</StatusBadge>,
          },
          {
            key: 'number',
            header: 'Admission no.',
            render: (a) => a.admissionNumber ?? 'Not assigned',
          },
          {
            key: 'origin',
            header: 'Route',
            render: (a) =>
              a.origin === 'demo'
                ? 'From a demo'
                : a.origin === 'direct'
                  ? 'Direct'
                  : 'Readmission',
          },
          { key: 'updated', header: 'Last change', render: (a) => fmtDateTime(a.updatedAt) },
        ]}
        empty={
          <EmptyState
            title={filtered ? 'No applications match' : 'No applications yet'}
            description={
              filtered
                ? 'Change or clear the search and filters.'
                : 'An application starts from "Convert to admission" on a demo student, or from "Start application" on an admission case without a demo.'
            }
            action={
              filtered ? (
                <a href={BASE}>Clear filters</a>
              ) : (
                <a href="/ops/admissions">Open demo students</a>
              )
            }
          />
        }
      />
      <Pager basePath={BASE} params={params} page={page} pageSize={pageSize} total={total} />
    </div>
  );
}

async function Quick({
  user,
  id,
  closeHref,
}: {
  user: AuthenticatedUser;
  id: string;
  closeHref: string;
}) {
  const r = await loadApplication(user, id);
  if (!r.ok) return r.view;
  const d = r.data;
  const page = `${BASE}/${id}`;
  return (
    <RecordModal
      id="application-modal"
      title={d.snapshot.student.fullName}
      meta={<ApplicationMeta d={d} />}
      fullHref={page}
      closeHref={closeHref}
      returnId={id}
    >
      <ApplicationDetail d={d} level={3} page={page} />
    </RecordModal>
  );
}
