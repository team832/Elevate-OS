/**
 * OWNER: Foundation (wave 1), then Integration (wave 3).
 * Platform permissions and their role grants.
 */
import { definePermissions, type PermissionDefinition } from '../types';

export const platformPermissionList = [
  { key: 'platform:module:access', description: 'Open the Elevate OS home.' },
  { key: 'platform:users:read', description: 'List user accounts and their roles.' },
  { key: 'platform:users:manage', description: 'Create, disable and reset user accounts.' },
  { key: 'platform:roles:manage', description: 'Grant and revoke roles.' },
  { key: 'platform:audit:read', description: 'Read the audit log across modules.' },
  {
    key: 'platform:approvals:read',
    description: 'Read approval requests and history across modules.',
  },
  { key: 'platform:notifications:read', description: 'Read and mark own in-app notifications.' },
] as const satisfies readonly PermissionDefinition[];

export type PlatformPermission = (typeof platformPermissionList)[number]['key'];

export const platformPermissions = definePermissions<PlatformPermission>({
  module: 'platform',
  permissions: platformPermissionList,
  grants: {
    platform_admin: [
      'platform:module:access',
      'platform:users:read',
      'platform:users:manage',
      'platform:roles:manage',
      'platform:audit:read',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    director: [
      'platform:module:access',
      'platform:users:read',
      'platform:audit:read',
      'platform:approvals:read',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    marketing_manager: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    marketing_contributor: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    academic_coordinator: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    teacher: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    admissions_counsellor: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    operations_manager: [
      'platform:module:access',
      'platform:approvals:read',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    auditor: [
      'platform:module:access',
      'platform:users:read',
      'platform:audit:read',
      'platform:approvals:read',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    finance_officer: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
    // PROPOSED-GRANTS-2026-10-23
    hr_manager: [
      'platform:module:access',
      { permission: 'platform:notifications:read', scope: 'own' },
    ],
  },
});
