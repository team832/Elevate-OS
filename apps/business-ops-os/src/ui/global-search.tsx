'use client';
/** "/" (outside a text field) moves focus to the top-bar search box. */
import { useEffect } from 'react';

type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & {
  target: Pick<HTMLElement, 'tagName' | 'isContentEditable'> | null;
};

/** True for a plain "/" typed outside an input, text area, select or editable text. */
export const isSearchShortcut = (e: Key) =>
  e.key === '/' &&
  !e.ctrlKey &&
  !e.metaKey &&
  !e.altKey &&
  !e.target?.isContentEditable &&
  !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName ?? '');

export function SearchShortcut({ inputId }: { inputId: string }) {
  useEffect(() => {
    const input = document.getElementById(inputId);
    input?.setAttribute('aria-keyshortcuts', '/');
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e as Key)) return;
      e.preventDefault();
      input?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inputId]);
  return null;
}
