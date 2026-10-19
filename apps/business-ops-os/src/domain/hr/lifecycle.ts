/**
 * Onboarding and offboarding rules (OPS-045…OPS-048, D-028). Pure.
 * Algorithm documentation: docs/parts/hr-lifecycle.md → HL-A5…HL-A8.
 *
 * - Checklist generation from the (proposed) onboarding template and from the
 *   employee's open asset assignments and owned work (offboarding).
 * - Item status rules: some item kinds are completed only by the system
 *   (asset returns from the asset register, access revocation from the
 *   platform consumer).
 * - Completion gating before final approval, and the separation due rule.
 */
import { addDays, type IsoDate } from '../dates';
import type { SettingValue } from '../policies';

export const LIFECYCLE_KINDS = ['onboarding', 'offboarding'] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];
export const LIFECYCLE_STATUSES = ['open', 'approved', 'completed', 'cancelled'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const LIFECYCLE_STATUS_LABELS: Record<LifecycleKind, Record<LifecycleStatus, string>> = {
  onboarding: {
    open: 'In progress',
    approved: 'Approved',
    completed: 'Completed (approved)',
    cancelled: 'Cancelled',
  },
  offboarding: {
    open: 'In progress',
    approved: 'Separation approved (on notice)',
    completed: 'Separated',
    cancelled: 'Cancelled',
  },
};

export const SEPARATION_TYPES = [
  'resignation',
  'termination',
  'contract_end',
  'retirement',
  'other',
] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];

export const ITEM_KINDS = [
  'document',
  'policy_ack',
  'org_confirmation',
  'asset_assignment',
  'access_request',
  'induction',
  'asset_return',
  'access_revocation',
  'ownership_transfer',
  'final_settlement',
  'exit_interview',
  'custom',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  document: 'Documents',
  policy_ack: 'Policy acknowledgement',
  org_confirmation: 'Organisation',
  asset_assignment: 'Assets',
  access_request: 'System access request',
  induction: 'Induction',
  asset_return: 'Asset return',
  access_revocation: 'Access revocation',
  ownership_transfer: 'Ownership transfer',
  final_settlement: 'Final settlement (reference)',
  exit_interview: 'Exit interview',
  custom: 'Other',
};

export const ITEM_STATUSES = ['pending', 'done', 'not_applicable', 'blocked'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const TRANSFER_ENTITY_TYPES = ['task', 'lead', 'admission', 'responsibility'] as const;
export type TransferEntityType = (typeof TRANSFER_ENTITY_TYPES)[number];

export type Assignee = 'hr' | 'manager' | 'employee';

export interface GeneratedItem {
  itemKey: string;
  kind: ItemKind;
  title: string;
  required: boolean;
  assignee: Assignee | 'none';
  dueDate: IsoDate | null;
  assetAssignmentId?: string;
  transferEntityType?: TransferEntityType;
  transferEntityId?: string;
}

// --- onboarding ---------------------------------------------------------------------------------

/**
 * HL-A5: one item per template entry, due `dueOffsetDays` after the base date
 * (the employment start date when known, else the case date). Keys are
 * `template:<key>` so regeneration never duplicates.
 */
export function generateOnboardingItems(
  template: SettingValue<'hr.onboarding_template'>,
  baseDate: IsoDate,
): GeneratedItem[] {
  return template.items.map((t) => ({
    itemKey: `template:${t.key}`,
    kind: t.kind,
    title: t.title,
    required: t.required,
    assignee: t.assignee,
    dueDate: addDays(baseDate, t.dueOffsetDays),
  }));
}

// --- offboarding --------------------------------------------------------------------------------

export interface OwnedWork {
  type: TransferEntityType;
  id: string;
  label: string;
}

/**
 * HL-A6: offboarding checklist =
 * one `asset_return` per open asset assignment (due on the last working day),
 * one `ownership_transfer` per open task / open lead / open admission /
 * active responsibility held by the employee (due N days before the LWD),
 * one `access_revocation` (system-completed after separation),
 * `final_settlement` (reference only) and optionally an exit interview.
 */
export function generateOffboardingItems(input: {
  lastWorkingDay: IsoDate;
  openAssignments: readonly { id: string; assetCode: string; assetName: string }[];
  ownedWork: readonly OwnedWork[];
  config: SettingValue<'hr.offboarding_checklist'>;
}): GeneratedItem[] {
  const { lastWorkingDay, config } = input;
  const transferDue = addDays(lastWorkingDay, -config.transferDueDaysBeforeLwd);
  const items: GeneratedItem[] = [];
  for (const a of input.openAssignments)
    items.push({
      itemKey: `asset:${a.id}`,
      kind: 'asset_return',
      title: `Return ${a.assetCode} — ${a.assetName}`,
      required: true,
      assignee: 'hr',
      dueDate: lastWorkingDay,
      assetAssignmentId: a.id,
    });
  for (const w of input.ownedWork)
    items.push({
      itemKey: `transfer:${w.type}:${w.id}`,
      kind: 'ownership_transfer',
      title: `Hand over ${w.type}: ${w.label}`,
      required: true,
      assignee: 'manager',
      dueDate: transferDue,
      transferEntityType: w.type,
      transferEntityId: w.id,
    });
  items.push({
    itemKey: 'access_revocation',
    kind: 'access_revocation',
    title: 'Disable the login and end all sessions (done by the platform at separation)',
    required: true,
    assignee: 'none',
    dueDate: addDays(lastWorkingDay, 1),
  });
  items.push({
    itemKey: 'final_settlement',
    kind: 'final_settlement',
    title: 'Final settlement reference recorded (calculated outside Elevate OS)',
    required: config.finalSettlementRequired,
    assignee: 'hr',
    dueDate: lastWorkingDay,
  });
  if (config.exitInterview)
    items.push({
      itemKey: 'exit_interview',
      kind: 'exit_interview',
      title: 'Exit interview held or declined',
      required: false,
      assignee: 'hr',
      dueDate: lastWorkingDay,
    });
  return items;
}

// --- item status rules ---------------------------------------------------------------------------

/** Kinds a person can never mark `done`: the system completes them. */
export const SYSTEM_COMPLETED_KINDS: readonly ItemKind[] = ['asset_return', 'access_revocation'];

export type ItemCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'NO_CHANGE' | 'SYSTEM_ONLY' | 'NOTE_REQUIRED' | 'EVIDENCE_REQUIRED';
      message: string;
    };

