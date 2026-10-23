import { z } from 'zod';
import { ValidationError, defineRoute } from '@elevate/server-kit';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { istMidnightUtc } from '../../../../domain';
import { contentFilter, listCalendar } from '../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({
  from: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  to: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  account: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/)
    .optional(),
});

/** GET /marketing/api/v1/placements?from&to&account — calendar (IST days) with conflicts. Max 62 days. */
export const GET = defineRoute(
  { permission: 'marketing:content:read', query },
  async ({ db, query, user }) => {
    const from = (query.from ?? toIsoDate()) as IsoDate;
    const to = (query.to ?? addDays(from, 13)) as IsoDate;
    if (to < from) throw new ValidationError('to must not be before from.');
    if (addDays(from, 62) < to) throw new ValidationError('The window is limited to 62 days.');
    return listCalendar(
      db,
      {
        from: istMidnightUtc(from),
        to: istMidnightUtc(addDays(to, 1)),
        accountCode: query.account,
      },
      await contentFilter(db, user),
    );
  },
);
