/** The one phone rule (HUS-035): what a person may type, and the E.164 it is stored as. */
import { z } from 'zod';

export type PhoneResult =
  | { ok: true; e164: string; kind: 'india_mobile' | 'india_landline' | 'international' }
  | { ok: false; reason: 'missing' | 'invalid_characters' | 'invalid_length' | 'invalid_number' };

const SEPARATORS = /[\s\-.()/]/g;

function classifyIndian(national: string): PhoneResult {
  if (!/^[1-9]\d{9}$/.test(national)) return { ok: false, reason: 'invalid_number' };
  const kind = /^[6-9]/.test(national) ? 'india_mobile' : 'india_landline';
  return { ok: true, e164: `+91${national}`, kind };
}

/**
 * Normalise a phone number to E.164. Indian numbers (the default country) accept:
 * `98765 43210`, `098765-43210` (trunk 0), `91 98765 43210`, `+91 98765 43210`,
 * `0091…`, `+91 (0) 98765 43210`. Other countries need an explicit `+` or `00`
 * prefix and are kept as given (8–15 digits). Extensions and letters are rejected.
 */
export function normalisePhone(raw: string | null | undefined): PhoneResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'missing' };
  let compact = trimmed.replace(SEPARATORS, '');
  if (!/^\+?\d+$/.test(compact)) return { ok: false, reason: 'invalid_characters' };
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;

  if (compact.startsWith('+')) {
    const digits = compact.slice(1);
    if (digits.startsWith('91')) {
      let national = digits.slice(2);
      // "+91 (0) 98765 43210": a trunk 0 written after the country code.
      if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
      if (national.length !== 10) return { ok: false, reason: 'invalid_length' };
      return classifyIndian(national);
    }
    if (!/^[1-9]\d{7,14}$/.test(digits)) return { ok: false, reason: 'invalid_length' };
    return { ok: true, e164: `+${digits}`, kind: 'international' };
  }

  // Digits only: Indian by default.
  if (compact.length === 10) return classifyIndian(compact);
  if (compact.length === 11 && compact.startsWith('0')) return classifyIndian(compact.slice(1));
  if (compact.length === 12 && compact.startsWith('91')) return classifyIndian(compact.slice(2));
  if (compact.length === 13 && compact.startsWith('091')) return classifyIndian(compact.slice(3));
  return { ok: false, reason: 'invalid_length' };
}

export const PHONE_ERROR_MESSAGES: Record<Exclude<PhoneResult, { ok: true }>['reason'], string> = {
  missing: 'No phone number given.',
  invalid_characters: 'Phone numbers may contain digits, spaces, dashes, brackets and a leading +.',
  invalid_length:
    'Not a valid phone number: Indian numbers have 10 digits (optionally with 0, 91 or +91 before them); other countries need a + prefix.',
  invalid_number: 'Not a valid Indian number: it cannot start with 0 after the prefix is removed.',
};

/** A phone as a person types it ("+91 98765 43210", "098765-43210"); the parsed value is E.164. */
export const phoneInputSchema = z.string().transform((raw, ctx) => {
  const phone = normalisePhone(raw);
  if (phone.ok) return phone.e164;
  ctx.addIssue({ code: 'custom', message: PHONE_ERROR_MESSAGES[phone.reason] });
  return z.NEVER;
});
