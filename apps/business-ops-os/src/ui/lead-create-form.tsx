'use client';

/**
 * Lead capture with duplicate-contact warnings (OPS-003). The server answers
 * 409 CONFLICT with the matches when an exact duplicate exists; the form then
 * shows them, links to the ones the user may open, and offers either "attach a
 * new enquiry to the existing lead" or "save anyway" with a reason. Nothing is
 * ever merged automatically — merges are a separate, audited review.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { groupSections, toBody, type FieldSpec } from './action-form';
import { FormSection } from './sections';

interface Match {
  leadId: string;
  code: string;
  level: 'exact' | 'possible';
  signals: string[];
  accessible: boolean;
  studentName: string | null;
  ownerName: string | null;
}

export function LeadCreateForm({
  fields,
  cancelHref,
}: {
  fields: readonly FieldSpec[];
  cancelHref?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(acknowledge: boolean) {
    if (!formRef.current) return;
    setBusy(true);
    setMessage(null);
    const body = toBody(fields, new FormData(formRef.current));
    if (acknowledge) body.acknowledgeDuplicates = { reason };
    const res = await fetch('/ops/api/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { lead: { id: string }; duplicates: Match[] };
      error?: { code: string; message: string; details?: unknown };
    };
    setBusy(false);
    if (res.status === 409 && json.error?.details && typeof json.error.details === 'object') {
      setMatches((json.error.details as { duplicates: Match[] }).duplicates);
      setMessage(json.error.message);
      return;
    }
    if (!res.ok || !json.data) {
      const details = Array.isArray(json.error?.details)
        ? (json.error?.details as { message: string }[]).map((d) => d.message).join(' ')
        : '';
      setMessage(`${json.error?.message ?? 'Could not save.'} ${details}`.trim());
      return;
    }
    // Next adds the basePath itself (D-022).
    router.push(`/leads/${json.data.lead.id}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="el-stack" noValidate>
      {groupSections(fields).map((g) => (
        <FormSection key={g.title ?? 'lead'} title={g.title ?? 'Lead'}>
          {g.fields.map((f) => {
            const id = `lead-${f.name}`;
            return (
              <div
                key={f.name}
                className={f.type === 'textarea' ? 'el-field el-field-wide' : 'el-field'}
              >
                <label htmlFor={id}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
                {f.type === 'select' ? (
                  <select
                    id={id}
                    name={f.name}
                    className="el-select"
                    defaultValue={f.defaultValue ?? ''}
                  >
                    {!f.required ? <option value="">—</option> : null}
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea id={id} name={f.name} className="el-textarea" rows={2} />
                ) : (
                  <input
                    id={id}
                    name={f.name}
                    className="el-input"
                    type={f.type ?? 'text'}
                    defaultValue={f.defaultValue}
                  />
                )}
                {f.hint ? <p className="el-field-hint">{f.hint}</p> : null}
              </div>
            );
          })}
        </FormSection>
      ))}
      {matches ? (
        <div className="el-alert el-tone-warning" role="alert">
          <p className="el-alert-title">
            Possible existing contact — nothing has been saved or merged.
          </p>
          <p>{message}</p>
          <ul>
            {matches.map((m) => (
              <li key={m.leadId}>
                <strong>{m.level === 'exact' ? 'Existing contact' : 'Possible duplicate'}</strong>{' '}
                {m.accessible ? (
                  <a href={`/ops/leads/${m.leadId}`}>
                    {m.code}
                    {m.studentName ? ` — ${m.studentName}` : ''}
                  </a>
                ) : (
                  <span>
                    {m.code} (owned by {m.ownerName ?? 'another counsellor'}; ask an operations
                    manager)
                  </span>
                )}{' '}
                · matched on {m.signals.join(', ').replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
          <p>
            To add this enquiry to an existing lead, open it and use “Add enquiry”. If this really
            is a different person, say why:
          </p>
          <div className="el-field">
            <label htmlFor="ack-reason">Reason (required to save anyway)</label>
            <input
              id="ack-reason"
              className="el-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="el-button el-button-secondary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void submit(true)}
          >
            Save anyway (flag for merge review)
          </button>
        </div>
      ) : message ? (
        <div className="el-alert el-tone-danger" role="alert">
          {message}
        </div>
      ) : null}
      <div className="ops-form-footer">
        {cancelHref ? <a href={cancelHref}>Cancel</a> : null}
        <button type="submit" className="el-button el-button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Create lead'}
        </button>
      </div>
    </form>
  );
}
