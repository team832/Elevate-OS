import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader, Subnav } from '@elevate/shared-ui';
import type { PageAccess } from '@elevate/server-kit/next';
import { WEEKDAY_NAMES } from '../../../domain';
import { getCourse, listBatches, listPatterns, listRooms, listStaff } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiForm } from '../../../ui/api-form';
import { PlanBadge } from '../../../ui/badges';
import { AcademicShell, LoadError, TIMETABLE_TABS, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Timetable patterns' };

export default async function PatternsPage() {
  const access = await gate('academic:timetable:read', MODULE_PATHS.patterns);
  return (
    <AcademicShell access={access} active="timetable" loading="Loading patterns…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const actor = actorFor(access.user);
  const canWrite = can(access.user, 'academic:timetable:write');
  const data = await load(async () => {
    const batches = canWrite ? await listBatches(db, actor) : [];
    const subjects = [];
    for (const b of batches) for (const s of (await getCourse(db, b.courseId)).subjects) subjects.push({ value: s.id, label: `${b.code}: ${s.name}` });
    return { patterns: await listPatterns(db, actor), batches, subjects, staff: canWrite ? await listStaff(db) : [], rooms: canWrite ? await listRooms(db) : [] };
  });
  return (
    <>
      <PageHeader
        title="Timetable patterns"
        description="A weekly pattern is a draft until it is checked and published. Publishing creates the dated classes; holidays are skipped."
        tabs={<Subnav label="Timetable views" items={TIMETABLE_TABS} current={MODULE_PATHS.patterns} />}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <Card title="Patterns">
            <DataTable
              compact
              rows={data.data.patterns}
              rowKey={(p) => p.id}
              empty={<EmptyState title="No patterns yet" description={canWrite ? 'Create a draft below, then preview and publish it.' : 'An academic coordinator publishes the weekly timetable.'} />}
              columns={[
                { key: 'when', header: 'Weekly slot', render: (p) => <a href={MODULE_PATHS.pattern(p.id)}><strong>{WEEKDAY_NAMES[p.weekday - 1]} {p.startTime}</strong></a> },
                { key: 'batch', header: 'Batch', render: (p) => p.batchCode },
                { key: 'subject', header: 'Subject', render: (p) => p.subjectName },
                { key: 'teacher', header: 'Teacher', render: (p) => p.teacherName },
                { key: 'room', header: 'Room', render: (p) => p.roomCode ?? (p.onlineLink ? 'Online' : '—') },
                { key: 'range', header: 'Dates', render: (p) => `${p.effectiveFrom} to ${p.effectiveTo ?? 'open'}` },
                { key: 'status', header: 'Status', render: (p) => <PlanBadge status={p.status} /> },
              ]}
            />
          </Card>
          {canWrite ? (
            <Card title="New draft pattern" description="Nothing is scheduled until you preview and publish the pattern.">
              <ApiForm
                action={MODULE_PATHS.api('patterns')}
                submitLabel="Save draft pattern"
                successMessage="Draft saved. Open it to preview and publish."
                idPrefix="pattern"
                fields={[
                  { name: 'batchId', label: 'Batch', type: 'select', required: true, options: data.data.batches.map((b) => ({ value: b.id, label: b.code })) },
                  { name: 'subjectId', label: 'Subject', type: 'select', required: true, hint: 'Pick a subject of the same batch.', options: data.data.subjects },
                  { name: 'staffId', label: 'Teacher', type: 'select', required: true, options: data.data.staff.map((s) => ({ value: s.id, label: s.fullName })) },
                  { name: 'weekday', label: 'Weekday', type: 'select', required: true, options: WEEKDAY_NAMES.map((d, i) => ({ value: String(i + 1), label: d })) },
                  { name: 'startTime', label: 'Start (HH:MM)', type: 'time', required: true },
                  { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', required: true },
                  { name: 'roomId', label: 'Room (optional)', type: 'select', options: data.data.rooms.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` })) },
                  { name: 'onlineLink', label: 'Online link (optional)' },
                  { name: 'effectiveFrom', label: 'First date', type: 'date', required: true },
                  { name: 'effectiveTo', label: 'Last date', type: 'date', required: true },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
