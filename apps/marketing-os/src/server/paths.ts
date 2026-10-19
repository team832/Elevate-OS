import { modulePath } from '../domain';

/** Browser paths (with basePath) used by pages, forms and redirects. */
export const MODULE_PATHS = {
  home: modulePath(),
  login: modulePath('login'),
  loginApi: modulePath('api/v1/auth/login'),
  logoutApi: modulePath('api/v1/auth/logout'),
} as const;
