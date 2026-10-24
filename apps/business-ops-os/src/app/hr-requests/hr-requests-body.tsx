/**
 * `<base>/hr-requests` (owner brief 23 Oct 2026 §6), shown in Ops, Academic and Marketing: the
 * requests you sent through HR, a form for a new one (draft or send), and what HR forwarded to
 * you with a reply box. A reply goes to HR, never to the sender. `?new=1` opens the form,
 * `?open=<id>` one request, `?tab=forwarded` the forwarded list.
 */
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader, Tabs } from '@elevate/shared-ui';
import { istWhen } from '../../domain/staff-tasks';
import { listAttachments, type AttachmentListRow } from '../../server/attachments';
import { staffIdForUser } from '../../server/context';
import {
  getHrRequest,
  listForwardedToMe,
  listMyRequests,
  requestFormOptions,
  type HrRequestView,
} from '../../server/hr-requests-read';
import { listTasks } from '../../server/staff-tasks';
import { taskListQuery } from '../../server/staff-tasks-schemas';
import { ActionForm, type FieldSpec } from '../../ui/action-form';
import { AttachmentList, AttachmentUpload } from '../../ui/attachments';
import { load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import type { BodyProps } from '../tasks/_components/bodies';
import '../ops.css';
import {
  RequestFacts,
  RequestStatus,
  RequestTimeline,
  Urgency,
  URGENCY_OPTIONS,
} from './_components/parts';

export function HrRequestsBody(props: BodyProps) {
  const page = `${props.base}/hr-requests`;
  return (
    <>
      <PageHeader
        title="Requests through HR"
        description="Ask HR, or a colleague through HR. HR reads every request first and passes it on; nothing is sent outside Elevate OS."
        actions={
          <ButtonLink
            variant="primary"
            href={listHref(page, props.searchParams, { new: '1', open: undefined })}
          >
            New request
          </ButtonLink>
        }
      />
      <Section label="Loading your requests…">
        <Lists {...props} />
      </Section>
      {props.searchParams.new ? <NewRequest {...props} /> : null}
      {props.searchParams.open ? <OpenRequest {...props} id={props.searchParams.open} /> : null}
    </>
  );
}

async function Lists({ user, base, searchParams: sp }: BodyProps) {
  const page = `${base}/hr-requests`;
  const tab = sp.tab === 'forwarded' ? 'forwarded' : 'mine';
  const r = await load(async (db) => ({
    mine: await listMyRequests(db, user, Math.max(1, Number(sp.page) || 1)),
    forwarded: await listForwardedToMe(db, user),
  }));
  if (!r.ok) return r.view;
  const { mine, forwarded } = r.data;
  const open = (id: string) => listHref(page, sp, { open: id, new: undefined });
  return (
    <Tabs
      idBase="hr-requests"
      label="Requests"
      selected={tab}
      items={[
        { key: 'mine', label: 'My requests', href: page, count: mine.total },
        {
          key: 'forwarded',
          label: 'Forwarded to me',
          href: `${page}?tab=forwarded`,
          count: forwarded.length,
        },
      ]}
    >
      {tab === 'mine' ? (
        <div className="el-stack">
          <RecordTable
            caption="Requests you sent"
            rows={mine.rows}
            rowKey={(x) => x.id}
            rowHref={(x) => open(x.id)}
            linkColumn="subject"
            empty={
              <EmptyState
                title="You have not sent any requests"
                description="Use New request to ask HR, or a colleague through HR, for something."
              />
            }
            columns={[
              { key: 'subject', header: 'Subject' },
              { key: 'for', header: 'For', render: (x) => x.recipient.label },
              { key: 'categoryLabel', header: 'Category' },
              { key: 'urgency', header: 'Urgency', render: (x) => <Urgency urgency={x.urgency} /> },
              {
                key: 'status',
                header: 'Status',
                render: (x) => <RequestStatus status={x.status} />,
              },
              {
                key: 'sent',
                header: 'Sent (IST)',
                render: (x) => (x.submittedAt ? istWhen(x.submittedAt) : 'Draft'),
              },
            ]}
          />
          <Pager
            basePath={page}
            params={sp}
            page={mine.page}
            pageSize={mine.pageSize}
            total={mine.total}
          />
        </div>
      ) : (
        <RecordTable
          caption="What HR forwarded to you"
          rows={forwarded}
          rowKey={(x) => x.requestId}
          rowHref={(x) => open(x.requestId)}
          linkColumn="summary"
          empty={
            <EmptyState
              title="Nothing has been forwarded to you"
              description="When HR passes a colleague's request to you, it appears here with a reply box."
            />
          }
          columns={[
            {
              key: 'summary',
              header: 'From HR',
              render: (x) => ((x.body ?? '').length > 80 ? `${x.body!.slice(0, 80)}…` : x.body),
            },
            { key: 'categoryLabel', header: 'Category' },
            { key: 'urgency', header: 'Urgency', render: (x) => <Urgency urgency={x.urgency} /> },
            { key: 'at', header: 'Received (IST)', render: (x) => istWhen(x.at) },
            {
              key: 'state',
              header: 'Your reply',
              render: (x) =>
                x.status !== 'forwarded'
                  ? 'Closed'
                  : x.replied
                    ? 'Sent to HR'
                    : 'Waiting for your reply',
            },
          ]}
        />
      )}
    </Tabs>
  );
}

/** The fields of a request (new, or a draft being changed). */
const requestFields = (
  form: Awaited<ReturnType<typeof requestFormOptions>>,
  v?: NonNullable<HrRequestView['request']>,
): FieldSpec[] => [
  {
    name: 'recipient',
    label: 'Who it is for',
    type: 'select',
    required: true,
    options: form.recipients,
    defaultValue: v
      ? v.recipientStaffId
        ? `staff:${v.recipientStaffId}`
        : v.recipientKey
          ? `key:${v.recipientKey}`
          : 'hr'
      : 'hr',
    hint: 'HR reads it first. The person named sees only what HR passes on.',
    section: 'Request',
  },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: form.categories,
    defaultValue: v?.category,
    section: 'Request',
  },
  {
    name: 'urgency',
    label: 'Urgency',
    type: 'select',
    required: true,
    options: URGENCY_OPTIONS,
    defaultValue: v?.urgency ?? 'normal',
    section: 'Request',
  },
  {
    name: 'subject',
    label: 'Subject',
    required: true,
    defaultValue: v?.subject,
    section: 'Request',
  },
  {
    name: 'message',
    label: 'Message',
    type: 'textarea',
    defaultValue: v?.message,
    hint: 'Fixed once you send it.',
    section: 'Request',
  },
];

