/**
 * Creating tasks (brief 2 §5; owner brief 23 Oct 2026 §8–§9). Anyone logs work for themselves;
 * managers assign to their reports (R3); all scope assigns to anyone — an HR manager only within
 * `hr.staff_scope_departments` (task-store `coversOwner`). Several assignees = one parent task
 * (owned by the assigning manager, a container) plus one child per person, each tracked on its
 * own; completing one never completes the others. A draft is invisible to its assignee and not
 * delivered until it is assigned (`publish`). Delivery = in-app notification + `delivered_at`.
 */
import { opsTaskCollaborators, type Database } from '@elevate/database';
import { can } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain/dates';
import { resolveTaskState } from '../domain/staff-tasks';
import { activeStaff, type Actor } from './context';
import { listTeachingAssignments } from './hr-assignments';
import { fieldError } from './ops-common';
import { afterChange, checkPeople, ownStaffId } from './staff-tasks';
import type { TaskInput } from './staff-tasks-schemas';
import { addChecklist } from './task-checklist';
import { deliverTask } from './task-links';
import {
  addDependencyRow,
  coversOwner,
  ctxOf,
  insertTaskWithEvent,
  taskAccess,
  type NewTask,
  type TaskAccess,
  type TaskRow,
} from './task-store';

const NOT_YOURS = 'You can assign tasks only to yourself and the people you manage.';

/** Log or assign a task; several `assignees` create a parent with one child each. */
export async function createTask(db: Database, actor: Actor, input: TaskInput, requestId?: string) {
  const access = await taskAccess(db, actor, 'ops:tasks:write');
  const people = input.assignees?.length ? [...new Set(input.assignees)] : null;
  const owners = people ?? [input.staffId ?? (await ownStaffId(db, actor))];
  for (const id of owners) {
    if (!coversOwner(access, id)) throw new ForbiddenError(NOT_YOURS);
    await activeStaff(db, id, people ? 'assignees' : 'staffId');
  }
  // Only all scope may record someone else as the assigning manager; otherwise it is you.
  const assignedByStaffId = (access.all && input.assignedByStaffId) || access.self;
  for (const id of owners) await checkPeople(db, id, { ...input, assignedByStaffId });
  if (people && people.length > 1 && !assignedByStaffId)
    throw fieldError('assignedByStaffId', 'Name the assigning manager (a staff member).');
  const forOther = owners.some((o) => o !== access.self);
  const source =
    forOther && (input.source ?? 'self') === 'self' ? 'manager' : (input.source ?? 'self');
  const closedBy = (await ctxOf(db, [])).closedBy;
  const doneOk = !forOther && !input.reviewRequired && closedBy === 'owner' && source === 'self';
  if (
    ['in_review', 'cancelled', 'draft', 'changes_requested'].includes(input.status) ||
    (input.status === 'done' && !doneOk)
  )
    throw fieldError(
      'status',
      'Start a task as assigned or in progress. Only work you log for yourself, without review, can start as done.',
    );
  const [refKind, refId] = input.relatedRef?.split(':') ?? [input.relatedKind, input.relatedId];
  const related = await checkRelated(db, actor, refKind ?? null, refId ?? null, owners);
  const { state, error } = resolveTaskState(null, input);
  if (error) throw fieldError(error.field, error.message);
  const draft = !input.publish && forOther;
  const {
    dependsOn = [],
    assignees: _a,
    checklist = [],
    collaborators = [],
    publish: _p,
    relatedRef: _r,
    ...values
  } = input;
  const now = new Date();
  const base: NewTask = {
    ...(values as Partial<NewTask>),
    ...state,
    ...related,
    status: draft ? 'draft' : state.status,
    title: input.title,
    staffId: owners[0] as StaffMemberId,
    assignedByStaffId: assignedByStaffId as StaffMemberId | null,
    source,
    dueOn: input.dueOn ?? istToday(now),
    receivedAt: input.receivedAt ?? now,
    completedAt: state.status === 'done' ? now : null,
    createdBy: actor.id,
  };
  const extras = { access, dependsOn, checklist, collaborators, draft, requestId };
  return withTransaction(db, async (tx) => {
    if (!people || people.length === 1)
      return insertOne(tx, actor, { ...base, staffId: owners[0] as StaffMemberId }, extras);
    // The parent is the assigning manager's container (acknowledged by creating it, no review).
    const parent = (await insertTaskWithEvent(
      tx,
      actor,
      {
        ...base,
        staffId: assignedByStaffId as StaffMemberId,
        reviewerStaffId: null,
        reviewRequired: false,
        backupStaffId: null,
        status: draft ? 'draft' : 'pending',
        acknowledgedAt: now,
        acknowledgedByUserId: actor.id,
      },
      { data: { assignees: people.length }, requestId },
    ))!;
    const children: string[] = [];
    for (const staffId of people)
      children.push(
        (
          await insertOne(
            tx,
            actor,
            { ...base, staffId: staffId as StaffMemberId, parentTaskId: parent.id },
            extras,
          )
        ).id,
      );
    return { ...parent, childIds: children };
  });
}

