/**
 * Prints the live role → permission catalogue as JSON (roles with grants and scopes, and every permission).
 * Used by the standalone prototype (C:\OPENBOT\Elevate → `npm run sync:permissions`) so it enforces
 * exactly the same access rules as the real system.
 *
 *   npx tsx scripts/development/export-permissions.ts > permissions.json
 */
import { ROLES, ROLE_KEYS, listPermissions, grantsForRole } from '@elevate/authorization';

const roles = ROLE_KEYS.map((key) => ({
  key,
  label: ROLES[key].label,
  description: ROLES[key].description,
  grants: Object.fromEntries(
    [...grantsForRole(key)].map(([permission, scope]) => [permission, scope]),
  ),
}));
const permissions = listPermissions().map((p) => ({
  key: p.key,
  module: p.module,
  description: p.description,
}));

process.stdout.write(JSON.stringify({ roles, permissions }, null, 1));
