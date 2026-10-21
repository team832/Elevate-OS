import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader, Tabs, type Column } from '@elevate/shared-ui';
import { addDays, istToday, istWeekContaining, isIsoDate, type IsoDate } from '../../domain';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPES,
  GROUP_APPOINTMENT_TYPES,
  isGroupType,
} from '../../domain/appointments';
import {
  getAppointment,
  listAppointments,
  studentPickerOptions,
  type AppointmentListRow,
} from '../../server/appointments';
import { formOptions } from '../../server/options';
import { staffPickerOptions } from '../../server/teachers';
import { ActionForm } from '../../ui/action-form';
import { AdmissionsNav } from '../../ui/admissions-nav';
import { fmtDate, fmtDateTime } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref, options, Pager, SearchPanel } from '../../ui/list-controls';
import { FormModal, RecordModal } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { Segment } from '../../ui/sections';
import {
  APPOINTMENT_ACTS,
  AppointmentActModal,
  appointmentTabs,
  ApptStatus,
  modeText,
  SampleBadge,
  TypeBadge,
} from './appointment-view';
import { audienceFields, EVENT_ACTS, EventActModal, MessageBadge } from './event-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Events and counselling' };

type Params = Record<string, string | undefined>;
const BASE = '/ops/meetings';
const TYPE_OPTIONS = APPOINTMENT_TYPES.map((t) => ({
  value: t,
  label: APPOINTMENT_TYPE_LABELS[t],
}));
const ONE_TO_ONE_OPTIONS = TYPE_OPTIONS.filter((o) => !isGroupType(o.value));
const EVENT_TYPE_OPTIONS = GROUP_APPOINTMENT_TYPES.map((t) => ({
  value: t,
  label: APPOINTMENT_TYPE_LABELS[t],
}));
const MODE_OPTIONS = [
  { value: 'offline', label: 'Offline, Sikar centre' },
  { value: 'online', label: 'Online' },
];

const timeOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' });

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:appointments:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="meetings">
      <PageHeader
        title="Events and counselling"
        description="Counselling, parent-teacher meetings, events and webinars. Times are IST; scheduling sends nothing."
        actions={
          can(access.user, 'ops:appointments:manage') ? (
            <>
              <ButtonLink
                variant="primary"
                href={listHref(BASE, sp, { new: '1', open: undefined, act: undefined })}
              >
                Schedule an appointment
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                href={listHref(BASE, sp, { newEvent: '1', open: undefined, act: undefined })}
              >
                Schedule an event or webinar
              </ButtonLink>
            </>
          ) : undefined
        }
        tabs={<AdmissionsNav current="meetings" user={access.user} />}
      />
      <Section>
        <Body user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function Body({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const view = sp.view === 'week' || sp.view === 'past' ? sp.view : 'list';
  const todayIso = istToday(new Date());
  const week = istWeekContaining(isIsoDate(sp.week) ? sp.week : todayIso);
  const page = Math.max(1, Number(sp.page) || 1);
  const manage = can(user, 'ops:appointments:manage');
  const scheduling = manage && Boolean(sp.new);
  const eventForm = manage && Boolean(sp.newEvent);
  const act = APPOINTMENT_ACTS.find((a) => a === sp.act);
  const eventAct = EVENT_ACTS.find((a) => a === sp.act);
  const needsPickers = scheduling || eventForm || Boolean(eventAct);
  const filters = {
    q: sp.q?.trim() || undefined,
    type: APPOINTMENT_TYPES.find((t) => t === sp.type),
    status: APPOINTMENT_STATUSES.find((s) => s === sp.status),
    staffId: sp.staffId || undefined,
    ...(view === 'week'
      ? week
      : {
          // Upcoming starts tomorrow (today has its own table); Past ends yesterday. A typed date wins.
          from: isIsoDate(sp.from) ? sp.from : view === 'list' ? addDays(todayIso, 1) : undefined,
          to: isIsoDate(sp.to) ? sp.to : view === 'past' ? addDays(todayIso, -1) : undefined,
        }),
    page: view === 'week' ? 1 : page,
  };
  const r = await load(async (db) => {
    const [list, today, staff, picker, students, open, programmes] = await Promise.all([
      listAppointments(db, user, filters, view === 'week' ? 200 : 25),
      view === 'list' && page === 1
        ? listAppointments(db, user, { from: todayIso, to: todayIso }, 50)
        : null,
      can(user, 'ops:teachers:read') ? staffPickerOptions(db, user) : [],
      scheduling || eventForm ? staffPickerOptions(db, user, sp.pickSubject) : [],
      needsPickers ? studentPickerOptions(db, user) : [],
      sp.open ? getAppointment(db, user, sp.open) : null,
      needsPickers ? (await formOptions(db)).programmes : [],
    ]);
    return { list, today, staff, picker, students, open, programmes };
  });
  if (!r.ok) return r.view;
  const { list, today, staff, picker, students, open, programmes } = r.data;
  const rowHref = (a: AppointmentListRow) =>
    listHref(BASE, sp, { open: a.id, act: undefined, new: undefined });
  const tabHref = (v?: string) =>
    listHref(BASE, sp, {
      view: v,
      page: undefined,
      open: undefined,
      act: undefined,
      week: undefined,
    });
  return (
    <div className="el-stack">
      {today ? (
        <Segment title={`Today, ${fmtDate(todayIso)}`} flush>
          <RecordTable
            caption={`${today.total} today, in time order`}
            rows={today.rows}
            rowKey={(a) => a.id}
            rowHref={rowHref}
            linkColumn="student"
            empty="Nothing booked for today."
            columns={columns('Time (IST)', (a) => timeOnly.format(a.startsAt))}
          />
        </Segment>
      ) : null}
      <SearchPanel
        action={BASE}
        hidden={view === 'list' ? {} : { view }}
        search={{ name: 'q', label: 'Student name or event title', value: sp.q }}
        filters={[
          {
            name: 'type',
            label: 'Type',
            type: 'select',
            value: filters.type,
            options: TYPE_OPTIONS,
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            value: filters.status,
            options: options(APPOINTMENT_STATUSES),
          },
          ...(staff.length
            ? [
                {
                  name: 'staffId',
                  label: 'Teacher / counsellor',
                  type: 'select' as const,
                  value: sp.staffId,
                  options: staff,
                },
              ]
            : []),
          ...(view !== 'week'
            ? [
                {
                  name: 'from',
                  label: 'From',
                  type: 'date' as const,
                  value: isIsoDate(sp.from) ? sp.from : undefined,
                },
                {
                  name: 'to',
                  label: 'To',
                  type: 'date' as const,
                  value: isIsoDate(sp.to) ? sp.to : undefined,
                },
              ]
            : [{ name: 'week', label: 'Week containing', type: 'date' as const, value: sp.week }]),
        ]}
      />
      <Tabs
        idBase="meetings-view"
        label="Appointment views"
        selected={view}
        items={[
          { key: 'list', label: 'Upcoming', href: tabHref() },
          { key: 'past', label: 'Past', href: tabHref('past') },
          { key: 'week', label: 'Week', href: tabHref('week') },
        ].map((t) => ({ ...t, count: t.key === view ? list.total : null }))}
      >
        {view === 'week' ? (
          <Week rows={list.rows} from={week.from} sp={sp} />
        ) : (
          <>
            <RecordTable
              caption={`${list.total} ${view === 'past' ? 'past' : 'upcoming'} appointment${list.total === 1 ? '' : 's'}`}
              rows={list.rows}
              rowKey={(a) => a.id}
              rowHref={rowHref}
              empty={
                <EmptyState
                  title={
                    view === 'past' ? 'No past appointments match' : 'Nothing booked after today'
                  }
                  description="Clear a filter, or schedule one if you can book appointments."
                />
              }
              linkColumn="student"
              columns={columns('When', (a) => fmtDateTime(a.startsAt))}
            />
            <Pager
              basePath={BASE}
              params={sp}
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
            />
          </>
        )}
      </Tabs>
      {open && eventAct && isGroupType(open.type) ? (
        <EventActModal
          act={eventAct}
          a={open}
          user={user}
          closeHref={listHref(BASE, sp, { act: undefined, message: undefined })}
          sendHref={`/meetings?open=${open.id}&act=send&message={id}`}
          messageId={sp.message}
          students={students}
          programmes={programmes}
        />
      ) : open && act ? (
        <AppointmentActModal
          act={act}
          a={open}
          user={user}
          closeHref={listHref(BASE, sp, { act: undefined })}
        />
      ) : open ? (
        <RecordModal
          id="appointment-modal"
          title={`${APPOINTMENT_TYPE_LABELS[open.type]}: ${open.personName}`}
          meta={
            <>
              <ApptStatus status={open.status} /> {fmtDateTime(open.startsAt)}{' '}
              <SampleBadge show={open.studentSample} />
            </>
          }
          fullHref={`${BASE}/${open.id}`}
          closeHref={listHref(BASE, sp, { open: undefined, act: undefined })}
          returnId={open.id}
          tabs={appointmentTabs(open, user, (a) => listHref(BASE, sp, { act: a }), 3)}
        />
      ) : scheduling ? (
        <FormModal
          id="schedule-appointment"
          title="Schedule an appointment"
          meta="Times are IST. A clash with the teacher's other bookings is refused."
          closeHref={listHref(BASE, sp, { new: undefined, pickSubject: undefined })}
        >
          <SearchPanel
            action={BASE}
            hidden={{ new: '1', ...(view === 'week' ? { view } : {}) }}
            search={{
              name: 'pickSubject',
              label: 'Narrow teachers by subject (optional)',
              value: sp.pickSubject,
            }}
            submitLabel="Filter teachers"
          />
          {picker.length === 0 ? (
            <p>
              No active teacher has “{sp.pickSubject}” recorded as a subject. Try another subject,
              or clear it to see all staff.
            </p>
          ) : (
            <ActionForm
              action="/ops/api/v1/appointments"
              submitLabel="Schedule appointment"
              // Router path: Next adds the /ops basePath itself (D-022).
              redirectTo={`/meetings?open={id}${view === 'week' ? '&view=week' : ''}`}
              secondary={
                <a href={listHref(BASE, sp, { new: undefined, pickSubject: undefined })}>Cancel</a>
              }
              fields={[
                {
                  name: 'type',
                  label: 'Type',
                  type: 'select',
                  required: true,
                  options: ONE_TO_ONE_OPTIONS,
                  section: 'Who',
                },
                {
                  name: 'staffId',
                  label: 'Teacher / counsellor',
                  type: 'select',
                  required: true,
                  options: picker,
                  section: 'Who',
                },
                {
                  name: 'studentId',
                  label: 'Student',
                  type: 'select',
                  required: true,
                  options: students,
                  section: 'Who',
                },
                {
                  name: 'startsAt',
                  label: 'Starts (IST)',
                  type: 'datetime',
                  required: true,
                  section: 'When',
                },
                {
                  name: 'endsAt',
                  label: 'Ends (IST)',
                  type: 'datetime',
                  hint: 'Leave empty for the default length (setting “Appointment scheduling”).',
                  section: 'When',
                },
                {
                  name: 'mode',
                  label: 'Mode',
                  type: 'select',
                  required: true,
                  options: MODE_OPTIONS,
                  section: 'When',
                },
                {
                  name: 'subject',
                  label: 'Subject',
                  defaultValue: sp.pickSubject,
                  section: 'About',
                },
                { name: 'purpose', label: 'Purpose', type: 'textarea', section: 'About' },
              ]}
            />
          )}
        </FormModal>
      ) : eventForm ? (
        <FormModal
          id="schedule-event"
          title="Schedule an event or webinar"
          meta="Times are IST. Scheduling sends nothing; people matching the audience are listed once, now."
          closeHref={listHref(BASE, sp, { newEvent: undefined })}
        >
          <ActionForm
            action="/ops/api/v1/appointments/events"
            submitLabel="Schedule event"
            // Router path: Next adds the /ops basePath itself (D-022).
            redirectTo="/meetings?open={id}"
            secondary={<a href={listHref(BASE, sp, { newEvent: undefined })}>Cancel</a>}
            fields={[
              { name: 'title', label: 'Title', required: true, section: 'Event' },
              {
                name: 'type',
                label: 'Type',
                type: 'select',
                required: true,
                options: EVENT_TYPE_OPTIONS,
                section: 'Event',
              },
              {
                name: 'staffId',
                label: 'Owner',
                type: 'select',
                options: picker,
                hint: 'Empty: you.',
                section: 'Event',
              },
              { name: 'capacity', label: 'Capacity', type: 'number', section: 'Event' },
              {
                name: 'startsAt',
                label: 'Starts (IST)',
                type: 'datetime',
                required: true,
                section: 'When and where',
              },
              {
                name: 'durationMinutes',
                label: 'Length (minutes)',
                type: 'number',
                hint: 'Empty: the default length (setting “Appointment scheduling”).',
                section: 'When and where',
              },
              {
                name: 'mode',
                label: 'Mode',
                type: 'select',
                required: true,
                options: MODE_OPTIONS,
                section: 'When and where',
              },
              { name: 'onlineLink', label: 'Online link', section: 'When and where' },
              { name: 'location', label: 'Room or place', section: 'When and where' },
              ...audienceFields(programmes, 'Audience'),
              {
                name: 'participantStudentIds',
                label: 'Also invite',
                type: 'select',
                options: students,
                hint: 'More people can be added by hand after scheduling.',
                section: 'Audience',
              },
              { name: 'purpose', label: 'Notes', type: 'textarea', section: 'Notes' },
            ]}
          />
        </FormModal>
      ) : null}
    </div>
  );
}

/** List columns: the person or event leads (it is the row link), then type, who, mode, status. */
const columns = (
  timeHeader: string,
  at: (a: AppointmentListRow) => string,
): Column<AppointmentListRow>[] => [
  {
    key: 'student',
    header: 'Student or event',
    render: (a) => (
      <>
        {a.personName} <SampleBadge show={a.studentSample} />
      </>
    ),
  },
  { key: 'when', header: timeHeader, render: at },
  { key: 'type', header: 'Type', render: (a) => <TypeBadge type={a.type} /> },
  {
    key: 'audience',
    header: 'Audience',
    render: (a) =>
      isGroupType(a.type) ? (
        <>
          {a.participantCount} listed{' '}
          {a.latestMessageStatus ? <MessageBadge status={a.latestMessageStatus} /> : 'No message'}
        </>
      ) : null,
  },
  { key: 'staffName', header: 'Teacher / counsellor' },
  { key: 'mode', header: 'Mode', render: (a) => modeText(a.mode) },
  { key: 'status', header: 'Status', render: (a) => <ApptStatus status={a.status} /> },
];

function Week({ rows, from, sp }: { rows: AppointmentListRow[]; from: IsoDate; sp: Params }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="el-stack">
      <nav className="el-inline-form" aria-label="Weeks">
        <a href={listHref(BASE, sp, { week: addDays(from, -7), open: undefined })}>Previous week</a>
        <strong>
          {fmtDate(from)} to {fmtDate(addDays(from, 6))}
        </strong>
        <a href={listHref(BASE, sp, { week: addDays(from, 7), open: undefined })}>Next week</a>
      </nav>
      {days.map((d) => {
        const today = rows.filter((a) => istToday(a.startsAt) === d);
        return (
          <Segment
            key={d}
            title={`${weekday.format(new Date(`${d}T00:00:00Z`))}, ${fmtDate(d)}`}
            meta={<span className="el-field-hint">{today.length} booked</span>}
            flush
          >
            <RecordTable
              rows={today}
              rowKey={(a) => a.id}
              rowHref={(a) => listHref(BASE, sp, { open: a.id })}
              empty="Nothing booked."
              columns={[
                { key: 'time', header: 'Time (IST)', render: (a) => timeOnly.format(a.startsAt) },
                {
                  key: 'student',
                  header: 'Student or event',
                  render: (a) => (
                    <>
                      {a.personName} <SampleBadge show={a.studentSample} />
                    </>
                  ),
                },
                { key: 'type', header: 'Type', render: (a) => <TypeBadge type={a.type} /> },
                { key: 'staffName', header: 'With' },
                {
                  key: 'status',
                  header: 'Status',
                  render: (a) => <ApptStatus status={a.status} />,
                },
              ]}
            />
          </Segment>
        );
      })}
    </div>
  );
}
