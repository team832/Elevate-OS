'use client';

import { useEffect, useRef } from 'react';
import { ActionForm } from '../../../ui/action-form';

/**
 * My day quick add. `version` changes when the day's tasks change: the form remounts empty and,
 * when this box caused the change, the cursor goes back into it for the next task.
 */
export function QuickAdd({ action, version }: { action: string; version: string }) {
  const box = useRef<HTMLDivElement>(null);
  const added = useRef(false);
  useEffect(() => {
    if (added.current) box.current?.querySelector('input')?.focus();
    added.current = false;
  }, [version]);
  return (
    <div
      ref={box}
      className="ops-quick-add"
      onSubmit={() => {
        added.current = true;
      }}
    >
      <ActionForm
        key={version}
        compact
        action={action}
        submitLabel="Add task"
        extra={{ priority: 'medium', recurrence: 'none' }}
        fields={[{ name: 'title', label: 'Quick add: what came in?', required: true }]}
      />
    </div>
  );
}
