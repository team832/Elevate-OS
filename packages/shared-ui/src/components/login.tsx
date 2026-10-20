import { Alert } from './states';
import { Button, Field, TextInput } from './forms';
import { BrandLogo, COMPANY_NAME } from './layout';

const ERROR_TEXT: Record<string, string> = {
  invalid: 'Email or password is incorrect.',
  missing: 'Enter your email and password.',
  locked: 'Too many failed attempts. Try again in 15 minutes.',
  unavailable: 'Sign-in is unavailable right now. Try again shortly.',
};

/** The app's basePath from its login action, e.g. `/ops/api/v1/auth/login` → `/ops`. */
const basePathOf = (action: string) => {
  const i = action.indexOf('/api/');
  return i > 0 ? action.slice(0, i) : '';
};

/**
 * Plain HTML sign-in form posting to the login route handler (works without
 * JavaScript). `action` and `next` include the basePath.
 */
export function LoginForm({
  action,
  next,
  error,
  subtitle,
}: {
  action: string;
  next: string;
  error?: string;
  subtitle?: string;
}) {
  const message = error ? (ERROR_TEXT[error] ?? ERROR_TEXT.invalid) : undefined;
  return (
    <div className="el-login">
      <section className="el-card el-login-card" aria-labelledby="el-login-title">
        <div className="el-login-brand">
          <BrandLogo basePath={basePathOf(action)} />
          <span>{COMPANY_NAME}</span>
        </div>
        <div className="el-card-body">
          <h1 id="el-login-title" className="el-login-title">
            {subtitle ?? 'Sign in to Elevate OS'}
          </h1>
          {message ? (
            <div className="el-login-alert">
              <Alert tone="danger">{message}</Alert>
            </div>
          ) : null}
          <form method="post" action={action}>
            <input type="hidden" name="next" value={next} />
            <Field id="email" label="Email">
              <TextInput id="email" name="email" type="email" autoComplete="username" required />
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
            <Button type="submit" block>
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
