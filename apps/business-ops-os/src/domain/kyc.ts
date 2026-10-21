/**
 * Identity documents (owner brief §8, acceptance 21, D-043): only a masked reference is ever
 * stored, never the full number or a scan. The rule is the shared `isMaskedReference` (same as the
 * DB CHECK); this adds the reason, so a full number typed with spaces (1234 5678 9012) or a full
 * PAN (ABCDE1234F) gets a specific message.
 */
import { isMaskedReference } from '@elevate/shared-contracts';

/** `ab…@example.test` — for histories and audit rows. */
export const maskEmail = (email: string | null | undefined) =>
  email ? `${email.slice(0, 2)}…@${email.split('@')[1] ?? ''}` : null;

export function checkMaskedReference(value: string) {
  const v = value.trim();
  if (isMaskedReference(v)) return null;
  if (v.length < 2 || v.length > 40)
    return { reason: 'length', message: 'Enter 2 to 40 characters, e.g. XXXX-XXXX-1234.' } as const;
  if (v.replace(/\D/g, '').length > 4)
    return {
      reason: 'full',
      message: 'This looks like a full number. Enter only the last 4 digits, e.g. XXXX-XXXX-1234.',
    } as const;
  return {
    reason: 'mask',
    message: 'Mask the hidden part with X, e.g. XXXXX1234X. Full numbers are never stored.',
  } as const;
}
