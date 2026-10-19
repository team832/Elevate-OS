/**
 * Work assets (OPS-038): assignment and return rules. Pure.
 * One open assignment per asset (also a unique index in the database).
 */

export const ASSET_STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'lost'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const RETURN_CONDITIONS = ['good', 'worn', 'damaged', 'lost'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Asset status after a return in a given condition. */
export function statusAfterReturn(condition: ReturnCondition): AssetStatus {
  switch (condition) {
    case 'good':
    case 'worn':
      return 'available';
    case 'damaged':
      return 'in_repair';
    case 'lost':
      return 'lost';
  }
}

export function checkAssignment(input: {
  assetStatus: AssetStatus;
  hasOpenAssignment: boolean;
  employeeStatus: string | null;
  staffStatus: string;
  assignedOn: string;
  expectedReturnOn: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (input.hasOpenAssignment || input.assetStatus === 'assigned')
    return { ok: false, message: 'The asset is already assigned; record its return first.' };
  if (input.assetStatus !== 'available')
    return {
      ok: false,
      message: `The asset is ${input.assetStatus.replace('_', ' ')}, not available.`,
    };
  if (input.employeeStatus === null)
    return { ok: false, message: 'Assets are assigned to employees with an employee record.' };
  if (input.employeeStatus === 'separated' || input.staffStatus === 'inactive')
    return { ok: false, message: 'The employee has separated or is inactive.' };
  if (input.expectedReturnOn && input.expectedReturnOn < input.assignedOn)
    return { ok: false, message: 'The expected return date is before the assignment date.' };
  return { ok: true };
}

/** Manual status changes (assignment and return have their own actions). */
export const MANUAL_ASSET_TARGETS: Record<AssetStatus, readonly AssetStatus[]> = {
  available: ['in_repair', 'retired', 'lost'],
  assigned: [],
  in_repair: ['available', 'retired', 'lost'],
  retired: [],
  lost: ['available', 'retired'],
};

export function checkAssetStatusChange(
  from: AssetStatus,
  to: AssetStatus,
): { ok: true } | { ok: false; message: string } {
  if (from === to) return { ok: false, message: 'The status is unchanged.' };
  if (from === 'assigned')
    return { ok: false, message: 'Record the return before changing an assigned asset.' };
  if (to === 'assigned') return { ok: false, message: 'Use “Assign” to assign an asset.' };
  if (!MANUAL_ASSET_TARGETS[from].includes(to))
    return { ok: false, message: `An asset cannot move from ${from} to ${to}.` };
  return { ok: true };
}
