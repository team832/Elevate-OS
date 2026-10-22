import { Frame, gate } from '../../../ui/frame';
import { TaskImportsBody } from './imports-body';

export const dynamic = 'force-dynamic';

export default async function TaskImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const access = await gate('ops:tasks:import', '/ops/tasks/imports');
  return (
    <Frame access={access} active="tasks">
      <TaskImportsBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
