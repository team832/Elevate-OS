import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { PageHeader } from '@elevate/shared-ui';
import { getStaffDetail } from '../../../server/organisation';
import { formOptions } from '../../../server/options';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { StaffEditModal, StaffProfile } from '../staff-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff member' };

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ act?: string }>;
}) {
  const { id } = await params;
  const access = await gate('ops:organisation:read', `/ops/staff/${id}`);
  const edit = (await searchParams).act === 'edit' && can(access.user, 'ops:organisation:manage');
  return (
    <Frame access={access} active="staff">
      <Section>
        <Detail user={access.user} id={id} edit={edit} />
      </Section>
    </Frame>
  );
}

async function Detail({ user, id, edit }: { user: AuthenticatedUser; id: string; edit: boolean }) {
  const r = await load(async (db) =>
    Promise.all([getStaffDetail(db, user, id), edit ? formOptions(db) : null]),
  );
  if (!r.ok) return r.view;
  const [d, o] = r.data;
  const self = `/ops/staff/${d.staff.id}`;
  return (
    <div className="el-stack">
      <PageHeader title={d.staff.fullName} description={<a href="/ops/staff">Staff directory</a>} />
      <StaffProfile d={d} user={user} editHref={`${self}?act=edit`} level={2} />
      {o ? <StaffEditModal d={d} o={o} closeHref={self} /> : null}
    </div>
  );
}
