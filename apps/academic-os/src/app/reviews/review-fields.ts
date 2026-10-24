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

/** The six evidence fields, in form and page order (D-058; brief §16 names the first three). */
export const EVIDENCE_FIELDS = [
  ['strengths', 'Strengths'],
  ['areasForSupport', 'Specific improvement areas'],
  ['suggestedAction', 'Recommended action'],
  ['attendanceEvidence', 'Attendance and engagement evidence'],
  ['homeworkEvidence', 'Homework and practice evidence'],
  ['academicConcerns', 'Academic concerns'],
] as const;

// D-058: evidence only, and the readers named per visibility. The 1,500-character form limit is PROPOSED;
// the contract keeps 4,000 so older reviews still load. Brief §16: constructive wording, facts unchanged.
const EVIDENCE_HINT =
  'Evidence from classes, work and assessments only. Never family or contact details, fee remarks, personality labels or diagnoses. Say what you saw and what will help, e.g. "scored 12/40; loses marks setting up word problems" rather than "weak". Keep marks, dates and attendance exactly as recorded. Up to 1,500 characters.';
const VISIBILITY_HINT =
  'Staff only: read by teachers of the student’s batches and subject, coordinators and Business Operations feedback readers. May inform a reviewed parent summary: the same readers, plus the family report, which may use only strengths, improvement areas and recommended action.';

type Option = { value: string; label: string };
const options = (labels: Record<string, string>, skip: string[] = []) => Object.entries(labels).filter(([v]) => !skip.includes(v)).map(([value, label]) => ({ value, label }));

type Values = Partial<Record<(typeof EVIDENCE_FIELDS)[number][0] | 'periodFrom' | 'periodTo' | 'followUpOn' | 'observationOn' | 'batchId' | 'subjectId' | 'visibility', string | null>>;

/** `choices`: the batches and subjects the writer may name (omit for a demo review: its class sets both). */
export function reviewFields(v: Values = {}, choices?: { batches: Option[]; subjects: Option[] }): FormField[] {
  const d = (k: keyof Values) => v[k] ?? undefined;
  return [
    ...(choices
      ? [
          { name: 'batchId', label: 'Batch', type: 'select' as const, options: choices.batches, hint: 'A batch you teach the student in.', defaultValue: d('batchId') },
          { name: 'subjectId', label: 'Subject', type: 'select' as const, options: choices.subjects, hint: 'A subject you teach.', defaultValue: d('subjectId') },
        ]
      : []),
    { name: 'observationOn', label: 'Observation date', type: 'date', hint: 'The day you saw what this review describes.', defaultValue: d('observationOn') },
    { name: 'periodFrom', label: 'Review period from', type: 'date', hint: 'Needed for a periodic progress review.', defaultValue: d('periodFrom') },
    { name: 'periodTo', label: 'Review period to', type: 'date', defaultValue: d('periodTo') },
    ...EVIDENCE_FIELDS.map(([name, label]) => ({ name, label, type: 'textarea' as const, hint: EVIDENCE_HINT, maxLength: 1500, defaultValue: d(name) })),
    { name: 'followUpOn', label: 'Follow-up date', type: 'date', defaultValue: d('followUpOn') },
    { name: 'visibility', label: 'Who may see it', type: 'select', required: true, hint: VISIBILITY_HINT, options: options(VISIBILITY_LABELS), defaultValue: d('visibility') ?? 'internal' },
  ];
}

export const typeField = (demo: boolean): FormField => ({ name: 'reviewType', label: 'Review type', type: 'select', required: true, options: options(TYPE_LABELS, demo ? ['periodic_progress', 'assessment_follow_up', 'support_referral'] : ['demo_session']) });
