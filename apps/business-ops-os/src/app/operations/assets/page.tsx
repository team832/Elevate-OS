import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { ASSET_STATUSES } from '../../../domain/hr/assets';
import { listAssets } from '../../../server/hr/assets';
import { assetListQuery } from '../../../server/hr/schemas';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { hrTone, FilterForm, options, Pager } from '../../../ui/hr-records';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | undefined>;

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await gate('ops:assets:read', '/ops/operations/assets');
  const sp = await searchParams;
  return (
    <Frame access={access} active="assets">
      <PageHeader
        title="Work assets"
        description="Laptops, phones, keys and ID cards: who holds each one, since when, and the condition it came back in."
      />
      <Section label="Loading assets…">
        <Register user={access.user} sp={sp} />
      </Section>
      {can(access.user, 'ops:assets:manage') ? (
        <Card
          title="Register an asset"
          description="Gets the next AST code. Assign it from the asset’s page."
        >
          <ActionForm
            action="/ops/api/v1/hr/assets"
            submitLabel="Register asset"
            redirectTo="/ops/operations/assets/{id}"
            fields={[
              {
                name: 'name',
                label: 'Name',
                required: true,
                hint: 'For example: Dell laptop, front-office key.',
              },
              {
                name: 'category',
                label: 'Category',
                required: true,
                hint: 'For example: Laptop, Phone, Key, ID card.',
              },
              { name: 'serialNumber', label: 'Serial number', hint: 'Must be unique when given.' },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ]}
          />
        </Card>
      ) : null}
    </Frame>
  );
}

async function Register({ user, sp }: { user: AuthenticatedUser; sp: SearchParams }) {
  const parsed = assetListQuery.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v)),
  );
  const query = parsed.success ? parsed.data : assetListQuery.parse({});
  const r = await load((db) => listAssets(db, user, query));
  if (!r.ok) return r.view;
  const list = r.data;
  const filtered = Boolean(query.q || query.status || query.category);
  return (
    <Card title={`${list.total} asset${list.total === 1 ? '' : 's'}`}>
      <div className="el-stack">
        <FilterForm
          action="/ops/operations/assets"
          submitLabel="Apply filters"
          resetHref="/ops/operations/assets"
          fields={[
            { name: 'q', label: 'Code, name or serial number', value: query.q },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: options(ASSET_STATUSES),
              value: query.status,
            },
            ...(list.categories.length
              ? [
                  {
                    name: 'category',
                    label: 'Category',
                    type: 'select' as const,
                    options: list.categories.map((c) => ({ value: c, label: c })),
                    value: query.category,
                  },
                ]
              : []),
          ]}
        />
        <DataTable
          rows={list.items}
          rowKey={(a) => a.id}
          empty={
            <EmptyState
              title={filtered ? 'No asset matches these filters' : 'No assets to show'}
              description={
                filtered
                  ? 'Change or clear the filters.'
                  : can(user, 'ops:assets:manage')
                    ? 'Register the first asset below.'
                    : 'Assets assigned to you (or your team) appear here.'
              }
            />
          }
          columns={[
            {
              key: 'code',
              header: 'Code',
              render: (a) => <a href={`/ops/operations/assets/${a.id}`}>{a.code}</a>,
            },
            { key: 'name', header: 'Name' },
            { key: 'category', header: 'Category' },
            { key: 'serialNumber', header: 'Serial', render: (a) => a.serialNumber ?? '—' },
            {
              key: 'status',
              header: 'Status',
              render: (a) => (
                <>
                  <StatusBadge tone={hrTone(a.status)}>{humanise(a.status)}</StatusBadge>
                  {a.returnOverdue ? <StatusBadge tone="danger">Return overdue</StatusBadge> : null}
                </>
              ),
            },
            {
              key: 'holder',
              header: 'Held by',
              render: (a) =>
                a.holder ? (
                  <a href={`/ops/hr/employees/${a.holder.staffId}`}>{a.holder.fullName}</a>
                ) : (
                  '—'
                ),
            },
            { key: 'assignedOn', header: 'Since', render: (a) => fmtDate(a.assignedOn) },
            {
              key: 'expectedReturnOn',
              header: 'Due back',
              render: (a) => fmtDate(a.expectedReturnOn),
            },
          ]}
        />
        <Pager
          basePath="/ops/operations/assets"
          params={sp}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
        />
      </div>
    </Card>
  );
}
