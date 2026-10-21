import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import { namesOf } from '../../../server/admissions';
import { listDemos } from '../../../server/demos';
import { listStudents } from '../../../server/students';
import { AdmissionsNav } from '../../../ui/admissions-nav';
import { fmtDateTime, humanise } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { PAST_OUTCOME_LABELS, PAST_OUTCOMES } from '../../../domain/student-lifecycle';
import { RecordTable } from '../../../ui/record-table';
import { PastSummary } from '../_components/student-dashboard';
import {
  listHref,
  parseQuery,
  STUDENT_COLUMNS as C,
  StudentListSection,
  StudentQuickView,
  StudentSearch,
} from '../_components/student-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Past students' };

const BASE = '/ops/students/past';
const TABS = [
  { key: 'former', label: 'Former students' },
  { key: 'demos', label: 'Past demos (never enrolled)' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const CLOSED_WITHOUT_CONVERSION = ['declined', 'withdrawn', 'not_converted', 'cancelled'] as const;

/**
 * Past students (brief §11): students with an exit and no active case, one row each, filtered
 * by outcome; and demos that never converted. Students on hold are under Active (filter).
 */
export default async function PastStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:students:read', BASE);
  const { open, ...params } = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === params.tab)?.key ?? 'former';
  return (
    <Frame access={access} active="past">
      <PageHeader
        title="Past students"
        description="Former students, and demos that never became admissions."
        tabs={<AdmissionsNav current="past" user={access.user} />}
      />
      <div className="el-stack">
        <details className="el-explain">
          <summary>How this list is defined</summary>
          <p>
            Left means withdrawn early, completed or another exit. A student still studying another
            programme stays under Active students. Each past student keeps their exit record and
            full history; nothing is deleted. Demo students who never enrolled are under Past demos.
          </p>
        </details>
        <Section label="Loading…">
          <PastTabs user={access.user} params={{ ...params, tab }} tab={tab} />
        </Section>
      </div>
      {open ? (
        <Section label="Loading student…">
          <StudentQuickView user={access.user} id={open} closeHref={listHref(BASE, params)} />
        </Section>
      ) : null}
    </Frame>
  );
}

/** Demos closed without conversion (all four outcomes), with who closed them. */
const pastDemos = (user: AuthenticatedUser) =>
  load(async (db) => {
    const lists = await Promise.all(
      CLOSED_WITHOUT_CONVERSION.map((outcome) =>
        listDemos(db, user, { view: 'previous', outcome }),
      ),
    );
    const rows = lists.flatMap((l) => l.rows);
    return {
      total: lists.reduce((n, l) => n + l.total, 0),
      rows,
      names: await namesOf(
        db,
        rows.map((d) => d.demo.outcomeBy),
      ),
    };
  });

async function PastTabs({
  user,
  params,
  tab,
}: {
  user: AuthenticatedUser;
  params: Record<string, string | undefined>;
  tab: Tab;
}) {
  // Tab counts come from the same queries as the rows (filters applied).
  const [former, demos] = await Promise.all([
    load(
      async (db) => (await listStudents(db, user, parseQuery(params, 'former', user).query)).total,
    ),
    pastDemos(user),
  ]);
  const counts: Record<Tab, number | null> = {
    former: former.ok ? former.data : null,
    demos: demos.ok ? demos.data.total : null,
  };
  return (
    <Tabs
      idBase="past"
      label="Past students"
      selected={tab}
      items={TABS.map((t) => ({
        key: t.key,
        label: t.label,
        href: listHref(BASE, { tab: t.key }),
        count: counts[t.key],
      }))}
    >
      {tab === 'former' ? (
        <div className="el-stack">
          <PastSummary user={user} base={BASE} params={params} />
          <StudentSearch
            basePath={BASE}
            params={params}
            user={user}
            hidden={{ tab }}
            extra={[
              {
                name: 'outcome',
                label: 'Outcome',
                type: 'select',
                options: PAST_OUTCOMES.map((o) => ({ value: o, label: PAST_OUTCOME_LABELS[o] })),
                value: params.outcome,
              },
            ]}
          />
          <StudentListSection
            user={user}
            basePath={BASE}
            params={params}
            view="former"
            columns={[C.student, C.number, C.programmes, C.exit, C.reason, C.counsellor]}
            empty={
              <EmptyState
                title="No past students"
                description="Record an exit (withdrawn early, completed, transferred …) from a student’s record. Students still active in another programme are not listed here."
              />
            }
          />
        </div>
      ) : demos.ok ? (
        <>
          <RecordTable
            caption={`${demos.data.total} demo(s) closed without conversion`}
            rows={demos.data.rows}
            rowKey={(d) => d.demo.id}
            rowHref={(d) => `/ops/admissions/demos/${d.demo.id}`}
            linkColumn="name"
            empty={
              <EmptyState
                title="No past demos"
                description="Demos closed as declined, withdrawn, not converted or cancelled appear here."
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Demo student',
                render: (d) => (
                  <>
                    {d.studentName}
                    {d.demo.isSample ? (
                      <span className="el-badge el-badge-sample">Sample data</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'programme',
                header: 'Programme',
                render: (d) => d.programmeName ?? 'Not set',
              },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (d) => <StatusBadge tone="neutral">{humanise(d.demo.outcome)}</StatusBadge>,
              },
              {
                key: 'reason',
                header: 'Reason',
                render: (d) => d.demo.outcomeReason ?? 'Not recorded',
              },
              { key: 'attended', header: 'Attendance', render: (d) => d.progress.label },
              {
                key: 'when',
                header: 'Closed',
                render: (d) =>
                  `${fmtDateTime(d.demo.outcomeAt)} by ${(d.demo.outcomeBy && demos.data.names.get(d.demo.outcomeBy)) || 'not recorded'}`,
              },
              { key: 'by', header: 'Counsellor', render: (d) => d.counsellorName ?? 'Unassigned' },
            ]}
          />
          {demos.data.rows.length < demos.data.total ? (
            <p>
              <a href="/ops/admissions?view=previous">See every previous demo</a>
            </p>
          ) : null}
        </>
      ) : (
        demos.view
      )}
    </Tabs>
  );
}
