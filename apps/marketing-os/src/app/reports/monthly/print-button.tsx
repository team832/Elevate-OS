'use client';

import { Button } from '@elevate/shared-ui';

/** Opens the browser's print dialog (the shell hides its navigation when printing). */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      Print these facts
    </Button>
  );
}
