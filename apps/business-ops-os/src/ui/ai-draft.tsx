'use client';

/**
 * AI draft helper (owner request 23 Oct 2026). Asks an /api/v1/ai/* route for a suggestion, shows
 * it as plain text labelled as an AI draft, and only when the person chooses "Use this draft"
 * puts it into the fields (by name) of the form it wraps, or hands it to `onUse`. It never saves,
 * submits or sends anything: the person checks, edits and saves with the form's own button.
 * Imports only domain constants — never server code or the OpenAI adapter.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { AI_DRAFT_LABEL, AI_FAILED, type DraftItem } from '../domain/ai-assist';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function AiDraft({
  api,
  body,
  blocked,
  buttonLabel = 'Draft with AI',
  note = AI_DRAFT_LABEL,
  onUse,
  children,
}: {
  /** e.g. `/ops/api/v1/ai/feedback-summary`. */
  api: string;
  /** Request body, or a function giving it when the button is pressed (null = nothing to send). */
  body: Record<string, unknown> | (() => Record<string, unknown> | null);
  /** Why it can't be used now (not set up, turned off, today's limit); null = ready. */
  blocked?: string | null;
  buttonLabel?: string;
  note?: string;
  /** Instead of filling the wrapped form's fields by name. */
  onUse?: (items: DraftItem[]) => void;
  /** The form whose fields the draft fills. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [stop, setStop] = useState<string | null>(null);
  const reason = blocked ?? stop;

  async function ask() {
    const payload = typeof body === 'function' ? body() : body;
    if (!payload) return;
    setBusy(true);
    setItems(null);
    setMessage('Asking for a draft…');
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });
      const out = (await res.json().catch(() => ({}))) as {
        data?: { items: DraftItem[] };
        error?: { message: string };
      };
      if (res.ok && out.data) {
        setItems(out.data.items);
        setMessage(
          out.data.items.length
            ? 'Draft ready below. Check it before using it.'
            : 'No suggestion this time.',
        );
      } else if (res.status === 409 || res.status === 429) {
        // Not set up, turned off, too few responses or today's limit: retrying will not help.
        setStop(out.error?.message ?? AI_FAILED);
        setMessage('');
      } else setMessage(out.error?.message ?? AI_FAILED);
    } catch {
      setMessage(AI_FAILED);
    } finally {
      setBusy(false);
    }
  }

  function use(draft: DraftItem[]) {
    if (onUse) onUse(draft);
    else {
      const fields = draft.flatMap((i) => {
        const el = box.current?.querySelector<Field>(`[name="${CSS.escape(i.name)}"]`);
        if (!el) return [];
        el.value = i.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return [el];
      });
      fields[0]?.focus();
    }
    setItems(null);
    setMessage('Draft put into the form. Edit it as needed, then save.');
  }

  return (
    <div ref={box} className="el-stack">
      <div className="el-inline-form">
        <button
          type="button"
          className="el-button el-button-secondary"
          onClick={ask}
          disabled={busy || Boolean(reason)}
          aria-describedby={`${id}-status`}
        >
          {busy ? 'Drafting…' : buttonLabel}
        </button>
        <p id={`${id}-status`} className="el-field-hint" role="status" aria-live="polite">
          {reason ?? message}
        </p>
      </div>
      {items?.length ? (
        <section className="el-alert el-tone-info" aria-labelledby={`${id}-title`}>
          <p id={`${id}-title`} className="el-alert-title">
            {note}
          </p>
          {items.map((i) => (
            <div key={i.name}>
              <p>
                <strong>{i.label}</strong>
              </p>
              {(i.shown ?? i.value).split('\n').map((line, n) => (
                <p key={n}>{line}</p>
              ))}
            </div>
          ))}
          <div className="el-inline-form">
            <button
              type="button"
              className="el-button el-button-primary"
              onClick={() => use(items)}
            >
              Use this draft
            </button>
            <button
              type="button"
              className="el-button el-button-secondary"
              onClick={() => {
                setItems(null);
                setMessage('Draft discarded.');
              }}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Task brief helper (wraps HR → Tasks "Assign a task", app/hr/tasks/page.tsx). The reviewer types a
 * rough line; the draft's items are named title, expectedDeliverable, acceptanceCriteria,
 * checklist (one per line), dueOn (YYYY-MM-DD), dueTime (HH:MM) — absent when not stated.
 */
export function TaskBriefAssist({
  api,
  blocked,
  onUse,
  children,
}: {
  /** `<base>/api/v1/ai/task-brief`. */
  api: string;
  blocked?: string | null;
  /** Omit to fill the wrapped form's fields with those names. */
  onUse?: (items: DraftItem[]) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const [line, setLine] = useState('');
  return (
    <div className="el-stack">
      <div className="el-field el-field-wide">
        <label htmlFor={id}>Describe the task in a line</label>
        <textarea
          id={id}
          className="el-textarea"
          rows={2}
          maxLength={2000}
          value={line}
          onChange={(e) => setLine(e.target.value)}
        />
      </div>
      <AiDraft
        api={api}
        body={() => (line.trim().length >= 3 ? { text: line } : null)}
        blocked={blocked}
        buttonLabel="Suggest a brief"
        onUse={onUse}
      >
        {children}
      </AiDraft>
    </div>
  );
}
