'use client';

/**
 * Small JSON form for the admin screens. The fields are server-rendered children
 * (native validation: required, type, pattern); on submit it sends their values
 * as JSON (names in `arrays` become lists, e.g. checked roles), shows the
 * server's error message, and refreshes or navigates on success. The server is
 * the authority on every rule.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useDialogClose, type ButtonVariant } from '@elevate/shared-ui';

export function JsonForm({
  action,
  method = 'POST',
  submitLabel,
  arrays = [],
  redirectTo,
  variant = 'primary',
  cancelLabel,
  children,
}: {
  action: string;
  method?: 'POST' | 'PUT';
  submitLabel: string;
  arrays?: readonly string[];
  /** Navigate here on success; `{id}` becomes `data.id`. Default: refresh the page. */
  redirectTo?: string;
  variant?: ButtonVariant;
  /** Inside a Dialog: show a button that closes it. */
  cancelLabel?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending) return;
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const [key, value] of form)
      if (!arrays.includes(key) && typeof value === 'string' && value.trim())
        body[key] = value.trim();
    for (const key of arrays) body[key] = form.getAll(key);
    setBusy(true);
    setErrors([]);
    let res: Response;
    try {
      res = await fetch(action, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch {
      setBusy(false);
      setErrors(['Elevate OS could not be reached. Check the connection and try again.']);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      error?: { message?: string; details?: unknown };
    };
    setBusy(false);
    if (!res.ok) {
      const details = Array.isArray(json.error?.details)
        ? (json.error.details as { message?: string }[]).flatMap((d) => d.message ?? [])
        : [];
      setErrors([
        res.status === 401
          ? 'Your session has ended. Sign in again and retry.'
          : (json.error?.message ?? `The change was not saved (${res.status}).`),
        ...details,
      ]);
      return;
    }
    closeDialog();
    startTransition(() => {
      if (redirectTo) router.push(redirectTo.replace('{id}', json.data?.id ?? ''));
      else router.refresh();
    });
  }

  return (
    <form className="el-stack" onSubmit={onSubmit} aria-busy={busy || pending || undefined}>
      {children}
      {errors.length > 0 ? (
        <div className="el-alert el-tone-danger" role="alert">
          <p className="el-alert-title">{errors[0]}</p>
          {errors.length > 1 ? (
            <ul>
              {errors.slice(1).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="el-form-actions">
        {cancelLabel ? (
          <button type="button" className="el-button el-button-secondary" onClick={closeDialog}>
            {cancelLabel}
          </button>
        ) : null}
        <button
          type="submit"
          className={`el-button el-button-${variant}`}
          disabled={busy || pending}
        >
          {busy || pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
