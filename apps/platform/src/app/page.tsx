import { can } from '@elevate/authorization';
import { requirePageAccess } from '@elevate/server-kit/next';
import { MODULES } from '@elevate/shared-types';
import { AppShell, ButtonLink, Card, EmptyState, ErrorState, PageHeader } from '@elevate/shared-ui';
import { MODULE_BLURBS, PLATFORM_PATHS } from '../lib/shell';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const access = await requirePageAccess('platform:module:access', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: '/',
  });
  const { user, modules } = access;
  const moduleCards = modules.filter((m) => m !== 'platform');

  return (
    <AppShell
      user={user}
      modules={modules}
      current="platform"
      logoutAction={PLATFORM_PATHS.logoutApi}
    >
      {access.status === 'forbidden' ? (
        <ErrorState
          title="No access"
          description="Your account has no role that opens Elevate OS. Ask a platform administrator."
        />
      ) : (
        <>
          <PageHeader
            title={`Welcome, ${user.displayName}`}
            description="Open one of the modules you have access to."
            actions={
              can(user, 'platform:dashboard:read') ? (
                <ButtonLink href={PLATFORM_PATHS.dashboard} variant="secondary">
                  Leadership dashboard
                </ButtonLink>
              ) : null
            }
          />
          {moduleCards.length === 0 ? (
            <EmptyState
              title="No modules yet"
              description="Your roles do not include any module. A platform administrator can grant access."
            />
          ) : (
            <div className="el-grid">
              {moduleCards.map((m) => (
                <Card
                  key={m}
                  title={MODULES[m].label}
                  description={MODULE_BLURBS[m as keyof typeof MODULE_BLURBS]}
                  footer={
                    <ButtonLink href={MODULES[m].basePath} variant="primary">
                      Open {MODULES[m].label}
                    </ButtonLink>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
