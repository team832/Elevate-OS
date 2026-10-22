import type { Metadata } from 'next';
import { can, workspacesFor } from '@elevate/authorization';
import { requireUser, workspaceHrefs } from '@elevate/server-kit/next';
import { WorkspaceChooser } from '@elevate/shared-ui';
import { MODULE } from '../../domain';
import { MODULE_PATHS } from '../../server/paths';

export const metadata: Metadata = { title: 'Choose a workspace' };
export const dynamic = 'force-dynamic';

/** Workspace chooser (D-072). No workspace gate: it also serves people who belong elsewhere. */
export default async function WorkspacesPage() {
  const user = await requireUser({
    loginPath: MODULE_PATHS.login,
    returnTo: `${MODULE.basePath}/workspaces`,
    basePath: MODULE.basePath,
  });
  return (
    <WorkspaceChooser
      user={user}
      workspaces={workspacesFor(user)}
      preferred={user.preferredWorkspace}
      action={`${MODULE.basePath}/api/v1/auth/workspace`}
      logoutAction={MODULE_PATHS.logoutApi}
      adminHref={
        can(user, 'platform:users:read') ? `${workspaceHrefs().platform}/admin/users` : undefined
      }
    />
  );
}
