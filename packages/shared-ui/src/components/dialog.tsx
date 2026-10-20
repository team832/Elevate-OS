'use client';

/**
 * Modal dialog on the native <dialog> element: `showModal()` makes the rest of
 * the page inert (focus stays inside), Escape closes it, and focus returns to the
 * button that opened it. Labelled by its title; described by its description.
 * Content can close it with `useDialogClose()`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { ButtonVariant } from './forms';
import { Icon, type IconName } from './icons';

const DialogCloseContext = createContext<() => void>(() => {});

/** Close the surrounding Dialog (no-op outside one). */
export function useDialogClose(): () => void {
  return useContext(DialogCloseContext);
}

export function Dialog({
  id,
  title,
  description,
  triggerLabel,
  triggerIcon,
  triggerVariant = 'primary',
  children,
}: {
  /** Unique id; the title and description ids derive from it. */
  id: string;
  title: string;
  description?: ReactNode;
  triggerLabel: string;
  triggerIcon?: IconName;
  triggerVariant?: ButtonVariant;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => dialog.current?.close(), []);
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    // A click on the ::backdrop targets the <dialog> itself, not its content.
    if (e.target === e.currentTarget) close();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`el-button el-button-${triggerVariant}`}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => dialog.current?.showModal()}
      >
        {triggerIcon ? <Icon name={triggerIcon} size={16} /> : null}
        {triggerLabel}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="el-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        onClose={() => trigger.current?.focus()}
        onClick={onBackdrop}
      >
        <div className="el-dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="el-icon-button" onClick={close}>
            <Icon name="close" />
            <span className="el-visually-hidden">Close</span>
          </button>
        </div>
        {description ? (
          <p id={`${id}-description`} className="el-dialog-description">
            {description}
          </p>
        ) : null}
        <div className="el-dialog-body">
          <DialogCloseContext.Provider value={close}>{children}</DialogCloseContext.Provider>
        </div>
      </dialog>
    </>
  );
}
