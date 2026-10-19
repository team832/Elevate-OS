import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

function buttonClass(variant: ButtonVariant, block?: boolean, extra?: string) {
  return ['el-button', `el-button-${variant}`, block ? 'el-button-block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'primary',
  block,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean }) {
  return <button type={type} className={buttonClass(variant, block, className)} {...rest} />;
}

/** A link styled as a button (navigation, not actions). */
export function ButtonLink({
  variant = 'secondary',
  block,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; block?: boolean }) {
  return <a className={buttonClass(variant, block, className)} {...rest} />;
}

/**
 * Label + control + hint + error, wired with ids for screen readers. Pass the
 * control as children and give it `id={id}` and `aria-describedby` from
 * `fieldDescribedBy(id, hint, error)`.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="el-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <p className="el-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="el-field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function fieldDescribedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

type WithError = { invalid?: boolean };

export function TextInput({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & WithError) {
  return (
    <input
      className={['el-input', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & WithError) {
  return (
    <select
      className={['el-select', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export function TextArea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & WithError) {
  return (
    <textarea
      className={['el-textarea', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Checkbox({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="el-checkbox">
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}
