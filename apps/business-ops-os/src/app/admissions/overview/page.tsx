/**
 * Admissions overview (owner brief 21 Oct 2026 §4): first the journey rail and what needs
 * someone now, then the period figures (Asia/Kolkata days, optional programme) for demos,
 * confirmations, conversion, onboarding and fees. Figures open the list they count; "Not enough
 * data" replaces any figure with nothing to count. Fees only with ops:fees:read.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import type { Metric } from '@elevate/shared-contracts';
import { EmptyState, JourneyRail, PageHeader, type JourneyStage } from '@elevate/shared-ui';
import { DEMO_VIEWS } from '../../../domain/demos';
import { FEE_CHARGE_CATEGORIES, FEE_CHARGE_LABELS } from '../../../domain/fees';
import { ONBOARDING_STATUS_LABELS } from '../../../domain/onboarding';
import { buildAdmissionsOverview } from '../../../server/admissions-overview';
import { formOptions } from '../../../server/options';
import { AdmissionsNav } from '../../../ui/admissions-nav';
import { StatCard } from '../../../ui/charts';
import { fmtDate, fmtDateTime, fmtPaise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordTable } from '../../../ui/record-table';
import { DetailTable, Segment } from '../../../ui/sections';
import { programmeName } from '../_components/demo-bits';
import { JOURNEY } from '../_components/journey';
import { periodOf, PeriodFilter } from './period';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admissions overview' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/admissions/overview';
const PROGRAMME = /^[A-Z][A-Z0-9_]{1,39}$/;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:admissions:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="overview">
      <PageHeader
        title="Admissions overview"
        description="Where students are on the way to admission, and what needs someone today."
        tabs={<AdmissionsNav current="overview" user={access.user} />}
      />
      <Section label="Loading the overview…">
        <Overview user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

/** A figure ("Not recorded" when missing, with the reason) and a one-line note. */
function Kpi({ label, m, note, href }: { label: string; m: Metric; note?: string; href?: string }) {
  return (
    <li>
      <StatCard
        label={label}
        value={m.value}
        href={href}
        note={m.status === 'missing' ? m.reason : (note ?? m.window.label)}
      />
    </li>
  );
}

/** Open application steps before signing (the applications list uses the same words). */
const WAITING = [
  ['draft', 'Awaiting information'],
  ['ready_for_review', 'Form to generate'],
  ['form_generated', 'Awaiting signatures'],
] as const;

/** Total of the counts; null when any part is not recorded (never a partial total). */
const total = (ms: readonly Metric[]) =>
  ms.some((m) => m.value === null) ? null : ms.reduce((n, m) => n + (m.value ?? 0), 0);

