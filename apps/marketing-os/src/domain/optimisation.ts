/**
 * SEO / AIO / GEO work items (brief 23 Oct 2026 §14): the example checks, the review states and
 * the honesty sentences every screen repeats. Pure.
 */
export const OPTIMISATION_CHECKS = [
  { key: 'title_description', label: 'Page title and description' },
  { key: 'crawl_index', label: 'Crawlability and indexing checks' },
  { key: 'internal_links', label: 'Internal linking' },
  { key: 'mobile_performance', label: 'Mobile usability and performance checks' },
  { key: 'structured_data', label: 'Structured data validation where relevant' },
  { key: 'author_organisation', label: 'Clear author and organisation information' },
  { key: 'course_information', label: 'Accurate course information' },
  { key: 'faqs', label: 'Useful FAQs' },
  { key: 'sources_facts', label: 'Sources and factual consistency' },
  { key: 'student_answers', label: 'Clear answers to relevant student questions' },
] as const;

export type OptimisationCheckKey = (typeof OPTIMISATION_CHECKS)[number]['key'];
export const OPTIMISATION_CHECK_KEYS = OPTIMISATION_CHECKS.map((c) => c.key) as [
  OptimisationCheckKey,
  ...OptimisationCheckKey[],
];
export type ChecklistItem = { key: string; label: string; done: boolean };

/** The chosen checks in the constant's order; `done` keys are ticked. */
export const buildChecklist = (keys: readonly string[], done: readonly string[] = []) =>
  OPTIMISATION_CHECKS.filter((c) => keys.includes(c.key)).map((c) => ({
    key: c.key,
    label: c.label,
    done: done.includes(c.key),
  }));

export type ReviewState = 'draft' | 'submitted' | 'approved' | 'changes_requested';

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

/** The owner edits only a draft or an item sent back; a submitted item waits for review. */
export const isEditable = (state: ReviewState) =>
  state === 'draft' || state === 'changes_requested';

export const NO_GUARANTEE =
  'A finished checklist records work done. It does not guarantee search rankings, AI citations, leads or admissions.';
export const ONE_OBSERVATION =
  'One observation shows what one search or AI assistant returned on one day. It is not stable visibility.';
