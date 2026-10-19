import { ButtonLink, EmptyState } from '@elevate/shared-ui';

export default function NotFound() {
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