async function Overview({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const at = periodOf(sp);
  const programme = sp.programme && PROGRAMME.test(sp.programme) ? sp.programme : undefined;
  const r = await load((db) =>
    Promise.all([buildAdmissionsOverview(db, user, { ...at.period, programme }), formOptions(db)]),
  );
  if (!r.ok) return r.view;
  const [o, opts] = r.data;
  const demoList = (patch: Params) => listHref('/ops/admissions', { programme }, patch);
  const apps = (status?: string) =>
    listHref('/ops/admissions/applications', {}, { status, programme });
  const list = o.demos.list;
  const days = o.demos.days;
  const c = o.conversion;
  const waiting = o.applications.awaiting;
  const programmeLabel = programme && programmeName(programme, opts.programmes);
  // Demo is left out (not drawn as 0) when the user cannot read the demo list.
  const stages: JourneyStage[] = [
    ...(list
      ? [
          {
            key: 'demo',
            label: JOURNEY.demo,
            count: list.current,
            note: 'In a demo now',
            href: demoList({ view: 'current' }),
          },
        ]
      : []),
    {
      key: 'application',
      label: JOURNEY.application,
      count: total([waiting.draft, waiting.ready_for_review, waiting.form_generated]),
      note: 'Open, not signed yet',
      href: apps(),
    },
    {
      key: 'signed',
      label: JOURNEY.signed,
      count: waiting.signatures_confirmed.value,
      note: 'Awaiting approval',
      href: apps('signatures_confirmed'),
    },
    {
      key: 'confirmed',
      label: JOURNEY.confirmed,
      count: o.confirmed.metric.value,
      note: o.confirmed.metric.window.label,
      href: '#confirmed',
    },
  ];
  return (
    <div className="el-stack">
      {o.scope === 'own' || programmeLabel || !list ? (
        <p className="el-field-hint">
          {o.scope === 'own' ? 'Only your own leads and admissions. ' : ''}
          {programmeLabel ? `Programme: ${programmeLabel}. ` : ''}
          {list ? '' : 'Current demos and follow-ups need access to leads.'}
        </p>
      ) : null}
      <JourneyRail label="Admission journey: students at each stage" stages={stages} />
      <ul className="el-grid ops-kpis" aria-label="Needs someone now">
        {list ? (
          <li>
            <StatCard
              label="Follow-ups due"
              value={list.followUpsDue}
              note="Due today or overdue"
              href={demoList({
                followUp: 'due',
                view: DEMO_VIEWS.find((v) => list.followUpsDueByView[v] > 0) ?? 'current',
              })}
            />
          </li>
        ) : null}
        {WAITING.map(([s, label]) => (
          <Kpi key={s} label={label} m={waiting[s]} note="Right now" href={apps(s)} />
        ))}
        <li>
          <StatCard
            label="Approval blocked"
            value={o.applications.approvalBlocked}
            note={
              o.applications.approvalChecked < (waiting.signatures_confirmed.value ?? 0)
                ? `Of the ${o.applications.approvalChecked} oldest checked`
                : 'Signed, but an item is missing'
            }
            href={apps('signatures_confirmed')}
          />
        </li>
        <Kpi
          label="Overdue onboarding"
          m={o.onboarding.items}
          note={`Items of ${o.onboarding.admissions} student(s)`}
          href="#overdue-onboarding"
        />
      </ul>

      <PeriodFilter base={BASE} at={at} keep={{ programme }}>
        <div className="el-field">
          <label htmlFor="overview-programme">Programme</label>
          <select
            id="overview-programme"
            name="programme"
            className="el-input"
            defaultValue={programme ?? ''}
          >
            <option value="">All programmes</option>
            {opts.programmes.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </PeriodFilter>

      <div className="ops-panels">
        <Segment title="Demo days" description="Days attended are counted, not classes." flush>
          <DetailTable
            caption="Demo days in the period"
            rows={[
              {
                label: 'Days attended',
                value:
                  days.daysAttended.status === 'missing'
                    ? days.daysAttended.reason
                    : `${days.daysAttended.value} of ${days.plannedDays} planned days`,
              },
              { label: 'Demos with a class in the period', value: days.demos },
              { label: 'Attended every day', value: days.allDaysAttended },
              { label: 'Period', value: days.daysAttended.window.label },
            ]}
          />
        </Segment>

        <Segment
          id="confirmed"
          title="Admissions confirmed"
          description={o.confirmed.metric.definition}
          flush
        >
          <RecordTable
            caption={`${o.confirmed.rows.length} admission(s)`}
            rows={o.confirmed.rows}
            rowKey={(a) => a.admissionNumber}
            rowHref={(a) => `/ops/students/${a.studentId}`}
            linkColumn="student"
            empty={
              <EmptyState
                title="No admission was confirmed in this period"
                description="An approver confirms admissions from applications awaiting approval."
                action={
                  <a href={apps('signatures_confirmed')}>Open applications awaiting approval</a>
                }
              />
            }
            columns={[
              { key: 'student', header: 'Student', render: (a) => a.studentName ?? 'Not linked' },
              { key: 'number', header: 'Admission no.', render: (a) => a.admissionNumber },
              { key: 'programme', header: 'Programme', render: (a) => a.programme ?? 'Not set' },
              { key: 'at', header: 'Confirmed', render: (a) => fmtDateTime(a.approvedAt) },
            ]}
          />
        </Segment>

        <Segment
          title="Demo → admission conversion"
          description={`Demos whose first day is in the period; converted = admission confirmed within ${c.windowDays} days.`}
          flush
        >
          <DetailTable
            caption="Conversion counts"
            rows={[
              {
                label: 'Conversion rate',
                value: c.rate.status === 'missing' ? c.rate.reason : `${c.rate.value} %`,
              },
              { label: 'Converted', value: c.converted },
              { label: 'Demos whose window has ended', value: c.cohort },
              { label: `Inside their ${c.windowDays} days (not counted yet)`, value: c.waiting },
              { label: 'Setting', value: `${c.setting.label} (${c.setting.decisionState})` },
              { label: 'Definition', value: c.rate.definition },
            ]}
          />
        </Segment>

        <Segment
          id="overdue-onboarding"
          title="Overdue onboarding"
          description="Checklist items of current students past their due date and not done."
          flush
        >
          <RecordTable
            caption={`${o.onboarding.rows.length} overdue item(s)`}
            rows={o.onboarding.rows}
            rowKey={(i) => i.id}
            rowHref={(i) => `/ops/students/${i.studentId}?tab=onboarding`}
            empty="Nothing overdue."
            columns={[
              { key: 'student', header: 'Student', render: (i) => i.studentName ?? 'Not linked' },
              { key: 'label', header: 'Item' },
              { key: 'due', header: 'Due', render: (i) => fmtDate(i.dueDate) },
              {
                key: 'status',
                header: 'Status',
                render: (i) => ONBOARDING_STATUS_LABELS[i.status],
              },
            ]}
          />
        </Segment>

        {o.fees ? (
          <Segment
            title="Fees"
            description="Manually recorded figures, not verified payment transactions. Voided and reversed entries never count."
            flush
          >
            <DetailTable
              caption="Fee figures"
              rows={[
                ...FEE_CHARGE_CATEGORIES.map((cat) => ({
                  label: `${FEE_CHARGE_LABELS[cat]} collected`,
                  value: o.fees!.collected
                    ? fmtPaise(o.fees!.collected.byCategory[cat])
                    : 'No fee records yet',
                })),
                {
                  label: 'Total collected (payments minus refunds)',
                  value: o.fees.collected
                    ? fmtPaise(o.fees.collected.netPaise)
                    : 'No fee records yet',
                },
                {
                  label: 'Tuition outstanding now',
                  value: o.fees.outstanding
                    ? `${fmtPaise(o.fees.outstanding.outstandingPaise)} across ${o.fees.outstanding.agreements} agreement(s)`
                    : 'No active fee agreement',
                },
                o.fees.outstanding?.creditPaise
                  ? {
                      label: 'Credit held (recorded above what is owed)',
                      value: fmtPaise(o.fees.outstanding.creditPaise),
                    }
                  : null,
              ]}
            />
          </Segment>
        ) : null}
      </div>
    </div>
  );
}
