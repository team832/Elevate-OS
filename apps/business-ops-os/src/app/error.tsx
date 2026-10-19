'use client';

import { Button, ErrorState } from '@elevate/shared-ui';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="el-main">
      <ErrorState
        requestId={error.digest}
        action={
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
