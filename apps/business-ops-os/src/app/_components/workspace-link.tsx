import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { workspacesFor } from '@elevate/authorization';
import { workspaceHrefs } from '@elevate/server-kit/next';
import { ButtonLink } from '@elevate/shared-ui';

/** Absolute link into another workspace, shown only to its members (D-072). */
export function WorkspaceLink({
  user,
  workspace,
  children,
}: {
  user: AuthenticatedUser;
  workspace: 'academic' | 'marketing';
  children: ReactNode;
}) {
  return workspacesFor(user).includes(workspace) ? (
    <ButtonLink variant="secondary" href={workspaceHrefs()[workspace]}>
      {children}
    </ButtonLink>
  ) : null;
}
