import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Select,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { DATE_FORMATS, formatIst, modulePath } from '../../../domain';
import { listAccounts, listMetricImports } from '../../../server';
import { importMetricsAction } from '../../actions/placements';
import { MarketingPage, Section, type SearchParams, METRICS_TABS } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Metrics import' };

export default async function MetricsImportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:metrics:read"
      path={modulePath('metrics/import')}
      active="metrics-import"
      title="Metrics import"
      tabs={METRICS_TABS}
      description="Import an Instagram or YouTube Studio CSV export. Blank cells stay missing, never 0."
      searchParams={await searchParams}
    >
      {(user) => (
        <Section
          load={async () => {
            const db = getDb();
            const accounts = (await listAccounts(db)).filter(
              (a) => a.platform === 'instagram' || a.platform === 'youtube',
            );
            const imports = await listMetricImports(db);
            return (
              <div className="el-stack">
                {can(user, 'marketing:metrics:import') ? (
                  <Card title="Import an export">
                    <Alert tone="info">
                      The file is read on the server and only its numbers are stored (no file is
                      kept). Numbers are “lifetime at capture”: set when the export was taken.
                    </Alert>
                    <form action={importMetricsAction} className="el-stack">
                      <Field id="accountCode" label="Account">
                        <Select id="accountCode" name="accountCode" required>
                          {accounts.map((a) => (
                            <option key={a.code} value={a.code}>
                              {a.code} ({a.platform})
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field id="file" label="CSV file">
                        <TextInput id="file" name="file" type="file" accept=".csv,text/csv" />
                      </Field>
                      <Field id="csv" label="…or paste the CSV">
                        <TextArea id="csv" name="csv" rows={5} />
                      </Field>
                      <Field
                        id="dateFormat"
                        label="Date format used in the export"
                        hint="Check one row by eye: 10/12/2026 is 10 Dec in DD/MM/YYYY and 12 Oct in MM/DD/YYYY."
                      >
                        <Select
                          id="dateFormat"
                          name="dateFormat"
                          required
                          defaultValue="DD/MM/YYYY"
                        >
                          {DATE_FORMATS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        id="capturedAt"
                        label="Export taken at (IST)"
                        hint="Leave empty for now."
                      >
                        <TextInput id="capturedAt" name="capturedAt" type="datetime-local" />
                      </Field>
                      <Checkbox
                        name="dryRun"
                        label="Dry run (preview only, store nothing)"
                        defaultChecked
                      />
                      <div>
                        <Button type="submit">Run import</Button>
                      </div>
                    </form>
                  </Card>
                ) : null}
                <Card title="Recent imports">
                  <DataTable
                    compact
                    rows={imports}
                    rowKey={(r) => r.imp.id}
                    empty={
                      <EmptyState
                        title="No exports imported yet"
                        description="Until an export is imported, every metric for these accounts is missing — not zero."
                      />
                    }
                    columns={[
                      {
                        key: 'when',
                        header: 'Imported',
                        render: (r) => formatIst(r.imp.createdAt),
                      },
                      { key: 'account', header: 'Account', render: (r) => r.accountCode },
                      {
                        key: 'file',
                        header: 'File',
                        render: (r) => `${r.imp.fileName} (${r.imp.format})`,
                      },
                      {
                        key: 'captured',
                        header: 'Captured',
                        render: (r) => formatIst(r.imp.capturedAt),
                      },
                      {
                        key: 'rows',
                        header: 'Rows',
                        render: (r) =>
                          `${r.imp.rowsAccepted} accepted · ${r.imp.rowsRejected} rejected · ${r.imp.rowsSkipped} skipped`,
                      },
                      {
                        key: 'rejected',
                        header: 'Rejected rows',
                        render: (r) => {
                          const list = r.imp.rejected as { rowNumber: number; reasons: string[] }[];
                          return list.length ? (
                            <details>
                              <summary>{list.length}</summary>
                              <ul>
                                {list.map((x) => (
                                  <li key={x.rowNumber}>
                                    row {x.rowNumber}: {x.reasons.join(' ')}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : (
                            '—'
                          );
                        },
                      },
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
