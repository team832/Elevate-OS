import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { AdmissionsNav } from '../../ui/admissions-nav';
import { Frame, gate, Section } from '../../ui/frame';
import { ActiveDashboard } from './_components/student-dashboard';
import {
  listHref,
  STUDENT_COLUMNS as C,
  StudentListSection,
  StudentQuickView,
  StudentSearch,
} from './_components/student-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Active students' };

const BASE = '/ops/students';

/**
 * Active students, one row per student: any case admitted, awaiting or in enrolment (brief
 * §11). `?view=on_hold` lists students on hold instead (they are not past students).
 */
export default async function ActiveStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:students:read', BASE);
  const { open, ...params } = await searchParams;
  const held = params.view === 'on_hold';
  const filtered = Object.entries(params).some(
    ([k, v]) => v && !['page', 'sort', 'view'].includes(k),
  );
  return (
    <Frame access={access} active="students">
      <PageHeader
        title="Active students"
        description="Students with a confirmed admission."
        tabs={<AdmissionsNav current="active" user={access.user} />}
      />
      <div className="el-stack">
        <details className="el-explain">
          <summary>How this list is defined</summary>
          <p>
            Enrolled students, and students whose admission is confirmed but who are still awaiting
            Academic setup. A student who finished one programme but still studies another stays
            here. Students on hold are under On hold; students who have left are under Past
            students. Class 11 and Class 12 count students alone or with an entrance programme;
            Dropper counts students with one entrance programme.
          </p>
          <p>
            Teachers, latest test and class attendance come from Academic OS, which cannot be read
            per student yet. They are left out here rather than shown as zero; each student&apos;s
            record says &ldquo;Source unavailable&rdquo;.
          </p>
        </details>
        <Section label="Loading summary…">
          <ActiveDashboard user={access.user} base={BASE} params={params} />
        </Section>
        <Section label="Loading filters…">
          <StudentSearch
            basePath={BASE}
            params={params}
            user={access.user}
            extra={[
              {
                name: 'view',
                label: 'Lifecycle',
                type: 'select',
                anyLabel: 'Active',
                options: [{ value: 'on_hold', label: 'On hold' }],
                value: params.view,
              },
            ]}
          />
        </Section>
        <Section label="Loading students…">
          <StudentListSection
            user={access.user}
            basePath={BASE}
            params={params}
            view={held ? 'on_hold' : 'active'}
            columns={
              held
                ? [C.student, C.number, C.programmes, C.review, C.reason, C.since, C.counsellor]
                : [
                    C.student,
                    C.number,
                    C.programmes,
                    C.status,
                    C.fees,
                    C.next,
                    C.activity,
                    C.counsellor,
                  ]
            }
            empty={
              <EmptyState
                title={
                  filtered
                    ? 'No students match'
                    : held
                      ? 'No students on hold'
                      : 'No active students yet'
                }
                description={
                  filtered
                    ? 'Change or clear the filters.'
                    : held
                      ? 'Put an enrolled student on hold from their record (reason and review date).'
                      : 'A student appears here once their admission is confirmed.'
                }
                action={
                  filtered ? (
                    <a href={BASE}>Clear filters</a>
                  ) : (
                    <a href="/ops/admissions">Open demo students</a>
                  )
                }
              />
            }
          />
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
