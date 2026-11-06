import { portalSetup } from '../../../../../server/portal';

export const dynamic = 'force-dynamic';

/** POST /api/v1/portal/setup — one-time setup code + new password (form). */
export const POST = portalSetup;
