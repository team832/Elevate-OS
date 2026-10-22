'use client';

import { Button } from '@elevate/shared-ui';

/** Opens the browser's print dialog (A4 print styles live in workspace.css). */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
