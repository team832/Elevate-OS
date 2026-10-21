'use client';

/**
 * One-tap attendance for a demo class that has started and is not yet recorded (UX idea 2).
 * Buttons, not radios: one tap per class, and arrow keys never post by accident. Posts to the
 * existing session API; the server checks permission, scope and the attendance rules.
 * Corrections stay in the record's "Record or correct a class" form (reason required).
 * Always mounted (with the recorded badge as children once recorded), so after the refresh the
 * focused status line stays the same DOM node and keyboard focus is not lost.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { ATTENDANCE_LABELS, RECORDABLE_ATTENDANCE } from '../domain/demos';
import { fmtDateTime } from './format';

export function AttendanceControl({
  action,
  label,
  canRecord,
  children,
}: {
  action: string;
  label: string;
  canRecord: boolean;
  /** What is recorded (badge, recorder, time): shown when there is nothing to record. */
  children: ReactNode;
}) {
  const router = useRouter();
  const status = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function record(attendance: (typeof RECORDABLE_ATTENDANCE)[number]) {
    setBusy(true); // before the request, so a double tap cannot post twice
    setMessage(null);
    const res = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'attendance', attendance }),
      credentials: 'same-origin',
    }).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as {
      data?: { recordedAt?: string };
      error?: { message: string };
    };
    if (!res?.ok || json.error) {
      setMessage({
        text: json.error?.message ?? 'Not saved. Check the connection and try again.',
        error: true,
      });
      setBusy(false);
      return;
    }
    setMessage({
      text: `${ATTENDANCE_LABELS[attendance]} · recorded by you, ${fmtDateTime(json.data?.recordedAt ?? new Date())}`,
    });
    status.current?.focus(); // the buttons go away; focus stays on the result
    router.refresh(); // the line then shows the badge and recorder from the server
  }

  return (
    <div className="ops-attendance">
      {canRecord ? (
        <div
          role="group"
          aria-label={`Record attendance: ${label}`}
          className="ops-attendance-buttons"
        >
          {RECORDABLE_ATTENDANCE.map((a) => (
            <button
              key={a}
              type="button"
              className="el-button el-button-secondary"
              disabled={busy}
              onClick={() => void record(a)}
            >
              {ATTENDANCE_LABELS[a]}
            </button>
          ))}
        </div>
      ) : null}
      <span
        ref={status}
        tabIndex={-1}
        role={canRecord || message ? 'status' : undefined}
        className={message?.error ? 'el-field-error' : undefined}
      >
        {canRecord ? message?.text : children}
      </span>
    </div>
  );
}
