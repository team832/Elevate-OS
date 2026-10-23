import type { AuthenticatedUser } from '@elevate/authentication';
import { can, scopeFor } from '@elevate/authorization';
import { PageHeader, Subnav } from '@elevate/shared-ui';
import { listTeachingAssignments } from '../../../../server/hr-assignments';
import { getHrStaff, hrFormOptions, type HrStaff } from '../../../../server/hr-staff';
import { fmtDateTime, humanise } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { Segment, Timeline } from '../../../../ui/sections';
import { AssignmentsTable } from '../../assignments/assignments-table';
import { HR_ACTS, HrActModal, HrOverview, LinkedList } from '../staff-hr-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff member' };

type Params = { tab?: string; act?: string };

/** [tab, label, who sees it]; the four list tabs open another HR page narrowed to this person. */
const TABS: [string, string, ((u: AuthenticatedUser) => boolean) | null][] = [
  ['overview', 'Overview', null],
  ['responsibilities', 'Responsibilities', (u) => can(u, 'ops:teaching_assignments:read')],
  ['attendance', 'Attendance', (u) => scopeFor(u, 'ops:attendance:read') === 'all'],
  ['tasks', 'Tasks and submissions', (u) => can(u, 'ops:tasks:review')],
  ['reports', 'Work reports', (u) => can(u, 'ops:work_reports:read')],
  ['feedback', 'Feedback', (u) => can(u, 'ops:teacher_feedback:read')],
  ['activity', 'Activity history', null],
];

const LINKED: Record<string, { title: string; path: string; description: string }> = {
  attendance: {
    title: 'Attendance',
    path: '/ops/hr/attendance',
    description:
      'Check-ins, daily status, leave and correction requests. Class delivery is not attendance.',
  },
  tasks: {
    title: 'Tasks',
    path: '/ops/hr/tasks',
    description: 'Tasks assigned to this person, their submissions and review decisions.',
  },
  reports: {
    title: 'Work reports',
    path: '/ops/hr/reports',
    description: 'Daily, weekly and monthly reports this person submitted.',
  },
  feedback: {
    title: 'Student feedback',
    path: '/ops/hr/feedback',
    description: 'Student feedback about this teacher, summaries and agreed development actions.',
  },
};

const ACTION_TEXT: Record<string, string> = {
  'staff.created': 'Staff record created',
  'staff.updated': 'Staff record changed',
  'staff.profile_updated': 'Employment profile changed',
  'staff.department_changed': 'Department changed',
  'staff.manager_changed': 'Manager changed',
  'staff.employment_ended': 'Employment ended; login disabled',
  'staff.private_details_updated': 'Private details changed',
  'teacher.updated': 'Teacher profile changed',
};

export default async function HrStaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const { id } = await params;
  const access = await gate('ops:hr:read', `/ops/hr/staff/${id}`);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-staff">
      <Section>
        <Record user={access.user} id={id} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Record({ user, id, sp }: { user: AuthenticatedUser; id: string; sp: Params }) {
  const tabs = TABS.filter(([, , allowed]) => !allowed || allowed(user));
  const tab = tabs.find(([key]) => key === sp.tab)?.[0] ?? 'overview';
  const act = sp.act ? HR_ACTS[sp.act] : undefined;
  const acting = act && can(user, act.permission) ? act : undefined;
  const r = await load(async (db) => {
    const d = await getHrStaff(db, user, id);
    const [o, assignments] = await Promise.all([
      acting ? hrFormOptions(db) : null,
      tab === 'responsibilities'
        ? listTeachingAssignments(db, user, { staffId: d.staff.id })
        : null,
    ]);
    return { d, o, assignments };
  });
  if (!r.ok) return r.view;
  const { d, o, assignments } = r.data;
  const self = `/ops/hr/staff/${d.staff.id}`;
  const here = tab === 'overview' ? self : `${self}?tab=${tab}`;
  const actHref = (a: string) => `${self}?act=${a}`;
  const linked = LINKED[tab];
  return (
    <div className="el-stack">
      <PageHeader
        title={d.displayName}
        description={
          <>
            {d.staff.title ?? 'No job title recorded'} · <a href="/ops/hr/staff">Staff directory</a>
          </>
        }
        tabs={
          <Subnav
            label="Staff record sections"
            items={tabs.map(([key, label]) => [
              key === 'overview' ? self : `${self}?tab=${key}`,
              label,
            ])}
            current={here}
          />
        }
      />
      {tab === 'overview' ? <HrOverview d={d} user={user} level={2} actHref={actHref} /> : null}
      {tab === 'responsibilities' && assignments ? (
        <Segment
          title="Teaching assignments"
          flush
          description="From Academic OS. Coordinators change them there; subjects someone can teach are listed on the overview and grant nothing."
          actions={<a href={`/academic/teachers/${d.staff.id}`}>Open in Academic OS</a>}
        >
          <AssignmentsTable result={assignments} withTeacher={false} />
        </Segment>
      ) : null}
      {linked ? (
        <LinkedList
          title={linked.title}
          description={linked.description}
          href={`${linked.path}?staffId=${d.staff.id}`}
          level={2}
        />
      ) : null}
      {tab === 'activity' ? <Activity d={d} /> : null}
      {acting && o ? <HrActModal d={d} o={o} act={acting} closeHref={here} /> : null}
    </div>
  );
}

function Activity({ d }: { d: HrStaff }) {
  return (
    <Segment title="Activity history" description="Changes to this staff record, newest first.">
      {d.history.length ? (
        <Timeline
          label="Staff record history"
          items={d.history.map((h) => ({
            key: h.id,
            when: fmtDateTime(h.at),
            title: ACTION_TEXT[h.action] ?? humanise(h.action),
            detail: h.actorName ? `By ${h.actorName}` : 'By the system',
          }))}
        />
      ) : (
        <p className="el-field-hint">No changes recorded yet.</p>
      )}
    </Segment>
  );
}
