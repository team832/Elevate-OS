/**
 * HR → Staff requests (owner brief 23 Oct 2026 §6): every request staff sent through HR, in
 * HR's department scope (never HR's own, never drafts). Tabs New / In review / Forwarded /
 * Closed with counts from the list's own query; filters for urgency, category and words in the
 * subject or sender's name. A request for a recipient who is not set up (e.g. Schar) says so and
 * stays here. `?open=<id>` opens one with its full routing log and HR's next steps.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader, Tabs } from '@elevate/shared-ui';
import { HR_QUEUE_TABS, HR_REQUEST_URGENCIES, type HrQueueTab } from '../../../domain/hr-requests';
import { istWhen } from '../../../domain/staff-tasks';
import { hrQueue } from '../../../server/hr-requests-read';
import { loadSettings } from '../../../server/settings';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import {
  RequestStatus,
  Unresolved,
  Urgency,
  URGENCY_OPTIONS,
} from '../../hr-requests/_components/parts';
import type { Params } from '../../tasks/_components/task-common';
import { HrRequestModal } from './request-modal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff requests' };

const BASE = '/ops/hr/requests';
const EMPTY: Record<HrQueueTab, [title: string, description: string]> = {
  new: ['No new requests', 'Requests staff send through HR arrive here.'],
  review: [
    'No requests waiting after review',
    'Reviewed requests wait here until HR forwards or closes them.',
  ],
  forwarded: [
    'No forwarded requests',
    'Requests HR has sent on to a recipient show here until they reply.',
  ],
  closed: ['No closed requests', 'Resolved and declined requests are kept here.'],
};

export default async function HrRequestsQueuePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('ops:hr_requests:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-requests-queue">
      <PageHeader
        title="Staff requests"
        description="Requests staff sent through HR. Review each one, then forward it, answer it or decline it. Nothing is sent outside Elevate OS."
      />
      <Section label="Loading requests…">
        <Queue user={access.user} sp={sp} />
      </Section>
      {sp.open ? <HrRequestModal user={access.user} sp={sp} id={sp.open} base={BASE} /> : null}
    </Frame>
  );
}

const pick = <T extends string>(list: readonly T[], v?: string) => list.find((x) => x === v);

async function Queue({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const filters = {
    urgency: pick(HR_REQUEST_URGENCIES, sp.urgency),
    category: sp.category || undefined,
    q: sp.q?.trim() || undefined,
  };
  const r = await load(async (db) => ({
    queue: await hrQueue(db, user, {
      view: 'queue',
      ...filters,
      tab: pick(
        HR_QUEUE_TABS.map((t) => t.key),
        sp.tab,
      ),
      page: Math.max(1, Number(sp.page) || 1),
    }),
    categories: (await loadSettings(db))['hr.request_categories'].value.categories,
  }));
  if (!r.ok) return r.view;
  const { queue, categories } = r.data;
  const tabParams = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Params;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={sp.tab ? { tab: sp.tab } : {}}
        search={{ name: 'q', label: 'Subject or sender', value: filters.q }}
        filters={[
          {
            name: 'urgency',
            label: 'Urgency',
            type: 'select',
            options: URGENCY_OPTIONS,
            value: filters.urgency,
          },
          {
            name: 'category',
            label: 'Category',
            type: 'select',
            options: categories.map((c) => ({ value: c.code, label: c.label })),
            value: filters.category,
          },
        ]}
      />
      <Tabs
        idBase="hr-requests-queue"
        label="Request status"
        selected={queue.tab}
        items={HR_QUEUE_TABS.map((t) => ({
          key: t.key,
          label: t.label,
          href: listHref(BASE, tabParams, { tab: t.key }),
          count: queue.counts[t.key],
        }))}
      >
        <RecordTable
          caption={`${queue.total} request${queue.total === 1 ? '' : 's'}`}
          rows={queue.rows}
          rowKey={(x) => x.id}
          rowHref={(x) => listHref(BASE, sp, { open: x.id })}
          linkColumn="subject"
          empty={<EmptyState title={EMPTY[queue.tab][0]} description={EMPTY[queue.tab][1]} />}
          columns={[
            { key: 'subject', header: 'Subject' },
            { key: 'senderName', header: 'From' },
            {
              key: 'for',
              header: 'For',
              render: (x) => (
                <>
                  {x.recipient.label} <Unresolved note={x.recipient.unresolved} />
                </>
              ),
            },
            { key: 'categoryLabel', header: 'Category' },
            { key: 'urgency', header: 'Urgency', render: (x) => <Urgency urgency={x.urgency} /> },
            {
              key: 'sent',
              header: 'Sent (IST)',
              render: (x) => (x.submittedAt ? istWhen(x.submittedAt) : 'Not recorded'),
            },
            { key: 'status', header: 'Status', render: (x) => <RequestStatus status={x.status} /> },
          ]}
        />
        <Pager
          basePath={BASE}
          params={sp}
          page={queue.page}
          pageSize={queue.pageSize}
          total={queue.total}
        />
      </Tabs>
    </div>
  );
}
