import { Frame, gate } from '../../../ui/frame';
import { TaskBody } from '../_components/bodies';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:tasks:read', `/ops/tasks/${id}`);
  return (
    <Frame access={access} active="tasks">
      <TaskBody user={access.user} base="/ops" id={id} />
    </Frame>
  );
}
