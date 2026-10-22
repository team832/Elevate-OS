import { describe, expect, it } from 'vitest';
import { asId, type ModuleKey, type RoleKey, type UserId } from '@elevate/shared-types';
import {
  resolveLanding,
  scopeFor,
  workspacesFor,
  type Landing,
  type WorkspaceKey,
} from '../src/index';

const as = (...roles: RoleKey[]) => ({
  id: asId<UserId>('00000000-0000-4000-8000-000000000001'),
  roles,
});

describe('workspacesFor (D-072: membership = a stored role granting <workspace>:module:access)', () => {
  it.each<[RoleKey[], WorkspaceKey[]]>([
    [['operations_manager'], ['ops']],
    [['admissions_counsellor'], ['ops']],
    [['finance_officer'], ['ops']],
    [['marketing_manager'], ['marketing']],
    [['marketing_contributor'], ['marketing']],
    [['teacher'], ['academic']],
    [['academic_coordinator'], ['ops', 'academic']],
    [['platform_admin'], []],
    [['director'], ['ops', 'academic', 'marketing']],
    [
      ['marketing_manager', 'operations_manager'],
      ['ops', 'marketing'],
    ],
    [[], []],
  ])('%j → %j', (roles, expected) => {
    expect(workspacesFor(as(...roles))).toEqual(expected);
  });

  it('nobody signed in belongs to nothing', () => {
    expect(workspacesFor(null)).toEqual([]);
  });
});

describe('resolveLanding', () => {
  const cases: [string, Parameters<typeof resolveLanding>[0], Landing][] = [
    [
      'member stays, deep link kept',
      { workspaces: ['ops'], preferred: null, current: 'ops', next: '/ops/students?x=1' },
      { kind: 'here', path: '/ops/students?x=1' },
    ],
    [
      'member stays, foreign next ignored',
      { workspaces: ['ops'], preferred: null, current: 'ops', next: '/academic/batches' },
      { kind: 'here', path: '/ops' },
    ],
    [
      'look-alike base is not inside',
      { workspaces: ['ops'], preferred: null, current: 'ops', next: '/opsx' },
      { kind: 'here', path: '/ops' },
    ],
    [
      'multi-workspace member stays where they signed in',
      { workspaces: ['ops', 'academic'], preferred: 'ops', current: 'academic' },
      { kind: 'here', path: '/academic' },
    ],
    [
      'wrong workspace, single membership',
      { workspaces: ['academic'], preferred: null, current: 'ops', next: '/ops/tasks' },
      { kind: 'workspace', workspace: 'academic' },
    ],
    [
      'wrong workspace, remembered choice',
      { workspaces: ['academic', 'marketing'], preferred: 'marketing', current: 'ops' },
      { kind: 'workspace', workspace: 'marketing' },
    ],
    [
      'remembered choice no longer permitted',
      { workspaces: ['academic', 'marketing'], preferred: 'ops', current: 'ops' },
      { kind: 'choose' },
    ],
    [
      'garbage preference ignored',
      { workspaces: ['academic'], preferred: 'platform', current: 'marketing' },
      { kind: 'workspace', workspace: 'academic' },
    ],
    [
      'no workspace at all',
      { workspaces: [], preferred: null, current: 'ops' },
      { kind: 'choose' },
    ],
    [
      'platform keeps an explicit next',
      { workspaces: ['ops'], preferred: null, current: 'platform', next: '/admin/users' },
      { kind: 'here', path: '/admin/users' },
    ],
    [
      'platform root goes to the workspace',
      { workspaces: ['ops'], preferred: null, current: 'platform', next: '/' },
      { kind: 'workspace', workspace: 'ops' },
    ],
    [
      'platform with several and no choice',
      { workspaces: ['ops', 'academic'], preferred: null, current: 'platform' },
      { kind: 'choose' },
    ],
    [
      'platform admin with no workspace stays home',
      { workspaces: [], preferred: null, current: 'platform' },
      { kind: 'here', path: '/' },
    ],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(resolveLanding(input)).toEqual(expected);
  });

  it.each<ModuleKey>(['ops', 'academic', 'marketing'])(
    'a %s member is never sent away from it',
    (current) => {
      const ws = current as WorkspaceKey;
      expect(resolveLanding({ workspaces: [ws], preferred: 'ops', current }).kind).toBe('here');
    },
  );
});

describe('lead contacts (D-073, Proposed)', () => {
  it.each<[RoleKey, 'all' | 'own' | null]>([
    ['marketing_manager', 'all'],
    ['marketing_contributor', 'own'],
    ['operations_manager', 'all'],
    ['director', null],
    ['auditor', null],
    ['teacher', null],
  ])('%s → %s', (role, scope) => {
    expect(scopeFor(as(role), 'ops:lead_contacts:read')).toBe(scope);
  });
});
