import type { Metadata } from 'next';
import { requirePageAccess } from '@elevate/server-kit/next';
import {
  Alert,
  AppShell,
  ButtonLink,
  Card,
  DataTable,
  ErrorState,
  FeatureStatusBadge,
  PageHeader,
} from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../lib/shell';
import { platformShell } from '../../server/shell';

export const metadata: Metadata = { title: 'Leadership dashboard' };
export const dynamic = 'force-dynamic';

const SOURCES = [
  {
    contract: 'MarketingSummaryV1',
    owner: 'Marketing OS',
    figures: 'Ideas captured, content approved, posts scheduled and published',
    endpoint: '/marketing/api/internal/v1/summary',
  },
  {
    contract: 'AcademicDeliverySummaryV1',
    owner: 'Academic OS',
    figures: 'Classes delivered, attendance rate, assessments, syllabus completion',
    endpoint: '/academic/api/internal/v1/summary',
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
          level={1}
          title="No access"
          description="The leadership dashboard needs the platform:dashboard:read permission."
        />
      ) : (
        <>
          <PageHeader
            title="Leadership dashboard"
            description="Marketing and Academic figures for leadership, once each source is connected."
            actions={
              <ButtonLink href={PLATFORM_PATHS.home}>Today’s figures on the Overview</ButtonLink>
            }
          />
          <div className="el-stack">
            <Alert tone="info" title="Not connected yet, so no figures are shown">
              <p>
                Marketing OS and Academic OS publish a summary, but this page does not read them
                yet. Until it does, any number here would be invented. When a source cannot be
                reached the page will say so; it never shows zero in place of missing data.
              </p>
              <ul>
                {SOURCES.map((s) => (
                  <li key={s.contract}>
                    <strong>{s.owner}:</strong> {s.figures.toLowerCase()}
                  </li>
                ))}
              </ul>
            </Alert>
            <Card title="Data sources" description="Where each figure will come from.">
              <DataTable
                compact
                columns={[
                  { key: 'owner', header: 'Source' },
                  { key: 'figures', header: 'Figures' },
                  {
                    key: 'endpoint',
                    header: 'Summary',
                    render: (r) => (
                      <div>
                        <code>{r.contract}</code>
                        <div className="el-field-hint">{r.endpoint}</div>
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Connected here',
                    render: () => <FeatureStatusBadge status="Proposed" />,
                  },
                ]}
                rows={SOURCES}
                rowKey={(r) => r.contract}
              />
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}
