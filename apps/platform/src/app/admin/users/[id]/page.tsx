import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { currentRequestId, requirePageAccess } from '@elevate/server-kit/next';
import { isAppError } from '@elevate/shared-contracts';
import {
  Alert,
  AppShell,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../../../lib/shell';
import { platformShell } from '../../../../server/shell';
import { auditLabel, getUserDetail, userIdParams } from '../../../../server/users';
import { JsonForm } from '../../../../ui/json-form';
import { AccountStatus, fmtDay, fmtWhen, roleLabels, RoleChecklist } from '../../../../ui/users';
import '../users.css';

export const metadata: Metadata = { title: 'Account · Users & roles' };
export const dynamic = 'force-dynamic';

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Permission check before any Suspense boundary: signed-out visitors get a real 307.
  const access = await requirePageAccess('platform:users:read', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: `${PLATFORM_PATHS.users}/${encodeURIComponent(id)}`,
  });
  const extras = await platformShell(access.user, 'users');
  const parsed = userIdParams.safeParse({ id });
  return (
    <AppShell
      user={access.user}
      modules={access.modules}
      current="platform"
      logoutAction={PLATFORM_PATHS.logoutApi}
      breadcrumbs={[
        { label: 'Overview', href: PLATFORM_PATHS.home },
        { label: 'Users & roles', href: PLATFORM_PATHS.users },
        { label: 'Account' },
      ]}
      {...extras}
    >
      {access.status === 'forbidden' ? (
        <ErrorState
          level={1}
          title="No access"
          description="Users & roles needs the platform:users:read permission. Ask a platform administrator."
        />
      ) : !parsed.success ? (
        <ErrorState
          title="Not found"
          description="There is no account at this address."
          action={<a href={PLATFORM_PATHS.users}>Back to Users & roles</a>}
        />
      ) : (
        <Suspense fallback={<LoadingState label="Loading the account…" />}>
          <Account viewer={access.user} id={parsed.data.id} />
        </Suspense>
      )}
    </AppShell>
  );
}

async function Account({ viewer, id }: { viewer: AuthenticatedUser; id: AuthenticatedUser['id'] }) {
  let detail: Awaited<ReturnType<typeof getUserDetail>>;
  try {
    detail = await getUserDetail(getDb(), id);
  } catch (error) {
    if (isAppError(error) && error.status === 404)
      return (
        <ErrorState
          title="Not found"
          description={error.message}
          action={<a href={PLATFORM_PATHS.users}>Back to Users & roles</a>}
        />
      );
    console.error('user detail failed', error);
    return <ErrorState requestId={await currentRequestId().catch(() => undefined)} />;
  }
  const { user, roles, history } = detail;
  const self = viewer.id === user.id;
  const api = `/api/v1/admin/users/${user.id}`;
  const canRoles = can(viewer, 'platform:roles:manage') && !self;
  const canStatus = can(viewer, 'platform:users:manage') && !self;
  return (
    <>
      <PageHeader
        title={user.displayName}
        description={user.email}
        meta={
          <>
            <AccountStatus status={user.status} />
            {roles.length ? (
              roles.map((r) => (
                <StatusBadge key={r} tone="neutral">
                  {roleLabels([r])}
                </StatusBadge>
              ))
            ) : (
              <StatusBadge tone="warning">No roles yet</StatusBadge>
            )}
          </>
        }
        actions={
          !canStatus ? null : user.status === 'active' ? (
            <Dialog
              id="disable-account"
              title="Disable this account?"
              description={`${user.displayName} is signed out everywhere at once and cannot sign in until an administrator enables the account again. Their roles and records stay as they are.`}
              triggerLabel="Disable account"
              triggerVariant="danger"
            >
              <JsonForm
                action={`${api}/status`}
                method="PUT"
                submitLabel="Disable account"
                variant="danger"
                cancelLabel="Keep account active"
              >
                <input type="hidden" name="status" value="disabled" />
              </JsonForm>
            </Dialog>
          ) : (
            <JsonForm
              action={`${api}/status`}
              method="PUT"
              submitLabel="Enable account"
              variant="secondary"
            >
              <input type="hidden" name="status" value="active" />
            </JsonForm>
          )
        }
      />
      <div className="el-stack">
        {self ? (
          <Alert tone="info" title="This is your own account">
            You cannot change your own roles or disable yourself. Another administrator must do it.
          </Alert>
        ) : null}
        <Card title="Account">
          <dl className="ur-facts">
            <div>
              <dt>How they sign in</dt>
              <dd>
                {user.hasPassword
                  ? 'Has a password; can also use Google sign-in'
                  : 'No password: signs in with Google. Setting a password by email comes later.'}
              </dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{fmtWhen(user.lastLoginAt)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                {fmtDay(user.createdAt)}
                {user.viaGoogle ? ', at their first Google sign-in' : ''}
              </dd>
            </div>
          </dl>
        </Card>
        <Card
          title="Roles"
          description={
            roles.length === 0
              ? 'No roles yet: this person sees “No access” everywhere until a role is given.'
              : `Holds: ${roleLabels(roles)}.`
          }
        >
          {canRoles ? (
            <JsonForm
              action={`${api}/roles`}
              method="PUT"
              submitLabel="Save roles"
              arrays={['roles']}
            >
              <RoleChecklist held={roles} />
            </JsonForm>
          ) : (
            <>
              {self ? null : (
                <p className="el-field-hint">Only a platform administrator can change roles.</p>
              )}
              <RoleChecklist held={roles} disabled />
            </>
          )}
        </Card>
        <Card title="History" description="Changes to this account, newest first (last 50).">
          <DataTable
            compact
            rows={history}
            rowKey={(h) => h.id}
            columns={[
              { key: 'at', header: 'When', render: (h) => fmtWhen(h.at) },
              {
                key: 'action',
                header: 'What happened',
                render: (h) => {
                  const before = (h.before as { roles?: string[] } | null)?.roles;
                  const after = (h.after as { roles?: string[] } | null)?.roles;
                  return (
                    <>
                      {auditLabel(h.action)}
                      {after && h.action !== 'user.created_via_google'
                        ? `: ${before ? `${roleLabels(before) || 'none'} → ` : ''}${roleLabels(after) || 'none'}`
                        : ''}
                    </>
                  );
                },
              },
              { key: 'by', header: 'By', render: (h) => h.actorName ?? 'System' },
            ]}
            empty={<p className="el-field-hint">No recorded changes yet.</p>}
          />
        </Card>
      </div>
    </>
  );
}
