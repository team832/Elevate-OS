import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENTS_PAGE_SIZE,
  listTeachingAssignments,
} from '../../../server/hr-assignments';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { options, Pager, SearchPanel } from '../../../ui/list-controls';
import { AssignmentsTable } from './assignments-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching assignments' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/hr/assignments';

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:teaching_assignments:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-assignments">
      <PageHeader
        title="Teaching assignments"
        description={
          <>
            Who teaches which subject to which batch, read from Academic OS. Coordinators change
            assignments in <a href="/academic/teachers">Academic OS → Teachers</a>.
          </>
        }
      />
      <Section>
        <Assignments user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Assignments({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load((db) =>
    listTeachingAssignments(db, user, {
      staffId: sp.staffId || undefined,
      status: (sp.status || undefined) as (typeof ASSIGNMENT_STATUSES)[number] | undefined,
      q: sp.q || undefined,
      page: sp.page,
    }),
  );
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        hidden={sp.staffId ? { staffId: sp.staffId } : undefined}
        search={{ name: 'q', label: 'Teacher, subject or batch', value: sp.q }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            value: sp.status,
            options: options(ASSIGNMENT_STATUSES),
          },
        ]}
      />
      <details className="el-explain">
        <summary>What the statuses mean</summary>
        Active assignments give the teacher their batch and its students in Academic OS. Pending
        means the responsibility is confirmed but no batch exists yet: it opens no students. A
        subject the person can teach (a capability) is not an assignment and grants nothing.
      </details>
      <AssignmentsTable result={r.data} withTeacher />
      {r.data.status === 'available' ? (
        <Pager
          basePath={BASE}
          params={sp}
          page={r.data.data.page}
          pageSize={ASSIGNMENTS_PAGE_SIZE}
          total={r.data.data.total}
        />
      ) : null}
    </div>
  );
}
