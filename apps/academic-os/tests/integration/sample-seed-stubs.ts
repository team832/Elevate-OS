import type { Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';

/**
 * Stand-ins for the Ops seeds Academic's seeds depend on (a module's tests never load another
 * module). `staff` runs as `ops.sample-staff`, `teachers` as `ops.teachers`; `ops.samples` does
 * nothing, so the demo attendee case is skipped. Without staff, the sample teaching seed is skipped.
 */
export const opsSeedStubs = (staff: (db: Database) => Promise<void> = async () => {}, teachers: (db: Database) => Promise<void> = async () => {}) => [
  defineSeed({ name: 'ops.teachers', module: 'ops', description: 'test stub', run: ({ db }) => teachers(db) }),
  defineSeed({
    name: 'ops.sample-staff',
    module: 'ops',
    description: 'test stub',
    run: ({ db }) => staff(db),
  }),
  defineSeed({ name: 'ops.samples', module: 'ops', description: 'test stub', run: async () => {} }),
];
