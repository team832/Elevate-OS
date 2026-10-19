/**
 * Helpers for server actions. Every action re-checks the session on the server and the
 * services re-check permissions (assertCan), so hiding a button is never the control.
 */
import { redirect } from 'next/navigation';
import type { AuthenticatedUser } from '@elevate/authentication';
import { getDb, type Database } from '@elevate/database';
import { getCurrentUser, toAppPath } from '@elevate/server-kit/next';
import { isAppError } from '@elevate/shared-contracts';
import { MODULE, modulePath } from '../../domain';
import { MODULE_PATHS } from '../../server/paths';

export function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function strs(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** Turn a thrown error into a short, user-facing sentence (details for brand blocks and conflicts). */
export function describeError(error: unknown): string {
  if (!isAppError(error)) return 'Something went wrong on our side.';
  const d = error.details as Record<string, unknown> | undefined;
  const parts = [error.message];
  if (d && Array.isArray(d.blocking)) {
    parts.push(
      `Blocking: ${(d.blocking as { ruleCode: string; description: string }[]).map((b) => `${b.ruleCode} (${b.description})`).join('; ')}`,
    );
  }
  if (d && Array.isArray(d.missing))
    parts.push(`Not confirmed: ${(d.missing as string[]).join(', ')}`);
  if (d && Array.isArray(d.hard))
    parts.push((d.hard as { message: string }[]).map((h) => h.message).join(' '));
  if (d && Array.isArray(d.errors))
    parts.push((d.errors as { message: string }[]).map((e) => e.message ?? String(e)).join(' '));
  if (d && Array.isArray(d.duplicates)) {
    parts.push(
      `Existing: ${(d.duplicates as { code: string | null; title: string }[]).map((x) => `${x.code ?? 'uncoded'} “${x.title}”`).join('; ')}`,
    );
  }
  if (
    Array.isArray(error.details) &&
    error.details.length &&
    'message' in (error.details[0] as object)
  ) {
    parts.push(
      (error.details as { path: unknown[]; message: string }[])
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    );
  }
  return parts.join(' — ').slice(0, 600);
}

/** Redirect to an in-module page with a notice or error (Next adds the basePath itself). */
export function go(subpath: string, message: { notice?: string; error?: string } = {}): never {
  const qs = new URLSearchParams();
  if (message.notice) qs.set('notice', message.notice);
  if (message.error) qs.set('error', message.error);
  const browser = `${modulePath(subpath)}${qs.size ? `?${qs.toString()}` : ''}`;
  redirect(toAppPath(browser, MODULE.basePath));
}

/**
 * Run a service call for a signed-in user. Errors come back as a message (redirect must
 * happen outside try/catch because Next implements it with a thrown signal).
 */
export async function run<T>(
  fn: (db: Database, user: AuthenticatedUser) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect(toAppPath(MODULE_PATHS.login, MODULE.basePath));
  try {
    return { ok: true, value: await fn(getDb(), user) };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}
