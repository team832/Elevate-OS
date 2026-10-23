import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { factsMissingReasons } from '../../../../domain/eod';
import { aiBlocked } from '../../../../server/ai-drafts';
import { NARRATIVE_FIELDS, type Period } from '../../../../domain/work-report';
import { eodSummaryText } from '../../../../server/eod-export';
import { getReport, reportContext, type EodReportView } from '../../../../server/eod-reports';
import { NO_STAFF_RECORD } from '../../../../server/staff-tasks';
import { ActionForm } from '../../../../ui/action-form';
import { AiDraft } from '../../../../ui/ai-draft';
import { fmtDateTime } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { RecordModal } from '../../../../ui/record-modal';
import { DetailTable, Segment } from '../../../../ui/sections';
import { CopySummary } from '../../_components/eod-copy';
import { EodHistory } from '../../_components/eod-facts';
import { EodDownloads, EodStatus } from '../../_components/eod-views';
import { taskPaths } from '../../_components/task-common';
import { WorkReportFacts } from './report-facts';

const deadlineText = (r: Pick<EodReportView, 'deadline'>) =>
  r.deadline ? `Due ${fmtDateTime(r.deadline)}` : 'No deadline set';

/** What the employee wrote, labelled per report kind and as their own words. */
function Narrative({ r, level }: { r: EodReportView; level: 2 | 3 }) {
  const n = r.current?.narrative ?? r;
  return (
    <Segment title="In their own words" level={level} description="Self-reported." flush>
      <DetailTable
        rows={NARRATIVE_FIELDS[r.period.kind].map((f) => ({
          label: f.label,
          value: n[f.key] ?? 'Not written',
        }))}
      />
    </Segment>
  );
}

/**
 * The employee's report for one period: facts rebuilt from their records, their own words,
 * submission to the manager, versions and review comments. Any report kind.
 */
export async function ReportEditor({
  user,
  base,
  period,
}: {
  user: AuthenticatedUser;
  base: string;
  period: Period;
}) {
  const API = taskPaths(base).eodApi;
  const r = await load(async (db) => {
    const c = await reportContext(db, user, period);
    return c && { ...c, ai: await aiBlocked(db, user, 'reportDraft') };
  });
  if (!r.ok) return r.view;
  if (!r.data) return <EmptyState title="No report to show" description={NO_STAFF_RECORD} />;
  const { report, recipient, facts, ai } = r.data;
  const editable =
    can(user, 'ops:tasks:write') &&
    (!report || ['draft', 'revision_requested'].includes(report.status));
  const missing = factsMissingReasons(facts);
  const request = report?.trail.find((t) => t.kind === 'revision_requested');
  const nextVersion = (report?.currentVersion ?? 0) + 1;
  const summary = report?.current ? eodSummaryText(report) : null;
  return (
    <div className="el-stack">
      {report ? (
        <Segment
          title={report.periodLabel}
          meta={<EodStatus r={report} />}
          actions={<EodDownloads id={report.id} base={base} />}
          flush
        >
          <DetailTable
            rows={[
              { label: 'Deadline', value: deadlineText(report) },
              report.current && {
                label: 'Latest version',
                value: `Version ${report.current.version}, submitted ${fmtDateTime(report.current.submittedAt)}${report.current.recipientName ? ` to ${report.current.recipientName}` : ''}`,
              },
              report.reviewedAt && { label: 'Reviewed', value: fmtDateTime(report.reviewedAt) },
            ]}
          />
        </Segment>
      ) : null}
      {request && report?.status === 'revision_requested' ? (
        <Alert tone="warning" title="Changes requested">
          {request.text} Change your notes or the tasks, then submit version {nextVersion}.
        </Alert>
      ) : null}
      {report?.sourceChanged ? (
        <Alert tone="info" title="Source changed since submission">
          Tasks or work updates in this period changed after you submitted. The submitted version
          stays as it was sent; submit a revision only if your manager asks for one.
        </Alert>
      ) : null}
      <p className="el-field-hint">
        {editable
          ? `Facts as of ${fmtDateTime(facts.asOf)}, rebuilt from your records each time you save. To correct a fact, update the task, the Academic record or your attendance.`
          : 'Showing the submitted version, as sent.'}
      </p>
      <WorkReportFacts f={editable ? facts : report!.facts} base={base} />
      {editable ? (
        <Segment title="Your words" description="Only these parts are yours to write.">
          <AiDraft
            api={`${base}/api/v1/ai/report-draft`}
            body={{ periodKind: period.kind, reportDate: period.start }}
            blocked={ai}
            buttonLabel="Draft from my recorded work"
            note="AI draft — check before submitting"
          >
            <ActionForm
              action={API}
              submitLabel="Save draft"
              variant="secondary"
              successText="Draft saved."
              extra={{
                periodKind: period.kind,
                reportDate: period.start,
                ...(report ? { version: report.version } : {}),
              }}
              fields={NARRATIVE_FIELDS[period.kind].map((f) => ({
                name: f.key,
                label: f.label,
                hint: f.hint,
                type: 'textarea' as const,
                defaultValue: report?.[f.key] ?? '',
              }))}
            />
          </AiDraft>
        </Segment>
      ) : null}
      {editable ? (
        <Segment
          title="Submit"
          description="Submitting freezes this version. Your manager can mark it reviewed or request changes."
        >
          <DetailTable
            rows={[
              {
                label: 'Goes to',
                value:
                  recipient.kind === 'manager'
                    ? `${recipient.name} (your reporting manager), in their Elevate OS inbox`
                    : 'Not resolved — choose below',
              },
              { label: 'Email or WhatsApp', value: 'Not configured' },
              { label: 'Version', value: String(nextVersion) },
            ]}
          />
          {missing.length ? (
            <Alert tone="warning" title="Reasons needed before you submit">
              Give a reason for each open task due by this day:{' '}
              {missing.map((t) => t.title).join(', ')}.
            </Alert>
          ) : null}
          {!report ? (
            <p className="el-field-hint">Save the draft first; then you can submit it.</p>
          ) : recipient.kind === 'manager' || recipient.candidates.length ? (
            <ActionForm
              action={`${API}/${report.id}/submit`}
              extra={{ expectedVersion: report.version }}
              submitLabel={
                recipient.kind === 'manager' ? `Submit to ${recipient.name}` : 'Submit report'
              }
              successText="Submitted."
              fields={
                recipient.kind === 'manager'
                  ? []
                  : [
                      {
                        name: 'recipientStaffId',
                        label: 'Send to',
                        hint: `${recipient.why} Recorded on this version only; your reporting line is not changed.`,
                        type: 'select',
                        required: true,
                        options: recipient.candidates.map((c) => ({
                          value: c.staffId,
                          label: c.name,
                        })),
                      },
                    ]
              }
            />
          ) : (
            <Alert tone="warning" title="No one can receive this report yet">
              {recipient.why} Ask HR or an operations manager to set your reporting manager.
            </Alert>
          )}
        </Segment>
      ) : null}
      {summary ? (
        <Segment
          title="Share outside Elevate OS"
          meta={<StatusBadge tone="neutral">Email or WhatsApp: not configured</StatusBadge>}
          description="Your manager already has the report in their inbox. Copy the summary or download the PDF to share it yourself."
        >
          <CopySummary text={summary} />
        </Segment>
      ) : null}
      {report ? <EodHistory r={report} base={base} /> : null}
    </div>
  );
}

