import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { metric } from '@elevate/shared-contracts';
import { Card, DataTable, MetricStrip, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { addDays, isIsoDate, type IsoDate } from '@elevate/shared-types';
import { teacherProfile, todayIst, UNAVAILABILITY_LABEL } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { ApiForm } from '../../../ui/api-form';
import { PlanBadge, StateBadge } from '../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teacher' };

const PART_LABELS: Record<string, string> = { planned: 'Planned', delivered: 'Delivered', substituted: 'Covered by another teacher', cancelled: 'Cancelled or moved' };

export default async function TeacherPage({ params, searchParams }: { params: Promise<{ staffId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { staffId } = await params;
  const access = await gate('academic:assignments:read', MODULE_PATHS.teacher(staffId));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="teachers">{null}</AcademicShell>;
  const sp = await searchParams;
  const pick = (v: unknown) => (typeof v === 'string' && isIsoDate(v) ? v : undefined);
  const to = pick(sp.to) ?? todayIst();
  const from = pick(sp.from) ?? addDays(to as IsoDate, -29);
  const data = await load(() => teacherProfile(getDb(), actorFor(access.user), staffId, { from, to: to < from ? from : to }));
  if (!data.ok) return <AcademicShell access={access} active="teachers"><LoadError error={data.error} /></AcademicShell>;
  const p = data.data;
  const canManage = can(access.user, 'academic:timetable:write');
  const window = { from, to };
  const hours = [
    ['Planned', p.hours.plannedMinutes, 'Scheduled classes this teacher is planned to teach (not yet delivered).'],
    ['Delivered', p.hours.deliveredMinutes, 'Classes marked delivered with this teacher as an actual teacher. A co-taught class counts for each teacher.'],
    ['Covered by another teacher', p.hours.substitutedMinutes, 'Planned for this teacher; a substitute covers or covered it.'],
    ['Cancelled or moved', p.hours.cancelledMinutes, 'Cancelled or rescheduled classes this teacher was planned for.'],
  ] as const;
  return (
    <AcademicShell access={access} active="teachers">
      <PageHeader title={p.staff.name} meta={<StatusBadge tone="neutral">{p.hrAttendance}</StatusBadge>} description={`${p.staff.title ?? 'Teacher'} · figures for ${from} to ${p.window.to}. Operational hours, not payroll.`} />
      <div className="el-stack">
        <form method="get" className="el-grid" style={{ alignItems: 'end' }}>
          <label>
            From <input type="date" name="from" defaultValue={from} className="el-input" />
          </label>
          <label>
            To <input type="date" name="to" defaultValue={p.window.to} className="el-input" />
          </label>
          <button type="submit" className="el-button el-button-secondary">Show</button>
        </form>
        <MetricStrip label={`Teaching time ${from} to ${p.window.to}`} items={hours.map(([label, minutes, definition]) => ({ label, metric: metric.ok(minutes, { definition, window, unit: 'minutes' }), note: definition }))} />
        <Card title="Assignments" description="Effective-dated batch and subject assignments, including ended ones. Reassigning never changes who taught a past class.">
          <DataTable
            compact
            rows={p.assignments}
            rowKey={(a) => a.id}
            empty={<p>No assignments.</p>}
            columns={[
              { key: 'batch', header: 'Batch', render: (a) => <a href={MODULE_PATHS.batch(a.batchId)}>{a.batchCode}</a> },
              { key: 'subject', header: 'Subject', render: (a) => a.subjectName },
              { key: 'role', header: 'Role', render: (a) => a.role.replace('_', '-') },
              { key: 'dates', header: 'Dates', render: (a) => `${a.startDate ?? 'from the start'} to ${a.endDate ?? 'open'}` },
              { key: 'status', header: 'Status', render: (a) => <StateBadge state={a.status} /> },
            ]}
          />
        </Card>
        <Card title="Classes" description={`${from} to ${p.window.to}`}>
          <DataTable
            compact
            rows={p.sessions}
            rowKey={(s) => s.id}
            empty={<p>No classes in this range.</p>}
            columns={[
              { key: 'when', header: 'Class', render: (s) => <a href={MODULE_PATHS.attendance(s.id)}><strong>{s.date} {s.startTime}</strong></a> },
              { key: 'batch', header: 'Batch', render: (s) => `${s.batchCode} · ${s.subjectName ?? ''}` },
              { key: 'length', header: 'Length', render: (s) => `${s.durationMinutes} min` },
              { key: 'part', header: 'This teacher', render: (s) => PART_LABELS[s.part] ?? s.part },
            ]}
          />
        </Card>
        <Card title="Availability records" description={`${UNAVAILABILITY_LABEL}. A record flags this teacher's classes for the coordinator; nobody is substituted automatically.`}>
          <DataTable
            compact
            rows={p.unavailability}
            rowKey={(u) => u.id}
            empty={<p>No availability records.</p>}
            columns={[
              { key: 'dates', header: 'Dates', render: (u) => `${u.fromDate} to ${u.toDate}` },
              { key: 'reason', header: 'Reason', render: (u) => u.reason },
              { key: 'state', header: 'State', render: (u) => <PlanBadge status={u.cancelledAt ? 'superseded' : 'locked'} prefix={u.cancelledAt ? 'withdrawn' : 'active'} /> },
              {
                key: 'go',
                header: '',
                render: (u) =>
                  canManage && !u.cancelledAt ? (
                    <details>
                      <summary>Withdraw</summary>
                      <ApiForm action={MODULE_PATHS.api(`unavailability/${u.id}`)} method="DELETE" submitLabel="Withdraw record" variant="danger" successMessage="Withdrawn; the record is kept in the history." idPrefix={`withdraw-${u.id}`} fields={[{ name: 'reason', label: 'Reason', required: true }]} />
                    </details>
                  ) : null,
              },
            ]}
          />
          {canManage ? (
            <details>
              <summary>Record unavailability</summary>
              <ApiForm
                action={MODULE_PATHS.api('unavailability')}
                extra={{ staffId }}
                submitLabel="Save availability record"
                successMessage="Saved. Affected classes are listed on the Academic overview as uncovered until a substitute is authorised."
                idPrefix="away"
                fields={[
                  { name: 'fromDate', label: 'From', type: 'date', required: true },
                  { name: 'toDate', label: 'To', type: 'date', required: true },
                  { name: 'reason', label: 'Reason', required: true },
                ]}
              />
            </details>
          ) : null}
        </Card>
        <Card title="HR attendance">
          <p>{p.hrAttendance}. Elevate OS has no HR attendance or leave source; delivery records are not HR attendance.</p>
        </Card>
      </div>
    </AcademicShell>
  );
}
