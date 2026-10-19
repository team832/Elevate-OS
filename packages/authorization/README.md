# @elevate/authorization

Server-side RBAC (D-008). Hiding UI is cosmetic; every protected route and server action must check a permission on the server (`defineRoute` in `@elevate/server-kit` does it for you).

## Model
- **Roles** (`src/roles.ts`): `platform_admin`, `director`, `marketing_manager`, `marketing_contributor`, `academic_coordinator`, `teacher`, `admissions_counsellor`, `operations_manager`, `auditor`. A user can hold several; grants are unioned with the broadest scope winning.
- **Permissions** are `<module>:<resource>:<action>` strings, declared per module:

| File | Owner |
|---|---|
| `src/permissions/platform.ts` | Foundation / Integration |
| `src/permissions/marketing.ts` | **Marketing** |
| `src/permissions/academic.ts` | **Academic** |
| `src/permissions/ops.ts` | **Business Ops** |

- **Scopes**: a grant is `'perm'` (all records) or `{ permission, scope: 'own' }` (only records the user is responsible for — e.g. a teacher's own assignments).

The catalogue is validated at import time and throws if: a permission is declared twice, a grant names an undeclared permission, a module grants another module's permission, the auditor gets a non-read action, or anyone but `platform_admin` gets `platform:users:manage` / `platform:roles:manage`.

## API
```ts
can(user, 'ops:leads:write')                // boolean
requirePermission(user, 'ops:leads:write')   // throws ForbiddenError (403); returns 'all' | 'own'
scopeFor(user, permission)                   // 'all' | 'own' | null
modulesFor(user)                             // ModuleKey[] with <module>:module:access
permissionsFor(user)                         // Map<Permission, scope>
scopedValue(user, permission, { all: () => X, own: (userId) => X })  // record-level scoping hook
canAccessRecord(user, permission, { ownerUserIds })
renderPermissionMatrix()                     // Markdown matrix (used by docs/SECURITY_AND_PERMISSIONS.md)
```
`Permission` is a union of every declared key, so typos fail type-checking.

## Adding a permission (module teams)
1. Add `{ key: 'ops:refunds:approve', description: '…' }` to your file's `…PermissionList`.
2. Add it to the right roles in `grants` (least privilege; auditor only `read`/`access`).
3. Use it: `defineRoute({ permission: 'ops:refunds:approve', … })`.
4. Note the change in your module README. Refreshing the matrix in `docs/SECURITY_AND_PERMISSIONS.md` (`npm run docs:permissions`) is an Integration step; `npm run docs:permissions -- --check` reports when it is stale.

Tests: `tests/authorization.test.ts`.
