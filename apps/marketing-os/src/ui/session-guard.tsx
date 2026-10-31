'use client';

/**
 * Marketing forms are server actions, so an ended session would send the browser to sign-in and
 * lose what was typed (HUS-022). Before such a form posts, this asks whether the session is still
 * good; if not, the page stays as it is and offers sign-in in a new tab. A network that is down
 * would throw the same post into the error page and lose the typing (RVC-004), so it stops here too.
 */
import { useEffect, useRef, useState } from 'react';

type SubmitLike = Pick<SubmitEvent, 'preventDefault' | 'stopPropagation' | 'submitter'>;
type FormLike = { requestSubmit(submitter?: HTMLElement | null): void };

/** One check per form at a time; the re-sent submit goes through untouched. */
export function sessionGate(
  check: () => Promise<boolean | 'offline'>,
  onBlocked: (why: 'ended' | 'offline') => void,
) {
  const checking = new WeakSet<FormLike>();
  const passed = new WeakSet<FormLike>();
  return (event: SubmitLike, form: FormLike) => {
    if (passed.delete(form)) return;
    event.preventDefault();
    event.stopPropagation();
    if (checking.has(form)) return;
    checking.add(form);
    const { submitter } = event;
    void check().then((state) => {
      checking.delete(form);
      if (state !== true) return onBlocked(state === 'offline' ? 'offline' : 'ended');
      passed.add(form);
      form.requestSubmit(submitter);
    });
  };
}

/** A form whose action is a server function, as React renders one on the server or the client. */
const postsToAction = (form: HTMLFormElement) =>
  form.getAttribute('action')?.startsWith('javascript:') ||
  form.querySelector('input[name^="$ACTION"]') !== null;

export function SessionGuard({ check, signIn }: { check: string; signIn: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [why, setWhy] = useState<'ended' | 'offline'>('ended');
  useEffect(() => {
    const gate = sessionGate(
      () =>
        fetch(check, { credentials: 'same-origin' }).then(
          (res) => res.status !== 401,
          () => 'offline' as const,
        ),
      (reason) => {
        setWhy(reason);
        dialog.current?.showModal();
      },
    );
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      if (postsToAction(form)) gate(event, form);
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, [check]);
  return (
    <dialog ref={dialog} className="el-dialog" aria-labelledby="session-ended-title">
      <div className="el-dialog-header">
        <h2 id="session-ended-title">
          {why === 'offline' ? 'Could not reach the server' : 'You have been signed out'}
        </h2>
      </div>
      <div className="el-dialog-body el-stack">
        <p>
          {why === 'offline'
            ? 'Nothing was saved. Check the connection, then press the button again. What you typed stays here.'
            : 'Nothing was saved. Sign in again in a new tab, then come back and press the button again. What you typed stays here.'}
        </p>
        <div className="el-inline-form">
          {why === 'ended' ? (
            <a className="el-button el-button-primary" href={signIn} target="_blank" rel="noopener">
              Sign in in a new tab
            </a>
          ) : null}
          <button
            type="button"
            className="el-button el-button-secondary"
            onClick={() => dialog.current?.close()}
          >
            Back to the form
          </button>
        </div>
      </div>
    </dialog>
  );
}
