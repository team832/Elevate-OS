'use client';

/**
 * "New enquiry" form for the overview dialog. Posts to the EXISTING Business Ops
 * create-lead API (`POST /ops/api/v1/leads`, body schema `createLeadBody` in
 * apps/business-ops-os/src/server/schemas.ts); the server checks `ops:leads:write`,
 * validates and normalises contacts, and answers 409 with duplicate matches. This
 * form checks only what the server would reject anyway (name, one contact, email
 * shape), shows the server's field errors and duplicate warnings as they come,
 * and links to the new lead on success. Nothing is merged automatically.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { useDialogClose } from '@elevate/shared-ui';

interface Match {
  leadId: string;
  code: string;
  level: 'exact' | 'possible';
  signals: string[];
  accessible: boolean;
  studentName: string | null;
  ownerName: string | null;
}

type FieldName =
  | 'studentName'
  | 'studentPhone'
  | 'studentEmail'
  | 'guardianName'
  | 'guardianPhone'
  | 'programmeCode'
  | 'interestMode'
  | 'notes';

type Errors = Partial<Record<FieldName | 'contact', string>>;

const CONTACTS: FieldName[] = ['studentPhone', 'studentEmail', 'guardianPhone'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client checks that mirror the server's rules (the server stays the authority). */
export function validateEnquiry(values: Partial<Record<FieldName, string>>): Errors {
  const errors: Errors = {};
  if (!values.studentName?.trim()) errors.studentName = 'Enter the student’s name.';
  if (!CONTACTS.some((k) => values[k]?.trim()))
    errors.contact = 'Give at least one phone number or email (student or parent).';
  if (values.studentEmail?.trim() && !EMAIL.test(values.studentEmail.trim()))
    errors.studentEmail = 'Not a valid email address.';
  return errors;
}

/** Build the JSON body: trimmed values, empty fields left out. */
export function enquiryBody(values: Partial<Record<FieldName, string>>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t) body[k] = t;
  }
  return body;
}

