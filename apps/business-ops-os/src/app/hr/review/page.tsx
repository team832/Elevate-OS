/**
 * HR → Submission review (owner brief 23 Oct 2026 §10, §18): submitted work waiting for a
 * decision, oldest submission first, with Approve / Request changes on each row. The full
 * submission history is on the task. Nobody can approve their own work (the server refuses).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { istWhen } from '../../../domain/staff-tasks';
import { listTasks } from '../../../server/staff-tasks';
import { taskListQuery } from '../../../server/staff-tasks-schemas';
import { ActionForm } from '../../../ui/action-form';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref, Pager } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { Deadline, type Params } from '../../tasks/_components/task-common';
import { TaskModal } from '../../tasks/_components/task-modal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submission review' };

const BASE = '/ops/hr/review';
const API = '/ops/api/v1/staff-tasks';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:review', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-review">
      <PageHeader
        title="Submission review"
        description="Submitted work you may decide on, oldest first. Submitting is not approval; nobody reviews their own work."
      />
      <Section label="Loading submissions…">
        <Queue user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Queue({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load((db) =>
    listTasks(
      db,
      user,
      taskListQuery.parse({
        status: 'in_review',
        reviewable: '1',
        sort: 'submitted',
        groups: 'exclude',
        page: Math.max(1, Number(sp.page) || 1),
      }),
    ),
  );
  if (!r.ok) return r.view;
  const list = r.data;
  return (
    <div className="el-stack">
      <RecordTable
        caption={`${list.total} submission${list.total === 1 ? '' : 's'} waiting`}
        rows={list.rows}
        rowKey={(t) => t.id}
        rowHref={(t) => listHref(BASE, sp, { open: t.id })}
        empty={
          <EmptyState
            title="Nothing waiting for review"
            description="Submitted tasks appear here the moment the assignee submits them."
          />
        }
        columns={[
          { key: 'title', header: 'Task' },
          { key: 'staffName', header: 'Assignee' },
          {
            key: 'submittedBy',
            header: 'Submitted by',
            render: (t) => t.submittedBy ?? 'Not recorded',
          },
          {
            key: 'submitted',
            header: 'Submitted (IST)',
            render: (t) => (t.lastSubmittedAt ? istWhen(t.lastSubmittedAt) : 'Not recorded'),
          },
          { key: 'due', header: 'Deadline (IST)', render: (t) => <Deadline t={t} /> },
          {
            key: 'decide',
            header: 'Decision',
            render: (t) => (
              <div className="el-card-actions">
                <ActionForm
                  compact
                  action={`${API}/${t.id}/approve`}
                  submitLabel="Approve"
                  labelSuffix={` — ${t.title}`}
                  extra={{ expectedVersion: t.version }}
                  successText="Approved."
                />
                <details className="el-explain">
                  <summary>Request changes…</summary>
                  <ActionForm
                    compact
                    variant="secondary"
                    action={`${API}/${t.id}/request-changes`}
                    submitLabel="Request changes"
                    labelSuffix={` — ${t.title}`}
                    extra={{ expectedVersion: t.version }}
                    fields={[{ name: 'reason', label: 'What needs to change', required: true }]}
                    successText="Changes requested."
                  />
                </details>
              </div>
            ),
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {sp.open ? <TaskModal user={user} id={sp.open} sp={sp} base="/ops" listPath={BASE} /> : null}
    </div>
  );
}