async function NewRequest({ user, base, searchParams: sp }: BodyProps) {
  const page = `${base}/hr-requests`;
  const close = listHref(page, sp, { new: undefined });
  const r = await load(async (db) => {
    const self = await staffIdForUser(db, user.id);
    const tasks =
      self && can(user, 'ops:tasks:read')
        ? (await listTasks(db, user, taskListQuery.parse({ staffId: self, open: '1' }))).rows
        : [];
    return { form: await requestFormOptions(db, user), tasks };
  });
  return (
    <FormModal id="hr-request-new" title="New request through HR" closeHref={close}>
      {r.ok ? (
        <ActionForm
          action={`${base}/api/v1/hr-requests`}
          submitLabel="Send to HR"
          successText="Saved."
          redirectTo={`${page}?open={id}`}
          secondary={<a href={close}>Cancel</a>}
          fields={[
            ...requestFields(r.data.form),
            {
              name: 'relatedRef',
              label: 'About one of your tasks (optional)',
              type: 'select',
              options: r.data.tasks.map((t) => ({ value: `task:${t.id}`, label: t.title })),
              section: 'Request',
            },
            {
              name: 'draft',
              label: 'Keep it as a draft instead (HR does not see it until you send it)',
              type: 'checkbox',
              section: 'Request',
            },
          ]}
        />
      ) : (
        r.view
      )}
    </FormModal>
  );
}

async function OpenRequest({ user, base, searchParams: sp, id }: BodyProps & { id: string }) {
  const page = `${base}/hr-requests`;
  const api = `${base}/api/v1`;
  const close = listHref(page, sp, { open: undefined });
  const r = await load(async (db) => {
    const view = await getHrRequest(db, user, id);
    const fileOwners =
      view.as === 'recipient'
        ? view.events.filter((e) => e.kind === 'forwarded').map((e) => e.id)
        : [view.id];
    const files: AttachmentListRow[] = [];
    for (const owner of fileOwners)
      files.push(...(await listAttachments(db, user, 'hr_request', owner)));
    const form = view.request?.status === 'draft' ? await requestFormOptions(db, user) : null;
    return { view, files, form };
  });
  if (!r.ok)
    return (
      <FormModal id="hr-request" title="Request" closeHref={close}>
        {r.view}
      </FormModal>
    );
  const { view, files, form } = r.data;
  const draft = view.request?.status === 'draft';
  const action = (a: string) => `${api}/hr-requests/${view.id}/${a}`;
  return (
    <RecordModal
      id="hr-request"
      title={view.request?.subject ?? `Forwarded by HR · ${view.categoryLabel}`}
      meta={<RequestStatus status={view.status} />}
      closeHref={close}
      returnId={view.id}
    >
      <div className="el-stack">
        <RequestFacts view={view} base={base} />
        {view.request ? (
          <Segment title="Your message" level={3}>
            <p className="el-pre">{view.request.message || 'No message yet.'}</p>
          </Segment>
        ) : null}
        <Segment title={view.as === 'recipient' ? 'Files HR shared with you' : 'Files'} level={3}>
          <AttachmentList rows={files} apiBase={api} empty="No files." />
          {draft ? (
            <AttachmentUpload
              apiBase={api}
              ownerKind="hr_request"
              ownerId={view.id}
              purpose="reference"
            />
          ) : null}
        </Segment>
        <Segment title="What happened" level={3}>
          <RequestTimeline view={view} />
        </Segment>
        {view.allowed.includes('respond') ? (
          <Segment
            title="Reply to HR"
            level={3}
            description="HR reads your reply and passes the answer on."
          >
            <ActionForm
              action={action('respond')}
              submitLabel="Send reply to HR"
              successText="Sent to HR."
              resetOnSuccess
              fields={[{ name: 'body', label: 'Your reply', type: 'textarea', required: true }]}
            />
          </Segment>
        ) : null}
        {draft && form && view.request ? (
          <>
            <Segment
              title="Send it"
              level={3}
              description="After you send it, the subject and message cannot change."
            >
              <ActionForm
                action={action('submit')}
                submitLabel="Send to HR"
                successText="Sent to HR."
              />
            </Segment>
            <Segment title="Change the draft" level={3}>
              <ActionForm
                action={`${api}/hr-requests/${view.id}`}
                method="PATCH"
                submitLabel="Save draft"
                fields={requestFields(form, view.request)}
              />
            </Segment>
          </>
        ) : null}
      </div>
    </RecordModal>
  );
}
