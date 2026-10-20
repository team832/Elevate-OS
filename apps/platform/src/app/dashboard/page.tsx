import type { Metadata } from 'next';
import { requirePageAccess } from '@elevate/server-kit/next';
import {
  Alert,
  AppShell,
  Card,
  DataTable,
  ErrorState,
  PageHeader,
  StatusBadge,
} from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../lib/shell';
import { platformShell } from '../../server/shell';

export const metadata: Metadata = { title: 'Leadership dashboard' };
export const dynamic = 'force-dynamic';

const SOURCES = [
  {
    contract: 'MarketingSummaryV1',
    owner: 'Marketing OS',
    endpoint: '/marketing/api/internal/v1/summary',
    state:
      'Not built yet — wave 2 (Marketing) builds the endpoint, wave 3 (Integration) connects it here.',
  },
  {
    contract: 'AcademicDeliverySummaryV1',
    owner: 'Academic OS',
    endpoint: '/academic/api/internal/v1/summary',
    state:
      'Not built yet — wave 2 (Academic) builds the endpoint, wave 3 (Integration) connects it here.',
  },
];

export default async function DashboardPage() {
  const access = await requirePageAccess('platform:dashboard:read', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: PLATFORM_PATHS.dashboard,
  });
  const extras = await platformShell(access.user, 'dashboard');
  return (
    <AppShell
      user={access.user}
      modules={access.modules}
      current="platform"
      logoutAction={PLATFORM_PATHS.logoutApi}
      {...extras}
    >
      {access.status === 'forbidden' ? (
        <ErrorState
          title="No access"
          description="The leadership dashboard needs the platform:dashboard:read permission."
        />
      ) : (
        <div className="el-stack">
          <PageHeader
            title="Leadership dashboard"
            description="Consolidated view across Marketing OS, Academic OS and Business Ops OS."
          />
          <Alert tone="info" title="Consolidated reporting arrives in the integration wave">
            No figures are shown here yet, on purpose. This page will display the modules’ summary
            contracts once they exist; until then any number would be invented. When a source is
            unreachable the dashboard will say “source unavailable” — it will never show zero in
            place of missing data.
          </Alert>
          <Card title="Planned data sources">
            <DataTable
              columns={[
                { key: 'contract', header: 'Contract', render: (r) => <code>{r.contract}</code> },
                { key: 'owner', header: 'Owner' },
                { key: 'endpoint', header: 'Endpoint', render: (r) => <code>{r.endpoint}</code> },
                {
                  key: 'status',
                  header: 'Status',
                  render: () => <StatusBadge tone="neutral">Proposed</StatusBadge>,
                },
                { key: 'state', header: 'Notes' },
              ]}
              rows={SOURCES}
              rowKey={(r) => r.contract}
            />
          </Card>
        </div>
      )}
    </AppShell>
  );
}
