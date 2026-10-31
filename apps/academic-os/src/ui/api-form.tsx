'use client';

/**
 * Generic JSON form for Academic OS API routes. The server route enforces the
 * permission and validation; this component only builds a JSON body, shows
 * loading / error / success states and refreshes the server-rendered page.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  fieldDescribedBy,
  Select,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { words } from './badges';

export type FieldType =
  /** One section's answer key: answers in question order, "-" for a dropped question. Name: `answers.<section>`. */
  | 'answer-list'
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

export interface ErrorView {
  message: string;
  details: string[];
  /** Issues that name a field, shown beside it (the last path segment is the field name). */
  issues?: { field: string; message: string }[];
  /** Server failures only: what to quote to an administrator. */
  reference?: string;
  /** Sign-in page, when the session has ended: a new tab, so what was typed here stays. */
  signIn?: string;
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

const named = (d: unknown): d is { path: unknown[]; message: string } =>
  typeof d === 'object' &&
  d !== null &&
  Array.isArray((d as { path?: unknown }).path) &&
  (d as { path: unknown[] }).path.length > 0 &&
  typeof (d as { message?: unknown }).message === 'string';

/** Required fields left blank, in words, before anything is sent (the server remains the check). */
export function missingRequired(fields: readonly FormField[], data: FormData): string[] {
  return fields
    .filter((f) => f.required && f.type !== 'checkbox')
    .filter((f) => !data.getAll(f.name).some((v) => String(v).trim()))
    .map(
      (f) =>
        `${f.type === 'select' || f.type === 'multi-select' ? 'Choose' : 'Enter'} ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}.`,
    );
}

/** One section of an answer key as typed: "A C - D" gives ["A", "C", null, "D"]. */
export const answerList = (raw: string) => raw.split(/[\s,]+/).map((a) => (a === '-' ? null : a));

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
      case 'answer-list': {
        const [key, section] = [f.name.slice(0, f.name.indexOf('.')), f.name.slice(f.name.indexOf('.') + 1)];
        ((body[key] ??= {}) as Record<string, unknown>)[section] = answerList(raw);
        break;
      }
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

export async function send(
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
    const raw = json.error?.details;
    const list = Array.isArray(raw) ? raw : [];
    return {
      ok: false,
      error: {
        message: json.error?.message ?? `HTTP ${response.status}`,
        details: describeDetails(Array.isArray(raw) ? list.filter((d) => !named(d)) : raw),
        issues: list
          .filter(named)
          .map((d) => ({ field: String(d.path.at(-1)), message: d.message })),
        reference: response.status >= 500 ? json.error?.requestId : undefined,
        signIn: response.status === 401 ? `${action.split('/api/')[0]}/login` : undefined,
      },
    };
  }
  return { ok: true, data: json.data };
}

export function ErrorAlert({
  error,
  labelOf = (field) => field,
}: {
  error: ErrorView;
  labelOf?: (field: string) => string;
}) {
  const lines = [
    ...(error.issues ?? []).filter((i) => !error.message.includes(i.message)).map((i) => `${labelOf(i.field)}: ${i.message}`),
    ...error.details.filter((d) => !error.message.includes(d)),
  ];
  return (
    <Alert tone="danger" title={error.message}>
      {error.reference ? <p>Reference for the administrator: {error.reference}</p> : null}
      {error.signIn ? (
        <p>
          <a href={error.signIn} target="_blank" rel="noopener">
            Sign in again in a new tab
          </a>
          , then come back and press the button again. What you typed stays here.
        </p>
      ) : null}
      {lines.length > 0 ? (
        <ul>
          {lines.map((d, i) => (
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
    | { kind: 'done'; message: string; nothing?: boolean }
  >({ kind: 'idle' });
  const alertRef = useRef<HTMLDivElement>(null);
  // A refusal or a result is read at once, wherever the person had scrolled.
  useEffect(() => {
    if (state.kind === 'error' || state.kind === 'done') alertRef.current?.focus();
  }, [state]);
  const issues = state.kind === 'error' ? (state.error.issues ?? []) : [];
  const errorOf = (name: string) => issues.find((i) => i.field === name)?.message;
  const labelOf = (field: string) => fields.find((f) => f.name === field)?.label ?? field;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    let body: Record<string, unknown>;
    const blank = missingRequired(fields, new FormData(form));
    if (blank.length) {
      setState({ kind: 'error', error: { message: 'There is a problem', details: blank } });
      return;
    }
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
      const nothing = (result.data as { saved?: number } | null)?.saved === 0;
      setState({
        kind: 'done',
        nothing,
        message: nothing
          ? 'Nothing was changed.'
          : asDraft
            ? 'Draft saved. Only you can see it.'
            : successMessage,
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
      <div ref={alertRef} tabIndex={-1}>
        {state.kind === 'error' ? <ErrorAlert error={state.error} labelOf={labelOf} /> : null}
        {state.kind === 'done' ? (
          <Alert tone={state.nothing ? 'warning' : 'success'}>{state.message}</Alert>
        ) : null}
      </div>
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
          'aria-invalid': errorOf(f.name) ? true : undefined,
          'aria-describedby': fieldDescribedBy(id, f.hint, errorOf(f.name)),
        };
        return (
          <Field key={f.name} id={id} label={f.label} hint={f.hint} error={errorOf(f.name)}>
            {type === 'select' || type === 'multi-select' ? (
              <Select
                {...common}
                multiple={type === 'multi-select'}
                size={type === 'multi-select' ? Math.min(8, f.options?.length ?? 0) : undefined}
              >
                {type === 'select' && (!f.required || !f.defaultValue) ? (
                  <option value="">{f.required ? 'Choose…' : '—'}</option>
                ) : null}
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label === o.value ? words(o.value) : o.label}
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
