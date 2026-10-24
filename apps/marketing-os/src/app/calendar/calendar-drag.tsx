'use client';

/**
 * Drag a card onto another day to move it (keeps its IST time of day). The same move is offered
 * without a mouse on the item page ("Move to another date"); the server checks the permission.
 */
import { useRef, type ReactNode } from 'react';

export function CalendarDrag({
  move,
  back,
  children,
}: {
  move: (form: FormData) => Promise<void>;
  /** Query string of the current view, so the page comes back where it was. */
  back: string;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const dragged = useRef<{ id: string; time: string; day?: string } | null>(null);
  const dayOf = (target: EventTarget) =>
    (target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
  return (
    <div
      onDragStart={(e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
        if (!card) return;
        dragged.current = { id: card.dataset.itemId!, time: card.dataset.time!, day: dayOf(card) };
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (dragged.current && dayOf(e.target)) e.preventDefault();
      }}
      onDrop={(e) => {
        const day = dayOf(e.target);
        const card = dragged.current;
        dragged.current = null;
        const f = form.current;
        if (!day || !card || !f) return;
        e.preventDefault();
        if (day === card.day) return; // dropped back on its own day: nothing to move
        (f.elements.namedItem('itemId') as HTMLInputElement).value = card.id;
        (f.elements.namedItem('plannedAt') as HTMLInputElement).value = `${day}T${card.time}`;
        f.requestSubmit();
      }}
    >
      {children}
      <form ref={form} action={move} hidden>
        <input type="hidden" name="itemId" />
        <input type="hidden" name="plannedAt" />
        <input type="hidden" name="back" value={back} />
      </form>
    </div>
  );
}
