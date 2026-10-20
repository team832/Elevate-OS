'use client';

import '@elevate/shared-ui/styles.css';
import ErrorPage from './error';

/** Replaces the root layout when it fails, so it brings its own document and styles. */
export default function GlobalError(props: { error: unknown; retry: () => void }) {
  return (
    <html lang="en-IN">
      <body>
        <title>Something went wrong</title>
        <ErrorPage {...props} />
      </body>
    </html>
  );
}
