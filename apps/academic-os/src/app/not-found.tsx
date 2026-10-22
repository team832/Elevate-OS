import { connection } from 'next/server';
import { ButtonLink, EmptyState } from '@elevate/shared-ui';
import { MODULE_PATHS } from '../server';

export default async function NotFound() {
  // Rendered per request so it carries the CSP nonce (a prerendered page has none).
  await connection();
  return (
    <main className="el-main">
      <EmptyState
        level={1}
        title="Page not found"
        description="This address does not exist in Academic OS."
        action={<ButtonLink href={MODULE_PATHS.home}>Back to Academic OS</ButtonLink>}
      />
    </main>
  );
}
