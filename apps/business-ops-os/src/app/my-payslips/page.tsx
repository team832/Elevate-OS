import { Frame, gate } from '../../ui/frame';
import { MyPayslipsBody } from './my-payslips-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My payslips' };

export default async function MyPayslipsPage() {
  const access = await gate('ops:payslips:read', '/ops/my-payslips');
  return (
    <Frame access={access} active="my-payslips">
      <MyPayslipsBody user={access.user} base="/ops" />
    </Frame>
  );
}
