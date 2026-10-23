import { defineConfig } from 'drizzle-kit';

/**
 * Central migration config (D-005). Covers all schema files.
 * `npm run db:generate` (root) writes SQL to ./migrations; `npm run db:migrate`
 * applies it. Module teams do not run generate during wave 2 (see BUILD_PLAN).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema/core.ts',
    './src/schema/marketing.ts',
    './src/schema/academic-curriculum.ts',
    './src/schema/academic.ts',
    './src/schema/academic-assessments.ts',
    './src/schema/academic-delivery.ts',
    './src/schema/academic-reviews.ts',
    './src/schema/academic-assessment-admin.ts',
    './src/schema/ops.ts',
    './src/schema/ops-demos.ts',
    './src/schema/ops-students.ts',
    './src/schema/ops-meetings.ts',
    './src/schema/ops-fees-intake.ts',
    './src/schema/ops-applications.ts',
    './src/schema/ops-onboarding.ts',
    './src/schema/ops-tasks.ts',
    './src/schema/ops-eod.ts',
    './src/schema/ops-task-imports.ts',
    './src/schema/ops-review-acks.ts',
    './src/schema/ops-teacher-reports.ts',
    './src/schema/ops-attachments.ts',
    './src/schema/ops-hr.ts',
    './src/schema/ops-attendance.ts',
    './src/schema/ops-task-work.ts',
    './src/schema/ops-feedback.ts',
    './src/schema/ops-hr-requests.ts',
    './src/schema/ops-score-imports.ts',
    './src/schema/ops-lead-stages.ts',
  ],
  out: './migrations',
  schemaFilter: ['core', 'marketing', 'academic', 'ops'],
  strict: true,
  verbose: true,
  ...(process.env.DATABASE_URL?.startsWith('postgres')
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
