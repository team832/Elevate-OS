/**
 * One request in HR's queue: the sender's original words (kept as sent), the full routing log
 * with HR notes, files, and HR's next steps. Forwarding keeps three things apart: who it goes to
 * (the routing decision), HR's own note, and the text the recipient sees. Files for a recipient
 * are added on that forward, so each recipient sees only what was shared with them.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { Alert } from '@elevate/shared-ui';
import { HR_REQUEST_RULES, type HrRequestAction } from '../../../domain/hr-requests';
import { listAttachments, type AttachmentListRow } from '../../../server/attachments';
import {
  activeStaffOptions,
  getHrRequest,
  type HrRequestView,
} from '../../../server/hr-requests-read';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { AttachmentList, AttachmentUpload } from '../../../ui/attachments';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../ui/record-modal';
import { Segment } from '../../../ui/sections';
import { RequestFacts, RequestStatus, RequestTimeline } from '../../hr-requests/_components/parts';
import type { Params } from '../../tasks/_components/task-common';

const API = '/ops/api/v1';
const hrNote: FieldSpec = {
  name: 'hrNote',
  label: 'HR note (only HR sees this)',
  type: 'textarea',
};

/** The fields of each HR step; `people` = active staff, `v` = the request. */
function stepFields(
  a: HrRequestAction,
  v: HrRequestView,
  people: { value: string; label: string }[],
): FieldSpec[] {
  const r = v.request!;
  const lastReply = v.events.filter((e) => e.kind === 'recipient_responded').at(-1)?.body;
  const fields: Partial<Record<HrRequestAction, FieldSpec[]>> = {
    review: [hrNote],
    forward: [
      {
        name: 'toStaffId',
        label: 'Forward to',
        type: 'select',
        required: !!r.recipient.unresolved || (!r.recipientStaffId && !r.recipientKey),
        options: people,
        defaultValue: r.recipientStaffId ?? undefined,
        hint: 'Leave as it is to send it to the person the request is for.',
      },
      {
        name: 'body',
        label: 'What they will see',
        type: 'textarea',
        required: true,
        defaultValue: r.message,
        hint: 'They see only this text and the files you share on this forward, not the original request.',
      },
      hrNote,
    ],
    resolve: [
      { name: 'body', label: 'Message to the sender (optional)', type: 'textarea' },
      hrNote,
    ],
    decline: [
      { name: 'body', label: 'Reason the sender will see', type: 'textarea', required: true },
      hrNote,
    ],
    relay: [
      {
        name: 'body',
        label: 'Answer for the sender',
        type: 'textarea',
        required: true,
        defaultValue: lastReply ?? undefined,
      },
      hrNote,
    ],
    note: [{ ...hrNote, required: true }],
    create_task: [
      { name: 'task.title', label: 'Task title', required: true, defaultValue: r.subject },
      { name: 'task.staffId', label: 'Assign to', type: 'select', required: true, options: people },
      { name: 'task.dueOn', label: 'Due on', type: 'date', required: true },
      { name: 'task.details', label: 'Details', type: 'textarea', defaultValue: r.message },
    ],
  };
  return fields[a] ?? [];
}

export async function HrRequestModal({
  user,
  sp,
  id,
  base,
}: {
  user: AuthenticatedUser;
  sp: Params;
  id: string;
  /** The queue's browser path (where closing returns). */
  base: string;
}) {
  const close = listHref(base, sp, { open: undefined });
  const r = await load(async (db) => {
    const view = await getHrRequest(db, user, id);
    const files = await listAttachments(db, user, 'hr_request', view.id);
    const forwards: { id: string; to: string; files: AttachmentListRow[] }[] = [];
    for (const e of view.events.filter((x) => x.kind === 'forwarded'))
      forwards.push({
        id: e.id,
        to: e.forwardedToName ?? 'the recipient',
        files: await listAttachments(db, user, 'hr_request', e.id),
      });
    const people = view.allowed.length
      ? await activeStaffOptions(db, view.request?.senderStaffId)
      : [];
    return { view, files, forwards, people };
  });
  if (!r.ok)
    return (
      <FormModal id="hr-request" title="Request" closeHref={close}>
        {r.view}
      </FormModal>
    );
  const { view, files, forwards, people } = r.data;
  const req = view.request;
  const steps = view.allowed.filter((a) => a !== 'submit' && a !== 'respond');
  return (
    <RecordModal
      id="hr-request"
      title={req?.subject ?? 'Request'}
      meta={<RequestStatus status={view.status} />}
      closeHref={close}
      returnId={view.id}
    >
      <div className="el-stack">
        {req?.recipient.unresolved ? (
          <Alert tone="warning">
            {req.recipient.unresolved}. It stays here until HR settings name a staff record for
            them, or you forward it to a person yourself.
          </Alert>
        ) : null}
        <RequestFacts view={view} base="/ops" />
        <Segment title="Original request (as sent)" level={3}>
          <p className="el-pre">{req?.message}</p>
        </Segment>
        <Segment title="Files from the sender" level={3}>
          <AttachmentList rows={files} apiBase={API} empty="No files." />
        </Segment>
        {forwards.map((f) => (
          <Segment key={f.id} title={`Files shared with ${f.to}`} level={3}>
            <AttachmentList rows={f.files} apiBase={API} empty="Nothing shared on this forward." />
            {view.allowed.length ? (
              <AttachmentUpload
                apiBase={API}
                ownerKind="hr_request"
                ownerId={f.id}
                purpose="reference"
                label={`Share a file with ${f.to}`}
              />
            ) : null}
          </Segment>
        ))}
        <Segment title="What happened" level={3}>
          <RequestTimeline view={view} />
        </Segment>
        {steps.length ? (
          <Segment title="Next step" level={3}>
            <div className="el-stack">
              {steps.map((a) => (
                <details key={a} className="el-explain">
                  <summary>{HR_REQUEST_RULES[a].label}</summary>
                  <ActionForm
                    action={`${API}/hr-requests/${view.id}/${a.replace('_', '-')}`}
                    submitLabel={HR_REQUEST_RULES[a].label}
                    variant={a === 'decline' ? 'danger' : 'primary'}
                    fields={stepFields(a, view, people)}
                    successText="Done."
                  />
                </details>
              ))}
            </div>
          </Segment>
        ) : null}
      </div>
    </RecordModal>
  );
}
