'use client';

/**
 * Generic JSON form for Business Ops actions. Builds the JSON body from the
 * fields (empty values omitted), calls the module's /api/v1 route (the server checks
 * permissions and validates), shows field errors, and refreshes on success.
 */
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { parseRupeesToPaise } from '../domain/fees';
import { fmtPaise, routerPath } from './format';
import { FormSection } from './sections';

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
    /** Rupees as typed ("25,000.50"); a decimal keypad on phones. */
    | 'money'
    | 'json';
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  defaultValue?: string;
  /** Heading of the form section this field belongs to (consecutive fields share one). */
  section?: string;
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
  /** Extra request headers, e.g. an Idempotency-Key rendered once per page load. */
  headers?: Record<string, string>;
  /** Secondary action beside the submit button, e.g. a "Cancel" link back to the list. */
  secondary?: ReactNode;
  /** Shown after success, e.g. "Attendance recorded for Day 2, class 1". */
  successText?: string;
  /** Label once the `money` field holds an amount: `{amount}` becomes e.g. "₹5,000". */
  amountLabel?: string;
  /** Visually hidden text after every label and the button (e.g. " for Call Asha"), so repeated row forms have distinct accessible names. */
  labelSuffix?: string;
  /** Empty the fields after a success (repeatable entries such as comments). */
  resetOnSuccess?: boolean;
}

const WIDE = new Set<FieldSpec['type']>(['textarea', 'json', 'checkbox']);
const INPUT_TYPE: Partial<Record<NonNullable<FieldSpec['type']>, string>> = {
  datetime: 'datetime-local',
  list: 'text',
  money: 'text',
};

/** Consecutive fields with the same `section`, in order. */
export function groupSections(fields: readonly FieldSpec[]) {
  const groups: { title?: string; fields: FieldSpec[] }[] = [];
  for (const f of fields) {
    const last = groups.at(-1);
    if (last && last.title === f.section) last.fields.push(f);
    else groups.push({ title: f.section, fields: [f] });
  }
  return groups;
}

type ApiError = { code: string; message: string; details?: unknown };
type Issue = { path?: (string | number)[]; message: string };
type Outcome = { data?: { id?: string; lead?: { id?: string } }; error?: ApiError };

// randomUUID needs a secure context; plain-http LAN testing falls back to a time-random key.
const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * One request at a time per form. A failed request keeps its Idempotency-Key while the body is
 * unchanged, so a retry after a network error replays on the server instead of posting twice.
 * A changed body or a success starts a new key (the server refuses a key reused for a different
 * body, and a second identical payment after a success is deliberate).
 */
export function submitGate(makeKey: () => string = newKey) {
  let key = '';
  let failedBody: string | undefined;
  let busy = false;
  return async (body: string, send: (key: string) => Promise<Outcome>): Promise<Outcome | null> => {
    if (busy) return null;
    busy = true;
    if (body !== failedBody) key = makeKey();
    try {
      const out = await send(key);
      failedBody = out.error ? body : undefined;
      return out;
    } finally {
      busy = false;
    }
  };
}

/** Idempotency-Key refusals in plain words (a caller's own key, or a request still running). */
export const plainError = (e: ApiError): ApiError =>
  e.message.includes('Idempotency-Key')
    ? { ...e, message: 'This form was already sent. Reload the page to see what was saved.' }
    : e;

