import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, DataTable, StatusBadge } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { listContentRules, listPolicySettings } from '../../server';
import { ProposedBadge, ruleText } from '../../ui/badges';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Marketing rules and settings' };

/** "marketing.targets.admission_attribution" reads "Targets admission attribution". */
const settingName = (key: string) =>
  words(key.replace(/^marketing\./, '').replace(/\./g, ' '));
const settingValue = (value: unknown): string =>
  value !== null && typeof value === 'object'
    ? Object.entries(value)
        .map(([k, v]) => `${words(k)}: ${settingValue(v)}`)
        .join(', ')
    : words(String(value));
const words = (s: string) =>
  (s.charAt(0).toUpperCase() + s.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath('settings')}
      active="settings"
      title="Rules and settings"
      description="What each rule is set to now. Proposed means it is in use but the owner has not decided it yet."
      searchParams={await searchParams}
    >
      {() => (
        <Section
          load={async () => {
            const db = getDb();
            const policies = await listPolicySettings(db);
            const rules = await listContentRules(db);
            return (
              <div className="el-stack">
                <Card title="Policies">
                  <DataTable
                    compact
                    rows={policies}
                    rowKey={(p) => p.key}
                    columns={[
                      { key: 'key', header: 'Setting', render: (p) => settingName(p.key) },
                      {
                        key: 'value',
                        header: 'Value',
                        render: (p) => settingValue(p.value),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (p) => <ProposedBadge status={p.status} />,
                      },
                      { key: 'desc', header: 'Meaning', render: (p) => p.description },
                    ]}
                  />
                </Card>
                <Card
                  title={`Brand rules (${rules.length})`}
                  description="Block = approval refused; flag = approver must confirm; manual = checklist item."
                >
                  <DataTable
                    compact
                    rows={rules}
                    rowKey={(r) => r.id}
                    columns={[
                      { key: 'code', header: 'Rule', render: (r) => <strong>{r.code}</strong> },
                      { key: 'kind', header: 'Kind', render: (r) => r.kind.replace('_', ' ') },
                      { key: 'desc', header: 'Description', render: (r) => ruleText(r.description) },
                      {
                        key: 'action',
                        header: 'Effect',
                        render: (r) => (
                          <StatusBadge
                            tone={
                              r.actionOnMatch === 'block'
                                ? 'danger'
                                : r.manualCheck
                                  ? 'info'
                                  : 'warning'
                            }
                          >
                            {r.manualCheck
                              ? 'manual check'
                              : (r.actionOnMatch ?? '—').replaceAll('_', ' ')}
                          </StatusBadge>
                        ),
                      },
                      {
                        key: 'accounts',
                        header: 'Accounts',
                        render: (r) => r.appliesTo.join(', '),
                      },
                      { key: 'status', header: 'Status', render: (r) => r.status },
                    ]}
                  />
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
