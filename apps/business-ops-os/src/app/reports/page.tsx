import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { addDays, istToday } from '../../domain';
import { activitySeries } from '../../server/dashboard';
import { buildAdmissionsFunnel } from '../../server/reports/admissions';
import { fmtPercent } from '../../ui/chart-math';
import { StatCard } from '../../ui/charts';
import { Frame, gate, load, Section } from '../../ui/frame';
import { Segment } from '../../ui/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

/** /ops/reports — a card per report with its headline figure for the last 30 days. */
export default async function ReportsPage() {
  const access = await gate('ops:module:access', '/ops/reports');
  return (
    <Frame access={access} active="reports">
      <PageHeader
        title="Reports"
        description="Each card shows the report's headline figure for the last 30 days (Asia/Kolkata) and opens the full report. Only the reports your role may read are listed."
      />
      {can(access.user, 'ops:admissions:read') ? (
        <Section label="Loading report figures…">
          <AdmissionsCards user={access.user} />
        </Section>
      ) : (
        <EmptyState
          title="No reports for your role"
          description="Ask an operations manager if you need access to a report."
        />
      )}
    </Frame>
  );
}

async function AdmissionsCards({ user }: { user: AuthenticatedUser }) {
  const today = istToday(new Date());
  const [funnel, series] = await Promise.all([
    load((db) => buildAdmissionsFunnel(db, user, { from: addDays(today, -29), to: today })),
    can(user, 'ops:leads:read') ? load((db) => activitySeries(db, user)) : null,
  ]);
  if (!funnel.ok) return funnel.view;
  const d = funnel.data;
  const stage = new Map(d.funnel.map((s) => [s.key, s.count]));
  const decided = d.demoConversion.byProgramme.reduce((n, g) => n + g.decided, 0);
  const converted = d.demoConversion.byProgramme.reduce((n, g) => n + g.converted, 0);
  const trend = (key: 'leadsPerDay' | 'conversionsPerDay') =>
    series?.ok ? series.data[key].map((p) => p.count) : undefined;
  const report = '/ops/reports/admissions';
  return (
    <Segment
      title="Admissions"
      description={`Last 30 days${d.scope === 'own' ? ', only your own leads and admissions' : ''}. Lines show one value per day.`}
    >
      <ul className="el-grid ops-kpis">
        <li>
          <StatCard
            label="Admissions funnel"
            value={stage.get('leads') ?? null}
            note={`Leads received · ${stage.get('converted') ?? 0} converted · ${stage.get('enrolled') ?? 0} enrolled`}
            trend={trend('leadsPerDay')}
            href={`${report}#funnel`}
          />
        </li>
        <li>
          <StatCard
            label="Demo conversion"
            value={decided ? fmtPercent((converted / decided) * 100) : null}
            missingLabel="Not enough data"
            note={`${converted} converted of ${decided} demos with an outcome`}
            trend={trend('conversionsPerDay')}
            href={`${report}#demo-conversion`}
          />
        </li>
        <li>
          <StatCard
            label="Active students"
            value={d.students.active}
            note={`Right now · ${d.students.on_hold} on hold · ${d.students.former} former`}
            href={`${report}#students`}
          />
        </li>
        <li>
          <StatCard
            label="Pipeline and handoff"
            value={series?.ok ? series.data.followUps.overdue : null}
            missingLabel={series === null ? 'Not available for your role' : 'Source unavailable'}
            note="Overdue follow-ups now · enquiries, decisions and Academic OS handoff inside"
            href={`${report}#pipeline`}
          />
        </li>
      </ul>
    </Segment>
  );
}
