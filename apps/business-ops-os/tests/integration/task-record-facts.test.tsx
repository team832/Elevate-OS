/**
 * What a task record says about itself: requester and department derived from what is stored,
 * empty optional fields that do not read like faults, who moved a deadline and why, and the two
 * separate things "Acknowledged" and "Notice read". Fictional people only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { departments, opsTaskEvents, staffMembers } from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { taskListQuery } from '../../src/server/staff-tasks-schemas';
import { listTasks } from '../../src/server/task-list';
import { taskDetail } from '../../src/server/task-detail';
import { POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { TaskFacts } from '../../src/app/tasks/_components/task-detail';
import { Deadline } from '../../src/app/tasks/_components/task-common';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const due = addDays(istToday(new Date()), 3);
let hr: StaffUser;
let teacher: StaffUser;
let academics: { id: string };

const newTask = async (more: Record<string, unknown> = {}) =>
  (
    await callRoute<{ id: string; version: number }>(
      createRoute,
      authedRequest(hr, '/ops/api/v1/staff-tasks', {
        method: 'POST',
        json: { title: 'Sample vague task', staffId: teacher.staffId, dueOn: due, ...more },
      }),
    )
  ).data!;
const facts = async (id: string) =>
  renderToStaticMarkup(<TaskFacts d={await taskDetail(ctx.db, hr, id)} base="/ops" />);
const rowOf = async (id: string) => {
  const { rows } = await listTasks(ctx.db, hr, taskListQuery.parse({ page: 1 }));
  return rows.find((r) => r.id === id)!;
};

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Asha' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Ravi' });
  const [row] = await ctx.db.select().from(departments).where(eq(departments.code, 'ACADEMICS'));
  academics = row!;
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: row!.id })
    .where(eq(staffMembers.id, teacher.staffId));
});

describe('a task given with only a title', () => {
  it('shows the requester and department it can derive, and says where they came from', async () => {
    const out = await facts((await newTask()).id);
    expect(out).toContain('Sample HR Asha (created this task)');
    expect(out).toContain('Academics (from the owner’s staff record)');
    expect(out).not.toContain('Not recorded');
  });

  it('the department filter finds it, as the record says', async () => {
    const { id } = await newTask({ title: 'Sample filtered by the owner’s department' });
    const q = taskListQuery.parse({ page: 1, departmentId: academics.id });
    const { rows } = await listTasks(ctx.db, hr, q);
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it('empty optional fields are left out, not reported as missing', async () => {
    const out = await facts((await newTask()).id);
    for (const fault of ['None recorded', 'Not specified', 'No acceptance criteria recorded'])
      expect(out).not.toContain(fault);
    expect(out).toContain('Only the title was given');
  });

  it('what was stored wins and carries no note; a filled brief hides the title-only line', async () => {
    const out = await facts(
      (
        await newTask({
          requesterNote: 'Parent of Sample Asha, by phone',
          departmentId: academics.id,
          details: 'Sample details',
        })
      ).id,
    );
    expect(out).toContain('Parent of Sample Asha, by phone');
    expect(out).not.toContain('created this task');
    expect(out).not.toContain('from the owner');
    expect(out).toContain('Sample details');
    expect(out).not.toContain('Only the title was given');
  });

  it('the PDF and CSV report read the same text', async () => {
    const d = await taskDetail(ctx.db, hr, (await newTask()).id);
    expect(d.requesterText).toBe('Sample HR Asha (created this task)');
    expect(d.departmentText).toBe('Academics (from the owner’s staff record)');
  });
});

describe('a deadline that moved', () => {
  const move = (id: string, version: number, json: Record<string, unknown>) =>
    callRoute(
      patchRoute,
      authedRequest(hr, `/ops/api/v1/staff-tasks/${id}`, {
        method: 'PATCH',
        json: { expectedVersion: version, ...json },
      }),
      { id },
    );

  it('the record says who, when and why; the list line says who and keeps why in a title', async () => {
    const t = await newTask({ title: 'Sample moved task' });
    await move(t.id, t.version, { dueOn: addDays(due, 2), changeReason: 'Sample exam moved' });
    const out = await facts(t.id);
    expect(out).toContain('changed by Sample HR Asha');
    expect(out).toContain('Why: Sample exam moved');
    const line = renderToStaticMarkup(<Deadline t={await rowOf(t.id)} />);
    expect(line).toContain('changed by Sample HR Asha');
    expect(line).toContain('originally');
    expect(line).toContain('title="Sample exam moved"');
  });

  it('a time-only change is still named in the list', async () => {
    const t = await newTask({ title: 'Sample time moved', dueTime: '17:00' });
    await move(t.id, t.version, { dueTime: '18:00', changeReason: 'Sample later slot' });
    const line = renderToStaticMarkup(<Deadline t={await rowOf(t.id)} />);
    expect(line).toContain('changed by Sample HR Asha');
    expect(line).not.toContain('originally');
  });

  it('an event with no stored values does not take the record down', async () => {
    const t = await newTask({ title: 'Sample old event' });
    await ctx.db
      .insert(opsTaskEvents)
      .values({ taskId: t.id as never, kind: 'due_changed', actorUserId: hr.id, data: null });
    expect(await facts(t.id)).toContain('changed by Sample HR Asha');
    expect(renderToStaticMarkup(<Deadline t={await rowOf(t.id)} />)).toContain('changed by');
  });

  it('a task never moved says nothing about it', async () => {
    const t = await newTask({ title: 'Sample unmoved' });
    expect(await facts(t.id)).not.toContain('Deadline changes');
    expect(renderToStaticMarkup(<Deadline t={await rowOf(t.id)} />)).not.toContain('changed by');
  });
});

describe('Acknowledged and Notice read', () => {
  it('are named apart, with what each one means', async () => {
    const out = await facts((await newTask({ title: 'Sample notice' })).id);
    expect(out).toContain('Notice read: not yet');
    expect(out).toContain('Acknowledged: not yet');
    expect(out).toContain('pressed Acknowledge');
    expect(out).toContain('either can come first');
  });
});
