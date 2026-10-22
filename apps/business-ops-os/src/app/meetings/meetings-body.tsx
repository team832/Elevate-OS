/**
 * "My meetings" (D-073): the caller's own appointments and events, read-only, for a host
 * workspace (Academic OS) whose page checks `ops:appointments:read`. Scheduling and changes
 * stay in Business Ops. Names only: `getAppointment` restricts guardians and never returns
 * contacts. Every link is built from `base`.
 */
import { EmptyState, PageHeader } from '@elevate/shared-ui';
import { addDays, istToday, isIsoDate } from '../../domain';
import { APPOINTMENT_TYPE_LABELS } from '../../domain/appointments';
import { getAppointment, listMyMeetings, type AppointmentListRow } from '../../server/appointments';
import { fmtDate, fmtDateTime, humanise } from '../../ui/format';
import { load, Section } from '../../ui/frame';
import { listHref, Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import type { BodyProps } from '../tasks/_components/bodies';
import '../ops.css';
import { ApptStatus, modeText, SampleBadge, TypeBadge } from './appointment-view';

/** Days shown per window: today and the next 14. */
const SPAN = 14;

export function MeetingsBody({ user, base, searchParams: sp }: BodyProps) {
  return (
    <>
      <PageHeader
        title="My meetings"
        description="Counselling, parent-teacher meetings and events you take part in. Times are IST. Business Operations schedules and changes them."
      />
      <Section>
        <Meetings user={user} base={base} searchParams={sp} />
      </Section>
    </>
  );
}

async function Meetings({ user, base, searchParams: sp }: BodyProps) {
  const self = `${base}/meetings`;
  const from = isIsoDate(sp.from) ? sp.from : istToday(new Date());
  const to = addDays(from, SPAN);
  const r = await load(async (db) => ({
    list: await listMyMeetings(db, user, { from, to, page: Math.max(1, Number(sp.page) || 1) }),
    open: sp.open ? await getAppointment(db, user, sp.open) : null,
    asOf: new Date(),
  }));
  if (!r.ok) return r.view;
  const { list, open, asOf } = r.data;
  if (!list)
    return (
      <EmptyState
        title="No staff record"
        description="Your sign-in is not linked to a staff record, so no meetings can be shown. Ask an academic coordinator."
      />
    );
  const shift = (days: number) =>
    listHref(self, sp, { from: addDays(from, days), page: undefined, open: undefined });
  return (
    <div className="el-stack">
      {open ? (
        <Segment
          title={`${APPOINTMENT_TYPE_LABELS[open.type]}: ${open.personName}`}
          meta={<SampleBadge show={open.studentSample} />}
          actions={<a href={listHref(self, sp, { open: undefined })}>Back to the list</a>}
        >
          <DetailTable
            rows={[
              { label: 'Status', value: <ApptStatus status={open.status} /> },
              {
                label: 'When',
                value: `${fmtDateTime(open.startsAt)} to ${fmtDateTime(open.endsAt)}`,
              },
              { label: 'Teacher / counsellor', value: open.staffName },
              { label: 'Where', value: modeText(open.mode, open.location) },
              !!open.onlineLink && { label: 'Online link', value: open.onlineLink },
              { label: 'Subject', value: open.subject ?? 'Not recorded' },
              { label: 'Purpose or notes', value: open.purpose ?? 'Not recorded' },
              !!open.outcome && { label: 'Outcome', value: open.outcome },
              !!open.cancelReason && { label: 'Cancelled because', value: open.cancelReason },
            ]}
          />
          <RecordTable
            caption="Participants (names only)"
            rows={open.participants.filter((p) => !p.removedAt)}
            rowKey={(p) => p.id}
            empty="No participants recorded."
            columns={[
              { key: 'name', header: 'Name', render: (p) => p.name },
              { key: 'role', header: 'As', render: (p) => humanise(p.role ?? p.kind) },
            ]}
          />
        </Segment>
      ) : null}
      <nav className="el-inline-form" aria-label="Dates">
        <a href={shift(-SPAN - 1)}>Earlier</a>
        <strong>
          {fmtDate(from)} to {fmtDate(to)}
        </strong>
        <a href={shift(SPAN + 1)}>Later</a>
      </nav>
      <RecordTable<AppointmentListRow>
        caption={`${list.total} meeting${list.total === 1 ? '' : 's'} you take part in, by start time. As of ${fmtDateTime(asOf)}.`}
        rows={list.rows}
        rowKey={(a) => a.id}
        rowHref={(a) => listHref(self, sp, { open: a.id })}
        linkColumn="person"
        empty={
          <EmptyState
            title="No meetings in these dates"
            description="Look at earlier or later dates. Business Operations books meetings with you."
          />
        }
        columns={[
          {
            key: 'person',
            header: 'Student or event',
            render: (a) => (
              <>
                {a.personName} <SampleBadge show={a.studentSample} />
              </>
            ),
          },
          { key: 'when', header: 'When', render: (a) => fmtDateTime(a.startsAt) },
          { key: 'type', header: 'Type', render: (a) => <TypeBadge type={a.type} /> },
          { key: 'mode', header: 'Where', render: (a) => modeText(a.mode, a.location) },
          { key: 'status', header: 'Status', render: (a) => <ApptStatus status={a.status} /> },
        ]}
      />
      <Pager
        basePath={self}
        params={sp}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
    </div>
  );
}
