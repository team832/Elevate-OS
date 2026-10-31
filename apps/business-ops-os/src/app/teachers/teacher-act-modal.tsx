import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ActionForm, type ActionFormProps } from '../../ui/action-form';
import { FormModal } from '../../ui/record-modal';
import type { TeacherProfile } from './teacher-record';

export const TEACHER_ACTS = ['edit', 'feedback'] as const;
export type TeacherAct = (typeof TEACHER_ACTS)[number];

export function TeacherActModal({
  act,
  t,
  user,
  closeHref,
}: {
  act: TeacherAct;
  t: TeacherProfile;
  user: AuthenticatedUser;
  closeHref: string;
}) {
  const flows: Record<TeacherAct, { title: string; allowed: boolean; form: ActionFormProps }> = {
    edit: {
      title: 'Edit teacher details',
      allowed: can(user, 'ops:teachers:manage'),
      form: {
        action: `/ops/api/v1/teachers/${t.staff.id}`,
        method: 'PATCH',
        submitLabel: 'Save teacher details',
        fields: [
          {
            name: 'displayName',
            label: 'Display name',
            defaultValue: t.displayName,
            section: 'Teacher',
          },
          {
            name: 'staffCode',
            label: 'Staff code',
            defaultValue: t.profile?.staffCode ?? '',
            section: 'Teacher',
          },
          {
            name: 'roleNote',
            label: 'Other role',
            defaultValue: t.profile?.roleNote ?? '',
            section: 'Teacher',
          },
          {
            name: 'verificationStatus',
            label: 'Name verification',
            type: 'select',
            defaultValue: t.profile?.verificationStatus ?? 'unverified',
            options: [
              { value: 'unverified', label: 'Unverified' },
              { value: 'confirmed', label: 'Confirmed by the owner' },
            ],
            section: 'Teacher',
          },
          {
            name: 'subjects',
            label: 'Subjects (comma separated)',
            type: 'list',
            defaultValue: t.subjects.map((s) => s.subject).join(', '),
            section: 'Subjects',
          },
        ],
      },
    },
    feedback: {
      title: 'Record feedback',
      allowed: can(user, 'ops:teacher_feedback:manage'),
      form: {
        action: '/ops/api/v1/feedback/about-teachers',
        submitLabel: 'Record feedback',
        extra: { teacherStaffId: t.staff.id },
        fields: [
          {
            name: 'submittedByKind',
            label: 'Given by',
            type: 'select',
            required: true,
            options: [
              { value: 'student', label: 'Student' },
              { value: 'guardian', label: 'Guardian' },
            ],
            section: 'Who and when',
          },
          {
            name: 'feedbackOn',
            label: 'Date given',
            type: 'date',
            required: true,
            section: 'Who and when',
          },
          { name: 'subjectRef', label: 'Subject or batch', section: 'Feedback' },
          { name: 'rating', label: 'Rating (1–5, optional)', type: 'number', section: 'Feedback' },
          {
            name: 'comment',
            label: 'Feedback',
            type: 'textarea',
            required: true,
            section: 'Feedback',
          },
        ],
      },
    },
  };
  const flow = flows[act];
  if (!flow.allowed) return null;
  return (
    <FormModal
      id={`teacher-${act}`}
      title={`${flow.title}: ${t.displayName}`}
      closeHref={closeHref}
    >
      <ActionForm
        {...flow.form}
        // Router path: Next adds the /ops basePath itself (D-022).
        redirectTo={closeHref.replace(/^\/ops/, '')}
        secondary={<a href={closeHref}>Cancel</a>}
      />
    </FormModal>
  );
}
