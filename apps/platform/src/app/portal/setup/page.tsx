import type { Metadata } from 'next';
import { MIN_PASSWORD_LENGTH } from '@elevate/authentication';
import { Alert, Button, Field, TextInput } from '@elevate/shared-ui';
import { portalEntry } from '../../../server/portal';
import { PORTAL_ERRORS, PortalClosed, PortalPlain } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Set your portal password' };
export const dynamic = 'force-dynamic';

const SETUP_ERRORS: Record<string, string> = {
  ...PORTAL_ERRORS,
  invalid:
    'This login and setup code do not work together. The code may be mistyped, already used, replaced by a newer slip or older than 7 days. Ask Elevate Education for a new slip.',
  missing: 'Enter your login, the setup code and a new password.',
  short: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: 'The two passwords are not the same. Type the new password twice.',
};

type Params = Promise<Record<string, string | string[] | undefined>>;

/** First password (or a new one) with the one-time code from the slip (F4-13). */
export default async function PortalSetupPage({ searchParams }: { searchParams: Params }) {
  if (!(await portalEntry()).open) return <PortalClosed />;
  const sp = await searchParams;
  const error =
    typeof sp.error === 'string' ? (SETUP_ERRORS[sp.error] ?? SETUP_ERRORS.invalid) : undefined;
  return (
    <PortalPlain>
      <h1>Set your password</h1>
      <p>
        Type the login and the setup code from your slip, and choose a password. The code works
        once, for 7 days. Then <a href="/portal/login">sign in</a> with the same login.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form method="post" action="/api/v1/portal/setup" className="portal-form">
        <Field id="login" label="Login" hint="As printed on the slip, for example asha.1234.">
          <TextInput
            id="login"
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-describedby="login-hint"
          />
        </Field>
        <Field id="code" label="Setup code" hint="8 letters and numbers, for example ABCD 2345.">
          <TextInput
            id="code"
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            required
            aria-describedby="code-hint"
          />
        </Field>
        <Field
          id="password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            aria-describedby="password-hint"
          />
        </Field>
        <Field id="confirm" label="New password again">
          <TextInput
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>
        <Button type="submit">Set password</Button>
      </form>
    </PortalPlain>
  );
}
