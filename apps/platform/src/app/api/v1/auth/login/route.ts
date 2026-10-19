import { loginHandler } from '../../../../../server/auth';

/** POST /api/v1/auth/login — JSON or HTML form. Public. */
export const POST = loginHandler;
