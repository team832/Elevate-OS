/** Review form fields and screen labels, shared by /reviews/new and /reviews/[id]. Evidence fields only: no ratings or labels. */
import type { FormField } from '../../ui/api-form';

export const TYPE_LABELS: Record<string, string> = {
  demo_session: 'Demo class feedback',
  periodic_progress: 'Periodic progress',
  assessment_follow_up: 'Assessment follow-up',
  support_referral: 'Counselling or support referral',
};

export const VISIBILITY_LABELS: Record<string, string> = {
  internal: 'Staff only',
  shareable: 'May inform a reviewed parent summary',
};

const options = (labels: Record<string, string>, skip: string[] = []) => Object.entries(labels).filter(([v]) => !skip.includes(v)).map(([value, label]) => ({ value, label }));

type Values = Partial<Record<'periodFrom' | 'periodTo' | 'strengths' | 'areasForSupport' | 'attendanceEvidence' | 'homeworkEvidence' | 'academicConcerns' | 'suggestedAction' | 'followUpOn' | 'visibility', string | null>>;

export function reviewFields(v: Values = {}): FormField[] {
  const d = (k: keyof Values) => v[k] ?? undefined;
  return [
    { name: 'periodFrom', label: 'Review period from', type: 'date', hint: 'Needed for a periodic progress review.', defaultValue: d('periodFrom') },
    { name: 'periodTo', label: 'Review period to', type: 'date', defaultValue: d('periodTo') },
    { name: 'strengths', label: 'Strengths seen in class', type: 'textarea', defaultValue: d('strengths') },
    { name: 'areasForSupport', label: 'Areas needing support', type: 'textarea', defaultValue: d('areasForSupport') },
    { name: 'attendanceEvidence', label: 'Attendance and engagement evidence', type: 'textarea', defaultValue: d('attendanceEvidence') },
    { name: 'homeworkEvidence', label: 'Homework and practice evidence', type: 'textarea', defaultValue: d('homeworkEvidence') },
    { name: 'academicConcerns', label: 'Academic concerns', type: 'textarea', hint: 'Describe what you observed. No personality labels or diagnoses.', defaultValue: d('academicConcerns') },
    { name: 'suggestedAction', label: 'Suggested action', type: 'textarea', defaultValue: d('suggestedAction') },
    { name: 'followUpOn', label: 'Follow up on', type: 'date', defaultValue: d('followUpOn') },
    { name: 'visibility', label: 'Who may see it', type: 'select', required: true, options: options(VISIBILITY_LABELS), defaultValue: d('visibility') ?? 'internal' },
  ];
}

export const typeField = (demo: boolean): FormField => ({ name: 'reviewType', label: 'Review type', type: 'select', required: true, options: options(TYPE_LABELS, demo ? ['periodic_progress', 'assessment_follow_up', 'support_referral'] : ['demo_session']) });
