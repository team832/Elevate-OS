import { BrandLogo, INSTITUTE, instituteTelHref } from './brand';
import { Alert } from './states';
import { Button, ButtonLink, Field, fieldDescribedBy, TextInput } from './forms';

const ERROR_TEXT: Record<string, string> = {
  invalid: 'Email or password is incorrect.',
  missing: 'Enter your email and password.',
  locked: 'Too many failed attempts. Try again in 15 minutes.',
  unavailable: 'Sign-in is unavailable right now. Try again shortly.',
  domain: 'Only @elevateeducation.in accounts can sign in.',
  google_domain: 'That Google account is not an Elevate Education account.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'Sign-in link expired — try again.',
  google_disabled: 'This account is switched off. Ask a platform administrator.',
  google_failed: 'Google sign-in did not work. Try again, or use your email and password.',
};

const FIELD_ERRORS: Record<string, { email: string; password: string }> = {
  missing: { email: 'Enter your email address.', password: 'Enter your password.' },
};

/**
 * Plain HTML form posting to the login route handler (works without JavaScript).
 * `action` and `next` include the basePath. `googleHref` (from `googleSignInHref`) adds
 * "Sign in with Google"; omitted when not configured. `subtitle` names the module.
 */
export function LoginForm({
  action,
  next,
  error,
  subtitle,
  googleHref,
}: {
  action: string;
  next: string;
  error?: string;
  subtitle?: string;
  googleHref?: string;
}) {
  const message = error ? (ERROR_TEXT[error] ?? ERROR_TEXT.invalid) : undefined;
  const fieldError = error ? FIELD_ERRORS[error] : undefined;
  return (
    <main className="el-login">
      <div className="el-login-brand">
        <BrandLogo size="lg" />
        <p className="el-login-about">
          <strong>Elevate OS</strong> is the staff workspace of Elevate Education: enquiries,
          admissions, classes, fee records and content.
        </p>
      </div>

      <dl className="el-login-facts">
        {(
          [
            ['Entrance exams', INSTITUTE.exams],
            ['Batches', INSTITUTE.batches],
          ] as const
        ).map(([label, items]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <ul className="el-chevron-list">
                {items.map((p) => (
                  <li key={p.name}>{p.name}</li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
        <div>
          <dt>Classes</dt>
          <dd>{INSTITUTE.modes}</dd>
        </div>
        <div>
          <dt>Institute</dt>
          <dd>
            <a href={instituteTelHref}>{INSTITUTE.phone}</a>
          </dd>
        </div>
      </dl>

      <section className="el-card el-login-card" aria-labelledby="el-login-title">
        <div>
          <h1 id="el-login-title" className="el-login-title">
            Staff sign in
          </h1>
          {subtitle ? <p className="el-login-module">{subtitle}</p> : null}
          <p className="el-login-hint">
            Use your <strong>@elevateeducation.in</strong> account.
          </p>
        </div>
        {message ? <Alert tone="danger">{message}</Alert> : null}
        {googleHref ? (
          <>
            <ButtonLink href={googleHref} block>
              Sign in with Google
            </ButtonLink>
            <p className="el-login-or">or with email and password</p>
          </>
        ) : null}
        <form method="post" action={action}>
          <input type="hidden" name="next" value={next} />
          <Field id="email" label="Email" error={fieldError?.email}>
            <TextInput
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              invalid={Boolean(fieldError)}
              aria-describedby={fieldDescribedBy('email', undefined, fieldError?.email)}
            />
          </Field>
          <Field id="password" label="Password" error={fieldError?.password}>
            <TextInput
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              invalid={Boolean(fieldError)}
              aria-describedby={fieldDescribedBy('password', undefined, fieldError?.password)}
            />
          </Field>
          <Button type="submit" block>
            Sign in
          </Button>
        </form>
        <p className="el-login-help">Trouble signing in? Ask the operations manager.</p>
      </section>
    </main>
  );
}
