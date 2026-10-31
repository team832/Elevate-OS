import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { settingFieldName } from '@elevate/shared-types';
import {
  Card,
  IN_USE_NOT_APPROVED,
  PageHeader,
  SETTINGS_STATE_NOTE,
  settingLine,
  settingShape,
  SettingFields,
  StatusBadge,
} from '@elevate/shared-ui';
import { SETTING_DEFINITIONS, type SettingKey } from '../../domain';
import { listSettings } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { fmtDateTime } from '../../ui/badges';
import { AcademicShell, LoadError, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Academic settings' };

const STATUS_OPTIONS = [
  { value: 'proposed', label: IN_USE_NOT_APPROVED },
  { value: 'approved', label: 'Approved' },
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
const label = (key: string) => (key === 'lastN' ? 'Last N results' : settingFieldName(key));
/** The setting's value as real fields, from its own rules. */
const shapeOf = (key: SettingKey, value: unknown) =>
  settingShape(SETTING_DEFINITIONS[key].schema, value, { label });

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
        description={`Rules that change how Academic OS counts and shows things. ${SETTINGS_STATE_NOTE} Mark a value approved only after the owner's decision is recorded.`}
      />
      <div className="el-stack">
        {data.data.map((s) => (
          <Card
            key={s.key}
            title={TITLES[s.key] ?? settingFieldName(s.key.split('.').at(-1)!)}
            meta={s.status === 'approved' ? <StatusBadge tone="success">Approved</StatusBadge> : <StatusBadge tone="info">{IN_USE_NOT_APPROVED}</StatusBadge>}
          >
            <p>
              <strong>{settingLine(shapeOf(s.key, s.value), s.value)}</strong>
            </p>
            <p className="el-field-hint">
              {s.isDefault ? 'Default value, never changed' : `Last changed ${fmtDateTime(s.updatedAt)}`}
            </p>
            <details className="el-explain">
              <summary>What it controls</summary>
              <p>{s.description}</p>
            </details>
            <details>
              <summary>Change this setting</summary>
              <ApiForm
                action={MODULE_PATHS.api(`settings/${s.key}`)}
                method="PUT"
                submitLabel="Save setting"
                successMessage="Setting saved and audited."
                idPrefix={`set-${s.key.replace(/\W/g, '-')}`}
                fields={[
                  { name: 'value', label: 'New value', type: 'json', required: true, control: <SettingFields name="value" shape={shapeOf(s.key, s.value)} value={s.value} /> },
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
