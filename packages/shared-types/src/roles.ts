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
  // Fee records in Business Ops (D-028). A profile, not a person (OD-009).
  'finance_officer',
  // HR for teachers and marketing staff (brief 23 Oct 2026, supersedes D-032 in part). Proposed.
  'hr_manager',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}
