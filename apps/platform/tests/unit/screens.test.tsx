import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STAFF_ROLE_KEYS } from '@elevate/authentication';
import { ROLES } from '@elevate/authorization';
import {
  AccountStatus,
  fmtWhen,
  RoleBadges,
  roleLabels,
  RoleChecklist,
  signInText,
} from '../../src/ui/users';
import { JsonForm } from '../../src/ui/json-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('Users & roles screen pieces', () => {
  it.each([
    [true, true, 'Password or Google sign-in'],
    [true, false, 'Password'],
    [false, true, 'Google sign-in only (no password)'],
    [false, false, 'Cannot sign in yet: no password, and Google sign-in is not set up'],
  ])('sign-in method: password %s, Google configured %s → "%s"', (password, google, text) => {
    expect(signInText(password, google)).toBe(text);
  });

  it.each([
    ['active', 'el-tone-success', 'Active'],
    ['disabled', 'el-tone-danger', 'Disabled'],
  ] as const)('account %s shows a %s badge in words', (status, tone, word) => {
    expect(html(<AccountStatus status={status} />)).toBe(
      `<span class="el-badge ${tone}">${word}</span>`,
    );
  });

  it('shows one pill per role, or "No roles yet" as a warning in words', () => {
    expect(html(<RoleBadges roles={[]} />)).toBe(
      '<span class="el-badge el-tone-warning">No roles yet</span>',
    );
    const out = html(<RoleBadges roles={['director', 'teacher']} />);
    expect(out.match(/el-tone-neutral/g)).toHaveLength(2);
    expect(out).toContain(`>${ROLES.director.label}</span>`);
  });

  it('names roles by label, keeping an unknown key visible instead of dropping it', () => {
    expect(roleLabels(['director', 'retired_role'])).toBe(`${ROLES.director.label}, retired_role`);
    expect(roleLabels([])).toBe('');
  });

  it.each([
    [null, 'Never'],
    [new Date('2026-10-22T04:30:00Z'), '22 Oct 2026, 10:00 am'],
  ])('fmtWhen(%s) shows IST or "Never", never a blank', (d, expected) => {
    expect(fmtWhen(d).replace(/\s/g, ' ')).toBe(expected);
  });

  it('every role checkbox is labelled, described by its hint, and only held roles are ticked', () => {
    const out = html(<RoleChecklist held={['director']} />);
    expect(out).toContain('<legend>Roles</legend>');
    expect(out.match(/type="checkbox"/g)).toHaveLength(STAFF_ROLE_KEYS.length);
    // Student and parent logins are given only from the student record (F4-13).
    expect(out).not.toMatch(/value="(student|guardian)"/);
    for (const key of STAFF_ROLE_KEYS) {
      expect(out).toContain(`aria-describedby="role-${key}-about"`);
      expect(out).toContain(`id="role-${key}-about"`);
    }
    expect(out.match(/checked=""/g)).toHaveLength(1);
    expect(out).toContain('checked="" value="director"');
    expect(out).not.toContain('disabled');
    expect(html(<RoleChecklist held={[]} disabled />)).toContain(
      '<fieldset class="el-fieldset" disabled="">',
    );
  });
});

describe('JsonForm', () => {
  it('names the action on its button and offers Cancel only inside a dialog', () => {
    const plain = html(<JsonForm action="/api/v1/admin/users" submitLabel="Add user" />);
    expect(plain).toContain('>Add user</button>');
    expect(plain).not.toContain('Submit');
    expect(plain).not.toContain('el-button-secondary');
    expect(plain).not.toContain('role="alert"');
    const dialog = html(<JsonForm action="/x" submitLabel="Save roles" cancelLabel="Keep roles" />);
    expect(dialog).toMatch(/type="button"[^>]*>Keep roles<\/button>/);
  });
});
