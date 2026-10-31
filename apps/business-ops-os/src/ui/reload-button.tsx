'use client';

import { Button } from '@elevate/shared-ui';

/** Reloads this page with its query. A button, not a link: a shared panel does not know the page's URL. */
export function ReloadButton() {
  return (
    <Button variant="secondary" onClick={() => location.reload()}>
      Try again
    </Button>
  );
}
