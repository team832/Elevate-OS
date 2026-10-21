import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { getTeacherProfile } from '../../../server/teachers';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { TEACHER_ACTS, TeacherActModal, teacherTabs, type TeacherAct } from '../teacher-record';
import { VerificationBadge } from '../verification-badge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teacher' };

export default async function TeacherPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ act?: string }>;
}) {
  const { id } = await params;
  const access = await gate('ops:teachers:read', `/ops/teachers/${id}`);
  const { act } = await searchParams;
  return (
    <Frame access={access} active="teachers">
      <Section>
        <Profile user={access.user} id={id} act={TEACHER_ACTS.find((a) => a === act)} />
      </Section>
    </Frame>
  );
}

async function Profile({
  user,
  id,
  act,
}: {
  user: AuthenticatedUser;
  id: string;
  act?: TeacherAct;
}) {
  const r = await load((db) => getTeacherProfile(db, user, id));
  if (!r.ok) return r.view;
  const t = r.data;
  const self = `/ops/teachers/${t.staff.id}`;
  return (
    <div className="el-stack">
      <PageHeader
        title={t.displayName}
        meta={<VerificationBadge status={t.profile?.verificationStatus} />}
        description={<a href="/ops/teachers">All teachers</a>}
      />
      {teacherTabs(t, user, (a) => `${self}?act=${a}`, 2).map((x) => (
        <div key={x.key} className="el-stack">
          {x.content}
        </div>
      ))}
      {act ? <TeacherActModal act={act} t={t} user={user} closeHref={self} /> : null}
    </div>
  );
}
