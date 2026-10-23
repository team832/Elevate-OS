import { Frame, gate } from '../../ui/frame';
import { MyAttendanceBody } from './my-attendance-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My attendance' };

export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:attendance:read', '/ops/my-attendance');
  return (
    <Frame access={access} active="my-attendance">
      <MyAttendanceBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
