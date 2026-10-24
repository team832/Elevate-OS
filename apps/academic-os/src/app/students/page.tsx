import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Button, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listBatches, listStudents } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import { Filter } from '../../ui/filters';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Academic students' };

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:students:read', MODULE_PATHS.students);
  return (
    <AcademicShell access={access} active="students" loading="Loading students…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({
  access,
  searchParams,
}: {
  access: PageAccess;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : undefined;
  const db = getDb();
  const actor = actorFor(access.user);
  const canWrite = can(access.user, 'academic:students:write');
  const canEnrol = can(access.user, 'academic:enrolments:decide');
  const data = await load(async () => ({
    students: await listStudents(db, actor, { q }),
    batches: canEnrol ? await listBatches(db, actor) : [],
  }));
  return (
    <>
      <PageHeader
        title="Students"
        description="Teachers see only students in their batches. Development data is fictional."
      />
      <form method="get" className="el-inline-form">
        <Filter id="st-q" name="q" label="Search name or code" value={q} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          {!canWrite ? (
            <Alert tone="info">
              Contact details (phone, email, guardian contact, date of birth) are hidden for your
              role (PLT-014).
            </Alert>
          ) : null}
          <Card>
            <DataTable
              compact
              rows={data.data.students}
              rowKey={(s) => s.id}
              empty={
                <EmptyState
                  title="No students"
                  description={
                    q
                      ? 'No student matches this search.'
                      : 'Students arrive through the enrolment intake or manual entry.'
                  }
                />
              }
              columns={[
                {
                  key: 'code',
                  header: 'Code',
                  render: (s) => <a href={MODULE_PATHS.student(s.id)}>{s.code}</a>,
                },
                { key: 'fullName', header: 'Name' },
                { key: 'stage', header: 'Stage', render: (s) => s.currentStage ?? '—' },
                {
                  key: 'batches',
                  header: 'Active batches',
                  render: (s) => (s.batches.length ? s.batches.join(', ') : 'none'),
                },
                ...(canWrite
                  ? [
                      {
                        key: 'contact',
                        header: 'Contact',
                        render: (s: (typeof data.data.students)[number]) =>
                          (s.contactsHidden ? null : [s.email, s.phone, s.guardianPhone].filter(Boolean).join(' · ')) || '—',
                      },
                    ]
                  : []),
                { key: 'status', header: 'Status', render: (s) => <StateBadge state={s.status} /> },
              ]}
            />
          </Card>
          {canWrite ? (
            <Card
              title="Add a student by hand"
              description="Normally students come from Business Ops through the enrolment intake. Collect only what is needed; a guardian contact is required for minors."
            >
              <ApiForm
                action={MODULE_PATHS.api('students')}
                submitLabel="Create student"
                successMessage="Student created."
                idPrefix="stu"
                fields={[
                  { name: 'fullName', label: 'Full name', required: true },
                  { name: 'preferredName', label: 'Preferred name' },
                  { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
                  {
                    name: 'currentStage',
                    label: 'Stage',
                    type: 'select',
                    options: [
                      'class_9',
                      'class_10',
                      'class_11',
                      'class_12',
                      'gap_year',
                      'graduate',
                      'other',
                    ].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
                  },
                  { name: 'schoolBoard', label: 'Board' },
                  { name: 'email', label: 'Email' },
                  { name: 'phone', label: 'Phone (E.164, e.g. +919800000000)' },
                  { name: 'city', label: 'City' },
                  { name: 'guardianName', label: 'Guardian name' },
                  {
                    name: 'guardianRelationship',
                    label: 'Guardian relationship',
                    type: 'select',
                    options: ['mother', 'father', 'guardian', 'other'].map((v) => ({
                      value: v,
                      label: v,
                    })),
                  },
                  { name: 'guardianEmail', label: 'Guardian email' },
                  { name: 'guardianPhone', label: 'Guardian phone' },
                ]}
              />
            </Card>
          ) : null}
          {canEnrol ? (
            <Card
              title="Manual enrolment"
              description="Only for cases outside the Business Ops handoff; the reason is audited."
            >
              <ApiForm
                action={MODULE_PATHS.api('enrolments')}
                submitLabel="Enrol"
                successMessage="Enrolment created."
                idPrefix="enrol"
                fields={[
                  {
                    name: 'studentId',
                    label: 'Student',
                    type: 'select',
                    required: true,
                    options: data.data.students.map((s) => ({
                      value: s.id,
                      label: `${s.fullName} (${s.code})`,
                    })),
                  },
                  {
                    name: 'batchId',
                    label: 'Batch',
                    type: 'select',
                    required: true,
                    options: data.data.batches.map((b) => ({ value: b.id, label: b.code })),
                  },
                  { name: 'startDate', label: 'Start date', type: 'date' },
                  { name: 'reason', label: 'Reason', required: true },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
