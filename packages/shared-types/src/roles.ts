/**
 * Role keys (D-008). The permission grants for each role live in
 * `@elevate/authorization`; this list is here so contracts and the database
 * layer can validate role strings without depending on the RBAC package.
 * Mapping real staff to roles is an owner decision.
 */
export const ROLE_KEYS = [
  'platform_admin',
  'director',
  'marketing_manager',
  'marketing_contributor',
  'academic_coordinator',
  'teacher',
  'admissions_counsellor',
  'operations_manager',
  'auditor',
  // Business Ops HR permission profiles (D-028). Profiles, not people: nobody holds
  // them until a platform administrator assigns them (OD-009).
  'hr_manager',
  'hr_contributor',
  'recruiter',
  'department_manager',
  'employee',
  'finance_officer',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}
