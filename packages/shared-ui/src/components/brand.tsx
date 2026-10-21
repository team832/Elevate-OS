export const COMPANY_NAME = 'Elevate Education';

/**
 * Public facts about the institute, from elevateeducation.in (checked 21 Oct 2026) and the
 * owner's programme answers (D-034, D-037; combinations as in business-ops `domain/catalog.ts`).
 * Address and GSTIN from the owner's admission form (D-048); the GSTIN is printed exactly as on
 * the form (14 characters; owner accepted, D-048). Nothing internal.
 */
export const INSTITUTE = {
  site: 'https://elevateeducation.in',
  privacyPolicy: 'https://elevateeducation.in/privacy-policy',
  phone: '+91 8505099888',
  email: 'team@elevateeducation.in', // public email on documents (owner, D-049)
  legalName: 'A unit of Zeromiles Digital (India) Pvt Ltd',
  address: '214, Bhaskar Heights, Silver Jubilee Road, Sikar, Rajasthan 332001',
  gstin: '08AACC2204Q120',
  modes: 'Online, and offline at the Sikar centre',
  exams: [
    {
      name: 'CLAT',
      about: 'Common Law Admission Test, for the National Law Universities. Also taken on its own.',
    },
    {
      name: 'IPMAT',
      about:
        'IIM Indore’s Integrated Programme in Management entrance. The IIM Bangalore UG test (IIMB UG-AT) is coached in the same batch and finishes earlier, as that exam comes first.',
    },
    {
      name: 'CUET',
      about: 'Common University Entrance Test, for Delhi University, BHU and other universities.',
    },
    {
      name: 'CA Foundation',
      about:
        'The first ICAI Chartered Accountancy exam: Accounting, Business Laws, Quantitative Aptitude and Business Economics.',
    },
  ],
  batches: [
    {
      name: 'Class 11 Commerce',
      about: 'The complete Class 11 Commerce year, alone or with CLAT, IPMAT or CUET.',
    },
    {
      name: 'Class 12 Commerce',
      about:
        'The complete Class 12 Commerce year, alone or with CLAT, IPMAT, CUET or CA Foundation.',
    },
    {
      name: 'Dropper',
      about:
        'For students who have finished Class 12: one exam, any of CLAT, IPMAT, CUET or CA Foundation.',
    },
  ],
} as const;

export const instituteTelHref = `tel:${INSTITUTE.phone.replace(/\s/g, '')}`;

const CHEVRONS = [
  { d: 'M413 25 468 78v39l-55-49-55 49V78z', fill: '#ff8623' },
  { d: 'M413 103l55 49v26l-55-43-55 43v-26z', fill: '#ffa43d' },
] as const;

const LETTERS =
  'M30.6 112h62.8a31.5 35 0 1 0-6.6 24M132.5 39.5v106M170.6 112h62.8a31.5 35 0 1 0-6.6 24' +
  'M264 79.5l34 66 34-66M519 51.5V127a21.5 21.5 0 0 0 21.5 21.5M501.5 78h39' +
  'M570.6 112h62.8a31.5 35 0 1 0-6.6 24';

/**
 * Letters use `currentColor` (set `color` to adapt).
 * Pass `decorative` when visible text next to it already names the company.
 */
export function BrandLogo({
  size = 'md',
  decorative,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={['el-brand-logo', `el-brand-logo-${size}`, className].filter(Boolean).join(' ')}
      viewBox="19 18 628 170"
      width="628"
      height="170"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': COMPANY_NAME })}
      focusable="false"
    >
      {decorative ? null : <title>{COMPANY_NAME}</title>}
      <path
        d={LETTERS}
        fill="none"
        stroke="currentColor"
        strokeWidth="23"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {CHEVRONS.map((c) => (
        <path
          key={c.fill}
          d={c.d}
          fill={c.fill}
          stroke={c.fill}
          strokeWidth="10"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
