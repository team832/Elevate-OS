import {
  createLoginHandler,
  createLogoutHandler,
  type AuthHandlerOptions,
} from '@elevate/authentication';
import { MODULE_PATHS } from './paths';

/** Sign-in/out handlers for standalone use; they share the session cookie with every zone. */
export const authOptions: AuthHandlerOptions = {
  module: 'ops',
  loginPath: MODULE_PATHS.login,
  defaultRedirect: MODULE_PATHS.home,
};

export const loginHandler = createLoginHandler(authOptions);
export const logoutHandler = createLogoutHandler(authOptions);
