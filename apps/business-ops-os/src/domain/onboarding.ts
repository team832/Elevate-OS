/**
 * Onboarding checklist rules (owner brief §8, acceptance 13). A checklist copies the items of
 * the template versions that apply to the student when it is built; later template versions
 * never rewrite it (new keys are added only on an explicit request). Status is append-only,
 * latest event wins. Material items complete only from issue/return/replacement rows.
 */
import { addDays, type IsoDate } from './dates';

export const ONBOARDING_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
  not_applicable: 'Not applicable',
};
export const ONBOARDING_ITEM_KINDS = ['check', 'biometric', 'material'] as const;
export type OnboardingItemKind = (typeof ONBOARDING_ITEM_KINDS)[number];
export const MATERIAL_MOVES = ['issue', 'return', 'replacement'] as const;
export type MaterialMove = (typeof MATERIAL_MOVES)[number];

export interface OnboardingTemplate {
  id: string;
  code: string;
  version: number;
  programmeCodes: readonly string[];
  classCategory: string | null;
  status: 'draft' | 'active' | 'retired';
  items: readonly OnboardingTemplateItem[];
}

/**
 * A template item (stored in the template's jsonb). Material items name the programme they
 * belong to (a multi-programme student gets one set per programme) and how many copies make the
 * set complete (default 1).
 */
export interface OnboardingTemplateItem {
  key: string;
  label: string;
  kind: OnboardingItemKind;
  dueDays?: number;
  // shortcut: catalogueCode is a free code (no material catalogue exists yet); link it when one does.
  catalogueCode?: string;
  programmeCode?: string;
  requiredQuantity?: number;
  edition?: string;
}

/** Latest active version of each template code that shares a programme and fits the class. */
export function applicableTemplates<T extends OnboardingTemplate>(
  templates: readonly T[],
  student: { programmeCodes: readonly string[]; classCategory: string | null },
): T[] {
  const latest = new Map<string, T>();
  for (const t of templates)
    if (t.status === 'active' && (latest.get(t.code)?.version ?? 0) < t.version)
      latest.set(t.code, t);
  return [...latest.values()]
    .filter(
      (t) =>
        t.programmeCodes.some((c) => student.programmeCodes.includes(c)) &&
        (t.classCategory === null || t.classCategory === student.classCategory),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Items the checklist lacks: union of the applicable templates by key (first by code wins);
 * a material item tied to a programme the student does not take is left out.
 */
export function checklistToAdd(
  templates: readonly OnboardingTemplate[],
  student: { programmeCodes: readonly string[]; classCategory: string | null },
  existingKeys: readonly string[],
  start: IsoDate,
) {
  const seen = new Set(existingKeys);
  return applicableTemplates(templates, student).flatMap((t) =>
    t.items.flatMap((i) => {
      if (seen.has(i.key) || (i.programmeCode && !student.programmeCodes.includes(i.programmeCode)))
        return [];
      seen.add(i.key);
      return [
        {
          templateId: t.id,
          templateVersion: t.version,
          itemKey: i.key,
          label: i.label,
          kind: i.kind,
          dueDate: i.dueDays === undefined ? null : addDays(start, i.dueDays),
        },
      ];
    }),
  );
}

/** Latest status event (by time; on a tie the later row). */
export function latestStatus(
  events: readonly { status: OnboardingStatus; at: Date }[],
): OnboardingStatus | null {
  let last: (typeof events)[number] | undefined;
  for (const e of events) if (!last || e.at >= last.at) last = e;
  return last?.status ?? null;
}

/** Copies held now: issues minus returns (a replacement swaps a copy already held). */
export const netIssued = (moves: readonly { kind: MaterialMove; quantity: number }[]) =>
  moves.reduce(
    (n, m) => n + (m.kind === 'issue' ? m.quantity : m.kind === 'return' ? -m.quantity : 0),
    0,
  );

export function materialMoveError(kind: MaterialMove, quantity: number, net: number) {
  if (kind === 'return' && quantity > net)
    return `Only ${net} issued, so ${quantity} cannot be returned.`;
  if (kind === 'replacement' && quantity > net)
    return `Only ${net} issued; a replacement swaps a copy the student already has.`;
  return null;
}

/**
 * Current status; a material item is completed only when the copies held reach the required
 * quantity (some but not all = in progress: one book is not all materials).
 */
export function itemStatus(
  kind: OnboardingItemKind,
  events: readonly { status: OnboardingStatus; at: Date }[],
  net: number,
  required = 1,
): OnboardingStatus {
  const latest = latestStatus(events);
  if (kind !== 'material') return latest ?? 'not_started';
  if (latest === 'not_applicable' || latest === 'blocked') return latest;
  if (net >= required) return 'completed';
  if (net > 0) return 'in_progress';
  return latest && latest !== 'completed' ? latest : 'not_started';
}

export function statusChangeError(
  kind: OnboardingItemKind,
  status: OnboardingStatus,
  net: number,
  required = 1,
  evidenceRef?: string | null,
) {
  if (status !== 'completed') return null;
  if (kind === 'material' && net < required)
    return `Record the materials handed over: ${net} of ${required} issued. The item completes when the whole set is issued.`;
  if (kind === 'biometric' && !evidenceRef)
    return 'Enter the biometric system’s enrolment reference to mark registration complete.';
  return null;
}

/** Books and materials across all material items (sets marked not applicable are not required). */
export function materialsSummary(items: readonly { kind: string; status: OnboardingStatus }[]) {
  const sets = items.filter((i) => i.kind === 'material' && i.status !== 'not_applicable');
  const issued = sets.filter((i) => i.status === 'completed').length;
  return { required: sets.length, issued, complete: sets.length ? issued === sets.length : null };
}

/** Overdue = a due date before today and not completed or not applicable. */
export const isOnboardingOverdue = (
  item: { dueDate: string | null; status: OnboardingStatus },
  today: IsoDate,
) =>
  item.dueDate !== null &&
  item.dueDate < today &&
  item.status !== 'completed' &&
  item.status !== 'not_applicable';
