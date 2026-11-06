import type { Metadata } from 'next';
import type { AuthenticatedUser } from '@elevate/authentication';
import { LINK_LOGIN_HELP } from '@elevate/shared-contracts';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { listTasks, taskListQuery } from '@elevate/business-ops-os/work';
import { Card } from '@elevate/shared-ui';
import { CONTENT_STATES, modulePath, type ContentState } from '../../domain';
import { myContentItems, myStaffId, teamWide } from '../../server';
import { ContentDeliverables, PageLinks, TaskDeliverables } from '../../ui/my-work';
import { MarketingPage, Section, param, type SearchParams } from '../../ui/shell';
import { TeamDeliverables } from './team-deliverables';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Content and deliverables' };

const PATH = modulePath('deliverables');
const pageOf = (v: string | undefined) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1);

export default async function DeliverablesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pages = { tp: String(pageOf(param(sp, 'tp'))), cp: String(pageOf(param(sp, 'cp'))) };
  const state = CONTENT_STATES.find((s) => s === param(sp, 'content'));
  return (
    <MarketingPage
      permission="marketing:module:access"
      path={PATH}
      active="deliverables"
      title="Content and deliverables"
      description="What is owed from tasks, content and the calendar. Approved and published externally are separate: approving never publishes or sends anything."
      searchParams={sp}
    >
      {(user) => (
        <>
          {teamWide(user) ? (
            <Section
              load={async () => (
                <TeamDeliverables
                  db={getDb()}
                  sp={Object.fromEntries(
                    ['from', 'to', 'owner', 'status', 'campaign'].map((k) => [k, param(sp, k)]),
                  )}
                />
              )}
            />
          ) : null}
          <Section load={async () => <Deliverables user={user} pages={pages} state={state} />} />
        </>
      )}
    </MarketingPage>
  );
}

async function Deliverables({
  user,
  pages,
  state,
}: {
  user: AuthenticatedUser;
  pages: { tp: string; cp: string };
  /** Only content in this state (the My day tile). */
  state: ContentState | undefined;
}) {
  const db = getDb();
  const staffId = await myStaffId(db, user.id);
  const tasks =
    staffId && can(user, 'ops:tasks:read')
      ? await listTasks(db, user, taskListQuery.parse({ staffId, page: pages.tp }))
      : null;
  const content = await myContentItems(db, user, Number(pages.cp), state);
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
            <PageLinks
              path={PATH}
              name="tp"
              params={state ? { ...pages, content: state } : pages}
              {...tasks}
            />
          </>
        ) : (
          <p>
            Your account is not linked to a staff record, so you have no tasks of your own.{' '}
            {LINK_LOGIN_HELP}
          </p>
        )}
      </Card>
      <Card
        id="my-content"
        title={state ? `Content I work on: ${state.replace(/_/g, ' ')}` : 'Content I work on'}
        actions={state ? <a href={`${PATH}#my-content`}>Show all my content</a> : undefined}
      >
        <ContentDeliverables rows={content.rows} />
        <PageLinks
          path={PATH}
          name="cp"
          params={state ? { ...pages, content: state } : pages}
          {...content}
        />
      </Card>
    </div>
  );
}
