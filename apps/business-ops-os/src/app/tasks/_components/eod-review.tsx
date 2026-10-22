import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, StatusBadge } from '@elevate/shared-ui';
import { getReport } from '../../../server/eod-reports';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { RecordModal } from '../../../ui/record-modal';
import { DetailTable, Segment } from '../../../ui/sections';
import { EodFactsView, EodHistory } from './eod-facts';
import { EodDownloads, EodStatus } from './eod-views';
import { taskPaths } from './task-views';

const REQUESTS = [
  ['comment', 'Comment', 'Add comment', 'Your comment'],
  [
    'clarification_requested',
    'Ask for clarification',
    'Ask for clarification',
    'What needs clarifying',
  ],
  ['revision_requested', 'Request a revision', 'Request revision', 'What to change'],
] as const;

/** The manager's review pane for one report (`?open=<id>`); getReport checks access. */
export async function ReviewPane({
  user,
  id,
  closeHref,
  base,
}: {
  user: AuthenticatedUser;
  id: string;
  closeHref: string;
  base: string;
}) {
  const EOD_API = taskPaths(base).eodApi;
  const r = await load((db) => getReport(db, user, id, { checkSource: true }));
  if (!r.ok) return r.view;
  const rep = r.data;
  const v = rep.current;
  const narrative = v?.narrative ?? {
    summary: rep.summary,
    nextDayPlan: rep.nextDayPlan,
    notes: rep.notes,
  };
  const open = rep.status === 'submitted';
  return (
    <RecordModal
      id="eod-review"
      title={`${rep.staffName}: ${fmtDate(rep.reportDate)}`}
      meta={
        <>
          <EodStatus r={rep} />{' '}
          {rep.isSample ? <span className="el-badge el-badge-sample">SAMPLE DATA</span> : null}
        </>
      }
      closeHref={closeHref}
      returnId={rep.id}
      tabs={[
        {
          key: 'report',
          label: 'Report',
          content: (
            <div className="el-stack">
              {rep.sourceChanged ? (
                <Alert tone="info" title="Source changed since submission">
                  Tasks or updates for this day changed after it was submitted. You are reading the
                  submitted version, as sent.
                </Alert>
              ) : null}
              <Segment
                title="What they wrote"
                level={3}
                flush
                actions={<EodDownloads id={rep.id} base={base} />}
              >
                <DetailTable
                  rows={[
                    v && {
                      label: 'Version',
                      value: `${v.version} of ${rep.versions.length}, submitted ${fmtDateTime(v.submittedAt)}${rep.late ? ' (after the day ended)' : ''}`,
                    },
                    { label: 'Summary', value: narrative.summary ?? 'Not written' },
                    {
                      label: 'Plan for the next day',
                      value: narrative.nextDayPlan ?? 'Not written',
                    },
                    { label: 'Notes', value: narrative.notes ?? 'Not written' },
                  ]}
                />
              </Segment>
              <EodFactsView f={rep.facts} base={base} level={3} />
            </div>
          ),
        },
        {
          key: 'history',
          label: 'Versions and responses',
          count: rep.trail.length,
          content: <EodHistory r={rep} base={base} level={3} />,
        },
        {
          key: 'respond',
          label: 'Respond',
          content: rep.canReview ? (
            <div className="el-stack">
              <p className="el-field-hint">
                Acknowledging confirms you have read the report. It does not close any task; close
                work on the task itself.
              </p>
              <div className="el-inline-form">
                <ActionForm
                  compact
                  action={`${EOD_API}/${rep.id}/review`}
                  submitLabel="Mark viewed"
                  variant="secondary"
                  extra={{ kind: 'viewed' }}
                  successText="Marked viewed."
                />
                {open ? (
                  <ActionForm
                    compact
                    action={`${EOD_API}/${rep.id}/review`}
                    submitLabel="Acknowledge report"
                    extra={{ kind: 'acknowledged' }}
                    successText="Acknowledged."
                  />
                ) : null}
              </div>
              {REQUESTS.filter(([kind]) => open || kind !== 'revision_requested').map(
                ([kind, title, label, field]) => (
                  <Segment key={kind} title={title} level={3}>
                    <ActionForm
                      action={`${EOD_API}/${rep.id}/review`}
                      submitLabel={label}
                      variant="secondary"
                      extra={{ kind }}
                      resetOnSuccess
                      fields={[{ name: 'text', label: field, type: 'textarea', required: true }]}
                    />
                  </Segment>
                ),
              )}
              {can(user, 'ops:tasks:write') ? (
                <Segment
                  title="Create a follow-up task"
                  level={3}
                  description={`Assigned to ${rep.staffName}.`}
                >
                  <ActionForm
                    action={`${EOD_API}/${rep.id}/follow-up`}
                    submitLabel="Create follow-up task"
                    successText="Follow-up task created."
                    fields={[
                      { name: 'title', label: 'Task', required: true },
                      { name: 'details', label: 'Details', type: 'textarea' },
                      { name: 'dueOn', label: 'Due day', type: 'date' },
                    ]}
                  />
                </Segment>
              ) : null}
            </div>
          ) : (
            <p>
              {rep.imported
                ? 'Imported from the old task tracker and never sent, so there is nothing to respond to.'
                : rep.isOwner
                  ? 'This is your own report.'
                  : 'Only the person it was sent to, or an EOD reviewer, can respond.'}{' '}
              <StatusBadge tone="neutral">Read only</StatusBadge>
            </p>
          ),
        },
      ]}
    />
  );
}