/**
 * I5: a related batch or subject must be one the assignee teaches, checked with Academic OS's
 * teaching assignments before anything is written (no network inside the transaction). The label
 * is Academic's, never typed. Campaigns and events cannot be checked yet (no Marketing list), so
 * they are refused rather than stored unchecked.
 */
async function checkRelated(
  db: Database,
  actor: Actor,
  kind: string | null,
  id: string | null,
  owners: readonly string[],
) {
  if (!kind || !id) return {};
  if (kind !== 'batch' && kind !== 'subject')
    throw fieldError(
      'relatedKind',
      'Campaign and event links cannot be checked yet. Name it in the description.',
    );
  if (!can(actor, 'ops:teaching_assignments:read'))
    throw fieldError(
      'relatedId',
      'You cannot see teaching assignments, so you cannot link a batch or subject.',
    );
  let relatedLabel = '';
  for (const staffId of owners) {
    const r = await listTeachingAssignments(db, actor, { staffId });
    if (r.status !== 'available')
      throw fieldError(
        'relatedId',
        `Source unavailable: Academic OS could not confirm the ${kind} (${r.reason}). Try again, or assign without the link.`,
      );
    const hit = r.data.items.find(
      (a) => a.staffId === staffId && (kind === 'batch' ? a.batchId : a.subjectId) === id,
    );
    if (!hit)
      throw fieldError(
        'relatedId',
        `That ${kind} is not one of this person’s teaching assignments.`,
      );
    relatedLabel = relatedLabelOf(kind, hit);
  }
  return { relatedKind: kind as 'batch' | 'subject', relatedId: id, relatedLabel };
}

export const relatedLabelOf = (
  kind: 'batch' | 'subject',
  a: { batchCode: string | null; subjectName: string; courseName: string | null },
) =>
  kind === 'batch'
    ? `${a.batchCode} · ${a.subjectName}`
    : `${a.subjectName}${a.courseName ? ` · ${a.courseName}` : ''}`;

async function insertOne(
  tx: Database,
  actor: Actor,
  values: NewTask,
  x: {
    access: TaskAccess;
    dependsOn: string[];
    checklist: string[];
    collaborators: string[];
    draft: boolean;
    requestId?: string;
  },
): Promise<TaskRow> {
  const forOther = values.staffId !== x.access.self;
  const now = new Date();
  let row = (await insertTaskWithEvent(
    tx,
    actor,
    {
      ...values,
      // Work you log for yourself is acknowledged by logging it; assigned work is not (§5).
      acknowledgedAt: forOther ? null : now,
      acknowledgedByUserId: forOther ? null : actor.id,
    },
    { requestId: x.requestId },
  ))!;
  for (const dep of x.dependsOn) await addDependencyRow(tx, actor, x.access, row, dep);
  await addChecklist(tx, row.id, x.checklist);
  for (const staffId of x.collaborators) {
    await activeStaff(tx, staffId, 'collaborators');
    await tx
      .insert(opsTaskCollaborators)
      .values({ taskId: row.id, staffId: staffId as StaffMemberId, addedBy: actor.id })
      .onConflictDoNothing();
  }
  if (forOther && !x.draft) row = await deliverTask(tx, actor, row);
  // Logged as already done: a recurring task gets its next occurrence at once.
  return row.status === 'done'
    ? afterChange(tx, actor, { ...row, status: 'pending' }, row, x.requestId)
    : row;
}
