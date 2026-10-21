/**
 * Admission numbers (owner brief §7; D-037 format 001, 002 …; D-040 given only at final
 * confirmation, never changed or reused). Pure. The format is the approved setting
 * `admissions.number.format`; the server takes the next value from the counter row of
 * `counterScopeKey()` locked FOR UPDATE inside the confirmation transaction.
 */
export interface AdmissionNumberFormat {
  prefix: string;
  separator: '' | '-' | '/';
  includeYear: boolean;
  width: number;
}

/** Counter row: one global sequence, or one per calendar year (IST) when the year is in the number. */
export function counterScopeKey(format: AdmissionNumberFormat, year: number): string {
  return format.includeYear ? `Y${year}` : 'all';
}

/** e.g. `00042`, or `EE-2026-00042` with prefix "EE" and the year. */
export function formatAdmissionNumber(
  format: AdmissionNumberFormat,
  sequence: number,
  year: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be ≥ 1');
  const parts = [
    format.prefix,
    format.includeYear ? String(year) : '',
    String(sequence).padStart(format.width, '0'),
  ];
  return parts.filter(Boolean).join(format.separator);
}

export const ADMISSION_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/-]{0,39}$/;
export const OVERRIDE_REASON_MIN = 10;

export type OverrideCheck =
  | { ok: true; number: string; reason: string }
  | { ok: false; field: 'admissionNumber' | 'reason' | 'permission'; message: string };

/** A manually entered number: permission, format and a reason of at least 10 characters. */
export function checkManualNumber(input: {
  number: string | null | undefined;
  reason: string | null | undefined;
  hasPermission: boolean;
}): OverrideCheck {
  if (!input.hasPermission)
    return {
      ok: false,
      field: 'permission',
      message:
        'Entering an admission number by hand needs permission ops:admission_number:override.',
    };
  const number = input.number?.trim() ?? '';
  if (!ADMISSION_NUMBER_PATTERN.test(number))
    return {
      ok: false,
      field: 'admissionNumber',
      message: 'Use 1–40 letters, digits, "-" or "/", starting with a letter or digit.',
    };
  const reason = input.reason?.trim() ?? '';
  if (reason.length < OVERRIDE_REASON_MIN)
    return {
      ok: false,
      field: 'reason',
      message: `Give a reason of at least ${OVERRIDE_REASON_MIN} characters for a manual number.`,
    };
  return { ok: true, number, reason };
}
