import { branches, departments, programmes } from '../schema/core';
import { defineSeed, type SeedDefinition } from './registry';

/**
 * Departments from the legacy "Suggested departments" table in
 * Elevate-Education-Agent-Handover-2026-10-15.zip →
 * elevate-education-operations/SYSTEM_ARCHITECTURE.md ("This is a starting model
 * and will be adjusted to Elevate Education's actual structure"). Seeded as
 * `provisional` until the owner confirms the structure.
 */
export const SEED_DEPARTMENTS = [
  ['LEADERSHIP_OPERATIONS', 'Leadership & Operations', 'Strategy execution and coordination'],
  ['ADMISSIONS_COUNSELLING', 'Admissions & Counselling', 'Lead-to-enrolment journey'],
  ['ACADEMICS', 'Academics', 'Teaching plan and delivery quality'],
  ['CURRICULUM_CONTENT', 'Curriculum & Content', 'Learning-material production'],
  ['FACULTY_MANAGEMENT', 'Faculty Management', 'Allocation, readiness, and performance'],
  ['STUDENT_SUCCESS', 'Student Success', 'Attendance, engagement, support, retention'],
  ['EXAMINATIONS', 'Examinations', 'Assessment planning and results'],
  ['PARENT_COMMUNICATION', 'Parent Communication', 'Structured updates and issue resolution'],
  ['MARKETING_GROWTH', 'Marketing & Growth', 'Awareness and lead generation'],
  ['FINANCE', 'Finance', 'Fees, payroll, budgeting, and controls'],
  ['HUMAN_RESOURCES', 'Human Resources', 'Hiring, onboarding, attendance, and performance'],
  ['ADMINISTRATION_FACILITIES', 'Administration & Facilities', 'Physical operations and logistics'],
  ['TECHNOLOGY_DATA', 'Technology & Data', 'Systems, access, support, and reporting'],
] as const;

/**
 * Programme catalogue (business planning data, not personal data — D-016).
 * All `active`: CA Foundation is running now (owner, 21 Oct 2026, D-037), no longer `planned`.
 */
export const SEED_PROGRAMMES = [
  ['CLAT', 'CLAT UG preparation', 'Common Law Admission Test (UG) preparation.', 'active'],
  [
    'IPMAT',
    'IPMAT preparation',
    'IPM entrance preparation (IPMAT, IIM Indore; owner shorthand "IAM IP mat"). The IIM Bangalore UG admission test (IIMB UG-AT) is coached in the same batch; its syllabus finishes earlier because that exam comes first (owner, 21 Oct 2026).',
    'active',
  ],
  ['CUET', 'CUET (UG) preparation', 'Common University Entrance Test (UG) preparation.', 'active'],
  ['COMMERCE_11_12', 'Class 11–12 Commerce', 'Class 11–12 Commerce board preparation.', 'active'],
  [
    'CLASS_11',
    'Class 11 Commerce',
    'Complete Class 11 Commerce batch (Commerce only); alone or with CLAT, IPMAT or CUET (owner, 20–21 Oct 2026).',
    'active',
  ],
  [
    'CLASS_12',
    'Class 12 Commerce',
    'Complete Class 12 Commerce batch (Commerce only); alone or with CLAT, IPMAT, CUET or CA Foundation (owner, 20–21 Oct 2026).',
    'active',
  ],
  [
    'DROPPER',
    'Dropper',
    'Dropper batch for students who have finished Class 12; always with one exam: CLAT, IPMAT (incl. IIMB UG-AT), CUET or CA Foundation (owner, 21 Oct 2026).',
    'active',
  ],
  [
    'CA_FOUNDATION',
    'CA Foundation',
    'CA Foundation preparation; running now (owner, 21 Oct 2026).',
    'active',
  ],
] as const satisfies readonly (readonly [
  string,
  string,
  string,
  'active' | 'planned' | 'paused' | 'retired',
])[];

/** The core seeds a production database needs: no people. Sample users are ./core-seed.ts. */
export const coreReferenceSeeds: readonly SeedDefinition[] = [
  defineSeed({
    name: 'core.departments',
    module: 'platform',
    description: '13 provisional departments from the legacy architecture note',
    async run({ db }) {
      for (const [code, name, description] of SEED_DEPARTMENTS) {
        await db
          .insert(departments)
          .values({ code, name, description, status: 'provisional' })
          .onConflictDoNothing({ target: departments.code });
      }
    },
  }),
  /**
   * The one centre on record: the Sikar address printed on every document (INSTITUTE in
   * packages/shared-ui/src/components/brand.tsx). `provisional` until the owner confirms the
   * branch list; "Online" is a delivery mode, not a branch.
   */
  defineSeed({
    name: 'core.branches',
    module: 'platform',
    description: 'Sikar centre (provisional; the only branch on record)',
    async run({ db }) {
      await db
        .insert(branches)
        .values({ code: 'SIKAR', name: 'Sikar centre', status: 'provisional' })
        .onConflictDoNothing({ target: branches.code });
    },
  }),
  defineSeed({
    name: 'core.programmes',
    module: 'platform',
    description:
      'Programme catalogue (CLAT, IPMAT, CUET, CLASS_11, CLASS_12, DROPPER, COMMERCE_11_12, CA_FOUNDATION)',
    async run({ db }) {
      for (const [code, name, description, status] of SEED_PROGRAMMES) {
        await db
          .insert(programmes)
          .values({ code, name, description, status })
          .onConflictDoNothing({ target: programmes.code });
      }
    },
  }),
];
