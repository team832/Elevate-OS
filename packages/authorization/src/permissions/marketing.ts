/**
 * OWNER: Marketing OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Marketing OS permissions and which roles hold them (least privilege; rationale in
 * apps/marketing-os/README.md §Permissions). Rules:
 * - keys are `marketing:<resource>:<action>` in lower snake case;
 * - `read` / `access` actions must be read-only — the auditor may hold only those;
 * - never grant platform:users:manage / platform:roles:manage here.
 *
 * Grants (wave 2):
 * - marketing_contributor drafts ideas and content, edits drafts, submits for review,
 *   comments, plans placements and imports metric exports. Cannot approve, schedule or publish.
 * - marketing_manager runs the module: everything above plus approve, schedule, publish,
 *   accounts and campaigns.
 * - director (the Co-Founder, content approver per OD-002) reads everything, approves and
 *   schedules. Publishing stays with the manager (separation of duties).
 * - auditor reads only. teacher, admissions_counsellor, academic_coordinator,
 *   operations_manager and platform_admin have no marketing access (no need shown yet;
 *   academic fact-checking by teachers is Proposed).
 */
import { definePermissions, type PermissionDefinition } from '../types';

export const marketingPermissionList = [
  { key: 'marketing:module:access', description: 'Open Marketing OS.' },
  { key: 'marketing:ideas:read', description: 'Read the idea register.' },
  { key: 'marketing:ideas:write', description: 'Capture and edit ideas.' },
  {
    key: 'marketing:content:read',
    description: 'Read content items, versions, placements, approvals and publishing records.',
  },
  {
    key: 'marketing:content:write',
    description:
      'Create and edit drafts, add versions, submit for review, comment, plan placements.',
  },
  { key: 'marketing:content:approve', description: 'Approve content or request changes.' },
  {
    key: 'marketing:schedule:manage',
    description: 'Schedule and unschedule placements and build collab groups.',
  },
  {
    key: 'marketing:content:publish',
    description: 'Publish approved, scheduled placements or record a manual publication.',
  },
  { key: 'marketing:metrics:read', description: 'Read marketing metrics and weekly reports.' },
  { key: 'marketing:metrics:import', description: 'Import platform metric exports (CSV).' },
  {
    key: 'marketing:accounts:read',
    description: 'Read social accounts and their connection status.',
  },
  {
    key: 'marketing:accounts:manage',
    description: 'Change social account settings and run adapter verification.',
  },
  { key: 'marketing:campaigns:write', description: 'Create campaigns and assign placements.' },
  {
    key: 'marketing:summary:read',
    description: 'Read the marketing summary (MarketingSummaryV1).',
  },
] as const satisfies readonly PermissionDefinition[];

export type MarketingPermission = (typeof marketingPermissionList)[number]['key'];

export const marketingPermissions = definePermissions<MarketingPermission>({
  module: 'marketing',
  permissions: marketingPermissionList,
  grants: {
    marketing_manager: marketingPermissionList.map((p) => p.key),
    marketing_contributor: [
      'marketing:module:access',
      'marketing:ideas:read',
      'marketing:ideas:write',
      'marketing:content:read',
      'marketing:content:write',
      'marketing:metrics:read',
      'marketing:metrics:import',
      'marketing:accounts:read',
    ],
    director: [
      'marketing:module:access',
      'marketing:ideas:read',
      'marketing:content:read',
      'marketing:content:approve',
      'marketing:schedule:manage',
      'marketing:metrics:read',
      'marketing:accounts:read',
      'marketing:summary:read',
    ],
    auditor: [
      'marketing:module:access',
      'marketing:ideas:read',
      'marketing:content:read',
      'marketing:metrics:read',
      'marketing:accounts:read',
      'marketing:summary:read',
    ],
  },
});
