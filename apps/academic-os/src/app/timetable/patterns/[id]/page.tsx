import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { ButtonLink, Card, DataTable, PageHeader } from '@elevate/shared-ui';
import { WEEKDAY_NAMES } from '../../../../domain';
import { listRooms, listStaff, previewPattern } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { ApiButton, ApiForm } from '../../../../ui/api-form';
import { PlanBadge, StateBadge } from '../../../../ui/badges';
import { ConflictList } from '../../../../ui/conflicts';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Timetable pattern' };

/** Validate → preview → publish one pattern; edit a published series from a date. */
export default async function PatternPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('academic:timetable:read', MODULE_PATHS.pattern(id));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="timetable">{null}</AcademicShell>;
  const canPublish = can(access.user, 'academic:timetable:publish');
  const canWrite = can(access.user, 'academic:timetable:write');
  const data = await load(async () => ({ preview: await previewPattern(getDb(), actorFor(access.user), id), staff: canWrite ? await listStaff(getDb()) : [], rooms: canWrite ? await listRooms(getDb()) : [] }));
  if (!data.ok) return <AcademicShell access={access} active="timetable"><LoadError error={data.error} /></AcademicShell>;
  const { pattern, occurrences, toCreate, check } = data.data.preview;
  const staffOptions = data.data.staff.map((s) => ({ value: s.id, label: s.fullName }));
  const roomOptions = data.data.rooms.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }));
  const weekdayOptions = WEEKDAY_NAMES.map((d, i) => ({ value: String(i + 1), label: d }));
  return (
    <AcademicShell access={access} active="timetable">
      <PageHeader
        title={`${WEEKDAY_NAMES[pattern.weekday - 1]} ${pattern.startTime} · ${pattern.durationMinutes} min`}
        meta={<PlanBadge status={pattern.status} />}
        description={`${pattern.effectiveFrom} to ${pattern.effectiveTo}. ${toCreate.length} class(es) still to be created; ${occurrences.filter((o) => o.skipped).length} date(s) skipped for closures.`}
        actions={<ButtonLink href={MODULE_PATHS.patterns}>All patterns</ButtonLink>}
      />
      <div className="el-stack">
        <Card title="Conflict check" description="Checked on the server against every batch: teacher (incl. co-teachers, substitutes and availability records), room, batch and students placed in two batches. Cancelled classes do not count.">
          <ConflictList verdict={check.verdict} hard={check.hard} preferences={check.preferences} notes={check.notes} />
        </Card>
        {canPublish && pattern.status !== 'retired' && toCreate.length > 0 ? (
          <Card title={pattern.status === 'draft' ? 'Publish' : 'Create the missing classes'} description={`Creates ${toCreate.length} class(es). Refused while any hard conflict remains; running it again never creates duplicates.`}>
            <ApiButton action={MODULE_PATHS.api(`patterns/${pattern.id}/publish`)} body={{ version: pattern.version }} label={`Publish ${toCreate.length} class(es)`} variant="primary" successMessage="Published." />
          </Card>
        ) : null}
        {canWrite && pattern.status === 'draft' ? (
          <Card title="Edit the draft" description="Leave a field blank to keep it. Nothing is scheduled until the draft is published.">
            <ApiForm
              action={MODULE_PATHS.api(`patterns/${pattern.id}`)}
              method="PATCH"
              extra={{ version: pattern.version }}
              submitLabel="Save draft"
              successMessage="Draft saved; the preview above is refreshed."
              idPrefix="draft"
              fields={[
                { name: 'weekday', label: 'Weekday', type: 'select', options: weekdayOptions },
                { name: 'startTime', label: 'Start (HH:MM)', type: 'time' },
                { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number' },
                { name: 'staffId', label: 'Teacher', type: 'select', options: staffOptions },
                { name: 'roomId', label: 'Room', type: 'select', options: roomOptions },
                { name: 'effectiveFrom', label: 'First date', type: 'date' },
                { name: 'effectiveTo', label: 'Last date', type: 'date' },
              ]}
            />
            <details>
              <summary>Delete this draft</summary>
              <ApiForm
                action={MODULE_PATHS.api(`patterns/${pattern.id}`)}
                method="DELETE"
                extra={{ version: pattern.version }}
                submitLabel="Delete draft"
                variant="danger"
                successMessage="Draft deleted."
                goTo={MODULE_PATHS.patterns}
                idPrefix="delete-draft"
                fields={[{ name: 'confirm', label: 'I understand this draft will be deleted', type: 'checkbox', required: true }]}
              />
            </details>
          </Card>
        ) : null}
        {canPublish && pattern.status === 'published' ? (
          <Card title="Change the series from a date" description="Classes from the effective date onward move to the new time, teacher or room; earlier and delivered classes stay exactly as they were. To change one class, reschedule it from the timetable instead.">
            <ApiForm
              action={MODULE_PATHS.api(`patterns/${pattern.id}/series`)}
              extra={{ version: pattern.version }}
              submitLabel="Change series"
              successMessage="Series changed. Later classes were moved; the history keeps the old ones as cancelled."
              idPrefix="series"
              fields={[
                { name: 'effectiveDate', label: 'From date (after today)', type: 'date', required: true },
                { name: 'startTime', label: 'New start (HH:MM)', type: 'time' },
                { name: 'durationMinutes', label: 'New duration (minutes)', type: 'number' },
                { name: 'weekday', label: 'New weekday', type: 'select', options: weekdayOptions },
                { name: 'staffId', label: 'New teacher', type: 'select', options: staffOptions },
                { name: 'roomId', label: 'New room', type: 'select', options: roomOptions },
                { name: 'reason', label: 'Reason', required: true },
              ]}
            />
          </Card>
        ) : null}
        <Card title="Dates">
          <DataTable
            compact
            rows={occurrences}
            rowKey={(o) => o.date}
            columns={[
              { key: 'date', header: 'Date', render: (o) => (o.sessionId ? <a href={MODULE_PATHS.attendance(o.sessionId)}>{o.date}</a> : o.date) },
              { key: 'state', header: 'State', render: (o) => (o.sessionId ? 'Created (open the class for its status)' : o.skipped ? `Skipped: ${o.skipped}` : o.conflicts.length ? <StateBadge state="infeasible" /> : 'To be created') },
              { key: 'conflicts', header: 'Conflicts', render: (o) => o.conflicts.join(' ') || '—' },
            ]}
          />
        </Card>
      </div>
    </AcademicShell>
  );
}
