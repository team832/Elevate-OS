import { Frame, gate } from '../../ui/frame';
import { TasksBody } from './_components/bodies';
import type { Params } from './_components/task-views';

export const dynamic = 'force-dynamic';

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:tasks:read', '/ops/tasks');
  return (
    <Frame access={access} active="tasks">
      <TasksBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
