/**
 * Figures over more rows than a list holds (HMO-018 and its class). With 640 leads the Leads tiles
 * count all of them in SQL and each list opens on the same set; every `flag` filter is the row's
 * own flag, one definition. A figure next to a capped list says so, or counts past the cap.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { sql } from 'drizzle-orm';
import { opsDuplicateFlags, opsFollowUps, opsStaffTasks, type Database } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { addDays, istToday } from '../../src/domain/dates';
import { FollowUpsBody } from '../../src/app/leads/follow-ups-body';
import { LeadsBody } from '../../src/app/leads/leads-body';
import { MyDay } from '../../src/app/tasks/_components/my-tasks';
import { createLead, LEAD_LIST_FLAGS, listLeads } from '../../src/server/leads';
import { DueWork } from '../../src/ui/task-notices';
import { setupReference, staffUser, uniqueEmail, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const html = async (node: ReactNode) =>
  (await new Response((await prerender(node)).prelude).text()).replaceAll('<!-- -->', '');
const page = (user: StaffUser, searchParams: Record<string, string> = {}) =>
  html(<LeadsBody user={user} base="/ops" searchParams={searchParams} />);
const tile = (out: string, label: string) =>
  Number(
    new RegExp(`el-stat-label">${label}</span><span class="el-stat-value">([\\d,]+)<`)
      .exec(out)![1]!
      .replaceAll(',', ''),
  );
const caption = (out: string) => /<caption[^>]*>(\d[^<]*)</.exec(out)?.[1];

const STAGES = [
  ['Admission pending', 'admission_pending', 13],
  ['Contacted', 'contacted', 12],
  ['New', 'new', 607],
  ['Demo scheduled', 'demo_scheduled', 1],
] as const;

let manager: StaffUser;
let templateLead: string;

const newLead = async (studentName: string) =>
  (
    await createLead(db(), manager, {
      studentName,
      studentEmail: uniqueEmail('volume'),
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
    } as never)
  ).lead;
const rawRows = async (q: string) =>
  ((await db().execute(sql.raw(q))) as unknown as { rows: Record<string, string>[] }).rows;
const columns = async (table: string, skip: string[]) =>
  (
    await rawRows(
      `select column_name c from information_schema.columns where table_schema='ops' and table_name='${table}' and is_generated='NEVER' order by ordinal_position`,
    )
  )
    .map((r) => r.c!)
    .filter((c) => !skip.includes(c));

beforeAll(async () => {
  await setupReference(db());
  manager = await staffUser(db(), ['operations_manager'], { name: 'Sample Manager' });
  templateLead = (await newLead('Sample Volume Lead')).id;
  const [{ adm }] = (await rawRows(
    `select id adm from ops.admissions where lead_id='${templateLead}'`,
  )) as [{ adm: string }];
  const leadCols = await columns('leads', [
    'id',
    'code',
    'student_phone',
    'student_phone_normalised',
    'student_email',
    'guardian_phone',
    'guardian_phone_normalised',
    'guardian_email',
    'guardian_email_normalised',
    'first_received_at',
  ]);
  const caseCols = await columns('admissions', ['id', 'code', 'lead_id', 'status']);
  // The newest 606 are new; the 33 older ones have moved on, so they sit past a cap of 500.
  await db().execute(
    sql.raw(`
    with n as (select generate_series(1, 639) i),
    ins as (
      insert into ops.leads (id, code, student_email, ${leadCols.join(',')}, first_received_at)
      select gen_random_uuid(), 'LEAD-'||lpad((900000+i)::text,6,'0'), 'volume'||i||'@example.test', ${leadCols.map((c) => 'l.' + c).join(',')}, now() - (i||' minutes')::interval
      from n cross join ops.leads l where l.id='${templateLead}'
      returning id, code
    )
    insert into ops.admissions (id, code, lead_id, status, ${caseCols.join(',')})
    select gen_random_uuid(), 'ADM-'||substr(ins.code, 6), ins.id,
      case when substr(ins.code, 6)::int - 900000 <= 606 then 'new'
           when substr(ins.code, 6)::int - 900000 <= 619 then 'admission_pending'
           when substr(ins.code, 6)::int - 900000 <= 631 then 'contacted'
           when substr(ins.code, 6)::int - 900000 <= 638 then 'lost'
           else 'demo_scheduled' end,
      ${caseCols.map((c) => 'a.' + c).join(',')}
    from ins cross join ops.admissions a where a.id='${adm}'
  `),
  );
}, 120_000);

describe('Leads over more rows than one list holds', () => {
  it('each tile counts every lead, and its list opens on the same set', async () => {
    const out = await page(manager);
    expect(caption(out)).toBe('640 leads');
    for (const [label, stage, count] of STAGES) {
      expect([label, tile(out, label)]).toEqual([label, count]);
      expect([stage, caption(await page(manager, { stage }))]).toEqual([
        stage,
        `${count} lead${count === 1 ? '' : 's'}`,
      ]);
    }
  });

  it('pages through the whole set: the oldest lead is on the last page', async () => {
    const last = await page(manager, { page: '26' });
    expect(last).toContain('LEAD-900639');
  });

  it('a search narrows the tiles and the list together', async () => {
    const out = await page(manager, { q: 'LEAD-90060' }); // 900600 to 900609
    expect(caption(out)).toBe('10 leads');
    expect(tile(out, 'New')).toBe(7);
    expect(tile(out, 'Admission pending')).toBe(3);
  });
});

describe('each flag filter is the flag the row shows', () => {
  const today = istToday(new Date());
  let lead: { id: string };
  let other: { id: string };

  beforeAll(async () => {
    lead = await newLead('Sample Flagged Lead');
    other = await newLead('Sample Matched Lead');
    await db()
      .insert(opsFollowUps)
      .values({
        leadId: lead.id,
        ownerStaffId: manager.staffId,
        kind: 'first_contact',
        title: 'Call back',
        dueDate: addDays(today, -1),
        status: 'open',
        createdBy: manager.id,
      } as never);
    await db()
      .insert(opsFollowUps)
      .values({
        leadId: other.id,
        ownerStaffId: manager.staffId,
        kind: 'first_contact',
        title: 'Call today',
        dueDate: today,
        status: 'open',
        createdBy: manager.id,
      } as never);
    await db()
      .insert(opsDuplicateFlags)
      .values({
        leadId: lead.id,
        matchedLeadId: other.id,
        level: 'exact',
        signals: ['student_phone'],
        status: 'open',
      } as never);
  });

  it.each(LEAD_LIST_FLAGS.filter((f) => f !== 'due_today'))('%s', async (flag) => {
    const rows = await listLeads(db(), manager, { flag, limit: 5000 });
    const everyRow = await listLeads(db(), manager, { limit: 5000 });
    const flagged = {
      new_this_week: (r: (typeof rows)[number]) => r.flags.newThisWeek,
      awaiting_contact: (r: (typeof rows)[number]) => r.flags.awaitingContact,
      unassigned: (r: (typeof rows)[number]) => r.assignment === 'unassigned',
      handoff_pending: (r: (typeof rows)[number]) => r.assignment === 'handoff_pending',
      overdue: (r: (typeof rows)[number]) => r.flags.overdue,
      missing_next_action: (r: (typeof rows)[number]) => r.flags.missingNextAction,
      duplicate: (r: (typeof rows)[number]) => r.flags.openDuplicates > 0,
    }[flag];
    expect(rows.map((r) => r.id).sort()).toEqual(
      everyRow
        .filter(flagged)
        .map((r) => r.id)
        .sort(),
    );
  });

  it('row flags: overdue, due today, duplicates; a lost case has no next action to miss', async () => {
    const rows = await listLeads(db(), manager, { q: 'Sample' });
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect(of(lead.id).flags).toMatchObject({
      overdue: true,
      dueToday: false,
      missingNextAction: false,
      openDuplicates: 1,
      exactDuplicate: true,
    });
    expect(of(other.id).flags).toMatchObject({ overdue: false, dueToday: true, openDuplicates: 1 });
    const lost = await rawRows(
      `select l.id from ops.leads l join ops.admissions a on a.lead_id = l.id where a.status = 'lost' limit 1`,
    );
    const [row] = await listLeads(db(), manager, { q: 'LEAD-900632' });
    expect(lost.length).toBe(1);
    expect(row).toMatchObject({ status: 'lost' });
    expect(row!.flags.missingNextAction).toBe(false);
    expect(row!.flags.awaitingContact).toBe(false);
  });
});

describe('other figures beside a capped list', () => {
  it('My tasks "To do" counts all 60 open tasks; the due list says it shows the first 50', async () => {
    const yesterday = addDays(istToday(new Date()), -1);
    await db()
      .insert(opsStaffTasks)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          staffId: manager.staffId,
          title: `Sample task ${i}`,
          dueOn: yesterday,
          originalDueOn: yesterday,
          status: 'pending' as const,
          createdBy: manager.id,
        })),
      );
    const out = await html(<MyDay user={manager} sp={{}} base="/ops" />);
    expect(tile(out, 'To do')).toBe(60);
    expect(await html(<DueWork user={manager} base="/ops" />)).toContain(
      'Due soon and overdue (first 50)',
    );
  });

  it('the follow-up list says how many there are past its first 500', async () => {
    await db()
      .insert(opsFollowUps)
      .values(
        Array.from({ length: 510 }, () => ({
          leadId: templateLead as never,
          ownerStaffId: manager.staffId,
          kind: 'general',
          title: 'Sample call',
          dueDate: istToday(new Date()),
          status: 'open' as const,
          createdBy: manager.id,
        })),
      );
    const out = await html(<FollowUpsBody user={manager} base="/ops" searchParams={{}} />);
    expect(out).toMatch(/First 500 of 51\d follow-ups, earliest due first/);
  });
});
