import { portalLogout } from '../../../../../server/portal';

export const dynamic = 'force-dynamic';

/** POST /api/v1/portal/logout — ends the portal session (form). */
export const POST = portalLogout;
