import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { APPOINTMENT_TYPE_LABELS } from '../../../domain/appointments';
import { getAppointment } from '../../../server/appointments';
import { AdmissionsNav } from '../../../ui/admissions-nav';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import {
  APPOINTMENT_ACTS,
  AppointmentActModal,
  appointmentTabs,
  ApptStatus,
  SampleBadge,
  type AppointmentAct,
} from '../appointment-view';
import { EVENT_ACTS } from '../event-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Appointment' };

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ act?: string }>;
}) {
  const { id } = await params;
  const access = await gate('ops:appointments:read', `/ops/meetings/${id}`);
  const { act } = await searchParams;
  return (
    <Frame access={access} active="meetings">
      <Section>
        <Detail user={access.user} id={id} act={APPOINTMENT_ACTS.find((a) => a === act)} />
      </Section>
    </Frame>
  );
}

async function Detail({
  user,
  id,
  act,
}: {
  user: AuthenticatedUser;
  id: string;
  act?: AppointmentAct;
}) {
  const r = await load((db) => getAppointment(db, user, id));
  if (!r.ok) return r.view;
  const a = r.data;
  const self = `/ops/meetings/${a.id}`;
  return (
    <div className="el-stack">
      <PageHeader
        title={`${APPOINTMENT_TYPE_LABELS[a.type]}: ${a.personName}`}
        meta={
          <>
            <ApptStatus status={a.status} /> <SampleBadge show={a.studentSample} />
          </>
        }
        description={
          <>
            {fmtDateTime(a.startsAt)} · <a href="/ops/meetings">All appointments</a>
          </>
        }
        tabs={<AdmissionsNav current="meetings" user={user} />}
      />
      {appointmentTabs(
        a,
        user,
        // Event flows run in the list's pop-up (they need its pickers).
        (x) =>
          (EVENT_ACTS as readonly string[]).includes(x)
            ? `/ops/meetings?open=${a.id}&act=${x}`
            : `${self}?act=${x}`,
        2,
      ).map((t) => (
        <div key={t.key}>{t.content}</div>
      ))}
      {act ? <AppointmentActModal act={act} a={a} user={user} closeHref={self} /> : null}
    </div>
  );
}
