import { z } from 'zod';

/** A report is addressed by its SR- reference or its export id, always under its student. */
export const reportParams = z.object({
  id: z.uuid(),
  reportId: z.union([z.uuid(), z.string().regex(/^SR-[0-9A-Z]{10}$/)]),
});
