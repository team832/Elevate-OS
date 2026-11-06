import { AdmissionsNav } from '../../ui/admissions-nav';
import { Frame, gate } from '../../ui/frame';
import { FollowUpsBody } from '../leads/follow-ups-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Follow-ups' };

/** `/ops/follow-ups`: the follow-ups body Marketing already mounts, in the caller's lead scope. */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:read', '/ops/follow-ups');
  return (
    <Frame access={access} active="follow-ups">
      <FollowUpsBody
        user={access.user}
        base="/ops"
        searchParams={await searchParams}
        tabs={<AdmissionsNav current="follow-ups" user={access.user} />}
      />
    </Frame>
  );
}
