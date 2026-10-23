/** Development actions agreed with teachers, across all summaries. */
import { can } from '@elevate/authorization';
import { StatusBadge, Subnav } from '@elevate/shared-ui';
import { listActions } from '../../../../server/feedback-summaries';
import { ActionForm } from '../../../../ui/action-form';
import { ACTION_STATUS } from '../../../../ui/feedback-development';
import { fmtDate } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { listHref, Pager } from '../../../../ui/list-controls';
import { FormModal } from '../../../../ui/record-modal';
import { RecordTable } from '../../../../ui/record-table';
import { API, BASE, type TabProps } from './shared';

const VIEWS = [
  ['All', {}],
  ['Open', { status: 'open' }],
  ['Past due', { due: 'past' }],
  ['Done', { status: 'done' }],
] as const;

export async function ActionsTab({ user, params }: TabProps) {
  const result = await load((db) =>
    listActions(db, user, {
      status: params.status,
      due: params.due,
      page: Math.max(1, Number(params.page) || 1),
    }),
  );
  if (!result.ok) return result.view;
  const list = result.data;
  const open = list.rows.find((r) => r.id === params.open);
  const close = listHref(BASE, params, { open: undefined });
  return (
    <>
      <Subnav
        label="Actions by state"
        items={VIEWS.map(([text, q]) => [listHref(BASE, { tab: 'actions', ...q }), text] as const)}
        current={listHref(BASE, { tab: 'actions', status: params.status, due: params.due })}
      />
      <RecordTable
        rows={list.rows}
        rowKey={(r) => r.id}
        caption={`${list.total} development ${list.total === 1 ? 'action' : 'actions'}`}
        rowHref={(r) => listHref(BASE, params, { open: r.id })}
        linkColumn="action"
        empty="No development actions here. Add them from a summary."
        columns={[
          { key: 'teacher', header: 'Teacher', render: (r) => r.teacherName },
          { key: 'action', header: 'Action' },
          { key: 'due', header: 'Due', render: (r) => (r.dueOn ? fmtDate(r.dueOn) : 'No date') },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <StatusBadge tone={r.status === 'done' ? 'success' : 'neutral'}>
                {ACTION_STATUS[r.status]}
              </StatusBadge>
            ),
          },
          { key: 'agreed', header: 'Agreed', render: (r) => (r.agreedAt ? 'Yes' : 'Not yet') },
          {
            key: 'shared',
            header: 'Teacher sees it',
            render: (r) =>
              r.summaryId === null || r.summaryStatus === 'approved'
                ? 'Yes'
                : 'After the summary is approved',
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={params}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {open && can(user, 'ops:teacher_feedback:manage') ? (
        <FormModal
          id="action-modal"
          title={`Action for ${open.teacherName}`}
          closeHref={close}
          returnId={open.id}
        >
          <p>{open.action}</p>
          <ActionForm
            action={`${API}/actions/${open.id}`}
            method="PATCH"
            submitLabel="Save"
            secondary={<a href={close}>Cancel</a>}
            fields={[
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                required: true,
                defaultValue: open.status,
                options: Object.entries(ACTION_STATUS).map(([value, label]) => ({ value, label })),
              },
              {
                name: 'agreed',
                label: 'Agreed with the teacher',
                type: 'checkbox',
                defaultValue: open.agreedAt ? 'true' : undefined,
              },
            ]}
          />
        </FormModal>
      ) : null}
    </>
  );
}
