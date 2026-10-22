import type { ModuleKey } from '@elevate/shared-types';
import { BrandLogo } from './brand';
import { Icon } from './icons';
import { Alert } from './states';
import { MODULE_NAV, WORKSPACE_PURPOSE } from './layout';

/**
 * The workspace chooser (D-072): only the workspaces the person's roles grant. One plain form
 * (no JavaScript): each workspace is a submit button; "remember" stores the default.
 */
export function WorkspaceChooser({
  user,
  workspaces,
  preferred,
  action,
  logoutAction,
  adminHref,
}: {
  user: { displayName: string; email: string };
  workspaces: readonly Exclude<ModuleKey, 'platform'>[];
  preferred?: string | null;
  /** `<base>/api/v1/auth/workspace` */
  action: string;
  logoutAction: string;
  /** Users & roles, for people who manage accounts. */
  adminHref?: string;
}) {
  const options = MODULE_NAV.filter((m) => workspaces.includes(m.key));
  return (
    <main className="el-login el-workspaces">
      <div className="el-login-brand">
        <BrandLogo size="lg" />
      </div>
      <section className="el-card el-login-card" aria-labelledby="el-workspaces-title">
        <div>
          <h1 id="el-workspaces-title" className="el-login-title">
            {options.length ? 'Choose a workspace' : 'No workspace yet'}
          </h1>
          <p className="el-login-hint">
            Signed in as <strong>{user.displayName}</strong> ({user.email})
          </p>
        </div>
        {options.length ? (
          <form method="post" action={action} className="el-workspace-form">
            <label className="el-checkbox">
              <input type="checkbox" name="remember" value="yes" />
              Open the one I pick by default next time
            </label>
            <ul className="el-workspace-list">
              {options.map((m) => (
                <li key={m.key}>
                  <button
                    type="submit"
                    name="workspace"
                    value={m.key}
                    className="el-workspace-option"
                  >
                    <Icon name={m.icon} />
                    <span>
                      <strong>{m.label}</strong>
                      {preferred === m.key ? (
                        <span className="el-workspace-default"> · your default</span>
                      ) : null}
                      <span className="el-workspace-purpose">{WORKSPACE_PURPOSE[m.key]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </form>
        ) : (
          <Alert tone="warning">
            Your account has no role that opens a workspace. Ask a platform administrator to give
            you the role for your job.
          </Alert>
        )}
        {adminHref ? <a href={adminHref}>Users &amp; roles</a> : null}
        <form method="post" action={logoutAction}>
          <button className="el-button el-button-secondary el-button-block" type="submit">
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
