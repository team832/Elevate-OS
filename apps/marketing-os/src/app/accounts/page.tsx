import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { formatIst, modulePath } from '../../domain';
import { listAccounts, listLegacyConflicts } from '../../server';
import { verifyAccountAction } from '../actions/ideas';
import { IntegrationBadge, ProposedBadge } from '../../ui/badges';
import { MarketingPage, Section, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:accounts:read"
      path={modulePath('accounts')}
      active="accounts"
      title="Social accounts"
      description="The account registry (MKT-001). Handles are shown only when confirmed — never guessed. Integration status changes only through an adapter check."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const [accounts, conflicts] = [await listAccounts(db), await listLegacyConflicts(db)];
            const manage = can(user, 'marketing:accounts:manage');
            if (accounts.length === 0) {
              return (
                <EmptyState
                  title="No accounts yet"
                  description="Run `npm run db:seed` to import the legacy registry."
                />
              );
            }
            return (
              <div className="el-stack">
                {conflicts.map((c) => (
                  <Alert
                    key={c.id}
                    tone="warning"
                    title={`${c.code} — ${c.title} (${c.ownerDecision}, ${c.status})`}
                  >
                    {c.description} Other model lists:{' '}
                    {(
                      (c.details as { accountsInOtherModel?: string[] } | null)
                        ?.accountsInOtherModel ?? []
                    ).join(', ')}
                    . The registry below follows the approved 9-account model plus IGN (later);
                    nothing from the other model is created until the owner decides.
                  </Alert>
                ))}
                <DataTable
                  caption={`${accounts.length} accounts`}
                  rows={accounts}
                  rowKey={(a) => a.id}
                  columns={[
                    { key: 'code', header: 'Code', render: (a) => <strong>{a.code}</strong> },
                    { key: 'platform', header: 'Platform', render: (a) => a.platform },
                    {
                      key: 'name',
                      header: 'Name / handle',
                      render: (a) => (
                        <>
                          {a.displayName ?? (
                            <span className="el-field-hint">
                              name not confirmed
                              {a.proposedDisplayName ? ` (proposed: ${a.proposedDisplayName})` : ''}
                            </span>
                          )}
                          <br />
                          {a.handle ?? (
                            <span className="el-field-hint">
                              handle {a.handleStatus.replaceAll('_', ' ')}
                              {a.proposedHandle ? ` (proposed: ${a.proposedHandle})` : ''}
                            </span>
                          )}
                        </>
                      ),
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (a) => (
                        <StatusBadge tone={a.status === 'live' ? 'success' : 'neutral'}>
                          {a.status}
                        </StatusBadge>
                      ),
                    },
                    {
                      key: 'scope',
                      header: 'Scope',
                      render: (a) =>
                        `${a.scope}${a.examPrefixes.length ? ` (${a.examPrefixes.join(', ')})` : ''}`,
                    },
                    {
                      key: 'owner',
                      header: 'Owner',
                      render: (a) =>
                        a.ownerName ?? <span className="el-field-hint">not assigned (OD-009)</span>,
                    },
                    {
                      key: 'cadence',
                      header: 'Cadence',
                      render: (a) => (
                        <>
                          {a.cadenceText ?? '—'}
                          <br />
                          <span className="el-field-hint">
                            limit {a.cadenceMaxPerDay ?? '–'}/day · {a.cadenceMaxPerWeek ?? '–'}
                            /week · {a.cadenceEnforcement}
                          </span>{' '}
                          <ProposedBadge status={a.cadenceStatus} />
                        </>
                      ),
                    },
                    {
                      key: 'integration',
                      header: 'Integration',
                      render: (a) => (
                        <>
                          <IntegrationBadge status={a.integrationStatus} />
                          {a.integrationCheckedAt ? (
                            <div className="el-field-hint">
                              checked {formatIst(a.integrationCheckedAt)}
                            </div>
                          ) : null}
                          {manage ? (
                            <form action={verifyAccountAction}>
                              <input type="hidden" name="accountId" value={a.id} />
                              <Button type="submit" variant="ghost">
                                Check adapter
                              </Button>
                            </form>
                          ) : null}
                        </>
                      ),
                    },
                    {
                      key: 'rules',
                      header: 'Content rules',
                      render: (a) => (
                        <details>
                          <summary>{a.contentRules.length} rules</summary>
                          <ul>
                            {a.contentRules.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                          {a.notes.length ? (
                            <p className="el-field-hint">{a.notes.join(' ')}</p>
                          ) : null}
                        </details>
                      ),
                    },
                  ]}
                />
                <Card title="API">
                  <p className="el-field-hint">
                    Managers can change owner, confirmed handle and cadence with PATCH
                    /marketing/api/v1/accounts/:id.
                  </p>
                </Card>
              </div>
            );
          }}
        />
      )}
    </MarketingPage>
  );
}
