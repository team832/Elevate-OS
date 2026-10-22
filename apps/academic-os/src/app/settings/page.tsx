import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listSettings } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { fmtDateTime } from '../../ui/badges';
import { AcademicShell, LoadError, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Academic settings' };

const STATUS_OPTIONS = [
  { value: 'proposed', label: 'Proposed (not approved by the owner)' },
  { value: 'approved', label: 'Approved by the owner' },
];

const TITLES: Record<string, string> = {
  'timetable.teacher_workload_cap': 'Teacher workload cap',
  'assessments.min_gap_days': 'Days between assessments',
  'catchup.weights': 'Catch-up priority weights',
  'progress.trend': 'Assessment trend',
  'attendance.denominator': 'How attendance % is counted',
  'progress.show_rank_percentile': 'Show rank and percentile',
  'teaching_log.deadline_hours': 'Teaching log deadline',
  'demo.attendees_count_toward_capacity': 'Demo students take a seat',
  'reviews.cadence_days': 'Progress review cadence',
  'timetable.substitute_authoriser': 'Who authorises a substitute',
};
const words = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const readable = (v: unknown) => (v === null ? 'Not set' : v === true ? 'Yes' : v === false ? 'No' : String(v).replace(/_/g, ' '));

export default async function SettingsPage() {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:settings:manage', MODULE_PATHS.settings);
  return (
    <AcademicShell access={access} active="settings" loading="Loading settings…">
      {access.status === 'allowed' ? <Body /> : null}
    </AcademicShell>
  );
}

async function Body() {
  const data = await load(() => listSettings(getDb()));
  if (!data.ok) return <LoadError error={data.error} />;
  return (
    <>
      <PageHeader
        title="Academic settings"
        description="Rules that change how Academic OS counts and shows things. A proposed value is in use but the owner has not approved it; mark a value approved only after the owner's decision is recorded."
      />
      <div className="el-stack">
        {data.data.map((s) => (
          <Card
            key={s.key}
            title={TITLES[s.key] ?? s.key}
            meta={s.status === 'approved' ? <StatusBadge tone="success">Approved by the owner</StatusBadge> : <StatusBadge tone="warning">Not approved by the owner</StatusBadge>}
            description={s.description}
          >
            <ul>
              {Object.entries(s.value).map(([k, v]) => (
                <li key={k}>
                  {words(k)}: <strong>{readable(v)}</strong>
                </li>
              ))}
            </ul>
            <p className="el-field-hint">
              {s.key} · {s.isDefault ? 'shipped default, never changed' : `last changed ${fmtDateTime(s.updatedAt)}`}
            </p>
            <details>
              <summary>Change this setting</summary>
              <ApiForm
                action={MODULE_PATHS.api(`settings/${s.key}`)}
                method="PUT"
                submitLabel="Save setting"
                successMessage="Setting saved and audited."
                idPrefix={`set-${s.key.replace(/\W/g, '-')}`}
                fields={[
                  { name: 'value', label: 'Value (JSON)', type: 'json', required: true, defaultValue: JSON.stringify(s.value, null, 2), hint: 'The server checks the value against this setting’s rules and refuses anything else.' },
                  { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_OPTIONS, defaultValue: s.status },
                  { name: 'decisionRef', label: 'Owner decision reference (needed to approve)', placeholder: 'D-061', hint: 'Only the owner decides. Enter the reference of the owner’s recorded decision (D-0xx / OD-0xx); without it, approval is refused.' },
                ]}
              />
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
