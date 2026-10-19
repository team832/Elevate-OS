import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listLeaveTypes } from '../../../../server/hr/leave';
import { ActionForm } from '../../../../ui/action-form';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { DecisionBadge, TimeNav, timeNavItems } from '../../attendance/time-ui';

export const dynamic = 'force-dynamic';

export default async function LeaveTypesPage() {
  const access = await gate('ops:leave:read', '/ops/hr/leave/types');
  return (
    <Frame access={access} active="leave">
      <PageHeader
        title="Leave types"
        description="The company’s actual leave types are an owner decision (OD-026). Every type starts as proposed; mark it approved once the owner confirms it."
      />
      <TimeNav current="" items={timeNavItems(access.user)} />
      <Section label="Loading leave types…">
        <Types user={access.user} />
      </Section>
    </Frame>
  );
}

async function Types({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listLeaveTypes(db, user, true));
  if (!r.ok) return r.view;
  const manage = can(user, 'ops:leave:manage');
  return (
    <div className="el-grid">
      <Card title="Recorded types">
        {r.data.length === 0 ? (
          <Alert tone="info" title="No leave types recorded">
            Staff cannot request leave until HR records at least one type.
          </Alert>
        ) : null}
        <DataTable
          rows={r.data}
          rowKey={(t) => t.id}
          empty={<EmptyState title="No leave types" />}
          columns={[
            { key: 'code', header: 'Code' },
            { key: 'name', header: 'Name' },
            { key: 'paid', header: 'Paid', render: (t) => (t.paid ? 'Paid' : 'Unpaid') },
            {
              key: 'half',
              header: 'Half days',
              render: (t) => (t.halfDayAllowed ? 'Allowed' : 'Full days only'),
            },
            {
              key: 'doc',
              header: 'Document',
              render: (t) => (t.requiresDocument ? 'Reference required' : 'Not required'),
            },
            {
              key: 'status',
              header: 'Decision',
              render: (t) => <DecisionBadge state={t.status} />,
            },
            {
              key: 'act',
              header: '',
              render: (t) =>
                manage ? (
                  <div className="el-inline-form">
                    {t.status !== 'approved' ? (
                      <ActionForm
                        action={`/ops/api/v1/hr/leave-types/${t.id}`}
                        method="PATCH"
                        submitLabel="Mark approved"
                        extra={{ status: 'approved' }}
                        variant="secondary"
                        compact
                      />
                    ) : null}
                    {t.status !== 'retired' ? (
                      <ActionForm
                        action={`/ops/api/v1/hr/leave-types/${t.id}`}
                        method="PATCH"
                        submitLabel="Retire"
                        extra={{ status: 'retired' }}
                        variant="danger"
                        compact
                      />
                    ) : (
                      <ActionForm
                        action={`/ops/api/v1/hr/leave-types/${t.id}`}
                        method="PATCH"
                        submitLabel="Restore as proposed"
                        extra={{ status: 'proposed' }}
                        variant="secondary"
                        compact
                      />
                    )}
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
      {manage ? (
        <Card
          title="Record a leave type"
          description="Use the owner’s wording. Entitlements and accrual are not set here; they stay an open decision."
        >
          <ActionForm
            action="/ops/api/v1/hr/leave-types"
            submitLabel="Record leave type"
            fields={[
              { name: 'code', label: 'Code', required: true, hint: 'Capital letters, e.g. CASUAL' },
              { name: 'name', label: 'Name', required: true },
              { name: 'paid', label: 'Paid leave', type: 'checkbox' },
              {
                name: 'halfDayAllowed',
                label: 'Half days allowed',
                type: 'checkbox',
                defaultValue: 'true',
              },
              {
                name: 'requiresDocument',
                label: 'Supporting document reference required',
                type: 'checkbox',
              },
              { name: 'description', label: 'Description', type: 'textarea' },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
