import { logoutHandler } from '../../../../../server/auth';

/** POST /api/v1/auth/logout — revokes the session and clears the cookie. */
export const POST = logoutHandler;
