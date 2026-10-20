import { connection } from 'next/server';
import { ButtonLink, EmptyState } from '@elevate/shared-ui';

export default async function NotFound() {
  // Rendered per request so it carries the CSP nonce (a prerendered page has none).
  await connection();
  return (
    <main className="el-main">
      <EmptyState
        title="Page not found"
        description="This address does not exist in Elevate OS."
        action={<ButtonLink href="/">Go home</ButtonLink>}
      />
    </main>
  );
}
