import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState, StatusBadge, type Tone } from '@elevate/shared-ui';
import { isIsoDate, istToday } from '../../../domain/dates';
import { factsMissingReasons } from '../../../domain/eod';
import { EOD_STATUS_LABELS, eodSummaryText } from '../../../server/eod-export';
import { eodContext, EXTERNAL_DELIVERY, type EodReportView } from '../../../server/eod-reports';
import { NO_STAFF_RECORD } from '../../../server/staff-tasks';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { DetailTable, Segment } from '../../../ui/sections';
import { CopySummary } from './eod-copy';
import { EodFactsView, EodHistory } from './eod-facts';
import { BASE, type Params } from './task-views';

export const EOD_API = '/ops/api/v1/eod-reports';

export const EOD_TONES: Record<EodReportView['status'], Tone> = {
  draft: 'neutral',
  submitted: 'info',
  revision_requested: 'warning',
  acknowledged: 'success',
};

export const EodStatus = ({ r }: { r: Pick<EodReportView, 'status' | 'late'> }) => (
  <>
    <StatusBadge tone={EOD_TONES[r.status]}>{EOD_STATUS_LABELS[r.status]}</StatusBadge>
    {r.late ? (
      <>
        {' '}
        <StatusBadge tone="warning">Submitted later</StatusBadge>
      </>
    ) : null}
  </>
);

/** Download links for a report (the latest submitted version, else the draft). */
export const EodDownloads = ({ id }: { id: string }) => (
  <span className="el-inline-form">
    <a href={`${EOD_API}/${id}/pdf`}>Download PDF</a>
    <a href={`${EOD_API}/${id}/csv`}>Download CSV</a>
  </span>
);

/** A report day from the URL: today, or an earlier valid day. */
const dayFrom = (sp: Params, today: string) =>
  isIsoDate(sp.date) && sp.date <= today ? sp.date : today;

function DayPicker({ day, today }: { day: string; today: string }) {
  return (
    <form method="get" action={BASE} className="el-inline-form">
      <input type="hidden" name="tab" value="eod" />
      <div className="el-field">
        <label htmlFor="eod-date">Report day</label>
        <input
          id="eod-date"
          name="date"
          type="date"
          className="el-input"
          defaultValue={day}
          max={today}
        />
      </div>
      <button type="submit" className="el-button el-button-secondary">
        Show day
      </button>
    </form>
  );
}

