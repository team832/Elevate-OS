import { Frame, gate } from '../../../ui/frame';
import type { Params } from '../_components/task-views';
import { InboxBody } from './inbox-body';

export const dynamic = 'force-dynamic';

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:read', '/ops/tasks/inbox');
  return (
    <Frame access={access} active="tasks-inbox">
      <InboxBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
