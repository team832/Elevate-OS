import { portalLogin } from '../../../../../server/portal';

export const dynamic = 'force-dynamic';

/** POST /api/v1/portal/login — portal sign-in form (login + password); sets the portal cookie only. */
export const POST = portalLogin;
