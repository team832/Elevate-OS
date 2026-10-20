import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { googleSignInHref } from '@elevate/authentication';
import { safeRelativePath } from '@elevate/shared-contracts';
import { getCurrentUser, toAppPath } from '@elevate/server-kit/next';
import { LoginForm } from '@elevate/shared-ui';
import { MODULE } from '../../domain';
import { MODULE_PATHS } from '../../server';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/** Standalone sign-in (/ops/login). Behind the platform, /login works too — the cookie is shared. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRelativePath(
    typeof params.next === 'string' ? params.next : undefined,
    MODULE_PATHS.home,
  );
  const error = typeof params.error === 'string' ? params.error : undefined;
  // Already signed in: go on, but only within this zone (Next's redirect() adds the basePath;
  // a path in another zone would become /<this zone>/<other zone>).
  const inZone = next === MODULE.basePath || next.startsWith(`${MODULE.basePath}/`);
  if (!error && inZone && (await getCurrentUser())) redirect(toAppPath(next, MODULE.basePath));
  return (
    <LoginForm
      action={MODULE_PATHS.loginApi}
      next={next}
      error={error}
      googleHref={googleSignInHref(next)}
      subtitle="Sign in to Business Ops OS"
    />
  );
}
