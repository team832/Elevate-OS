import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { isIsoDate, istToday } from '../../../domain/dates';
import { missingReasons, type EodSnapshot } from '../../../domain/staff-tasks';
import { eodContext, getReport, SIMULATED, teamDay } from '../../../server/eod-reports';
import { myDay, NO_STAFF_RECORD } from '../../../server/staff-tasks';
import { ActionForm } from '../../../ui/action-form';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { BASE, DayTable, TaskBadge, dueText, type Params } from './task-views';

const API = '/ops/api/v1/eod-reports';
type Report = Awaited<ReturnType<typeof getReport>>;

/** A report day from the URL: today, or an earlier valid day. */
const dayFrom = (sp: Params, today: string) =>
  isIsoDate(sp.date) && sp.date <= today ? sp.date : today;

function DayPicker({ tab, day, today }: { tab: string; day: string; today: string }) {
  return (
    <form method="get" action={BASE} className="el-inline-form">
      <input type="hidden" name="tab" value={tab} />
      <div className="el-field">
        <label htmlFor={`${tab}-date`}>Report day</label>
        <input
          id={`${tab}-date`}
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

/** The report's task groups; `edit` lets the owner fix status and reasons before submitting. */
function ReportTables({ s, edit, level = 2 }: { s: EodSnapshot; edit?: boolean; level?: 2 | 3 }) {
  return (
    <>
      <Segment title={`Still open (${s.counts.open})`} level={level} flush>
        <DayTable rows={s.open} edit={edit} empty="Nothing left open for this day." />
      </Segment>
      {s.counts.carried ? (
        <Segment title={`Carried forward (${s.counts.carried})`} level={level} flush>
          <DayTable rows={s.carried} edit={edit} />
        </Segment>
      ) : null}
      <Segment title={`Done (${s.counts.done})`} level={level} flush>
        <DayTable rows={s.done} empty="Nothing completed on this day." />
      </Segment>
    </>
  );
}

function reportFacts(r: Report) {
  return [
    { label: 'Staff member', value: r.staffName },
    { label: 'Report day', value: fmtDate(r.reportDate) },
    {
      label: 'Status',
      value:
        r.status === 'draft' ? (
          <StatusBadge tone="neutral">Draft</StatusBadge>
        ) : (
          <>
            <StatusBadge tone="success">Submitted</StatusBadge>{' '}
            {r.late ? <StatusBadge tone="warning">Submitted later</StatusBadge> : null}{' '}
            {r.reviewedAt ? <StatusBadge tone="info">Reviewed</StatusBadge> : null}
          </>
        ),
    },
    r.submittedAt && {
      label: 'Submitted',
      value: `${fmtDateTime(r.submittedAt)} to ${r.managerName ?? 'the EOD reviewers'}`,
    },
    r.status === 'draft' && {
      label: 'Tasks as of',
      value: `${fmtDateTime(r.snapshot.generatedAt)} (rebuilt each time you save)`,
    },
    { label: 'Summary', value: r.summary ?? 'No summary written' },
  ];
}

export async function EodReport({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const day = dayFrom(sp, today);
  const r = await load(async (db) => {
    const [preview, context] = await Promise.all([myDay(db, user, day), eodContext(db, user, day)]);
    return { preview, context };
  });
  if (!r.ok) return r.view;
  const { preview, context } = r.data;
  if (!preview || !context)
    return <EmptyState title="No report to show" description={NO_STAFF_RECORD} />;
  const { report, managerName } = context;
  const write = can(user, 'ops:tasks:write');
  const submitted = report?.status === 'submitted';
  const s = submitted ? report.snapshot : preview;
  const missing = missingReasons(s);
  return (
    <div className="el-stack">
      <DayPicker tab="eod" day={day} today={today} />
      {report ? (
        <Segment
          title={`Report for ${fmtDate(day)}`}
          flush
          actions={<a href={`${API}/${report.id}/pdf`}>Download PDF</a>}
        >
          <DetailTable rows={reportFacts(report)} />
        </Segment>
      ) : null}
      <ReportTables s={s} edit={!submitted && write} />
      {!submitted && write ? (
        <Segment
          title="Last step: summary and submit"
          description="Save the summary as a draft, then submit it. A submitted report cannot be changed."
        >
          {missing.length ? (
            <Alert tone="warning" title="Reasons needed before you submit">
              Give a reason for each task that is not done: {missing.map((t) => t.title).join(', ')}
              . Use the Update column above.
            </Alert>
          ) : null}
          <ActionForm
            action={API}
            submitLabel="Save draft"
            variant="secondary"
            extra={{ reportDate: day }}
            fields={[
              {
                name: 'summary',
                label: 'Summary for your manager',
                type: 'textarea',
                defaultValue: report?.summary ?? '',
              },
            ]}
          />
          {report ? (
            <ActionForm
              action={`${API}/${report.id}/submit`}
              submitLabel={managerName ? `Submit to ${managerName}` : 'Submit to the EOD reviewers'}
            />
          ) : (
            <p className="el-field-hint">Save the draft first; then you can submit it.</p>
          )}
        </Segment>
      ) : null}
      {submitted && write ? (
        <Segment
          title="Share"
          meta={<StatusBadge tone="warning">Simulated</StatusBadge>}
          description="No WhatsApp or email provider is connected yet, so sharing is only simulated and nothing is sent. Download the PDF to send it yourself."
        >
          <div className="el-inline-form">
            <ActionForm
              compact
              action={`${API}/${report.id}/share`}
              submitLabel="Share on WhatsApp"
              variant="secondary"
              extra={{ channel: 'whatsapp' }}
            />
            <ActionForm
              compact
              action={`${API}/${report.id}/share`}
              submitLabel="Share by email"
              variant="secondary"
              extra={{ channel: 'email' }}
            />
          </div>
          {report.shares.length ? (
            <ul>
              {report.shares.map((x, i) => (
                <li key={i}>
                  {fmtDateTime(x.at)}:{' '}
                  {String((x.metadata as { channel?: string } | null)?.channel ?? '')}. {SIMULATED}
                </li>
              ))}
            </ul>
          ) : null}
        </Segment>
      ) : null}
    </div>
  );
}

export async function TeamReports({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const today = istToday(new Date());
  const day = dayFrom(sp, today);
  const r = await load(async (db) => {
    return teamDay(db, user, day);
  });
  if (!r.ok) return r.view;
  const team = r.data;
  const sent = team.people.filter((p) => p.status === 'submitted').length;
  return (
    <div className="el-stack">
      <DayPicker tab="team" day={day} today={today} />
      <RecordTable
        caption={`${sent} of ${team.people.length} submitted for ${fmtDate(day)}`}
        rows={team.people}
        rowKey={(p) => p.staffId}
        rowHref={(p) =>
          p.reportId
            ? listHref(BASE, sp, { report: p.reportId })
            : listHref(BASE, {}, { tab: 'all', staffId: p.staffId })
        }
        empty={
          <EmptyState
            title="No active staff with a login"
            description="Staff appear here once they can sign in."
          />
        }
        columns={[
          { key: 'name', header: 'Staff member' },
          {
            key: 'status',
            header: 'Report',
            render: (p) =>
              p.status === 'submitted' ? (
                <>
                  <StatusBadge tone="success">Submitted {fmtDateTime(p.submittedAt)}</StatusBadge>{' '}
                  {p.late ? <StatusBadge tone="warning">Later</StatusBadge> : null}
                </>
              ) : (
                <StatusBadge tone={p.status ? 'neutral' : 'warning'}>
                  {p.status ? 'Draft, not submitted' : 'Not started'}
                </StatusBadge>
              ),
          },
          {
            key: 'reviewed',
            header: 'Reviewed',
            render: (p) =>
              p.reviewedAt ? fmtDateTime(p.reviewedAt) : p.status === 'submitted' ? 'Not yet' : '',
          },
        ]}
      />
      <Segment title="Blocked or on hold" description="Across all staff, oldest due first." flush>
        <RecordTable
          rows={team.stuck}
          rowKey={(t) => t.id}
          empty="No task is blocked or on hold."
          columns={[
            { key: 'title', header: 'Task' },
            { key: 'staffName', header: 'Staff member' },
            {
              key: 'due',
              header: 'Due',
              render: (t) => dueText({ dueOn: t.dueOn, dueTime: null }),
            },
            { key: 'status', header: 'Status', render: (t) => <TaskBadge status={t.status} /> },
            { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '' },
          ]}
        />
      </Segment>
    </div>
  );
}

/** A report opened from the team list or a notification (`?report=<id>`); getReport checks access. */
export async function ReportModal({
  user,
  id,
  sp,
}: {
  user: AuthenticatedUser;
  id: string;
  sp: Params;
}) {
  const r = await load((db) => getReport(db, user, id));
  if (!r.ok) return r.view;
  const open = r.data;
  return (
    <RecordModal
      id="eod-modal"
      title={`${open.staffName}: ${fmtDate(open.reportDate)}`}
      closeHref={listHref(BASE, sp, { report: undefined })}
      returnId={open.staffId}
      tabs={[
        {
          key: 'report',
          label: 'Report',
          content: (
            <div className="el-stack">
              <Segment
                title="Report"
                level={3}
                flush
                actions={<a href={`${API}/${open.id}/pdf`}>Download PDF</a>}
              >
                <DetailTable rows={reportFacts(open)} />
              </Segment>
              <ReportTables s={open.snapshot} level={3} />
              {open.canReview ? (
                <ActionForm action={`${API}/${open.id}/review`} submitLabel="Mark reviewed" />
              ) : null}
            </div>
          ),
        },
      ]}
    />
  );
}
