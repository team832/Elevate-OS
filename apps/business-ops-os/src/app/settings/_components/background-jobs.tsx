/** Settings → Background jobs (D-133): each job's switch, how often it runs, its last run and Run now. */
import { StatusBadge, type Column } from '@elevate/shared-ui';
import { settingFieldName } from '@elevate/shared-types';
import { JOB_INTERVALS_TEXT } from '../../../domain/policies-jobs';
import type { JobView } from '../../../server/jobs';
import { ActionForm } from '../../../ui/action-form';
import { fmtDateTime, plural } from '../../../ui/format';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';

const counts = (result: unknown) =>
  Object.entries(result ?? {})
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${settingFieldName(k)}: ${v}`)
    .join(', ');

const COLUMNS: Column<JobView>[] = [
  {
    key: 'label',
    header: 'Job',
    render: (j) => (
      <>
        <strong>{j.label}</strong>
        <p className="el-field-hint">{j.description}</p>
      </>
    ),
  },
  {
    key: 'enabled',
    header: 'Runs by itself',
    render: (j) => (
      <>
        <StatusBadge tone={j.enabled ? 'success' : 'neutral'}>
          {j.enabled ? 'On' : 'Off'}
        </StatusBadge>
        <p className="el-field-hint">
          Every {plural(j.everyMinutes, 'minute')}
          {j.runsAs ? `. Runs as ${j.runsAs}` : ''}
        </p>
      </>
    ),
  },
  {
    key: 'lastRun',
    header: 'Last run',
    render: ({ lastRun: r }) =>
      r ? (
        <>
          <StatusBadge tone={r.outcome === 'done' ? 'success' : 'danger'}>
            {r.outcome === 'done' ? 'Done' : 'Failed'}
          </StatusBadge>{' '}
          {fmtDateTime(r.at)}
          <p className="el-field-hint">{r.outcome === 'done' ? counts(r.result) : r.message}</p>
        </>
      ) : (
        'Not run yet'
      ),
  },
];

const ACTIONS: Column<JobView> = {
  key: 'actions',
  header: '',
  render: (j) => (
    <>
      <ActionForm
        action={`/ops/api/v1/jobs/${j.job}`}
        method="PUT"
        submitLabel="Save schedule"
        compact
        labelSuffix={` — ${j.label}`}
        fields={[
          {
            name: 'value.enabled',
            label: 'Run by itself',
            type: 'checkbox',
            defaultValue: String(j.enabled),
          },
          {
            name: 'value.everyMinutes',
            label: 'Every (minutes)',
            type: 'number',
            required: true,
            defaultValue: String(j.everyMinutes),
            hint: `One of ${JOB_INTERVALS_TEXT}. 60 is hourly, 1440 daily.`,
          },
        ]}
      />
      <ActionForm
        action={`/ops/api/v1/jobs/${j.job}`}
        submitLabel="Run now"
        variant="secondary"
        compact
        labelSuffix={` — ${j.label}`}
        successText="Done."
        showCounts
      />
    </>
  ),
};

export function BackgroundJobs({ jobs, canRun }: { jobs: readonly JobView[]; canRun: boolean }) {
  return (
    <Segment
      id="background-jobs"
      title="Background jobs"
      description="Every job is off until someone who runs jobs switches it on. A job that is on runs once in each period, counted from midnight IST, as the person who switched it on. Run now runs it straight away as you; running a job twice is safe."
      flush
    >
      <RecordTable
        caption={`${jobs.length} jobs`}
        rows={jobs}
        rowKey={(j) => j.job}
        columns={canRun ? [...COLUMNS, ACTIONS] : COLUMNS}
      />
    </Segment>
  );
}
