'use client';

/**
 * Centred record pop-up. The list page renders it only when `?open=<id>` is in
 * the URL, so the record is shareable and closing it restores the list exactly
 * (filters stay in the URL). Native <dialog> + showModal(): focus stays inside,
 * Escape / the close button / a backdrop click close it, focus returns to the
 * row link (`data-drawer-return`). A curved bottom sheet on phones, a centred panel from 641px.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Icon, nextTabIndex } from '@elevate/shared-ui';
import { routerPath } from './format';

const noSubscribe = () => () => {};

export interface ModalTab {
  key: string;
  label: string;
  content: ReactNode;
  /** Shown after the label; null/undefined shows nothing (unknown is not zero). */
  count?: number | null;
}

export interface RecordModalProps {
  id: string;
  title: string;
  /** Status badges, reference, sample label: shown under the title. */
  meta?: ReactNode;
  /** Deep route of the record ("Open full record"). */
  fullHref?: string;
  /** The list URL without `open` (browser path, with the basePath). */
  closeHref: string;
  /** Row to focus after closing (matches `data-drawer-return` on the row link); default: `?open=`. */
  returnId?: string;
  /** Splits a long record into sections; rendered after `children`. */
  tabs?: readonly ModalTab[];
  /** `form`: narrower, for create/edit flows. */
  size?: 'record' | 'form';
  children?: ReactNode;
}

export function RecordModal({
  id,
  title,
  meta,
  fullHref,
  closeHref,
  returnId,
  tabs,
  size = 'record',
  children,
}: RecordModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const router = useRouter();
  // The open section lives in the URL, so a reload or a shared link keeps it.
  const inUrl = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(location.search).get('section'),
    () => null,
  );
  const [chosen, setChosen] = useState<string>();
  const tab = chosen ?? (tabs?.some((t) => t.key === inUrl) ? inUrl! : tabs?.[0]?.key);
  const chooseTab = (key: string) => {
    setChosen(key);
    const url = new URL(location.href);
    url.searchParams.set('section', key);
    history.replaceState(null, '', url);
  };
  // Rendered open so it paints with the page, not after hydration (ops.css); this makes it the real modal.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.removeAttribute('open');
    dialog.showModal();
  }, []);
  const onClose = () => {
    router.replace(routerPath(closeHref), { scroll: false });
    // The row's key is the `open` value on almost every list, so most callers need not pass it.
    const row = returnId ?? new URLSearchParams(location.search).get('open');
    const rowLink = row && document.querySelector<HTMLElement>(`[data-drawer-return="${CSS.escape(row)}"]`);
    // Opened from a page button (New lead): back to the page's own actions.
    (rowLink || document.querySelector<HTMLElement>('.el-page-actions a, .el-page-actions button') || document.getElementById('main'))?.focus();
  };
  // A click on the ::backdrop targets the <dialog> itself, not its content.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) ref.current?.close();
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabs ? nextTabIndex(e.key, index, tabs.length) : null;
    if (next === null || !tabs?.[next]) return;
    e.preventDefault();
    chooseTab(tabs[next].key);
    tabRefs.current[next]?.focus();
  };
  return (
    <dialog
      ref={ref}
      id={id}
      className={`el-dialog ops-modal${size === 'form' ? ' ops-modal-form' : ''}`}
      aria-labelledby={`${id}-title`}
      open
      onClose={onClose}
      onClick={onBackdrop}
    >
      <header className="el-dialog-header ops-modal-head">
        <div className="ops-modal-titles">
          <h2 id={`${id}-title`}>{title}</h2>
          {meta ? <div className="ops-modal-meta">{meta}</div> : null}
        </div>
        <div className="ops-modal-actions">
          {fullHref ? <a href={fullHref}>Open full record</a> : null}
          {/* A plain link until hydrated, so Close never waits on JavaScript; after that it closes in place. */}
          <a
            href={closeHref}
            className="el-icon-button"
            onClick={(e) => {
              e.preventDefault();
              ref.current?.close();
            }}
          >
            <Icon name="close" />
            <span className="el-visually-hidden">Close</span>
          </a>
        </div>
        {tabs?.length ? (
          <div
            className="el-tablist ops-modal-tabs"
            role="tablist"
            aria-label={`${title}: sections`}
          >
            {tabs.map((t, i) => (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${t.key}`}
                aria-selected={t.key === tab}
                aria-controls={`${id}-panel-${t.key}`}
                tabIndex={t.key === tab ? 0 : -1}
                className="el-tab"
                onClick={() => chooseTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
                {typeof t.count === 'number' ? (
                  <span className="el-tab-count">{t.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="ops-modal-body">
        {children}
        {tabs?.map((t) => (
          <div
            key={t.key}
            id={`${id}-panel-${t.key}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${t.key}`}
            hidden={t.key !== tab}
            tabIndex={0}
            className="el-stack"
          >
            {t.content}
          </div>
        ))}
      </div>
    </dialog>
  );
}

/** A create/edit flow in the centred modal (narrower; put an ActionForm with sections inside). */
export function FormModal(props: Omit<RecordModalProps, 'size' | 'tabs' | 'fullHref'>) {
  return <RecordModal {...props} size="form" />;
}
