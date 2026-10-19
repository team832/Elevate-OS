import { getDb } from '@elevate/database';
import { Card, DataTable, StatusBadge } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { listContentRules, listPolicySettings } from '../../server';
import { ProposedBadge } from '../../ui/badges';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={modulePath('settings')}
      active="settings"
      title="Rules and settings"
      description="Open owner decisions (OD-xxx) ship as proposed settings; brand rules come from the legacy BRAND.md and account rules with their status."
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
                    rows={policies}
                    rowKey={(p) => p.key}
                    columns={[
                      { key: 'key', header: 'Setting', render: (p) => <code>{p.key}</code> },
                      {
                        key: 'value',
                        header: 'Value',
                        render: (p) => <code>{JSON.stringify(p.value)}</code>,
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (p) => (
                          <>
                            <ProposedBadge status={p.status} /> {p.ownerDecision ?? ''}
                          </>
                        ),
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
                    rows={rules}
                    rowKey={(r) => r.id}
                    columns={[
                      { key: 'code', header: 'Rule', render: (r) => <strong>{r.code}</strong> },
                      { key: 'kind', header: 'Kind', render: (r) => r.kind.replace('_', ' ') },
                      { key: 'desc', header: 'Description', render: (r) => r.description },
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
