import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, PageHeader } from '@elevate/shared-ui';
import { getStaffDetail } from '../../server/organisation';
import { PeopleNav } from '../../ui/admissions-nav';
import { Frame, gate, load, Section } from '../../ui/frame';
import { listHref } from '../../ui/list-controls';
import { RecordModal } from '../../ui/record-modal';
import { Directory, type Params } from './directory';
import { StaffEditModal, StaffProfile } from './staff-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'All staff' };

const BASE = '/ops/staff';

export default async function StaffPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:organisation:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="staff">
      <PageHeader
        title="All staff"
        tabs={<PeopleNav current="staff" user={access.user} />}
        description="Everyone on staff in every department, and who they report to. HR records (employment, responsibilities, attendance) are under HR → Staff Directory."
        actions={
          can(access.user, 'ops:organisation:manage') ? (
            <ButtonLink
              variant="primary"
              href={listHref(BASE, sp, { new: '1', open: undefined, act: undefined })}
            >
              Add staff member
            </ButtonLink>
          ) : undefined
        }
      />
      <Section>
        <Directory user={access.user} sp={sp} base={BASE} view="organisation" />
      </Section>
      {sp.open ? (
        <Section label="Loading staff member…">
          <OpenStaff user={access.user} sp={sp} id={sp.open} />
        </Section>
      ) : null}
    </Frame>
  );
}

/** The `?open=` record loads on its own, so a failure stays inside the modal and the list stays. */
async function OpenStaff({ user, sp, id }: { user: AuthenticatedUser; sp: Params; id: string }) {
  const close = (patch: Params) => listHref(BASE, sp, patch);
  const edit = sp.act === 'edit' && can(user, 'ops:organisation:manage');
  const r = await load(async (db) =>
    getStaffDetail(db, user, id),
  );
  if (!r.ok)
    return (
      <RecordModal
        id="staff-modal"
        title="Staff member"
        closeHref={close({ open: undefined, act: undefined })}
      >
        {r.view}
      </RecordModal>
    );
  const d = r.data;
  return edit ? (
    <StaffEditModal d={d} closeHref={close({ act: undefined })} />
  ) : (
    <RecordModal
      id="staff-modal"
      title={d.staff.fullName}
      meta={d.staff.title ?? undefined}
      fullHref={`${BASE}/${d.staff.id}`}
      closeHref={close({ open: undefined, act: undefined })}
      returnId={d.staff.id}
    >
      <StaffProfile d={d} user={user} editHref={close({ act: 'edit' })} level={3} />
    </RecordModal>
  );
}
