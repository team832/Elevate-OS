import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { listTasks } from '../../../server/staff-tasks';
import { formOptions } from '../../../server/options';
import { taskDetail } from '../../../server/task-detail';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  AckBadge,
  TaskActions,
  TaskDependencies,
  TaskFacts,
  TaskHistory,
  TaskReport,
  WaitingAlert,
  WorkUpdates,
} from '../_components/task-detail';
import { BASE, dueLabel, TaskBadge } from '../_components/task-views';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:tasks:read', `${BASE}/${id}`);
  return (
    <Frame access={access} active="tasks">
      <Section>
        <TaskView user={access.user} id={id} />
      </Section>
    </Frame>
  );
}

async function TaskView({ user, id }: { user: AuthenticatedUser; id: string }) {
  const r = await load(async (db) => {
    const d = await taskDetail(db, user, id);
    const [options, open] = await Promise.all([
      d.canEdit ? formOptions(db) : null,
      // shortcut: the 100 newest tasks in scope as dependency choices; add a search when lists grow.
      d.canEdit ? listTasks(db, user, { page: 1 }, 100) : null,
    ]);
    return { d, staff: options?.staff ?? [], open: open?.rows ?? [] };
  });
  if (!r.ok) return r.view;
  const { d, staff, open } = r.data;
  const candidates = open
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .map((t) => ({ value: t.id, label: `${t.title} (${t.staffName})` }));
  return (
    <div className="el-stack">
      <PageHeader
        title={d.title}
        meta={
          <>
            <TaskBadge status={d.status} />
            <AckBadge at={d.acknowledgedAt} />
            {d.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
          </>
        }
        description={
          <>
            {d.staffName ?? 'No owner'} · {dueLabel(d, new Date())} · received{' '}
            {fmtDateTime(d.receivedAt)} · <a href={`${BASE}?tab=all`}>Task tracker</a>
          </>
        }
      />
      <WaitingAlert d={d} />
      <TaskActions d={d} staff={staff} />
      <TaskFacts d={d} />
      <TaskDependencies d={d} candidates={candidates} />
      <WorkUpdates d={d} />
      <TaskReport d={d} />
      <TaskHistory d={d} />
    </div>
  );
}
