import type { AuthenticatedUser } from '@elevate/authentication';
import type { Metric } from '@elevate/shared-contracts';
import { PageHeader, StatTile } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS, PIPELINE_ORDER, type AdmissionStatus } from '../../../domain';
import { buildAdmissionsFunnel, buildAdmissionsReport } from '../../../server/reports/admissions';
import { BarChart } from '../../../ui/charts';
import { fmtDate, fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { Segment } from '../../../ui/sections';
import { periodOf, PeriodFilter, type Period } from '../../admissions/overview/period';
import {
  ConversionBreakdown,
  Funnel,
  FunnelTable,
  OutcomeDonut,
  StudentSummary,
} from '../_components/admissions-charts';

export const dynamic = 'force-dynamic';

const BASE = '/ops/reports/admissions';

export default async function AdmissionsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:admissions:read', BASE);
  const at = periodOf(await searchParams);
  const { period } = at;
  return (
    <Frame access={access} active="reports">
      <PageHeader
        title="Admissions report"
        description="Funnel, demo conversion and students, then pipeline figures, from the admissions records in Business Ops. Dates are Asia/Kolkata. A rate with nothing to divide by shows “Not enough data”, never 0 %. No targets are set yet (an owner decision)."
      />
      <PeriodFilter base={BASE} at={at} />
      <Section label="Loading the funnel…">
        <FunnelSections user={access.user} period={period} />
      </Section>
      <Section label="Loading the pipeline figures…">
        <PipelineSections user={access.user} period={period} />
      </Section>
    </Frame>
  );
}

async function FunnelSections({ user, period }: { user: AuthenticatedUser; period: Period }) {
  const r = await load((db) => buildAdmissionsFunnel(db, user, period));
  if (!r.ok) return r.view;
  const d = r.data;
  const c = d.demoConversion;
  const ownNote = d.scope === 'own' ? ' Only your own leads.' : '';
  return (
    <>
      <Segment
        id="funnel"
        title="Admissions funnel"
        description={`Leads first received in the period.${ownNote} A lead counts at a stage only if it also reached the stage it is measured against. Admissions made without a demo are not in this funnel.`}
      >
        <div className="ops-panels">
          <Funnel report={d} />
          <FunnelTable report={d} />
        </div>
      </Segment>
      <div id="demo-conversion" className="ops-panels">
        <Segment
          title="Demos by outcome"
          description={`${c.total} demo(s) with a class in the period.${ownNote}`}
        >
          <OutcomeDonut report={d} />
        </Segment>
        <Segment
          title="Conversion by programme"
          description="Converted ÷ demos with an outcome; open demos are not counted against anyone."
        >
          <ConversionBreakdown
            title="By programme"
            rows={c.byProgramme}
            window={d.window}
            filter={(g) => (g.programmeCode ? { programme: g.programmeCode } : null)}
          />
        </Segment>
        <Segment
          title="Conversion by counsellor"
          description="The demo's counsellor. A capacity and follow-up view, not a ranking."
        >
          <ConversionBreakdown
            title="By counsellor"
            rows={c.byCounsellor}
            window={d.window}
            filter={(g) => (g.counsellorId ? { counsellor: g.counsellorId } : null)}
          />
        </Segment>
        <Segment title="Conversion by first source and campaign">
          {c.bySource ? (
            <ConversionBreakdown
              title="By first source and campaign"
              rows={c.bySource}
              window={d.window}
            />
          ) : (
            <p className="el-field-hint">
              Not available for your role: source and campaign need Marketing attribution access.
            </p>
          )}
        </Segment>
      </div>
      <Segment
        id="students"
        title="Students right now"
        description="Admitted students with a student record; a student with several admissions counts once. Not limited to the period."
      >
        <div className="ops-panels">
          <StudentSummary students={d.students} />
        </div>
      </Segment>
    </>
  );
}

function Tiles({ tiles }: { tiles: [string, Metric][] }) {
  return (
    <div className="el-grid">
      {tiles.map(([label, metric]) => (
        <StatTile key={label} label={label} metric={metric} />
      ))}
    </div>
  );
}

async function PipelineSections({ user, period }: { user: AuthenticatedUser; period: Period }) {
  const r = await load((db) => buildAdmissionsReport(db, user, period));
  if (!r.ok) return r.view;
  const d = r.data;
  const k = d.kpis;
  const statuses: AdmissionStatus[] = [...PIPELINE_ORDER, 'on_hold', 'lost'];
  return (
    <>
      <Segment
        id="pipeline"
        title="Enquiries and pipeline"
        description={`As of ${fmtDateTime(d.asOf)}${d.scope === 'own' ? ' · only your own leads and admissions' : ''}.`}
      >
        <Tiles
          tiles={[
            ['New enquiries', k.newEnquiries],
            ['Counselling sessions coming up', k.counselling.upcoming],
            ['Past sessions without an outcome', k.counselling.pastUnrecorded],
            ['Demos in the next 7 days', k.upcomingDemos],
            ['Applications awaiting a decision', k.decisions.awaitingDecision],
            ['Fee approvals waiting for an approver', k.decisions.awaitingApproval],
            ['Offers awaiting the family', k.decisions.offersAwaitingResponse],
            ['Overdue follow-ups', k.overdueFollowUps],
          ]}
        />
      </Segment>
      <div className="ops-panels">
        <Segment
          title="Lead → admission conversion"
          description={`Cohort ${fmtDate(d.cohort.from)} – ${fmtDate(d.cohort.to)}, ${d.cohort.windowDays}-day window (setting ${d.cohort.setting.decisionState}). Not tied to the period above.`}
        >
          <Tiles tiles={[['Lead → admission conversion', k.conversion]]} />
        </Segment>
        <Segment
          title="Enrolment handoff to Academic OS"
          description="Requests published in the period and what happened to them."
        >
          <Tiles
            tiles={[
              ['Requests sent', k.handoff.requested],
              ['Confirmed by Academic OS', k.handoff.confirmed],
              ['Rejected by Academic OS', k.handoff.rejected],
              ['Failed after all retries', k.handoff.failed],
              ['Still waiting', k.handoff.awaiting],
              ['Handoff success rate', k.handoff.successRate],
            ]}
          />
        </Segment>
        <Segment title="New leads by first source" description="First enquiry in the period.">
          <BarChart
            label="New leads by first source"
            data={d.bySource.map((s) => ({ label: s.label, value: s.count }))}
            emptyText="No new leads in this period."
          />
        </Segment>
        <Segment
          title="Admission cases by status"
          description="Right now; merged duplicates excluded."
        >
          <BarChart
            label="Admission cases by status"
            data={statuses.map((s) => ({
              label: ADMISSION_STATUS_LABELS[s],
              value: d.byStatus[s],
            }))}
            emptyText="No admission cases yet."
          />
        </Segment>
        <Segment title="Closed cases by reason" description="Cases closed as lost in the period.">
          <BarChart
            label="Closed cases by reason"
            data={d.closures.map((c) => ({ label: c.label, value: c.count }))}
            emptyText="No cases closed in this period."
          />
        </Segment>
      </div>
    </>
  );
}
