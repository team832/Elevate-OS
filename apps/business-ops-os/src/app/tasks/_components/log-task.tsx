/**
 * The "Log a task" form (brief 2 §5): quick fields first, assignment and request details after;
 * staff choices are the caller's scope, lead and student links from the Admissions search.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { TASK_RECURRENCES } from '../../../domain/staff-tasks';
import { formOptions } from '../../../server/options';
import { globalSearch } from '../../../server/search';
import { TASK_DUE_FILTERS } from '../../../server/staff-tasks-schemas';
import { coversOwner, taskAccess } from '../../../server/task-store';
import type { FieldSpec } from '../../../ui/action-form';
import { PRIORITY_OPTIONS } from './task-common';

export const RECURRENCE_OPTIONS = TASK_RECURRENCES.map((r) => ({
  value: r,
  label: r === 'none' ? 'Does not repeat' : `Repeats ${r}`,
}));
const SOURCE_OPTIONS = [
  { value: 'self', label: 'I found it myself' },
  { value: 'manager', label: 'My manager' },
  { value: 'verbal', label: 'Verbal request (call, WhatsApp, in person)' },
  { value: 'academic', label: 'Academic OS (support case, missing log)' },
];
export const DUE_OPTIONS = TASK_DUE_FILTERS.map((d) => ({
  value: d,
  label: { overdue: 'Overdue', today: 'Due today', week: 'Due this week', soon: 'Due soon' }[d],
}));

type Db = Parameters<typeof globalSearch>[0];

/** Staff options the caller may assign to or filter by: yourself and your reports (all scope: everyone). */
export async function scopedStaff(
  db: Db,
  user: AuthenticatedUser,
  permission: 'ops:tasks:read' | 'ops:tasks:write',
) {
  const [access, { staff, departments }] = await Promise.all([
    taskAccess(db, user, permission),
    formOptions(db),
  ]);
  return { staff: staff.filter((s) => coversOwner(access, s.value)), everyone: staff, departments };
}

/** Lead and student picks from the existing Admissions search (`rel` query). */
export async function relatedFields(
  db: Db,
  user: AuthenticatedUser,
  rel: string | undefined,
): Promise<FieldSpec[]> {
  if (!rel) return [];
  const { groups } = await globalSearch(db, user, rel);
  const pick = (key: string) =>
    (groups.find((g) => g.key === key)?.hits ?? []).map((h) => ({
      value: h.id,
      label: `${h.name}${h.code ? ` (${h.code})` : ''}${h.isSample ? ' — sample' : ''}`,
    }));
  const leads = pick('leads');
  const students = pick('students');
  return [
    ...(leads.length
      ? [{ name: 'leadId', label: 'Related lead', type: 'select' as const, options: leads }]
      : []),
    ...(students.length
      ? [
          {
            name: 'admissionId',
            label: 'Related student',
            type: 'select' as const,
            options: students,
          },
        ]
      : []),
  ];
}

/** Lead and student links need a reader of either (teachers and Marketing log tasks without them). */
export const relatable = (user: AuthenticatedUser) =>
  can(user, 'ops:leads:read') || can(user, 'ops:students:read');

type Option = { value: string; label: string };
const ADVANCED = 'Assign, review and source (optional)';

/** The full "Log a task" form: quick fields first, assignment and request details after. */
export function logTaskFields(
  related: FieldSpec[],
  assignable: Option[],
  everyone: Option[],
  departments: Option[],
  all: boolean,
): FieldSpec[] {
  return [
    { name: 'title', label: 'Task', required: true, section: 'Task' },
    {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      options: PRIORITY_OPTIONS,
      defaultValue: 'medium',
      section: 'Task',
    },
    {
      name: 'dueTime',
      label: 'Due time today (IST)',
      hint: '24-hour, e.g. 17:30. Leave empty for end of day.',
      section: 'Task',
    },
    ...related.map((f) => ({ ...f, section: 'Task' })),
    ...(assignable.length > 1
      ? [
          {
            name: 'staffId',
            label: 'Owner',
            type: 'select' as const,
            options: assignable,
            hint: 'Empty: you.',
            section: ADVANCED,
          },
        ]
      : []),
    {
      name: 'reviewRequired',
      label: 'Needs review before it is closed',
      type: 'checkbox',
      section: ADVANCED,
    },
    {
      name: 'reviewerStaffId',
      label: 'Reviewer',
      type: 'select',
      options: everyone,
      hint: 'Review required with no reviewer: only an operations manager can close it.',
      section: ADVANCED,
    },
    { name: 'acceptanceCriteria', label: 'Done when', type: 'textarea', section: ADVANCED },
    {
      name: 'source',
      label: 'Where it came from',
      type: 'select',
      options: SOURCE_OPTIONS,
      section: ADVANCED,
    },
    {
      name: 'requesterStaffId',
      label: 'Requested by (staff)',
      type: 'select',
      options: everyone,
      section: ADVANCED,
    },
    {
      name: 'requesterNote',
      label: 'Requested by (someone else)',
      hint: 'Name and channel, e.g. "Parent of Sample Asha, by phone".',
      section: ADVANCED,
    },
    {
      name: 'backupStaffId',
      label: 'Backup',
      type: 'select',
      options: everyone,
      section: ADVANCED,
    },
    {
      name: 'departmentId',
      label: 'Department',
      type: 'select',
      options: departments,
      section: ADVANCED,
    },
    { name: 'dueOn', label: 'Due on another day', type: 'date', section: 'More (optional)' },
    { name: 'plannedStartOn', label: 'Planned start', type: 'date', section: 'More (optional)' },
    ...(all
      ? [
          {
            name: 'assignedByStaffId',
            label: 'Given by',
            type: 'select' as const,
            options: everyone,
            hint: 'Empty: you.',
            section: 'More (optional)',
          },
        ]
      : []),
    {
      name: 'linkedRef',
      label: 'Linked record in another module',
      hint: 'e.g. an Academic support case reference.',
      section: 'More (optional)',
    },
    {
      name: 'recurrence',
      label: 'Repeats',
      type: 'select',
      required: true,
      options: RECURRENCE_OPTIONS,
      defaultValue: 'none',
      section: 'More (optional)',
    },
    { name: 'details', label: 'Details', type: 'textarea', section: 'More (optional)' },
  ];
}
