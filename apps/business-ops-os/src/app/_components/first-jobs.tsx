/** A new institute's first jobs, in the order that works (HUS-015). Gone once staff and leads exist. */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { firstJobCounts } from '../../server/overview';
import { load } from '../../ui/frame';
import { Segment } from '../../ui/sections';

export async function FirstJobs({ user }: { user: AuthenticatedUser }) {
  const manage = can(user, 'ops:organisation:manage');
  const write = can(user, 'ops:leads:write');
  if (!manage && !write) return null;
  const r = await load(firstJobCounts);
  if (!r.ok || (r.data.staff > 0 && r.data.leads > 0)) return null;
  return (
    <Segment title="First jobs on a new system">
      <ol>
        <li>
          {manage ? <a href="/ops/staff?new=1">Add your staff</a> : 'An operations manager adds the staff'}.
          Leads, tasks and classes are assigned to staff records.
        </li>
        <li>Link each person&apos;s login on their staff record, so they see their own work.</li>
        <li>
          {write ? <a href="/ops/leads?new=1">Add the first lead</a> : 'Add the first lead'}. Everything
          after it (counselling, demo, admission) starts from a lead.
        </li>
      </ol>
    </Segment>
  );
}
