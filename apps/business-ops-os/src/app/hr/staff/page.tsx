import type { AuthenticatedUser } from '@elevate/authentication';
import { PageHeader } from '@elevate/shared-ui';
import { getHrStaff } from '../../../server/hr-staff';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { listHref } from '../../../ui/list-controls';
import { RecordModal } from '../../../ui/record-modal';
import { Directory, type Params } from '../../staff/directory';
import { HrOverview } from './staff-hr-record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff directory' };

const BASE = '/ops/hr/staff';

export default async function HrStaffPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:hr:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="hr-staff">
      <PageHeader
        title="Staff directory"
        description="Teachers and marketing staff HR looks after: employment, department, manager and branch."
      />
      <Section>
        <Directory user={access.user} sp={sp} base={BASE} view="hr" />
      </Section>
      {sp.open ? (
        <Section label="Loading staff member…">
          <OpenStaff user={access.user} sp={sp} id={sp.open} />
        </Section>
      ) : null}
    </Frame>
  );
}

/** The `?open=` record loads on its own, so a failure stays inside the pop-up. */
async function OpenStaff({ user, sp, id }: { user: AuthenticatedUser; sp: Params; id: string }) {
  const close = listHref(BASE, sp, { open: undefined });
  const r = await load((db) => getHrStaff(db, user, id));
  if (!r.ok)
    return (
      <RecordModal id="hr-staff-modal" title="Staff member" closeHref={close}>
        {r.view}
      </RecordModal>
    );
  const full = `${BASE}/${r.data.staff.id}`;
  return (
    <RecordModal
      id="hr-staff-modal"
      title={r.data.displayName}
      meta={r.data.staff.title ?? undefined}
      fullHref={full}
      closeHref={close}
      returnId={r.data.staff.id}
    >
      <HrOverview d={r.data} user={user} level={3} actHref={(act) => `${full}?act=${act}`} />
    </RecordModal>
  );
}
