import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { getCourse } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { PlanBadge, StateBadge, programmeName } from '../../../../ui/badges';
import { CourseChapters } from '../../../../ui/course-chapters';
import { AcademicShell, LoadError, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Course' };

/** One course: its subjects, chapters and chapter weights, and its plan versions. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:courses:read', MODULE_PATHS.course(id));
  if (access.status !== 'allowed')
    return (
      <AcademicShell access={access} active="curriculum">
        {null}
      </AcademicShell>
    );
  const data = await load(() => getCourse(getDb(), id));
  if (!data.ok)
    return (
      <AcademicShell access={access} active="curriculum">
        <LoadError level={1} error={data.error} />
      </AcademicShell>
    );
  const c = data.data;
  return (
    <AcademicShell access={access} active="curriculum">
      <PageHeader
        title={`${c.code} — ${c.name}`}
        description={`${programmeName(c.programmeCode)} · version ${c.version}. Weight is a chapter's relative importance for catch-up priority, 1 to 10; 1 means unweighted.`}
        meta={<StateBadge state={c.status} />}
        actions={<ButtonLink href={MODULE_PATHS.curriculum}>All courses</ButtonLink>}
      />
      <div className="el-stack">
        <CourseChapters subjects={c.subjects} chapters={c.chapters} />
        <Card title="Plan versions">
          <DataTable
            compact
            caption="Plan versions of this course"
            rows={c.plans}
            rowKey={(p) => p.id}
            empty={<EmptyState title="No plan versions yet" />}
            columns={[
              {
                key: 'code',
                header: 'Plan',
                render: (p) => <a href={MODULE_PATHS.plan(p.id)}>{p.code}</a>,
              },
              { key: 'title', header: 'Title' },
              { key: 'status', header: 'Status', render: (p) => <PlanBadge status={p.status} /> },
            ]}
          />
        </Card>
      </div>
    </AcademicShell>
  );
}
