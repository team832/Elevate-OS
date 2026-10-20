/** Platform paths used by pages and route handlers. */
export const PLATFORM_PATHS = {
  login: '/login',
  home: '/',
  dashboard: '/dashboard',
  users: '/admin/users',
  loginApi: '/api/v1/auth/login',
  logoutApi: '/api/v1/auth/logout',
} as const;

/** What each module is for — shown on the home page. */
export const MODULE_BLURBS = {
  marketing:
    'Ideas, content, approvals, publishing records and marketing metrics across Elevate’s accounts.',
  academic:
    'Courses, batches, timetables, teaching assignments, attendance, assessments and enrolments.',
  ops: 'Leads, counselling, demos, admissions, tasks, SOPs, decisions and the organisation structure.',
} as const;
