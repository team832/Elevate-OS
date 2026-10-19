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
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}
