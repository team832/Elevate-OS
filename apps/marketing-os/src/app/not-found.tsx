import { ButtonLink, EmptyState } from '@elevate/shared-ui';
import { MODULE_PATHS } from '../server';

export default function NotFound() {
  return (
    <main className="el-main">
      <EmptyState
        title="Page not found"
        description="This address does not exist in Marketing OS."
        action={<ButtonLink href={MODULE_PATHS.home}>Back to Marketing OS</ButtonLink>}
      />
    </main>
  );
}
