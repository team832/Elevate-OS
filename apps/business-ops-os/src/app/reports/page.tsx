import { can, type Permission } from '@elevate/authorization';
import { Card, EmptyState, PageHeader } from '@elevate/shared-ui';
import { Frame, gate } from '../../ui/frame';

export const dynamic = 'force-dynamic';

/**
 * `available: false` = the report page is not built yet: listed without a link.
 * Flip HR to true when src/app/reports/hr/page.tsx exists (orchestrator).
 */
const REPORTS: {
  href: string;
  title: string;
  description: string;
  permission: Permission;
  available: boolean;
}[] = [
  {
    href: '/ops/reports/admissions',
    title: 'Admissions report',
    description: 'Leads, pipeline, follow-ups and admissions administration.',
    permission: 'ops:admissions:read',
    available: true,
  },
  {
    href: '/ops/reports/hr',
    title: 'HR report',
    description: 'Headcount, attendance, leave and lifecycle figures.',
    permission: 'ops:hr_reports:read',
    available: false,
  },
  {
    href: '/ops/reports/operations',
    title: 'Operations report',
    description:
      'Tasks and capacity, SOP approvals and acknowledgements, incidents, blocked projects, deadlines and integration errors.',
    permission: 'ops:dashboard:read',
    available: true,
  },
];

/** /ops/reports — the reports this user may open (each link needs its own permission). */
export default async function ReportsPage() {
  const access = await gate('ops:module:access', '/ops/reports');
  const visible = REPORTS.filter((r) => can(access.user, r.permission));
  return (
    <Frame access={access} active="reports">
      <PageHeader title="Reports" description="Only the reports your role may read are listed." />
      {visible.length ? (
        <div className="el-grid">
          {visible.map((r) => (
            <Card key={r.href} title={r.title} description={r.description}>
              {r.available ? (
                <a href={r.href}>Open the {r.title.toLowerCase()}</a>
              ) : (
                <p className="el-field-hint">
                  Not available yet: this report is still being built.
                </p>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No reports for your role"
          description="Ask an operations manager if you need access to a report."
        />
      )}
    </Frame>
  );
}