const REQUESTS = [
  ['comment', 'Comment', 'Add comment', 'Your comment'],
  [
    'clarification_requested',
    'Ask for clarification',
    'Ask for clarification',
    'What needs clarifying',
  ],
  ['revision_requested', 'Request changes', 'Request changes', 'What to change'],
] as const;

/** The reviewer's pane for one report of any kind (`?open=<id>`); getReport checks access (404). */
export async function ReportPane({
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
  const API = taskPaths(base).eodApi;
  const r = await load((db) => getReport(db, user, id, { checkSource: true }));
  if (!r.ok) return r.view;
  const rep = r.data;
  const open = rep.status === 'submitted';
  return (
    <RecordModal
      id="report-review"
      title={`${rep.staffName}: ${rep.kindLabel.toLowerCase()}, ${rep.periodLabel}`}
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
                  Records in this period changed after it was submitted. You are reading the
                  submitted version, as sent.
                </Alert>
              ) : null}
              <p className="el-inline-form">
                <span>
                  {rep.current
                    ? `Version ${rep.current.version} of ${rep.versions.length}, submitted ${fmtDateTime(rep.current.submittedAt)}`
                    : 'Not submitted'}
                  {' · '}
                  {deadlineText(rep)}
                </span>
                <EodDownloads id={rep.id} base={base} />
              </p>
              <Narrative r={rep} level={3} />
              <WorkReportFacts f={rep.facts} base={base} level={3} />
            </div>
          ),
        },
        {
          key: 'history',
          label: 'Versions and comments',
          count: rep.trail.length,
          content: <EodHistory r={rep} base={base} level={3} />,
        },
        {
          key: 'respond',
          label: 'Review',
          content: rep.canReview ? (
            <div className="el-stack">
              <p className="el-field-hint">
                Marking a report reviewed confirms you have read it. It never approves or closes a
                task; review work on the task itself.
              </p>
              {open ? (
                <ActionForm
                  compact
                  action={`${API}/${rep.id}/review`}
                  submitLabel="Mark reviewed"
                  extra={{ kind: 'acknowledged' }}
                  successText="Marked reviewed."
                />
              ) : null}
              {REQUESTS.filter(([kind]) => open || kind !== 'revision_requested').map(
                ([kind, title, label, field]) => (
                  <Segment key={kind} title={title} level={3}>
                    <ActionForm
                      action={`${API}/${rep.id}/review`}
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
                    action={`${API}/${rep.id}/follow-up`}
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
                ? 'Imported from the old task tracker and never sent, so there is nothing to review.'
                : rep.isOwner
                  ? 'This is your own report.'
                  : 'Only the person it was sent to, or a report reviewer, can review it.'}{' '}
              <StatusBadge tone="neutral">Read only</StatusBadge>
            </p>
          ),
        },
      ]}
    />
  );
}