/** Request error: with 2+ field issues a GOV.UK-style summary linking to each field. */
export function FormAlert({
  error,
  issues,
  fieldFor,
  ref,
}: {
  error: ApiError;
  issues: readonly Issue[];
  /** The input id and label of the field an issue belongs to, if any. */
  fieldFor: (issue: Issue) => { id: string; label: string } | undefined;
  ref?: Ref<HTMLDivElement>;
}) {
  const linked = issues.filter((i) => fieldFor(i)).length;
  return (
    <div className="el-alert el-tone-danger" role="alert" tabIndex={-1} ref={ref}>
      <p className="el-alert-title">{linked >= 2 ? 'There is a problem' : error.message}</p>
      {linked >= 2 || linked < issues.length ? (
        <ul>
          {issues.map((i, n) => {
            const f = fieldFor(i);
            return (
              <li key={n}>
                {f ? (
                  <a
                    href={`#${f.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(f.id)?.focus();
                    }}
                  >
                    {f.label}: {i.message}
                  </a>
                ) : (
                  i.message
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

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
  headers,
  secondary,
  successText = 'Saved.',
  amountLabel,
  labelSuffix,
  resetOnSuccess,
}: ActionFormProps) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [gate] = useState(() => submitGate());
  const alertRef = useRef<HTMLDivElement>(null);
  const money = fields.find((f) => f.type === 'money');
  const [paise, setPaise] = useState(() => parseRupeesToPaise(money?.defaultValue ?? ''));
  // Unique per form: two forms posting to the same route never share field ids.
  const formId = useId();
  useEffect(() => alertRef.current?.focus(), [error]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = toBody(fields, new FormData(form), extra);
    // Disabled before the request starts: a double click never posts twice.
    setSubmitting(true);
    const json = await gate(JSON.stringify(body), async (key) => {
      try {
        const res = await fetch(action, {
          method,
          // Callers' headers win (the conversion form brings its own key).
          headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers },
          body: method === 'DELETE' ? undefined : JSON.stringify(body),
          credentials: 'same-origin',
        });
        const out = (await res.json().catch(() => ({}))) as Outcome;
        if (res.ok && !out.error) return out;
        return {
          error: out.error
            ? plainError(out.error)
            : { code: 'INTERNAL', message: `Request failed (${res.status}).` },
        };
      } catch {
        return {
          error: {
            code: 'NETWORK',
            message: 'Could not reach the server. Check the connection and try again.',
          },
        };
      }
    });
    if (!json) return;
    setSubmitting(false);
    setError(json.error ?? null);
    setDone(!json.error);
    if (json.error) return;
    if (resetOnSuccess) form.reset();
    startTransition(() => {
      if (redirectTo)
        router.push(
          routerPath(redirectTo.replace('{id}', json.data?.id ?? json.data?.lead?.id ?? '')),
        );
      else router.refresh();
    });
  }

  const issues: Issue[] = Array.isArray(error?.details) ? error.details : [];
  const suffix = labelSuffix ? <span className="el-visually-hidden">{labelSuffix}</span> : null;
  const idOf = (f: FieldSpec) => `${formId}-${f.name}`;
  const fieldFor = (i: Issue) => {
    const f = fields.find((x) => x.type !== 'hidden' && x.name === i.path?.join('.'));
    return f && { id: idOf(f), label: f.label };
  };
  const field = (f: FieldSpec) => {
    const id = idOf(f);
    const fieldError = issues.find((i) => i.path?.join('.') === f.name)?.message;
    const hintId = f.hint ? `${id}-hint` : '';
    const errorId = fieldError ? `${id}-error` : '';
    const a11y = {
      id,
      'aria-invalid': Boolean(fieldError) || undefined,
      'aria-describedby': `${hintId} ${errorId}`.trim() || undefined,
    };
    const notes = (
      <>
        {f.hint ? (
          <p id={hintId} className="el-field-hint">
            {f.hint}
          </p>
        ) : null}
        {fieldError ? (
          <p id={errorId} className="el-field-error">
            {fieldError}
          </p>
        ) : null}
      </>
    );
    if (f.type === 'hidden')
      return <input key={f.name} type="hidden" name={f.name} defaultValue={f.defaultValue} />;
    if (f.type === 'checkbox')
      return (
        <div key={f.name} className="el-field el-field-wide">
          <label className="el-checkbox" htmlFor={id}>
            <input
              type="checkbox"
              name={f.name}
              defaultChecked={f.defaultValue === 'true'}
              {...a11y}
            />{' '}
            {f.label}
            {suffix}
          </label>
          {notes}
        </div>
      );
    return (
      <div key={f.name} className={WIDE.has(f.type) ? 'el-field el-field-wide' : 'el-field'}>
        <label htmlFor={id}>
          {f.label}
          {suffix}
        </label>
        {f.type === 'textarea' || f.type === 'json' ? (
          <textarea
            name={f.name}
            className="el-textarea"
            defaultValue={f.defaultValue}
            required={f.required}
            rows={3}
            {...a11y}
          />
        ) : f.type === 'select' ? (
          <select
            name={f.name}
            className="el-select"
            defaultValue={f.defaultValue ?? ''}
            required={f.required}
            {...a11y}
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
            name={f.name}
            className="el-input"
            type={INPUT_TYPE[f.type ?? 'text'] ?? f.type ?? 'text'}
            inputMode={f.type === 'money' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined}
            autoComplete={f.type === 'tel' ? 'tel' : undefined}
            defaultValue={f.defaultValue}
            required={f.required}
            onChange={f === money ? (e) => setPaise(parseRupeesToPaise(e.target.value)) : undefined}
            {...a11y}
          />
        )}
        {notes}
      </div>
    );
  };
  const footer = (
    <>
      {error ? (
        <FormAlert ref={alertRef} error={error} issues={issues} fieldFor={fieldFor} />
      ) : null}
      {done && !error ? (
        <p className="el-field-hint" role="status">
          {successText}
        </p>
      ) : null}
      {secondary}
      <button
        type="submit"
        className={`el-button el-button-${variant}`}
        disabled={submitting || pending}
      >
        {submitting || pending
          ? 'Saving…'
          : amountLabel && paise
            ? amountLabel.replace('{amount}', fmtPaise(paise))
            : submitLabel}
        {suffix}
      </button>
    </>
  );
  if (compact)
    return (
      <form onSubmit={onSubmit} className="el-inline-form" noValidate>
        {fields.map(field)}
        {footer}
      </form>
    );
  return (
    <form onSubmit={onSubmit} className="el-stack" noValidate>
      {fields.some((f) => f.section)
        ? groupSections(fields).map((g, i) =>
            g.title ? (
              <FormSection key={`${g.title}-${i}`} title={g.title}>
                {g.fields.map(field)}
              </FormSection>
            ) : (
              <div key={`group-${i}`} className="el-form-grid">
                {g.fields.map(field)}
              </div>
            ),
          )
        : fields.map(field)}
      <div className="ops-form-footer el-glass">{footer}</div>
    </form>
  );
}
