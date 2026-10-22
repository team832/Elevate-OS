'use client';

/**
 * Generic JSON form for Academic OS API routes. The server route enforces the
 * permission and validation; this component only builds a JSON body, shows
 * loading / error / success states and refreshes the server-rendered page.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Checkbox, Field, Select, TextArea, TextInput } from '@elevate/shared-ui';

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'select'
  | 'multi-select'
  | 'textarea'
  | 'json'
  | 'checkbox'
  | 'csv-list'
  | 'number-list';

export interface FormField {
  name: string;
  label: string;
  type?: FieldType;
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  maxLength?: number;
}

export interface ApiFormProps {
  /** Browser path of the API route (with /academic). */
  action: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  fields: readonly FormField[];
  submitLabel: string;
  /** Static JSON merged into the body (e.g. an id). */
  extra?: Record<string, unknown>;
  /** Wrap the collected fields under this key, e.g. `sessions` → { sessions: [body] }. */
  wrapAs?: string;
  successMessage?: string;
  refresh?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  idPrefix?: string;
  /** Adds a "save draft" button: the body gets `submit: false` from it and `submit: true` from the main button. */
  draftLabel?: string;
  /** Keep the buttons in view at the bottom of the screen (long forms, phones). */
  stickyActions?: boolean;
  /** App path WITHOUT the /academic basePath (the router adds it, D-022) to open after success; `{id}` = the returned record's id. */
  goTo?: string;
}

interface ErrorView {
  message: string;
  details: string[];
}

/** Readable lines from an error envelope's details: only entries with a message (validation issues, clashes, file problems), never raw ids or debug fields. */
export function describeDetails(details: unknown): string[] {
  const lines: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (typeof v.message !== 'string') return Object.values(v).forEach(visit);
    const where = Array.isArray(v.path) && v.path.length ? `${v.path.join('.')}: ` : '';
    lines.push(`${typeof v.line === 'number' ? `line ${v.line}: ` : ''}${where}${v.message}`);
  };
  visit(details);
  return lines.slice(0, 50);
}

function collect(form: HTMLFormElement, fields: readonly FormField[]): Record<string, unknown> {
  const data = new FormData(form);
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const type = f.type ?? 'text';
    if (type === 'checkbox') {
      body[f.name] = data.get(f.name) === 'on';
      continue;
    }
    if (type === 'multi-select') {
      const values = data.getAll(f.name).map(String);
      if (values.length) body[f.name] = values;
      continue;
    }
    const raw = String(data.get(f.name) ?? '').trim();
    if (raw === '') continue;
    switch (type) {
      case 'number':
        body[f.name] = Number(raw);
        break;
      case 'json':
        try {
          body[f.name] = JSON.parse(raw);
        } catch {
          throw new Error(`${f.label} is not valid JSON.`);
        }
        break;
      case 'csv-list':
        body[f.name] = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case 'number-list':
        body[f.name] = raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));
        break;
      default:
        body[f.name] = raw;
    }
  }
  return body;
}

async function send(
  action: string,
  method: string,
  body: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ErrorView }> {
  const response = await fetch(action, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: { data?: unknown; error?: { message?: string; details?: unknown; requestId?: string } };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      error: { message: `Unexpected response (HTTP ${response.status}).`, details: [] },
    };
  }
  if (!response.ok || json.error) {
    const ref = json.error?.requestId ? ` (reference ${json.error.requestId})` : '';
    return {
      ok: false,
      error: {
        message: `${json.error?.message ?? `HTTP ${response.status}`}${ref}`,
        details: describeDetails(json.error?.details),
      },
    };
  }
  return { ok: true, data: json.data };
}

