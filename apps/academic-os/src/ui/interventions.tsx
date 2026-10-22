/** Support plans (interventions): evidence → goal → action → responsible → due → review → outcome. Shared by the student and progress pages. */
import { DataTable, EmptyState } from '@elevate/shared-ui';
import type { listInterventions } from '../server';
import { MODULE_PATHS } from '../server/paths';
import { ApiForm, type FormField } from './api-form';
import { StateBadge } from './badges';

type Rows = Awaited<ReturnType<typeof listInterventions>>;

const options = (values: string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

/** Plan fields shared by the create form (progress page) and the update form. */
export const PLAN_FIELDS: readonly FormField[] = [
  { name: 'evidence', label: 'Evidence (what was observed, with dates)', type: 'textarea' },
  { name: 'goal', label: 'Goal', type: 'textarea' },
  { name: 'dueDate', label: 'Action due', type: 'date' },
  { name: 'reviewOn', label: 'Review on', type: 'date' },
];

export function InterventionsTable({ rows, canWrite }: { rows: Rows; canWrite: boolean }) {
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(i) => i.id}
      empty={<EmptyState title="No support plans" description="Open one from a student's progress page when the evidence calls for it." />}
      columns={[
        { key: 'student', header: 'Student', render: (i) => <a href={MODULE_PATHS.studentProgress(i.studentId)}>{i.studentName}</a> },
        { key: 'concern', header: 'Concern and evidence', render: (i) => `${i.trigger.replace(/_/g, ' ')}: ${i.description}${i.evidence ? ` — ${i.evidence}` : ''}` },
        { key: 'goal', header: 'Goal', render: (i) => i.goal ?? 'Not recorded' },
        { key: 'action', header: 'Next action', render: (i) => i.action },
        { key: 'owner', header: 'Responsible', render: (i) => i.responsibleName },
        { key: 'due', header: 'Due', render: (i) => i.dueDate ?? 'No date' },
        { key: 'review', header: 'Review', render: (i) => i.reviewOn ?? 'No date' },
        { key: 'status', header: 'Status and outcome', render: (i) => <><StateBadge state={i.status} />{i.outcome ? ` ${i.outcome}` : ''}</> },
        {
          key: 'update',
          header: '',
          render: (i) =>
            canWrite && i.status !== 'closed' ? (
              <details>
                <summary>Update plan</summary>
                <ApiForm
                  action={MODULE_PATHS.api(`interventions/${i.id}`)}
                  method="PATCH"
                  submitLabel={`Save plan for ${i.studentName}`}
                  successMessage="Support plan updated."
                  idPrefix={`iv-${i.id}`}
                  fields={[
                    { name: 'status', label: 'Status', type: 'select', options: options(['open', 'in_progress', 'resolved', 'closed']) },
                    { name: 'action', label: 'Next action', type: 'textarea' },
                    ...PLAN_FIELDS,
                    { name: 'outcome', label: 'Outcome (required to resolve or close)', type: 'textarea' },
                    { name: 'parentContactStatus', label: 'Parent contact', type: 'select', options: options(['not_contacted', 'contacted', 'unreachable', 'not_required']) },
                  ]}
                />
              </details>
            ) : null,
        },
      ]}
    />
  );
}
