/**
 * D-073: "My meetings" through the `./work` entry (Academic OS): own meetings only, names only,
 * links in the host workspace; meeting notifications open the recipient's own workspace.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { notifications, students } from '@elevate/database';
import { POST as schedule } from '../../src/app/api/v1/appointments/route';
import { MeetingsBody } from '../../src/work';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const tomorrow = (hh: string) =>
  new Date(`${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T${hh}:00:00+05:30`);

let teacher: StaffUser;
let otherTeacher: StaffUser;
let counsellor: StaffUser;
let mine: string;
let counselling: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  const manager = await staffUser(ctx.db, ['operations_manager']);
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher' });
  otherTeacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Other Teacher' });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  const [a, b] = await ctx.db
    .insert(students)
    .values([{ fullName: 'Sample Mine Student' }, { fullName: 'Sample Elsewhere Student' }])
    .returning();
  const book = async (staffId: string, studentId: string, type: string, hh: string) =>
    (
      await callRoute<{ id: string }>(
        schedule,
        authedRequest(manager, '/ops/api/v1/appointments', {
          method: 'POST',
          json: { type, staffId, studentId, startsAt: tomorrow(hh).toISOString(), mode: 'online' },
        }),
      )
    ).data!.id;
  mine = await book(teacher.staffId, a!.id, 'parent_teacher_meeting', '10');
  counselling = await book(counsellor.staffId, b!.id, 'student_counselling', '11');
});

describe('MeetingsBody with base /academic', () => {
  it('shows only the teacher’s own meetings, names only, with links in Academic', async () => {
    const list = await html(<MeetingsBody user={teacher} base="/academic" searchParams={{}} />);
    const open = await html(
      <MeetingsBody user={teacher} base="/academic" searchParams={{ open: mine }} />,
    );
    expect(list).toContain('Sample Mine Student');
    expect(list).toContain(`href="/academic/meetings?open=${mine}"`);
    expect(list).not.toContain('Sample Elsewhere Student');
    expect(open).toContain('Participants (names only)');
    for (const out of [list, open]) {
      expect(out).not.toContain('/ops/');
      expect(out).not.toContain('@example.test');
    }
  });

  it('a second teacher sees none of them, and cannot open one by id', async () => {
    const out = await html(
      <MeetingsBody user={otherTeacher} base="/academic" searchParams={{ open: mine }} />,
    );
    expect(out).not.toContain('Sample Mine Student');
    expect(out).toContain('assigned to you');
    const list = await html(
      <MeetingsBody user={otherTeacher} base="/academic" searchParams={{}} />,
    );
    expect(list).toContain('No meetings in these dates');
  });
});

it('meeting notifications open the recipient’s own workspace', async () => {
  const linkOf = async (userId: string) =>
    (
      await ctx.db
        .select({ link: notifications.link })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId as never),
            eq(notifications.kind, 'appointment.scheduled'),
          ),
        )
    ).map((n) => n.link);
  expect(await linkOf(teacher.id)).toEqual([`/academic/meetings?open=${mine}`]);
  expect(await linkOf(counsellor.id)).toEqual([`/ops/meetings?open=${counselling}`]);
});
