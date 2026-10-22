import type { AuthenticatedUser } from '@elevate/authentication';
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { getTeacherProfile, listTeachers, subjectCatalogue } from '../../server/teachers';
import { humanise } from '../../ui/format';
import { PeopleNav } from '../../ui/admissions-nav';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, options, SearchPanel } from '../../ui/list-controls';
import { RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { metricText, TEACHER_ACTS, TeacherActModal, teacherTabs } from './teacher-record';
import { VerificationBadge } from './verification-badge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teachers' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/teachers';

export default async function TeachersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:teachers:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="teachers">
      <PageHeader
        title="Teachers"
        tabs={<PeopleNav current="teachers" user={access.user} />}
        description="Who teaches what, today's classes from Academic OS, and open tasks and EOD status where you may see them."
      />
      <Section>
        <Directory user={access.user} sp={sp} />
      </Section>
      {sp.open ? (
        <Section label="Loading teacher…">
          <OpenTeacher user={access.user} sp={sp} id={sp.open} />
        </Section>
      ) : null}
    </Frame>
  );
}

async function Directory({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const r = await load(async (db) => {
    const [d, subjects] = await Promise.all([
      listTeachers(db, user, { subject: sp.subject, withActivity: true }),
      subjectCatalogue(db),
    ]);
    return { d, subjects };
  });
  if (!r.ok) return r.view;
  const { d, subjects } = r.data;
  const q = sp.q?.trim().toLowerCase();
  const statuses = [...new Set(d.teachers.map((t) => t.status))];
  const rows = d.teachers.filter(
    (t) =>
      (!q || t.displayName.toLowerCase().includes(q)) && (!sp.status || t.status === sp.status),
  );
  return (
    <div className="el-stack">
      <SearchPanel
        action={BASE}
        search={{ name: 'q', label: 'Teacher name', value: sp.q }}
        filters={[
          {
            name: 'subject',
            label: 'Subject',
            type: 'select',
            value: sp.subject,
            options: subjects.map((s) => ({ value: s, label: s })),
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            value: sp.status,
            options: options(statuses),
          },
        ]}
      />
      <RecordTable
        caption={`${rows.length} teacher${rows.length === 1 ? '' : 's'}`}
        rows={rows}
        rowKey={(t) => t.id}
        rowHref={(t) => listHref(BASE, sp, { open: t.id, act: undefined })}
        empty={
          <EmptyState
            title={sp.subject ? `No teacher has “${sp.subject}” recorded` : 'No teachers match'}
            description="Subjects are added on a teacher's profile by an operations manager."
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Teacher',
            render: (t) => (
              <>
                {t.displayName}
                {t.staffCode ? ` · ${t.staffCode}` : ''}
                {t.verificationStatus === 'confirmed' ? null : (
                  <>
                    {' '}
                    <VerificationBadge status={t.verificationStatus} />
                  </>
                )}
              </>
            ),
          },
          { key: 'dept', header: 'Department', render: (t) => t.department ?? 'Not recorded' },
          {
            key: 'subjects',
            header: 'Subjects',
            render: (t) => t.subjects.map((s) => s.subject).join(', '),
          },
          { key: 'manager', header: 'Manager', render: (t) => t.manager ?? 'Not recorded' },
          { key: 'status', header: 'Staff status', render: (t) => humanise(t.status) },
          { key: 'hr', header: 'HR attendance today', render: () => 'HR attendance unavailable' },
          {
            key: 'classes',
            header: 'Classes today (scheduled / delivered)',
            render: (t) =>
              t.academicToday?.status === 'available'
                ? `${metricText(t.academicToday.data.sessions.planned)} / ${metricText(t.academicToday.data.sessions.delivered)}`
                : 'Academic OS unavailable',
          },
          {
            key: 'logs',
            header: 'Logs pending today',
            render: (t) =>
              t.academicToday?.status === 'available'
                ? metricText(t.academicToday.data.logsPending)
                : 'Academic OS unavailable',
          },
          {
            key: 'tasks',
            header: 'Tasks open / overdue',
            render: (t) =>
              t.tasks ? `${t.tasks.open} / ${t.tasks.overdue}` : 'Not shared with you',
          },
          {
            key: 'eod',
            header: 'EOD today',
            render: (t) => (t.tasks ? humanise(t.tasks.eodToday) : 'Not shared with you'),
          },
        ]}
      />
      {d.unassignedSubjects.length ? (
        <p className="el-field-hint">
          Subjects with no teacher assigned: {d.unassignedSubjects.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}

/** The `?open=` record loads on its own, so a failure stays inside the modal and the list stays. */
async function OpenTeacher({ user, sp, id }: { user: AuthenticatedUser; sp: Params; id: string }) {
  const closeHref = listHref(BASE, sp, { open: undefined, act: undefined });
  const r = await load((db) => getTeacherProfile(db, user, id));
  if (!r.ok)
    return (
      <RecordModal id="teacher-modal" title="Teacher" closeHref={closeHref}>
        {r.view}
      </RecordModal>
    );
  const open = r.data;
  const act = TEACHER_ACTS.find((a) => a === sp.act);
  return act ? (
    <TeacherActModal
      act={act}
      t={open}
      user={user}
      closeHref={listHref(BASE, sp, { act: undefined })}
    />
  ) : (
    <RecordModal
      id="teacher-modal"
      title={open.displayName}
      meta={
        <>
          <VerificationBadge status={open.profile?.verificationStatus} />{' '}
          {open.subjects.map((s) => s.subject).join(', ') || 'No subjects recorded'}
        </>
      }
      fullHref={`${BASE}/${open.staff.id}`}
      closeHref={closeHref}
      returnId={open.staff.id}
      tabs={teacherTabs(open, user, (a) => listHref(BASE, sp, { act: a }), 3)}
    />
  );
}
