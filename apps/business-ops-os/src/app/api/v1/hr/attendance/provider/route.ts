import { defineRoute } from '@elevate/server-kit';
import { getAttendanceProvider } from '../../../../../../server/adapters/attendance-provider';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/attendance/provider — device/provider status (mock: not_configured, D-014). */
export const GET = defineRoute({ permission: 'ops:attendance:read' }, async () => {
  const provider = getAttendanceProvider();
  return { name: provider.name, ...(await provider.status()) };
});
