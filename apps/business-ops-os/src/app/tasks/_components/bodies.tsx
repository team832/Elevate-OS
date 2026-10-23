/**
 * Task and EOD page bodies, shared by every workspace that shows them (D-073): the host page
 * checks access and renders its own shell, then this body with its basePath (`base`), which
 * every link, form action and redirect inside is built from.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, PageHeader } from '@elevate/shared-ui';
import { hasInbox } from '../../../server/eod-review';
import { listTasks } from '../../../server/staff-tasks';
import { formOptions } from '../../../server/options';
import { taskDetail } from '../../../server/task-detail';
import { fmtDateTime } from '../../../ui/format';
import { load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import '../../ops.css';
import { TasksNav, type TasksArea } from './eod-nav';
import { EodReport } from './eod-views';
import { AckBadge, TaskActions, TaskDependencies, TaskFacts, WaitingAlert } from './task-detail';
import { listAttachments } from '../../../server/attachments';
import { TaskHistory, TaskReport } from './task-history';
import { AllTasks, dueLabel, MyDay, TaskBadge, taskPaths, type Params } from './task-views';
import {
  Checklist,
  Discussion,
  Submissions,
  SubmitWork,
  TaskFiles,
  WorkUpdates,
} from './task-work';

export interface BodyProps {
  user: AuthenticatedUser;
  /** The host app's browser basePath: '/ops', '/academic' or '/marketing'. */
  base: string;
  searchParams: Params;
}

/** Page header with the task area tabs (Inbox only for people who receive reports). */
export async function TasksHeader({
  user,
  base,
  current,
  inbox,
  ...header
}: Omit<BodyProps, 'searchParams'> & {
  current: TasksArea;
  /** Already known by the caller; otherwise looked up. */
  inbox?: boolean;
} & Parameters<typeof PageHeader>[0]) {
  inbox ??= await hasInbox(getDb(), user).catch(() => false);
  return (
    <PageHeader
      {...header}
      tabs={<TasksNav user={user} current={current} inbox={inbox} base={base} />}
    />
  );
}

const VIEWS = { day: MyDay, all: AllTasks, eod: EodReport };
const LABELS = { day: 'My tasks', all: 'Task tracker', eod: 'End-of-day report' };
const DESCRIPTIONS = {
  day: 'Work assigned to you and work you log yourself, each with its deadline and next step.',
  all: 'Every task you may see, with filters.',
  eod: 'Your report for a day, built from your task history. Add your notes and submit it to your manager.',
};

/** `<base>/tasks`: My day, the tracker (`?tab=all`) and the EOD report (`?tab=eod`). */
export function TasksBody({ user, base, searchParams: sp }: BodyProps) {
  const tab = (Object.keys(VIEWS) as (keyof typeof VIEWS)[]).find((k) => k === sp.tab) ?? 'day';
  const View = VIEWS[tab];
  return (
    <>
      <TasksHeader
        user={user}
        base={base}
        current={tab}
        title={LABELS[tab]}
        description={DESCRIPTIONS[tab]}
        actions={
          tab === 'day' && can(user, 'ops:tasks:write') ? (
            <ButtonLink
              variant="primary"
              href={listHref(taskPaths(base).tasks, sp, { new: '1', open: undefined })}
            >
              Log a task
            </ButtonLink>
          ) : undefined
        }
      />
      <Section>
        <View user={user} sp={sp} base={base} />
      </Section>
    </>
  );
}

/** `<base>/tasks/<id>`: one task with the actions, updates and history the caller may see. */
export function TaskBody({ user, base, id }: Omit<BodyProps, 'searchParams'> & { id: string }) {
  return (
    <Section>
      <TaskView user={user} base={base} id={id} />
    </Section>
  );
}

async function TaskView({ user, base, id }: Omit<BodyProps, 'searchParams'> & { id: string }) {
  const r = await load(async (db) => {
    const d = await taskDetail(db, user, id);
    const [options, open, files] = await Promise.all([
      d.canEdit ? formOptions(db) : null,
      // shortcut: the 100 newest tasks in scope as dependency choices; add a search when lists grow.
      d.canEdit ? listTasks(db, user, { page: 1 }, 100) : null,
      listAttachments(db, user, 'task', d.id),
    ]);
    return { d, staff: options?.staff ?? [], open: open?.rows ?? [], files };
  });
  if (!r.ok) return r.view;
  const { d, staff, open, files } = r.data;
  const candidates = open
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .map((t) => ({ value: t.id, label: `${t.title} (${t.staffName})` }));
  return (
    <div className="el-stack">
      <PageHeader
        title={d.title}
        meta={
          <>
            <TaskBadge
              status={d.status}
              reviewRequired={d.reviewRequired}
              blocked={d.blockedKind}
            />
            <AckBadge at={d.acknowledgedAt} />
            {d.isSample ? <span className="el-badge el-badge-sample">Sample data</span> : null}
          </>
        }
        description={
          <>
            {d.staffName ?? 'No owner'} · {dueLabel(d, new Date())} · received{' '}
            {fmtDateTime(d.receivedAt)} ·{' '}
            <a href={`${taskPaths(base).tasks}?tab=all`}>Task tracker</a>
          </>
        }
      />
      <WaitingAlert d={d} />
      <TaskActions d={d} staff={staff} base={base} />
      <TaskFacts d={d} base={base} />
      <Checklist d={d} base={base} />
      <TaskFiles d={d} base={base} files={files} />
      <SubmitWork d={d} base={base} />
      <Submissions d={d} base={base} />
      <Discussion d={d} base={base} />
      <WorkUpdates d={d} base={base} />
      <TaskDependencies d={d} candidates={candidates} base={base} />
      <TaskReport d={d} base={base} />
      <TaskHistory d={d} />
    </div>
  );
}
