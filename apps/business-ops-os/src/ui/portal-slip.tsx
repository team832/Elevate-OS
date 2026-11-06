'use client';

/**
 * "Print a setup slip" (F4-13): asks the server for a new one-time setup code and shows the slip
 * in a dialog with a Print button. The code exists only in this dialog: closing it forgets it, and
 * a new slip makes the previous code stop working. Printing shows the slip alone.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@elevate/shared-ui';
import { fmtDateTime } from './format';
import { UNREACHABLE } from './pdf-download';
import './portal-slip.css';

interface Slip {
  login: string;
  code: string;
  expiresAt: string;
  name: string;
  studentName: string;
  kind: 'student' | 'guardian';
  portalUrl: string;
}

export function PortalSlipButton({ action, labelSuffix }: { action: string; labelSuffix: string }) {
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (slip) dialog.current?.showModal();
  }, [slip]);

  async function issue() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(action, { method: 'POST', credentials: 'same-origin' });
      const out = (await res.json().catch(() => ({}))) as {
        data?: Slip;
        error?: { message: string };
      };
      if (res.ok && out.data) setSlip(out.data);
      else setError(out.error?.message ?? `Request failed (${res.status}).`);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={issue} disabled={busy}>
        Print a setup slip<span className="el-visually-hidden">{labelSuffix}</span>
      </Button>
      {error ? (
        <p className="el-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {slip
        ? createPortal(
            <dialog
              ref={dialog}
              className="el-dialog portal-slip"
              aria-labelledby="portal-slip-title"
              onClose={() => setSlip(null)}
            >
              <h2 id="portal-slip-title">Elevate Education portal: setup slip</h2>
              <p>
                For <strong>{slip.name}</strong>
                {slip.kind === 'guardian'
                  ? `, parent or guardian of ${slip.studentName}`
                  : ' (student)'}
              </p>
              <dl className="portal-slip-facts">
                <dt>Portal address</dt>
                <dd>{slip.portalUrl}</dd>
                <dt>Login</dt>
                <dd className="portal-slip-mono">{slip.login}</dd>
                <dt>Setup code</dt>
                <dd className="portal-slip-mono portal-slip-code">{slip.code}</dd>
                <dt>Use the code by</dt>
                <dd>{fmtDateTime(slip.expiresAt)}. It works once.</dd>
              </dl>
              <h3>How to set your password</h3>
              <ol>
                <li>
                  Open <strong>{slip.portalUrl}/setup</strong> on a phone or computer.
                </li>
                <li>
                  Type the login and the setup code, and choose a password of at least 10
                  characters.
                </li>
                <li>Sign in at {slip.portalUrl} with the login above and your new password.</li>
              </ol>
              <p>
                Keep this slip private. If it is lost, ask Elevate Education for a new one: the old
                code then stops working.
              </p>
              <p className="portal-slip-screen-only el-field-hint">
                This code is shown only now. Print the slip before you close this window.
              </p>
              <div className="portal-slip-screen-only portal-slip-actions">
                <Button type="button" onClick={() => window.print()}>
                  Print slip
                </Button>
                <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>
                  Close
                </Button>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