/**
 * HL-A7: a person may move an item between pending / done / not_applicable /
 * blocked, except: system kinds cannot be marked done by hand; not_applicable
 * and blocked need a note; ownership transfers are done through the transfer
 * action (which reassigns the record) or marked not applicable with a note;
 * a final settlement item needs its reference as evidence.
 */
export function checkItemUpdate(input: {
  kind: ItemKind;
  from: ItemStatus;
  to: ItemStatus;
  notes?: string | null;
  evidence?: string | null;
}): ItemCheck {
  const { kind, from, to } = input;
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: `The item is already ${to}.` };
  if (to === 'done' && (SYSTEM_COMPLETED_KINDS.includes(kind) || kind === 'ownership_transfer'))
    return {
      ok: false,
      code: 'SYSTEM_ONLY',
      message:
        kind === 'asset_return'
          ? 'Record the return in the asset register; the item completes from there.'
          : kind === 'access_revocation'
            ? 'The platform completes this item when it disables the login at separation.'
            : 'Use "Transfer" to hand the record over; it completes the item.',
    };
  if ((to === 'not_applicable' || to === 'blocked') && !input.notes?.trim())
    return { ok: false, code: 'NOTE_REQUIRED', message: 'Add a note saying why.' };
  if (to === 'done' && kind === 'final_settlement' && !input.evidence?.trim())
    return {
      ok: false,
      code: 'EVIDENCE_REQUIRED',
      message: 'Give the settlement reference (no amounts) as evidence.',
    };
  return { ok: true };
}

export function isResolved(status: ItemStatus): boolean {
  return status === 'done' || status === 'not_applicable';
}

/**
 * HL-A8: required items not yet resolved. For offboarding, the access
 * revocation item is excluded: it can only complete after the separation the
 * approval leads to.
 */
export function completionGaps(
  kind: LifecycleKind,
  items: readonly { title: string; kind: ItemKind; required: boolean; status: ItemStatus }[],
): string[] {
  return items
    .filter((i) => i.required && !isResolved(i.status))
    .filter((i) => !(kind === 'offboarding' && i.kind === 'access_revocation'))
    .map((i) => i.title);
}

/** Separation is applied the day after the last working day (IST calendar days). */
export function separationDue(lastWorkingDay: IsoDate, today: IsoDate): boolean {
  return today > lastWorkingDay;
}

/** Overdue = unresolved and due before today (IST). Items without a due date are never overdue. */
export function isItemOverdue(
  item: { status: ItemStatus; dueDate: IsoDate | null },
  today: IsoDate,
) {
  return !isResolved(item.status) && item.dueDate !== null && item.dueDate < today;
}

/** Validate separation dates (notice ≤ LWD). */
export function checkSeparationDates(
  noticeDate: IsoDate | null,
  lastWorkingDay: IsoDate,
): { ok: true } | { ok: false; message: string } {
  if (noticeDate && noticeDate > lastWorkingDay)
    return { ok: false, message: 'The notice date cannot be after the last working day.' };
  return { ok: true };
}
