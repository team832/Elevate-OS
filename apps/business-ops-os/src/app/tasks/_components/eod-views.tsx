import type { AuthenticatedUser } from '@elevate/authentication';
import { StatusBadge, type Tone } from '@elevate/shared-ui';
import { isIsoDate, istToday, type IsoDate } from '../../../domain/dates';
import { periodOf } from '../../../domain/work-report';
import { EOD_STATUS_LABELS } from '../../../server/eod-export';
import type { EodReportView } from '../../../server/eod-reports';
import { ReportEditor } from '../reports/_components/report-views';
import { taskPaths, type Params } from './task-common';

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
export const EodDownloads = ({ id, base }: { id: string; base: string }) => (
  <span className="el-inline-form">
    <a href={`${taskPaths(base).eodApi}/${id}/pdf`}>Download PDF</a>
    <a href={`${taskPaths(base).eodApi}/${id}/csv`}>Download CSV</a>
  </span>
);

/** A report day from the URL: today, or an earlier valid day. */
const dayFrom = (sp: Params, today: IsoDate): IsoDate =>
  isIsoDate(sp.date) && sp.date <= today ? sp.date : today;

function DayPicker({ day, today, base }: { day: string; today: string; base: string }) {
  return (
    <form method="get" action={taskPaths(base).tasks} className="el-inline-form">
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

/** The owner's end-of-day report for a picked day: REP's report editor for the day period. */
export function EodReport({
  user,
  sp,
  base,
}: {
  user: AuthenticatedUser;
  sp: Params;
  base: string;
}) {
  const today = istToday(new Date());
  const day = dayFrom(sp, today);
  return (
    <div className="el-stack">
      <DayPicker day={day} today={today} base={base} />
      <ReportEditor user={user} base={base} period={periodOf('day', day)} />
    </div>
  );
}