/** The owner's end-of-day report: facts, narrative, recipient, submit, versions, exports. */
export async function EodReport({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const day = dayFrom(sp, today);
  const r = await load((db) => eodContext(db, user, day));
  if (!r.ok) return r.view;
  if (!r.data) return <EmptyState title="No report to show" description={NO_STAFF_RECORD} />;
  const { report, recipient, facts } = r.data;
  const editable =
    can(user, 'ops:tasks:write') &&
    (!report || ['draft', 'revision_requested'].includes(report.status));
  const missing = factsMissingReasons(facts);
  const request = report?.trail.find((t) => t.kind === 'revision_requested');
  const nextVersion = (report?.currentVersion ?? 0) + 1;
  const summary = report && report.current ? eodSummaryText(report) : null;
  return (
    <div className="el-stack">
      <DayPicker day={day} today={today} />
      {report ? (
        <Segment
          title={`Report for ${fmtDate(day)}`}
          meta={<EodStatus r={report} />}
          actions={<EodDownloads id={report.id} />}
          flush
        >
          <DetailTable
            rows={[
              { label: 'Period', value: `${fmtDate(day)}, 00:00–24:00 IST` },
              report.current && {
                label: 'Latest version',
                value: `Version ${report.current.version}, submitted ${fmtDateTime(report.current.submittedAt)}${report.current.recipientName ? ` to ${report.current.recipientName}` : ''}`,
              },
              report.reviewedAt && { label: 'Acknowledged', value: fmtDateTime(report.reviewedAt) },
            ]}
          />
        </Segment>
      ) : null}
      {request && report?.status === 'revision_requested' ? (
        <Alert tone="warning" title="Your manager asked for a revision">
          {request.text} Change your notes or the tasks, then submit version {nextVersion}.
        </Alert>
      ) : null}
      {report?.sourceChanged ? (
        <Alert tone="info" title="Source changed since submission">
          Tasks or work updates for this day changed after you submitted. The submitted version
          stays as it was sent.
        </Alert>
      ) : null}
      <p className="el-field-hint">
        {editable
          ? `Facts as of ${fmtDateTime(facts.asOf)}, rebuilt from your task history each time you save. To correct a fact, update the task or the Academic record.`
          : 'Showing the submitted version. To correct a fact, update the task or the Academic record.'}
      </p>
      <EodFactsView f={editable ? facts : report!.facts} />
      {editable ? (
        <Segment
          title="Your notes for your manager"
          description="Only these parts are yours to write."
        >
          <ActionForm
            action={EOD_API}
            submitLabel="Save draft"
            variant="secondary"
            successText="Draft saved."
            extra={{ reportDate: day, ...(report ? { version: report.version } : {}) }}
            fields={[
              {
                name: 'summary',
                label: 'Summary of the day',
                type: 'textarea',
                defaultValue: report?.summary ?? '',
              },
              {
                name: 'nextDayPlan',
                label: 'Plan for the next day',
                type: 'textarea',
                defaultValue: report?.nextDayPlan ?? '',
              },
              {
                name: 'notes',
                label: 'Notes or evidence links',
                type: 'textarea',
                defaultValue: report?.notes ?? '',
              },
            ]}
          />
        </Segment>
      ) : null}
      {editable ? (
        <Segment
          title="Submit"
          description="Submitting freezes this version. Your manager can acknowledge it or ask for a revision."
        >
          <DetailTable
            rows={[
              {
                label: 'Goes to',
                value:
                  recipient.kind === 'manager'
                    ? `${recipient.name} (your reporting manager)`
                    : 'Not resolved — choose below',
              },
              { label: 'Period', value: `${fmtDate(day)}, 00:00–24:00 IST` },
              { label: 'Version', value: String(nextVersion) },
            ]}
          />
          {missing.length ? (
            <Alert tone="warning" title="Reasons needed before you submit">
              Give a reason for each open task due by this day:{' '}
              {missing.map((t) => t.title).join(', ')}. Update them on My day.
            </Alert>
          ) : null}
          {!report ? (
            <p className="el-field-hint">Save the draft first; then you can submit it.</p>
          ) : recipient.kind === 'manager' ? (
            <ActionForm
              action={`${EOD_API}/${report.id}/submit`}
              extra={{ expectedVersion: report.version }}
              submitLabel={`Submit to ${recipient.name}`}
              successText="Submitted."
            />
          ) : recipient.candidates.length ? (
            <>
              <Alert tone="warning" title="Choose who receives this report">
                {recipient.why} The person you choose is recorded on this version only; your
                reporting line is not changed.
              </Alert>
              <ActionForm
                action={`${EOD_API}/${report.id}/submit`}
                extra={{ expectedVersion: report.version }}
                submitLabel="Submit report"
                successText="Submitted."
                fields={[
                  {
                    name: 'recipientStaffId',
                    label: 'Send to',
                    type: 'select',
                    required: true,
                    options: recipient.candidates.map((c) => ({ value: c.staffId, label: c.name })),
                  },
                ]}
              />
            </>
          ) : (
            <Alert tone="warning" title="No one can receive this report yet">
              {recipient.why} Ask an operations manager to set your reporting manager in the Staff
              directory.
            </Alert>
          )}
        </Segment>
      ) : null}
      {summary ? (
        <Segment
          title="Share outside Elevate OS"
          meta={<StatusBadge tone="neutral">{EXTERNAL_DELIVERY}</StatusBadge>}
          description="Your manager already has the report in their inbox. Nothing is sent by email or WhatsApp; copy the summary or download the PDF to share it yourself."
        >
          <CopySummary text={summary} />
        </Segment>
      ) : null}
      {report ? <EodHistory r={report} /> : null}
    </div>
  );
}
