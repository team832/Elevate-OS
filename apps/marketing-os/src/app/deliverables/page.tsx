import type { Metadata } from 'next';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { listTasks, taskListQuery } from '@elevate/business-ops-os/work';
import { Card } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { myContentItems, myStaffId } from '../../server';
import { ContentDeliverables, PageLinks, TaskDeliverables } from '../../ui/my-work';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Deliverables' };

const PATH = modulePath('deliverables');
const pageOf = (v: string | undefined) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1);

export default async function DeliverablesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pages = { tp: String(pageOf(param(sp, 'tp'))), cp: String(pageOf(param(sp, 'cp'))) };
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={PATH}
      active="deliverables"
      title="Deliverables"
      description="What you owe from your tasks and the content you work on. Approved and published externally are separate: approving never publishes or sends anything."
      searchParams={sp}
    >
      {(user) => <Section load={async () => <Deliverables user={user} pages={pages} />} />}
    </MarketingPage>
  );
}

async function Deliverables({
  user,
  pages,
}: {
  user: AuthenticatedUser;
  pages: { tp: string; cp: string };
}) {
  const db = getDb();
  const staffId = await myStaffId(db, user.id);
  const tasks =
    staffId && can(user, 'ops:tasks:read')
      ? await listTasks(db, user, taskListQuery.parse({ staffId, page: pages.tp }))
      : null;
  const content = await myContentItems(db, user, Number(pages.cp));
  return (
    <div className="el-stack">
      <details className="el-explain">
        <summary>How this list is defined</summary>
        From tasks: every task assigned to you; open one to attach previews, source files or copy
        documents and submit it. Approved comes from the task review. From content: items you
        created or are assigned to (writer, designer, editor, presenter). Approved comes from the
        content review; published externally only from the publish step with a live link.
      </details>
      <Card title="From my tasks" actions={<a href={modulePath('tasks')}>My tasks</a>}>
        {tasks ? (
          <>
            <TaskDeliverables rows={tasks.rows} />
            <PageLinks path={PATH} name="tp" params={pages} {...tasks} />
          </>
        ) : (
          <p>
            Your account is not linked to a staff record, so you have no tasks of your own. Staff
            records are linked by HR in the Staff directory.
          </p>
        )}
      </Card>
      <Card title="Content I work on">
        <ContentDeliverables rows={content.rows} />
        <PageLinks path={PATH} name="cp" params={pages} {...content} />
      </Card>
    </div>
  );
}
