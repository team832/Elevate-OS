/**
 * Numbered documents (F4-01 receipts, F4-02 certificates): the Indian financial year of a day, the
 * printed number, an amount in words (Indian numbering) and the certificate wording's
 * placeholders. Pure.
 */

/** April–March year of an IST calendar day: 2027-03-31 → 2026-27, 2027-04-01 → 2027-28. */
export function financialYearOf(day: string): string {
  const year = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** `ER/2026-27/000001`: the parts, then the sequence padded to `digits`. */
export const documentNumber = (parts: readonly string[], sequence: number, digits: number) =>
  [...parts, String(sequence).padStart(digits, '0')].join('/');

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const below100 = (n: number) =>
  n < 20 ? ONES[n]! : [TENS[Math.floor(n / 10)]!, ONES[n % 10]!].filter(Boolean).join(' ');

/** Whole number in Indian grouping: crore, lakh, thousand, hundred. */
function indianWords(n: number): string {
  const groups: [number, string][] = [
    [Math.floor(n / 1e7), 'Crore'],
    [Math.floor((n % 1e7) / 1e5), 'Lakh'],
    [Math.floor((n % 1e5) / 1e3), 'Thousand'],
    [Math.floor((n % 1e3) / 100), 'Hundred'],
  ];
  return [
    ...groups.map(([g, name]) =>
      g ? `${name === 'Crore' && g > 99 ? indianWords(g) : below100(g)} ${name}` : '',
    ),
    below100(n % 100),
  ]
    .filter(Boolean)
    .join(' ');
}

/** 12,04,050.05 → "Rupees Twelve Lakh Four Thousand Fifty and Five Paise Only". */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const parts = [
    rupees ? `Rupees ${indianWords(rupees)}` : '',
    paise % 100 ? `${below100(paise % 100)} ${paise % 100 === 1 ? 'Paisa' : 'Paise'}` : '',
  ].filter(Boolean);
  return `${parts.join(' and ') || 'Rupees Zero'} Only`;
}

/** What a certificate's wording may name, in braces: "{student}", "{admission number}". */
export const CERTIFICATE_PLACEHOLDERS = [
  'student',
  'admission number',
  'programme',
  'academic year',
  'issue date',
  'institute',
] as const;
export type CertificateValues = Record<(typeof CERTIFICATE_PLACEHOLDERS)[number], string>;

/** Placeholders in the wording that are not in the list (the setting refuses them). */
export const unknownPlaceholders = (text: string) =>
  [...text.matchAll(/\{([^}]*)\}/g)]
    .map((m) => m[1]!)
    .filter((p) => !(CERTIFICATE_PLACEHOLDERS as readonly string[]).includes(p));

export const fillWording = (text: string, values: CertificateValues) =>
  text.replace(/\{([^}]+)\}/g, (_, key: string) => values[key as keyof CertificateValues]);
