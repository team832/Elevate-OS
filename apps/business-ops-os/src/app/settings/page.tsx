import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { DECISION_STATE_LABELS } from '../../domain';
import { getCrmAdapter } from '../../server/adapters/crm';
import { listSettings } from '../../server/settings';
import { ActionForm } from '../../ui/action-form';
import { decisionTone } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const access = await gate('ops:settings:read', '/ops/settings');
  return (
    <Frame access={access} active="settings">
      <PageHeader
        title="Configuration and policy states"
        description="Each value shows its decision state and source. Changing a value here keeps it Proposed — approving a policy is a leadership decision."
      />
      <Section>
        <Settings user={access.user} />
      </Section>
    </Frame>
  );
}

async function Settings({ user }: { user: AuthenticatedUser }) {
  const r = await load(async (db) => ({
    settings: await listSettings(db, user),
    crm: await getCrmAdapter().status(),
  }));
  if (!r.ok) return r.view;
  const manage = can(user, 'ops:settings:manage');
  return (
    <div className="el-stack">
      <Alert tone="info" title="External CRM">
        {r.data.crm.detail} Connection:{' '}
        <StatusBadge tone="neutral">{r.data.crm.connection}</StatusBadge>
      </Alert>
      {r.data.settings.map((s) => (
        <Card key={s.key} title={s.label} description={s.description}>
          <p>
            <StatusBadge tone={decisionTone(s.decisionState)}>
              {DECISION_STATE_LABELS[s.decisionState]}
            </StatusBadge>
            {s.ownerDecision ? ` · owner decision ${s.ownerDecision}` : ''} ·{' '}
            {s.origin === 'default'
              ? 'default from the legacy record'
              : s.origin === 'stored'
                ? 'changed in Elevate OS'
                : 'stored value invalid — default used'}
          </p>
          <pre className="el-pre">{JSON.stringify(s.value, null, 2)}</pre>
          <p className="el-field-hint">Source: {s.source}</p>
          {manage && s.editable ? (
            <SettingEditor settingKey={s.key} value={JSON.stringify(s.value)} />
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function SettingEditor({ settingKey, value }: { settingKey: string; value: string }) {
  return (
    <details>
      <summary>Change (stays proposed)</summary>
      <JsonSettingForm settingKey={settingKey} value={value} />
    </details>
  );
}

function JsonSettingForm({ settingKey, value }: { settingKey: string; value: string }) {
  return (
    <ActionForm
      action={`/ops/api/v1/settings/${settingKey}`}
      method="PUT"
      submitLabel="Save as proposed"
      fields={[
        { name: 'value', label: 'Value (JSON)', type: 'json', required: true, defaultValue: value },
        { name: 'note', label: 'Why' },
      ]}
    />
  );
}
