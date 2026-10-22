/** Pieces shared by the Users & roles pages (server components). */
import { ROLE_KEYS, ROLES, type RoleKey } from '@elevate/authorization';
import { StatusBadge } from '@elevate/shared-ui';

const when = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
const day = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/** IST date and time; `null` means it never happened (e.g. never signed in). */
export const fmtWhen = (d: Date | null, never = 'Never') => (d ? when.format(d) : never);
export const fmtDay = (d: Date) => day.format(d);

export const roleLabels = (roles: readonly string[]) =>
  roles.map((r) => ROLES[r as RoleKey]?.label ?? r).join(', ');

/** One pill per role; none held = a warning in words. */
export function RoleBadges({ roles }: { roles: readonly string[] }) {
  if (!roles.length) return <StatusBadge tone="warning">No roles yet</StatusBadge>;
  return (
    <span className="ur-badges">
      {roles.map((r) => (
        <StatusBadge key={r} tone="neutral">
          {roleLabels([r])}
        </StatusBadge>
      ))}
    </span>
  );
}

export function AccountStatus({ status }: { status: 'active' | 'disabled' }) {
  return status === 'active' ? (
    <StatusBadge tone="success">Active</StatusBadge>
  ) : (
    <StatusBadge tone="danger">Disabled</StatusBadge>
  );
}

/** Every role with its label and description; checked = held. `disabled` renders it read-only. */
export function RoleChecklist({
  held,
  disabled,
}: {
  held: readonly RoleKey[];
  disabled?: boolean;
}) {
  return (
    <fieldset className="el-fieldset" disabled={disabled}>
      <legend>Roles</legend>
      <ul className="ur-roles">
        {ROLE_KEYS.map((key) => (
          <li key={key}>
            <label className="el-checkbox">
              <input
                type="checkbox"
                name="roles"
                value={key}
                defaultChecked={held.includes(key)}
                aria-describedby={`role-${key}-about`}
              />
              {ROLES[key].label}
            </label>
            <p className="el-field-hint" id={`role-${key}-about`}>
              {ROLES[key].description}
            </p>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
