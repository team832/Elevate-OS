import type { AuthenticatedUser } from '@elevate/authentication';
import { ButtonLink } from '@elevate/shared-ui';
import { taskDetail } from '../../../server/task-detail';
import { load } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { AckBadge, TaskFacts } from './task-detail';
import { istWhen } from '../../../domain/staff-tasks';
import { deliveryText, TaskBadge, taskPaths, type Params } from './task-common';

/** The list's pop-up: the task's facts; actions, updates and history are on the full page. */
export async function TaskModal({
  user,
  id,
  sp,
  base,
  listPath,
}: {
  user: AuthenticatedUser;
  id: string;
  sp: Params;
  base: string;
  /** The list this pop-up sits on (default: the task tracker). */
  listPath?: string;
}) {
  const BASE = taskPaths(base).tasks;
  const r = await load((db) => taskDetail(db, user, id));
  if (!r.ok) return r.view;
  const t = r.data;
  return (
    <RecordModal
      id="task-modal"
      title={t.title}
      meta={
        <>
          <TaskBadge status={t.status} reviewRequired={t.reviewRequired} blocked={t.blockedKind} />
          <AckBadge at={t.acknowledgedAt} />
        </>
      }
      fullHref={`${BASE}/${t.id}`}
      closeHref={listHref(listPath ?? BASE, sp, { open: undefined })}
      returnId={t.id}
    >
      <div className="el-stack">
        <p>
          {deliveryText(t)}
          {t.lastSubmittedAt ? ` · Last submitted ${istWhen(t.lastSubmittedAt)}` : ''}
          {t.group ? ` · ${t.group.done} of ${t.group.total} approved` : ''}
        </p>
        <ButtonLink variant="primary" href={`${BASE}/${t.id}`}>
          Open the task to act, review or see its history
        </ButtonLink>
        <TaskFacts d={t} base={base} level={3} />
      </div>
    </RecordModal>
  );
}