function ErrorAlert({ error }: { error: ErrorView }) {
  return (
    <Alert tone="danger" title={error.message}>
      {error.details.length > 0 ? (
        <ul>
          {error.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

export function ApiForm({
  action,
  method = 'POST',
  fields,
  submitLabel,
  extra,
  wrapAs,
  successMessage = 'Saved.',
  refresh = true,
  variant = 'primary',
  idPrefix = 'f',
  draftLabel,
  stickyActions,
  goTo,
}: ApiFormProps) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'error'; error: ErrorView }
    | { kind: 'done'; message: string }
  >({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    let body: Record<string, unknown>;
    const asDraft =
      draftLabel !== undefined &&
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft';
    try {
      body = {
        ...collect(form, fields),
        ...extra,
        ...(draftLabel !== undefined ? { submit: !asDraft } : {}),
      };
    } catch (e) {
      setState({ kind: 'error', error: { message: (e as Error).message, details: [] } });
      return;
    }
    setState({ kind: 'saving' });
    try {
      const result = await send(action, method, wrapAs ? { [wrapAs]: [body] } : body);
      if (!result.ok) {
        setState({ kind: 'error', error: result.error });
        return;
      }
      setState({
        kind: 'done',
        message: asDraft ? 'Draft saved. Only you can see it.' : successMessage,
      });
      if (method === 'POST') form.reset(); // a create form starts empty again for the next entry
      if (goTo)
        router.push(
          goTo.replace('{id}', String((result.data as { id?: string } | null)?.id ?? '')),
        );
      else if (refresh) router.refresh();
    } catch {
      setState({
        kind: 'error',
        error: {
          message: 'Could not reach Academic OS. Check your connection and try again.',
          details: [],
        },
      });
    }
  }

  return (
    <form onSubmit={onSubmit} className="el-stack" noValidate>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.name}`;
        const type = f.type ?? 'text';
        if (type === 'checkbox') {
          return (
            <Checkbox
              key={f.name}
              id={id}
              name={f.name}
              label={f.label}
              defaultChecked={Boolean(f.defaultValue)}
            />
          );
        }
        const common = {
          id,
          name: f.name,
          required: f.required,
          defaultValue: f.defaultValue === undefined ? undefined : String(f.defaultValue),
          placeholder: f.placeholder,
          'aria-describedby': f.hint ? `${id}-hint` : undefined,
        };
        return (
          <Field key={f.name} id={id} label={f.label} hint={f.hint}>
            {type === 'select' || type === 'multi-select' ? (
              <Select
                {...common}
                multiple={type === 'multi-select'}
                size={type === 'multi-select' ? Math.min(8, f.options?.length ?? 0) : undefined}
              >
                {!f.required && type === 'select' ? <option value="">—</option> : null}
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : type === 'textarea' || type === 'json' ? (
              <TextArea
                {...common}
                rows={type === 'json' ? 8 : 4}
                maxLength={f.maxLength}
                spellCheck={type === 'json' ? false : undefined}
              />
            ) : (
              <TextInput
                {...common}
                type={
                  type === 'number'
                    ? 'number'
                    : type === 'date'
                      ? 'date'
                      : type === 'time'
                        ? 'time'
                        : 'text'
                }
                step={type === 'number' ? 'any' : undefined}
              />
            )}
          </Field>
        );
      })}
      {state.kind === 'error' ? <ErrorAlert error={state.error} /> : null}
      {state.kind === 'done' ? <Alert tone="success">{state.message}</Alert> : null}
      <div className={stickyActions ? 'acd-sticky-actions el-glass' : 'el-form-actions'}>
        <Button type="submit" variant={variant} value="submit" disabled={state.kind === 'saving'}>
          {state.kind === 'saving' ? 'Saving…' : submitLabel}
        </Button>
        {draftLabel !== undefined ? (
          <Button
            type="submit"
            variant="secondary"
            value="draft"
            disabled={state.kind === 'saving'}
          >
            {draftLabel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A button that sends a fixed body (or none) to a route. */
export function ApiButton({
  action,
  method = 'POST',
  body,
  label,
  successMessage = 'Done.',
  variant = 'secondary',
  showResult = false,
}: {
  action: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  label: string;
  successMessage?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  showResult?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'error'; error: ErrorView }
    | { kind: 'done'; data: unknown }
  >({ kind: 'idle' });
  async function onClick() {
    setState({ kind: 'saving' });
    try {
      const result = await send(action, method, body ?? {});
      if (!result.ok) return setState({ kind: 'error', error: result.error });
      setState({ kind: 'done', data: result.data });
      router.refresh();
    } catch {
      setState({ kind: 'error', error: { message: 'Could not reach Academic OS.', details: [] } });
    }
  }
  return (
    <div className="el-stack">
      <div>
        <Button variant={variant} onClick={onClick} disabled={state.kind === 'saving'}>
          {state.kind === 'saving' ? 'Working…' : label}
        </Button>
      </div>
      {state.kind === 'error' ? <ErrorAlert error={state.error} /> : null}
      {state.kind === 'done' ? (
        <Alert tone="success" title={successMessage}>
          {showResult ? (
            <pre className="el-field-hint">{JSON.stringify(state.data, null, 2)}</pre>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