export function NewEnquiryForm({
  programmes,
}: {
  programmes: readonly { value: string; label: string }[];
}) {
  const closeDialog = useDialogClose();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    code: string | null;
    owned: boolean;
  } | null>(null);

  const id = (name: string) => `${uid}-${name}`;
  const describedBy = (name: FieldName, hint?: boolean) =>
    [
      hint ? id(`${name}-hint`) : '',
      errors[name] ? id(`${name}-error`) : '',
      // the "one contact needed" error belongs to every contact field
      errors.contact && CONTACTS.includes(name) ? id('contact-error') : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  function values(): Partial<Record<FieldName, string>> {
    const data = new FormData(formRef.current ?? undefined);
    const out: Partial<Record<FieldName, string>> = {};
    for (const [k, v] of data.entries()) if (typeof v === 'string') out[k as FieldName] = v;
    return out;
  }

  function focusFirstError(found: Errors) {
    const first = (Object.keys(found) as (FieldName | 'contact')[])[0];
    const target = first === 'contact' ? 'studentPhone' : first;
    if (target) formRef.current?.querySelector<HTMLElement>(`[name="${target}"]`)?.focus();
  }

  async function submit(acknowledge: boolean) {
    if (busy) return; // no double submit
    const v = values();
    const found = validateEnquiry(v);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }
    const body = enquiryBody(v);
    if (acknowledge) body.acknowledgeDuplicates = { reason: reason.trim() };
    setBusy(true);
    let res: Response;
    try {
      res = await fetch('/ops/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      setBusy(false);
      setMessage('Business Operations could not be reached. Check the connection and try again.');
      return;
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { lead?: { id: string; code?: string; ownerStaffId?: string | null } };
      error?: { code?: string; message?: string; details?: unknown };
    };
    setBusy(false);
    if (res.status === 409 && json.error?.details && typeof json.error.details === 'object') {
      const dup = (json.error.details as { duplicates?: Match[] }).duplicates;
      if (Array.isArray(dup)) {
        setMatches(dup);
        setMessage(json.error.message ?? 'This contact may already exist.');
        return;
      }
    }
    if (!res.ok || !json.data?.lead) {
      const details = Array.isArray(json.error?.details)
        ? (json.error.details as { path?: (string | number)[]; message?: string }[])
        : [];
      const fieldErrors: Errors = {};
      const other: string[] = [];
      for (const d of details) {
        const field = d.path?.[0];
        if (typeof field === 'string' && d.message) fieldErrors[field as FieldName] = d.message;
        else if (d.message) other.push(d.message);
      }
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length) focusFirstError(fieldErrors);
      setMessage(
        res.status === 401
          ? 'Your session has ended. Sign in again, then add the enquiry.'
          : res.status === 403
            ? 'Your role cannot add enquiries.'
            : [json.error?.message ?? 'The enquiry could not be saved.', ...other].join(' '),
      );
      return;
    }
    setCreated({
      id: json.data.lead.id,
      code: json.data.lead.code ?? null,
      owned: Boolean(json.data.lead.ownerStaffId),
    });
    formRef.current?.reset();
    setMatches(null);
    setReason('');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  if (created) {
    return (
      <div className="el-stack" role="status">
        <p className="el-enquiry-done">
          <strong>Saved as lead {created.code ?? ''}.</strong>{' '}
          {created.owned
            ? 'Open it to see the first follow-up and add notes from the call.'
            : 'It has no counsellor yet: open it to assign one and set the first follow-up.'}
        </p>
        <div className="el-form-actions">
          <button
            type="button"
            className="el-button el-button-secondary"
            onClick={() => setCreated(null)}
          >
            Add another enquiry
          </button>
          <a className="el-button el-button-primary" href={`/ops/leads/${created.id}`}>
            Open lead {created.code ?? ''}
          </a>
        </div>
      </div>
    );
  }

  const field = (
    name: FieldName,
    label: string,
    input: 'text' | 'tel' | 'email',
    opts: { required?: boolean; hint?: string } = {},
  ) => (
    <div className="el-field">
      <label htmlFor={id(name)}>
        {label}
        {opts.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id(name)}
        name={name}
        type={input}
        className="el-input"
        required={opts.required}
        aria-invalid={
          errors[name] || (errors.contact && CONTACTS.includes(name)) ? true : undefined
        }
        aria-describedby={describedBy(name, Boolean(opts.hint))}
        // The student's details, not the signed-in user's: no autofill from their profile.
        autoComplete="off"
        maxLength={input === 'email' ? 254 : input === 'tel' ? 40 : 200}
      />
      {opts.hint ? (
        <p className="el-field-hint" id={id(`${name}-hint`)}>
          {opts.hint}
        </p>
      ) : null}
      {errors[name] ? (
        <p className="el-field-error" id={id(`${name}-error`)}>
          {errors[name]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={busy || undefined}>
      <p className="el-field-hint el-enquiry-required">
        Fields marked * are required. Give at least one phone number or email.
      </p>
      <fieldset className="el-fieldset">
        <legend>Student</legend>
        <div className="el-form-grid">
          <div className="el-field-wide">
            {field('studentName', 'Student name', 'text', { required: true })}
          </div>
          {field('studentPhone', 'Student phone', 'tel', {
            hint: '98765 43210, +91 98765 43210 or 098765-43210',
          })}
          {field('studentEmail', 'Student email', 'email')}
        </div>
      </fieldset>
      <fieldset className="el-fieldset">
        <legend>Parent or guardian</legend>
        <div className="el-form-grid">
          {field('guardianName', 'Name', 'text')}
          {field('guardianPhone', 'Phone', 'tel')}
        </div>
      </fieldset>
      {errors.contact ? (
        <p
          className="el-field-error el-enquiry-contact-error"
          id={id('contact-error')}
          role="alert"
        >
          {errors.contact}
        </p>
      ) : null}
      <fieldset className="el-fieldset">
        <legend>Interest</legend>
        <div className="el-form-grid">
          {programmes.length > 0 ? (
            <div className="el-field">
              <label htmlFor={id('programmeCode')}>Programme</label>
              <select
                id={id('programmeCode')}
                name="programmeCode"
                className="el-select"
                defaultValue=""
                aria-invalid={errors.programmeCode ? true : undefined}
                aria-describedby={describedBy('programmeCode')}
              >
                <option value="">Not decided</option>
                {programmes.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {errors.programmeCode ? (
                <p className="el-field-error" id={id('programmeCode-error')}>
                  {errors.programmeCode}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="el-field">
            <label htmlFor={id('interestMode')}>Mode</label>
            <select
              id={id('interestMode')}
              name="interestMode"
              className="el-select"
              defaultValue="undecided"
            >
              <option value="undecided">Undecided</option>
              <option value="offline">Offline (classroom)</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div className="el-field el-field-wide">
            <label htmlFor={id('notes')}>Notes</label>
            <textarea
              id={id('notes')}
              name="notes"
              className="el-textarea"
              rows={2}
              maxLength={2000}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={describedBy('notes')}
            />
            {errors.notes ? (
              <p className="el-field-error" id={id('notes-error')}>
                {errors.notes}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      {matches ? (
        <div className="el-alert el-tone-warning el-enquiry-dupes" role="alert">
          <p className="el-alert-title">
            Possible existing contact. Nothing has been saved or merged.
          </p>
          <p>{message}</p>
          <ul>
            {matches.map((m) => (
              <li key={m.leadId}>
                <strong>{m.level === 'exact' ? 'Existing contact' : 'Possible duplicate'}:</strong>{' '}
                {m.accessible ? (
                  <a href={`/ops/leads/${m.leadId}`}>
                    {m.code}
                    {m.studentName ? `, ${m.studentName}` : ''}
                  </a>
                ) : (
                  <span>
                    {m.code} (owned by {m.ownerName ?? 'another counsellor'}; ask an operations
                    manager)
                  </span>
                )}{' '}
                (matched on {m.signals.join(', ').replace(/_/g, ' ')})
              </li>
            ))}
          </ul>
          <p>
            To add this enquiry to an existing lead, open it and use “Add enquiry”. If this is a
            different person, say why and save anyway:
          </p>
          <div className="el-field">
            <label htmlFor={id('ack')}>Reason (required to save anyway)</label>
            <input
              id={id('ack')}
              className="el-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <button
            type="button"
            className="el-button el-button-secondary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit(true)}
          >
            Save anyway and flag for merge review
          </button>
        </div>
      ) : message ? (
        <div className="el-alert el-tone-danger el-enquiry-error" role="alert">
          {message}
        </div>
      ) : null}

      <div className="el-form-actions">
        <button type="button" className="el-button el-button-secondary" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="el-button el-button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save enquiry'}
        </button>
      </div>
    </form>
  );
}
