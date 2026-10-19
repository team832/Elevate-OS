import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { formOptions } from '../../server/options';
import { listBlockedProjects, listProjects, listWorkInventory } from '../../server/planning';
import { ActionForm } from '../../ui/action-form';
import { decisionTone, fmtDate } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const access = await gate('ops:risks:read', '/ops/projects');
  return (
    <Frame access={access} active="projects">
      <PageHeader
        title="Projects and work inventory"
        description="Projects with milestones and milestone dependencies, plus the imported legacy work inventory (processes with their decision status — not delivered work)."
      />
      <Section label="Checking for blocked projects…">
        <Blocked user={access.user} />
      </Section>
      <Section>
        <Projects user={access.user} canWrite={can(access.user, 'ops:risks:write')} />
      </Section>
      <Section label="Loading work inventory…">
        <Inventory user={access.user} />
      </Section>
    </Frame>
  );
}

async function Blocked({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listBlockedProjects(db, user));
  if (!r.ok) return r.view;
  return (
    <Card
      title="Blocked projects"
      description="Planned, active or on-hold projects that are on hold, missed a milestone, have a milestone waiting on an overdue dependency, or have blocked tasks or open blockers linked."
    >
      <DataTable
        rows={r.data}
        rowKey={(p) => p.id}
        empty={<EmptyState title="No project is blocked" />}
        columns={[
          { key: 'code', header: 'Project', render: (p) => `${p.code} — ${p.name}` },
          { key: 'ownerName', header: 'Owner', render: (p) => p.ownerName ?? '—' },
          { key: 'reasons', header: 'Why', render: (p) => p.reasonLabels.join('; ') },
          { key: 'blockedTasks', header: 'Blocked tasks', numeric: true },
          { key: 'openBlockers', header: 'Open blockers', numeric: true },
        ]}
      />
    </Card>
  );
}

async function Projects({ user, canWrite }: { user: AuthenticatedUser; canWrite: boolean }) {
  const r = await load(async (db) => ({
    projects: await listProjects(db, user),
    options: await formOptions(db),
  }));
  if (!r.ok) return r.view;
  return (
    <div className="el-stack">
      {r.data.projects.length === 0 ? <EmptyState title="No projects yet" /> : null}
      {r.data.projects.map((p) => {
        const titles = new Map(p.milestones.map((m) => [m.id as string, m.title]));
        return (
          <Card
            key={p.id}
            title={`${p.code} — ${p.name}`}
            description={`${p.workstream ?? 'No workstream'} · owner ${p.ownerName ?? 'none'} · ${fmtDate(p.startDate)} → ${fmtDate(p.endDate)} · ${p.status}`}
          >
            <DataTable
              rows={p.milestones}
              rowKey={(m) => m.id}
              empty={<EmptyState title="No milestones" />}
              columns={[
                { key: 'title', header: 'Milestone' },
                { key: 'dueDate', header: 'Due', render: (m) => fmtDate(m.dueDate) },
                {
                  key: 'status',
                  header: 'Status',
                  render: (m) => (
                    <StatusBadge tone={m.status === 'done' ? 'success' : 'neutral'}>
                      {m.status}
                    </StatusBadge>
                  ),
                },
                {
                  key: 'dependsOn',
                  header: 'Depends on',
                  render: (m) => m.dependsOn.map((d) => titles.get(d) ?? d).join(', ') || '—',
                },
                {
                  key: 'act',
                  header: '',
                  render: (m) =>
                    canWrite && m.status === 'planned' ? (
                      <ActionForm
                        action={`/ops/api/v1/milestones/${m.id}`}
                        method="PATCH"
                        submitLabel="Mark done"
                        extra={{ status: 'done' }}
                        compact
                      />
                    ) : null,
                },
              ]}
            />
            {canWrite ? (
              <ActionForm
                action={`/ops/api/v1/projects/${p.id}/milestones`}
                submitLabel="Add milestone"
                variant="secondary"
                fields={[
                  { name: 'title', label: 'Title', required: true },
                  { name: 'dueDate', label: 'Due', type: 'date' },
                  {
                    name: 'dependsOnMilestoneIds',
                    label: 'Depends on (milestone ids, comma separated)',
                    type: 'list',
                  },
                ]}
              />
            ) : null}
          </Card>
        );
      })}
      {canWrite ? (
        <Card title="New project">
          <ActionForm
            action="/ops/api/v1/projects"
            submitLabel="Create"
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'workstream', label: 'Workstream' },
              {
                name: 'ownerStaffId',
                label: 'Owner',
                type: 'select',
                options: r.data.options.staff,
              },
              { name: 'startDate', label: 'Start', type: 'date' },
              { name: 'endDate', label: 'End', type: 'date' },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

async function Inventory({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listWorkInventory(db, user));
  if (!r.ok) return r.view;
  return (
    <Card title="Work inventory (legacy import)">
      <DataTable
        rows={r.data}
        rowKey={(w) => w.id}
        empty={<EmptyState title="Not imported yet" description="Run npm run db:seed." />}
        columns={[
          { key: 'code', header: 'ID' },
          { key: 'function', header: 'Function' },
          { key: 'process', header: 'Process' },
          { key: 'scope', header: 'Scope', render: (w) => w.scope ?? '' },
          { key: 'proposedRole', header: 'Proposed role', render: (w) => w.proposedRole ?? '' },
          {
            key: 'status',
            header: 'Status',
            render: (w) => <StatusBadge tone={decisionTone(w.status)}>{w.status}</StatusBadge>,
          },
          { key: 'legacyStatus', header: 'Legacy word', render: (w) => w.legacyStatus ?? '' },
        ]}
      />
    </Card>
  );
}
