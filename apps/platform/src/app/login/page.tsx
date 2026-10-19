import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeRelativePath } from '@elevate/shared-contracts';
import { getCurrentUser } from '@elevate/server-kit/next';
import { LoginForm } from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../lib/shell';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRelativePath(
    typeof params.next === 'string' ? params.next : undefined,
    PLATFORM_PATHS.home,
  );
  const error = typeof params.error === 'string' ? params.error : undefined;
  if (!error && (await getCurrentUser())) redirect(next);
  return <LoginForm action={PLATFORM_PATHS.loginApi} next={next} error={error} />;
}
