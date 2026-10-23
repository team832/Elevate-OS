/**
 * HR "Assign a task" form (owner brief 23 Oct 2026 §8): progressive sections Brief → People →
 * Deadline → Deliverable & checklist → Links & attachments → Visibility. Several people ticked =
 * one task each under a parent. Reference files are added on the task page it opens next (an
 * upload needs the task to exist). Related batch/subject come from Academic's teaching
 * assignments (the server checks the choice); campaigns and events have no list yet.
 */
import type { FieldSpec } from '../../../ui/action-form';
import { RECURRENCE_OPTIONS } from '../../tasks/_components/log-task';
import { PRIORITY_OPTIONS } from '../../tasks/_components/task-common';

type Option = { value: string; label: string };
const VISIBILITY = [
  { value: 'assignee_chain', label: 'The assignee, their managers, the reviewer and HR' },
  { value: 'department', label: 'Also everyone in the task’s department' },
  { value: 'collaborators', label: 'Also the collaborators ticked below' },
];

const people = (prefix: string, staff: Option[], section: string): FieldSpec[] =>
  staff.map((s) => ({ name: `${prefix}.${s.value}`, label: s.label, type: 'checkbox', section }));

export function newTaskFields(
  assignable: Option[],
  everyone: Option[],
  departments: Option[],
  self: string | null,
  related: Option[],
): FieldSpec[] {
  const B = 'Brief';
  const P = 'People';
  const D = 'Deadline';
  const W = 'Deliverable and checklist';
  const L = 'Links and attachments';
  const V = 'Visibility';
  return [
    { name: 'title', label: 'Title', required: true, section: B },
    {
      name: 'category',
      label: 'Category',
      hint: 'e.g. Worksheet, Creative, Event preparation.',
      section: B,
    },
    {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      options: PRIORITY_OPTIONS,
      defaultValue: 'medium',
      section: B,
    },
    { name: 'details', label: 'Description', type: 'textarea', section: B },
    ...people('assignees', assignable, `${P}: assign to (one or more; each gets their own task)`),
    {
      name: 'assignedByStaffId',
      label: 'Assigning manager',
      type: 'select',
      options: everyone,
      defaultValue: self ?? undefined,
      section: P,
    },
    {
      name: 'reviewerStaffId',
      label: 'Reviewer',
      type: 'select',
      options: everyone,
      defaultValue: self ?? undefined,
      section: P,
    },
    {
      name: 'reviewRequired',
      label: 'Needs review before it is approved',
      type: 'checkbox',
      defaultValue: 'true',
      section: P,
    },
    {
      name: 'departmentId',
      label: 'Department',
      type: 'select',
      options: departments,
      section: P,
    },
    { name: 'plannedStartOn', label: 'Start date', type: 'date', section: D },
    { name: 'dueOn', label: 'Due date', type: 'date', required: true, section: D },
    { name: 'dueTime', label: 'Due time (IST)', hint: '24-hour, e.g. 17:00.', section: D },
    {
      name: 'recurrence',
      label: 'Repeats',
      type: 'select',
      required: true,
      options: RECURRENCE_OPTIONS,
      defaultValue: 'none',
      section: D,
    },
    {
      name: 'expectedDeliverable',
      label: 'Expected deliverable',
      hint: 'e.g. "Practice sheet (PDF) with an answer key". Submitting then needs a file or a link.',
      section: W,
    },
    { name: 'acceptanceCriteria', label: 'Acceptance criteria', type: 'textarea', section: W },
    {
      name: 'checklist',
      label: 'Checklist',
      type: 'textarea',
      hint: 'One item per line.',
      section: W,
    },
    {
      name: 'relatedRef',
      label: 'Related batch or subject',
      type: 'select',
      options: related,
      hint: related.length
        ? 'From Academic OS teaching assignments; it must be one the assignee teaches.'
        : 'No teaching assignments could be loaded (Academic OS unavailable or none recorded).',
      section: L,
    },
    {
      name: 'visibility',
      label: 'Who can see it',
      type: 'select',
      required: true,
      options: VISIBILITY,
      defaultValue: 'assignee_chain',
      section: V,
    },
    ...people('collaborators', everyone, `${V}: collaborators (optional)`),
    {
      name: 'publish',
      label: 'Assign now and notify (untick to save a draft the assignee cannot see yet)',
      type: 'checkbox',
      defaultValue: 'true',
      section: 'Assign',
    },
  ];
}
