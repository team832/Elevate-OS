import type { Metadata } from 'next';
import { Suspense } from 'react';
import { can, ROLE_KEYS, ROLES } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { currentRequestId, requirePageAccess } from '@elevate/server-kit/next';
import {
  AppShell,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@elevate/shared-ui';
import { ORGANISATION_EMAIL_DOMAIN } from '@elevate/authentication';
import { PLATFORM_PATHS } from '../../../lib/shell';
import { platformShell } from '../../../server/shell';
import { listUsers, listUsersQuery, NO_ROLES, type ListUsersQuery } from '../../../server/users';
import { JsonForm } from '../../../ui/json-form';
import { AccountStatus, fmtDay, fmtWhen, roleLabels, RoleChecklist } from '../../../ui/users';
import './users.css';

export const metadata: Metadata = { title: 'Users & roles' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORT_LABELS = {
  name: 'Name',
  email: 'Email',
  created: 'Created',
  last_sign_in: 'Last sign-in',
};

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  // Permission check before any Suspense boundary: signed-out visitors get a real 307.
  const access = await requirePageAccess('platform:users:read', {
    loginPath: PLATFORM_PATHS.login,
    returnTo: PLATFORM_PATHS.users,
  });
  const { user } = access;
  const extras = await platformShell(user, 'users');
  const raw = Object.fromEntries(
    Object.entries(await searchParams).filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Record<string, string>;
  const parsed = listUsersQuery.safeParse(raw);
  return (
    <AppShell
      user={user}
      modules={access.modules}
      current="platform"
      logoutAction={PLATFORM_PATHS.logoutApi}
      {...extras}
    >
      {access.status === 'forbidden' ? (
        <ErrorState
          level={1}
          title="No access"
          description="Users & roles needs the platform:users:read permission. Ask a platform administrator."
        />
      ) : (
        <>
          <PageHeader
            title="Users & roles"
            description="Everyone with an account and their roles. First-time Google sign-ins appear with no roles."
            actions={
              can(user, 'platform:users:manage') ? (
                <Dialog
                  id="add-person"
                  title="Add a person"
                  description={`Creates the account now so you can give roles before their first sign-in. They sign in with Google using this @${ORGANISATION_EMAIL_DOMAIN} address. There is no password yet: setting one by email comes later.`}
                  triggerLabel="Add person"
                  triggerIcon="plus"
                >
                  <JsonForm
                    action="/api/v1/admin/users"
                    submitLabel="Add person"
                    arrays={['roles']}
                    redirectTo={`${PLATFORM_PATHS.users}/{id}`}
                    cancelLabel="Cancel"
                  >
                    <div className="el-field">
                      <label htmlFor="add-email">Work email *</label>
                      <input
                        id="add-email"
                        name="email"
                        type="email"
                        className="el-input"
                        required
                        maxLength={254}
                        autoComplete="off"
                        pattern={`[^@\\s]+@${ORGANISATION_EMAIL_DOMAIN.replace('.', '\\.')}`}
                        title={`An @${ORGANISATION_EMAIL_DOMAIN} address`}
                        aria-describedby="add-email-hint"
                      />
                      <p className="el-field-hint" id="add-email-hint">
                        name@{ORGANISATION_EMAIL_DOMAIN} only.
                      </p>
                    </div>
                    <div className="el-field">
                      <label htmlFor="add-name">Name *</label>
                      <input
                        id="add-name"
                        name="displayName"
                        className="el-input"
                        required
                        maxLength={200}
                        autoComplete="off"
                      />
                    </div>
                    {can(user, 'platform:roles:manage') ? <RoleChecklist held={[]} /> : null}
                  </JsonForm>
                </Dialog>
              ) : null
            }
          />
          {parsed.success ? null : (
            <p className="el-field-error" role="alert">
              Some filters in the address were not valid and were ignored.
            </p>
          )}
          <Suspense fallback={<LoadingState label="Loading accounts…" />}>
            <UserList query={parsed.success ? parsed.data : listUsersQuery.parse({})} raw={raw} />
          </Suspense>
        </>
      )}
    </AppShell>
  );
}

async function UserList({ query, raw }: { query: ListUsersQuery; raw: Record<string, string> }) {
  let list: Awaited<ReturnType<typeof listUsers>>;
  try {
    list = await listUsers(getDb(), query);
  } catch (error) {
    console.error('users list failed', error);
    return <ErrorState requestId={await currentRequestId().catch(() => undefined)} />;
  }
  const filtered = Boolean(query.q || query.role || query.status);
  const pageHref = (page: number) =>
    `${PLATFORM_PATHS.users}?${new URLSearchParams({ ...raw, page: String(page) })}`;
  const from = (list.page - 1) * list.pageSize + 1;
  const to = from + list.items.length - 1;
  return (
    <div className="el-stack">
      <form className="ur-filters" method="get" action={PLATFORM_PATHS.users} role="search">
        <div className="el-field">
          <label htmlFor="f-q">Name or email</label>
          <input
            id="f-q"
            name="q"
            type="search"
            className="el-input"
            defaultValue={query.q}
            maxLength={100}
          />
        </div>
        <div className="el-field">
          <label htmlFor="f-role">Role</label>
          <select id="f-role" name="role" className="el-select" defaultValue={query.role ?? ''}>
            <option value="">Any role</option>
            <option value={NO_ROLES}>No roles yet</option>
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {ROLES[k].label}
              </option>
            ))}
          </select>
        </div>
        <div className="el-field">
          <label htmlFor="f-status">Status</label>
          <select
            id="f-status"
            name="status"
            className="el-select"
            defaultValue={query.status ?? ''}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div className="el-field">
          <label htmlFor="f-sort">Sort by</label>
          <select id="f-sort" name="sort" className="el-select" defaultValue={query.sort}>
            {Object.entries(SORT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="el-field">
          <label htmlFor="f-dir">Order</label>
          <select id="f-dir" name="dir" className="el-select" defaultValue={query.dir}>
            <option value="asc">A to Z, oldest first</option>
            <option value="desc">Z to A, newest first</option>
          </select>
        </div>
        <button type="submit" className="el-button el-button-secondary">
          Apply filters
        </button>
        {filtered ? <a href={PLATFORM_PATHS.users}>Clear filters</a> : null}
      </form>
      <DataTable
        compact
        caption={`${list.total} account${list.total === 1 ? '' : 's'}${filtered ? ' match these filters' : ''}`}
        rows={list.items}
        rowKey={(u) => u.id}
        empty={
          list.total > 0 ? (
            <EmptyState
              title="This page is past the last account"
              action={<a href={pageHref(1)}>Go to the first page</a>}
            />
          ) : (
            <EmptyState
              title={filtered ? 'No account matches these filters' : 'No accounts yet'}
              description={filtered ? 'Change or clear the filters.' : undefined}
              action={filtered ? <a href={PLATFORM_PATHS.users}>Clear filters</a> : undefined}
            />
          )
        }
        columns={[
          {
            key: 'displayName',
            header: 'Name',
            render: (u) => (
              <div>
                <a href={`${PLATFORM_PATHS.users}/${u.id}`}>{u.displayName}</a>
                <div className="el-field-hint ur-cell-email">{u.email}</div>
              </div>
            ),
          },
          { key: 'status', header: 'Status', render: (u) => <AccountStatus status={u.status} /> },
          {
            key: 'roles',
            header: 'Roles',
            render: (u) =>
              u.roles.length ? (
                roleLabels(u.roles)
              ) : (
                <StatusBadge tone="warning">No roles yet</StatusBadge>
              ),
          },
          { key: 'lastLoginAt', header: 'Last sign-in', render: (u) => fmtWhen(u.lastLoginAt) },
          {
            key: 'createdAt',
            header: 'Created',
            render: (u) => `${fmtDay(u.createdAt)}${u.viaGoogle ? ', via Google' : ''}`,
          },
        ]}
      />
      {list.items.length > 0 ? (
        <nav className="ur-pager" aria-label="Pages">
          <span>
            Showing {from}–{to} of {list.total}
          </span>
          {list.page > 1 ? <a href={pageHref(list.page - 1)}>Previous page</a> : null}
          {to < list.total ? <a href={pageHref(list.page + 1)}>Next page</a> : null}
        </nav>
      ) : null}
    </div>
  );
}
