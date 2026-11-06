/**
 * The website enquiry form's server rules as HTML `pattern` attributes (FR-D), so the browser stops
 * a person before posting what the server would refuse (behind the same thank-you). Browsers compile
 * a pattern whole and with the `v` flag, so every class escape here is valid in that mode.
 * Tests compare these with normalisePhone and normaliseEmail on the rendered page.
 */
const SEP = String.raw`[\s\-.\(\)\/]*`;
const digits = (n: string) => String.raw`(?:\d${SEP}){${n}}`;
const NATIONAL = String.raw`[1-9]${SEP}${digits('9')}`;
const PLUS = String.raw`${SEP}(?:\+|0${SEP}0)${SEP}`;

/**
 * normalisePhone (shared-contracts phone.ts): separators anywhere; Indian numbers with nothing,
 * 0, 91 or 091 before them, or +91 / 0091 with an optional 0; other countries with + or 00 and
 * 8–15 digits, not starting 91.
 */
export const PHONE_PATTERN = [
  String.raw`${PLUS}9${SEP}1${SEP}(?:0${SEP})?${NATIONAL}`,
  String.raw`${PLUS}(?:[1-8]${SEP}${digits('7,14')}|9${SEP}[02-9]${SEP}${digits('6,13')})`,
  String.raw`${SEP}(?:0${SEP}|(?:0${SEP})?9${SEP}1${SEP})?${NATIONAL}`,
].join('|');

/** normaliseEmail (domain/contacts.ts): something@something.something, no spaces. */
export const EMAIL_PATTERN = String.raw`[^\s@]+@[^\s@]+\.[^\s@]+`;

/** Not blank after trimming (the server trims the name). */
export const NAME_PATTERN = String.raw`.*\S.*`;
