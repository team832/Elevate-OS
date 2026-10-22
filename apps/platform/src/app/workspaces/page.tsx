import type { Metadata } from 'next';
import { can, workspacesFor } from '@elevate/authorization';
import { requireUser } from '@elevate/server-kit/next';
import { WorkspaceChooser } from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../lib/shell';

export const metadata: Metadata = { title: 'Choose a workspace' };
export const dynamic = 'force-dynamic';

/** Workspace chooser (D-072) for sign-ins on the platform app. */
export default async function WorkspacesPage() {
  const user = await requireUser({ loginPath: PLATFORM_PATHS.login, returnTo: '/workspaces' });
  return (
    <WorkspaceChooser
      user={user}
      workspaces={workspacesFor(user)}
      preferred={user.preferredWorkspace}
      action="/api/v1/auth/workspace"
      logoutAction={PLATFORM_PATHS.logoutApi}
      adminHref={can(user, 'platform:users:read') ? PLATFORM_PATHS.users : undefined}
    />
  );
}
