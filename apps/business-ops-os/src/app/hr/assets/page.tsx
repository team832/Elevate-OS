/**
 * Team (HR) → Staff assets (F4-09): what the institute handed to staff (ID cards, keys, devices),
 * who holds it, when it was issued and returned, its condition. A tag is out with one person at a
 * time. HR reads within its staff reach; issuing and returns need ops:staff:manage.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader } from '@elevate/shared-ui';
import { istToday } from '../../../domain/dates';
import { ASSET_VIEWS, listAssets, staffRecordOptions } from '../../../server/hr-staff-records';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import type { Params } from '../../tasks/_components/task-common';
import { HrRecordsNav } from '../checklists/nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff assets' };

const BASE = '/ops/hr/assets';
const API = '/ops/api/v1/hr';
const VIEW_LABELS: Record<(typeof ASSET_VIEWS)[number], string> = {
  out: 'Out with staff',
  returned: 'Returned',
  all: 'All',
};

export default async function StaffAssetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:hr:read', BASE);
  const sp = await searchParams;
  const filters = { view: ASSET_VIEWS.find((v) => v === sp.view), q: sp.q?.trim() || undefined };
  return (
    <Frame access={access} active="hr-assets">
      <PageHeader
        title="Staff assets"
        description="ID cards, keys, devices and anything else handed to staff, with its return. Someone leaving is told what they still hold."
        tabs={<HrRecordsNav current={BASE} />}
        actions={
          <ButtonLink href={listHref(`${API}/staff-records/assets`, filters)} download>
            Download (spreadsheet)
          </ButtonLink>
        }
      />
      <Section label="Loading assets…">
        <Assets user={access.user} sp={sp} filters={filters} />
      </Section>
    </Frame>
  );
}

async function Assets({
  user,
  sp,
  filters,
}: {
  user: AuthenticatedUser;
  sp: Params;
  filters: { view?: (typeof ASSET_VIEWS)[number]; q?: string };
}) {
  const manage = can(user, 'ops:staff:manage');
  const r = await load(async (db) => ({
    list: await listAssets(db, user, { ...filters, page: Math.max(1, Number(sp.page) || 1) }),
    people: manage ? await staffRecordOptions(db, user) : [],
  }));
  if (!r.ok) return r.view;
  const { list, people } = r.data;
  const today = istToday(new Date());
  return (
    <div className="el-stack">
      {manage ? (
        <details>
          <summary>Issue an asset</summary>
          <ActionForm
            action={`${API}/assets`}
            submitLabel="Record issue"
            resetOnSuccess
            fields={[
              {
                name: 'staffId',
                label: 'Issued to',
                type: 'select',
                required: true,
                options: people.filter((p) => !p.left),
                emptyHint: 'No staff member in your reach yet.',
              },
              {
                name: 'assetType',
                label: 'What it is',
                required: true,
                hint: 'For example ID card, office key, laptop.',
              },
              {
                name: 'tag',
                label: 'Tag or serial number (optional)',
                hint: 'One person holds a tag at a time.',
              },
              { name: 'description', label: 'Description (optional)' },
              {
                name: 'issuedOn',
                label: 'Issued on',
                type: 'date',
                required: true,
                defaultValue: today,
              },
              { name: 'conditionNote', label: 'Condition (optional)' },
            ]}
          />
        </details>
      ) : null}
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Type, tag or person', value: filters.q }}
        filters={[
          {
            name: 'view',
            label: 'Show',
            type: 'select',
            options: ASSET_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })),
            value: filters.view,
          },
        ]}
      />
      <RecordTable
        caption={`${list.total} asset${list.total === 1 ? '' : 's'}, ${VIEW_LABELS[filters.view ?? 'out'].toLowerCase()}`}
        rows={list.rows}
        rowKey={(a) => a.id}
        sampleOf={(a) => a.isSample}
        empty={
          <EmptyState
            title="No assets recorded"
            description={
              manage
                ? 'Record the first one with "Issue an asset".'
                : 'HR records assets as they are issued.'
            }
          />
        }
        columns={[
          { key: 'assetType', header: 'Asset' },
          { key: 'tag', header: 'Tag', render: (a) => a.tag ?? 'No tag' },
          { key: 'staffName', header: 'Issued to' },
          {
            key: 'issuedOn',
            header: 'Issued',
            render: (a) =>
              `${fmtDate(a.issuedOn)}${a.issuedByName ? `, by ${a.issuedByName}` : ''}`,
          },
          {
            key: 'returnedOn',
            header: 'Returned',
            render: (a) =>
              a.returnedOn
                ? `${fmtDate(a.returnedOn)}${a.returnedByName ? `, by ${a.returnedByName}` : ''}`
                : 'Not returned',
          },
          {
            key: 'conditionNote',
            header: 'Description and condition',
            render: (a) => [a.description, a.conditionNote].filter(Boolean).join('. '),
          },
          ...(manage
            ? [
                {
                  key: 'act',
                  header: '',
                  render: (a: (typeof list.rows)[number]) =>
                    a.returnedOn ? null : (
                      <details>
                        <summary>Record return</summary>
                        <ActionForm
                          action={`${API}/assets/${a.id}/return`}
                          submitLabel="Record return"
                          labelSuffix={` — ${a.assetType}${a.tag ? ` ${a.tag}` : ''}, ${a.staffName}`}
                          compact
                          fields={[
                            {
                              name: 'returnedOn',
                              label: 'Returned on',
                              type: 'date',
                              required: true,
                              defaultValue: today,
                            },
                            {
                              name: 'conditionNote',
                              label: 'Condition (optional)',
                              defaultValue: a.conditionNote ?? undefined,
                            },
                          ]}
                        />
                      </details>
                    ),
                },
              ]
            : []),
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
    </div>
  );
}
