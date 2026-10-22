import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, ButtonLink, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { demoCandidates, getSessionAttendance, listStaff, sessionHistory, sessionRows, sessionTeachers, todayIst } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiForm } from '../../../../ui/api-form';
import { AttendanceForm } from '../../../../ui/attendance-form';
import { StateBadge, fmtDateTime } from '../../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';
import '../../../../ui/workspace.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Class' };

const ACTION_LABELS: Record<string, string> = {
  'attendance.recorded': 'Attendance recorded',
  'attendance.corrected': 'Attendance changed',
  'attendance.bulk_present': 'Remaining students marked present',
  'class_session.delivered': 'Marked delivered',
  'class_session.reopened': 'Delivery reopened',
  'class_session.substitute_assigned': 'Substitute authorised',
  'class_session.scheduled': 'Scheduled',
  'class_session.cancelled': 'Cancelled',
  'class_session.rescheduled': 'Rescheduled',
  'demo_attendee.added': 'Demo student added',
  'demo_attendee.removed': 'Demo student removed',
};

/** The class page: delivery, roster and attendance (incl. demo students), teachers and history — each recorded separately (R12). */
export default async function ClassPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const access = await gate('academic:attendance:read', MODULE_PATHS.attendance(sessionId));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="attendance">{null}</AcademicShell>;
  const db = getDb();
  const user = access.user;
  const actor = actorFor(user);
  const data = await load(async () => {
    const attendance = await getSessionAttendance(db, actor, sessionId); // checks scope first
    const canRecord = can(user, 'academic:attendance:record');
    return {
      ...attendance,
      info: (await sessionRows(db, { ids: [sessionId] }))[0]!,
      teachers: await sessionTeachers(db, sessionId),
      history: await sessionHistory(db, sessionId),
      candidates: canRecord && attendance.session.status !== 'cancelled' && attendance.session.status !== 'rescheduled' ? await demoCandidates(db, actor, sessionId) : null,
      staff: can(user, 'academic:timetable:publish') ? await listStaff(db) : [],
    };
  });
  if (!data.ok) return <AcademicShell access={access} active="attendance"><LoadError error={data.error} /></AcademicShell>;
  const { session, info, roster, demoAttendees, counts, teachers, history, candidates, staff } = data.data;
  const live = session.status === 'scheduled' || session.status === 'held';
  const past = session.date <= todayIst();
  const canRecord = can(user, 'academic:attendance:record') && live && past;
  const actual = teachers.filter((t) => t.participation === 'actual' && !t.removedAt);
  const where = info.roomCode ? `Room ${info.roomCode}` : session.onlineLink ? 'Online' : 'No room set';
  return (
    <AcademicShell access={access} active="attendance" loading="Loading class…">
      <PageHeader
        title={`${info.batchCode} · ${info.subjectName ?? 'Class'}`}
        meta={<StateBadge state={session.status === 'held' ? 'delivered' : session.status} />}
        description={`${session.date}, ${session.startTime} IST · ${session.durationMinutes} min · ${where} · Planned teacher: ${info.teacherName ?? 'not set'}`}
        actions={
          <>
            {session.onlineLink ? <ButtonLink href={session.onlineLink}>Open class link</ButtonLink> : null}
            <ButtonLink href={MODULE_PATHS.teachingLog(session.id)}>Teaching log</ButtonLink>
          </>
        }
      />
      <div className="el-stack">
        {session.status === 'cancelled' || session.status === 'rescheduled' ? <Alert tone="warning" title={`This class was ${session.status}`}>{session.statusReason}</Alert> : null}

        <Card title="Delivery" description="Delivery, attendance and the teaching log are recorded separately. Marking a class delivered never records HR attendance.">
          {session.status === 'held' ? (
            <div className="el-stack">
              <p>
                Delivered {fmtDateTime(session.deliveredAt)} · taught by {actual.map((t) => `${t.name} (${t.role.replace('_', '-')})`).join(', ') || 'not recorded'}
                {session.deliveryNote ? ` · Note: ${session.deliveryNote}` : ''}
              </p>
              {can(user, 'academic:timetable:write') ? (
                <details className="acd-no-print">
                  <summary>Reopen delivery (correction)</summary>
                  <ApiForm action={MODULE_PATHS.api(`sessions/${session.id}/reopen`)} submitLabel="Reopen delivery" variant="danger" successMessage="Reopened. The correction is in the history." idPrefix="reopen" fields={[{ name: 'reason', label: 'Reason', required: true }]} />
                </details>
              ) : null}
            </div>
          ) : session.status === 'scheduled' ? (
            past && can(user, 'academic:classes:record') ? (
              <ApiForm
                action={MODULE_PATHS.api(`sessions/${session.id}/deliver`)}
                extra={{ version: session.version }}
                submitLabel="Mark delivered"
                successMessage="Marked delivered."
                idPrefix="deliver"
                fields={[{ name: 'note', label: 'Delivery note (optional)', type: 'textarea' }]}
              />
            ) : (
              <p>Not delivered yet. {past ? '' : `A class can be marked delivered on or after its date (${session.date}).`}</p>
            )
          ) : (
            <p>Not delivered: the class was {session.status}.</p>
          )}
        </Card>

        <Card
          title="Roster and attendance"
          description={`Students placed in the batch on ${session.date}, plus demo students. Present ${counts.present} · Late ${counts.late} · Partial ${counts.partial} · Absent ${counts.absent} · Excused ${counts.excused} · Not recorded ${counts.notRecorded}. Not recorded is never counted as absent.`}
        >
          {roster.length + demoAttendees.length === 0 ? (
            <EmptyState title="Nobody on this roster" description="No student was placed in this batch on the class date. Place students from Enrolments; demo students can be added below." />
          ) : (
            <AttendanceForm
              action={MODULE_PATHS.api(`sessions/${session.id}/attendance`)}
              bulkAction={MODULE_PATHS.api(`sessions/${session.id}/attendance/mark-remaining`)}
              canRecord={canRecord}
              roster={roster.map((r) => ({ studentId: r.studentId, code: r.code, fullName: r.fullName, isSample: r.isSample, onPlacement: r.onPlacement, status: r.mark?.status ?? null, minutesPresent: r.mark?.minutesPresent ?? null, reviewHref: `${MODULE_PATHS.newReview}?studentId=${r.studentId}&sessionId=${session.id}` }))}
              demos={demoAttendees.map((d) => ({ attendeeId: d.id, displayName: d.displayName, dayNumber: d.demoDayNumber, status: d.status, isSample: d.isSample, reviewHref: `${MODULE_PATHS.newReview}?coreStudentId=${d.coreStudentId}&opsDemoSessionId=${d.opsDemoSessionId}` }))}
            />
          )}
        </Card>

        {candidates ? (
          <Card title="Add a demo student" description="Demo students booked in Business Ops for this date. A demo student gets no enrolment; their mark here feeds the Day 1/2/3 view in Business Ops.">
            {demoAttendees.filter((d) => d.status === 'not_recorded').map((d) => (
              <details key={d.id}>
                <summary>Remove {d.displayName} (added by mistake)</summary>
                <ApiForm action={MODULE_PATHS.api(`demo-attendees/${d.id}`)} method="DELETE" submitLabel={`Remove ${d.displayName}`} variant="danger" successMessage="Removed from this class." idPrefix={`rm-${d.id}`} fields={[{ name: 'reason', label: 'Reason', required: true }]} />
              </details>
            ))}
            {candidates.status === 'unavailable' ? (
              <Alert tone="warning" title="Business Ops unavailable">Demo bookings could not be loaded ({candidates.reason}). Try again later.</Alert>
            ) : candidates.data.items.length === 0 ? (
              <EmptyState title="No other demo students on this date" description="Book demo sessions in Business Ops; they appear here for the class date." />
            ) : (
              <ApiForm
                action={MODULE_PATHS.api('demo-attendees')}
                extra={{ sessionId: session.id }}
                submitLabel="Add to this class"
                successMessage="Added to the roster."
                idPrefix="demo"
                fields={[{ name: 'opsDemoSessionId', label: 'Demo student', type: 'select', required: true, options: candidates.data.items.map((i) => ({ value: i.demoSessionId, label: `${i.displayName} · Day ${i.dayNumber}${i.subject ? ` · ${i.subject}` : ''}${i.isSample ? ' (sample)' : ''}` })) }]}
              />
            )}
          </Card>
        ) : null}

        <Card title="Teachers on this class" description="Planned and actual teachers. A substitute is added beside the original teacher; nobody is replaced automatically.">
          <DataTable
            compact
            rows={teachers}
            rowKey={(t) => t.id}
            empty={<p>Only the planned teacher ({info.teacherName ?? 'not set'}) is on record.</p>}
            columns={[
              { key: 'name', header: 'Teacher', render: (t) => t.name },
              { key: 'role', header: 'Role', render: (t) => t.role.replace('_', '-') },
              { key: 'part', header: 'Recorded as', render: (t) => (t.removedAt ? <StatusBadge tone="neutral">{t.participation}, withdrawn</StatusBadge> : t.participation) },
              { key: 'reason', header: 'Reason', render: (t) => t.reason ?? '—' },
            ]}
          />
          {staff.length && session.status === 'scheduled' ? (
            <details className="acd-no-print">
              <summary>Authorise a substitute</summary>
              <ApiForm
                action={MODULE_PATHS.api(`sessions/${session.id}/substitute`)}
                submitLabel="Authorise substitute"
                successMessage="Substitute authorised; the original teacher stays on record."
                idPrefix="sub"
                fields={[
                  { name: 'staffId', label: 'Substitute', type: 'select', required: true, options: staff.filter((s) => s.id !== session.teacherStaffId).map((s) => ({ value: s.id, label: s.fullName })) },
                  { name: 'reason', label: 'Reason', required: true },
                ]}
              />
            </details>
          ) : null}
        </Card>

        <details className="el-explain">
          <summary>History of this class ({history.length})</summary>
          <DataTable
            compact
            rows={history.map((h, i) => ({ ...h, key: String(i) }))}
            rowKey={(h) => h.key}
            columns={[
              { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
              { key: 'action', header: 'What', render: (h) => ACTION_LABELS[h.action] ?? h.action },
              { key: 'by', header: 'By', render: (h) => h.actorName ?? 'System' },
              { key: 'reason', header: 'Reason and changes', render: (h) => [h.reason, ...h.changes.map((c) => `${c.name ?? ''}: ${c.from} → ${c.to}`)].filter(Boolean).join(' · ') || '—' },
            ]}
          />
        </details>
      </div>
    </AcademicShell>
  );
}
