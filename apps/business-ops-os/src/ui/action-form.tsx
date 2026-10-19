'use client';

/**
 * Generic JSON form for Business Ops actions. Builds the JSON body from the
 * fields (empty values omitted), calls the /ops/api/v1 route (the server checks
 * permissions and validates), shows field errors, and refreshes on success.
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

export interface FieldSpec {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'textarea'
    | 'select'
    | 'date'
    | 'datetime'
    | 'number'
    | 'checkbox'
    | 'hidden'
    | 'list'
    | 'email'
    | 'tel'
    | 'json';
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  defaultValue?: string;
}

export interface ActionFormProps {
  action: string;
  method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  submitLabel: string;
  fields?: readonly FieldSpec[];
  /** Fixed values merged into the body. */
  extra?: Record<string, unknown>;
  /** After success: navigate here (`{id}` is replaced by data.id or data.lead.id). Default: refresh. */
  redirectTo?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
}

type ApiError = { code: string; message: string; details?: unknown };

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = target;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
  cur[parts[parts.length - 1] as string] = value;
}

export function toBody(
  fields: readonly FieldSpec[],
  form: FormData,
  extra: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = { ...extra };
  for (const f of fields) {
    const raw = form.get(f.name);
    if (f.type === 'checkbox') {
      setPath(body, f.name, raw === 'on');
      continue;
    }
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v === '') continue;
    if (f.type === 'number') setPath(body, f.name, Number(v));
    else if (f.type === 'list')
      setPath(
        body,
        f.name,
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (f.type === 'json') {
      try {
        setPath(body, f.name, JSON.parse(v));
      } catch {
        setPath(body, f.name, v); // the server reports the validation error
      }
    } else if (f.type === 'datetime')
      setPath(body, f.name, new Date(`${v}:00+05:30`).toISOString());
    else setPath(body, f.name, v);
  }
  return body;
}

export function ActionForm({
  action,
  method = 'POST',
  submitLabel,
  fields = [],
  extra,
  redirectTo,
  variant = 'primary',
  compact,
}: ActionFormProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);
    const body = toBody(fields, new FormData(event.currentTarget), extra);
    const res = await fetch(action, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string; lead?: { id?: string } };
      error?: ApiError;
    };
    if (!res.ok || json.error) {
      setError(json.error ?? { code: 'INTERNAL', message: `Request failed (${res.status}).` });
      return;
    }
    setDone(true);
    startTransition(() => {
      if (redirectTo)
        router.push(redirectTo.replace('{id}', json.data?.id ?? json.data?.lead?.id ?? ''));
      else router.refresh();
    });
  }

  const issues = Array.isArray(error?.details)
    ? (error.details as { path?: (string | number)[]; message: string }[])
    : [];
  return (
    <form onSubmit={onSubmit} className={compact ? 'el-inline-form' : 'el-stack'} noValidate>
      {fields.map((f) => {
        const id = `f-${action.replace(/\W+/g, '-')}-${f.name}`;
        const fieldError = issues.find((i) => i.path?.join('.') === f.name)?.message;
        if (f.type === 'hidden')
          return <input key={f.name} type="hidden" name={f.name} defaultValue={f.defaultValue} />;
        if (f.type === 'checkbox')
          return (
            <label key={f.name} className="el-checkbox">
              <input type="checkbox" name={f.name} defaultChecked={f.defaultValue === 'true'} />{' '}
              {f.label}
            </label>
          );
        return (
          <div key={f.name} className="el-field">
            <label htmlFor={id}>
              {f.label}
              {f.required ? ' *' : ''}
            </label>
            {f.type === 'textarea' || f.type === 'json' ? (
              <textarea
                id={id}
                name={f.name}
                className="el-textarea"
                defaultValue={f.defaultValue}
                required={f.required}
                aria-invalid={Boolean(fieldError) || undefined}
                rows={3}
              />
            ) : f.type === 'select' ? (
              <select
                id={id}
                name={f.name}
                className="el-select"
                defaultValue={f.defaultValue ?? ''}
                required={f.required}
              >
                {!f.required ? <option value="">—</option> : null}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={f.name}
                className="el-input"
                type={
                  f.type === 'datetime'
                    ? 'datetime-local'
                    : f.type === 'list'
                      ? 'text'
                      : (f.type ?? 'text')
                }
                defaultValue={f.defaultValue}
                required={f.required}
                aria-invalid={Boolean(fieldError) || undefined}
              />
            )}
            {f.hint ? <p className="el-field-hint">{f.hint}</p> : null}
            {fieldError ? <p className="el-field-error">{fieldError}</p> : null}
          </div>
        );
      })}
      {error ? (
        <div className="el-alert el-tone-danger" role="alert">
          <p className="el-alert-title">{error.message}</p>
          {issues.length &&
          !issues.every((i) => fields.some((f) => f.name === i.path?.join('.'))) ? (
            <ul>
              {issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {done && !error ? (
        <p className="el-field-hint" role="status">
          Saved.
        </p>
      ) : null}
      <button type="submit" className={`el-button el-button-${variant}`} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
