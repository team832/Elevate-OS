/** Interventions table with an update form (shared by the student and progress pages). */
import { DataTable, EmptyState } from '@elevate/shared-ui';
import type { listInterventions } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { ApiForm } from './api-form';
import { StateBadge } from './badges';

type Rows = Awaited<ReturnType<typeof listInterventions>>;

export function InterventionsTable({ rows, canWrite }: { rows: Rows; canWrite: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(i) => i.id}
      empty={<EmptyState title="No interventions" />}
      columns={[
        { key: 'student', header: 'Student', render: (i) => <a href={MODULE_PATHS.student(i.studentId)}>{i.studentName}</a> },
        { key: 'trigger', header: 'Trigger', render: (i) => i.trigger.replace(/_/g, ' ') },
        { key: 'description', header: 'Concern' },
        { key: 'action', header: 'Action' },
        { key: 'owner', header: 'Responsible', render: (i) => i.responsibleName },
        { key: 'due', header: 'Due', render: (i) => i.dueDate ?? '—' },
        { key: 'parent', header: 'Parent contact', render: (i) => i.parentContactStatus.replace(/_/g, ' ') },
        { key: 'status', header: 'Status', render: (i) => <><StateBadge state={i.status} />{i.outcome ? ` ${i.outcome}` : ''}</> },
        {
          key: 'update',
          header: '',
          render: (i) =>
            canWrite && i.status !== 'closed' ? (
              <details>
                <summary>Update</summary>
                <ApiForm
                  action={MODULE_PATHS.api(`interventions/${i.id}`)}
                  method="PATCH"
                  submitLabel="Save"
                  successMessage="Intervention updated."
                  idPrefix={`iv-${i.id}`}
                  fields={[
                    { name: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'resolved', 'closed'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) },
                    { name: 'outcome', label: 'Outcome (required to resolve or close)', type: 'textarea' },
                    { name: 'parentContactStatus', label: 'Parent contact', type: 'select', options: ['not_contacted', 'contacted', 'unreachable', 'not_required'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) },
                  ]}
                />
              </details>
            ) : null,
        },
      ]}
    />
  );
}
