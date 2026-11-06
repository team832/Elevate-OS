import type { Metadata } from 'next';
import { Alert, Button, Field, TextInput } from '@elevate/shared-ui';
import { portalEntry } from '../../../server/portal';
import { PORTAL_ERRORS, PortalClosed, PortalPlain } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Portal sign in' };
export const dynamic = 'force-dynamic';

type Params = Promise<Record<string, string | string[] | undefined>>;

/** Portal sign-in (F4-13): the login and password from the setup slip. Works without JavaScript. */
export default async function PortalLoginPage({ searchParams }: { searchParams: Params }) {
  if (!(await portalEntry()).open) return <PortalClosed />;
  const sp = await searchParams;
  const error =
    typeof sp.error === 'string'
      ? (PORTAL_ERRORS[sp.error] ?? 'The login or password is not right.')
      : undefined;
  return (
    <PortalPlain>
      <h1>Student and parent sign in</h1>
      <p>
        Use the login printed on your slip from Elevate Education. First time here?{' '}
        <a href="/portal/setup">Set your password with the setup code</a>.
      </p>
      {sp.done ? (
        <Alert tone="success">
          Your password is set. Sign in with your login and the new password.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form method="post" action="/api/v1/portal/login" className="portal-form">
        <input
          type="hidden"
          name="next"
          value={typeof sp.next === 'string' ? sp.next : '/portal'}
        />
        <Field id="login" label="Login">
          <TextInput
            id="login"
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </Field>
        <Field id="password" label="Password">
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit">Sign in</Button>
      </form>
      <p>Forgot your password? Ask Elevate Education for a new setup slip.</p>
    </PortalPlain>
  );
}
