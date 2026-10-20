'use client';

import { Button, ButtonLink, ErrorState } from '@elevate/shared-ui';

/**
 * Generic on purpose (§6.4): in production Next replaces server error messages with a
 * digest, and only that digest is shown, as a reference to match the server log.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String(error.digest) : undefined;
  return (
    <main className="el-main">
      <ErrorState
        requestId={digest}
        action={
          <>
            <Button variant="secondary" onClick={() => retry()}>
              Try again
            </Button>{' '}
            <ButtonLink href="/">Go to the home page</ButtonLink>
          </>
        }
      />
    </main>
  );
}
