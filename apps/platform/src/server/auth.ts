import {
  createLoginHandler,
  createLogoutHandler,
  type AuthHandlerOptions,
} from '@elevate/authentication';
import { PLATFORM_PATHS } from '../lib/shell';

/** Shared options for the platform's sign-in and sign-out route handlers. */
export const platformAuth: AuthHandlerOptions = {
  module: 'platform',
  loginPath: PLATFORM_PATHS.login,
  defaultRedirect: PLATFORM_PATHS.home,
};

export const loginHandler = createLoginHandler(platformAuth);
export const logoutHandler = createLogoutHandler(platformAuth);
