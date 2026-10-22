/**
 * OWNER: Business Ops OS — Ops' acknowledgement of a teacher's submitted student review (owner
 * answer 1, 21 Oct 2026; ruling R4). The review itself lives in Academic OS and is read through
 * its internal route; Ops never edits it. `review_key` is Academic's review id (no FK across
 * modules). Part of the `ops` Postgres schema, split across ops*.ts; same rules as ops.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, isoDate, ops, userRef } from './ops-columns';

export const opsReviewAcknowledgements = ops.table(
  'review_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewKey: uuid('review_key').notNull(),
    reviewVersion: integer('review_version').notNull(),
    acknowledgedByUserId: userRef('acknowledged_by_user_id').notNull(),
    note: text('note'),
    /** Ops' own follow-up (Ops words, never the teacher's). */
    followUp: text('follow_up'),
    followUpOn: isoDate('follow_up_on'),
    isSample: boolean('is_sample').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_acknowledgements_key').on(
      t.reviewKey,
      t.reviewVersion,
      t.acknowledgedByUserId,
    ),
    check('review_acknowledgements_version_check', sql`${t.reviewVersion} >= 1`),
    check(
      'review_acknowledgements_follow_up_check',
      sql`${t.followUpOn} IS NULL OR ${t.followUp} IS NOT NULL`,
    ),
  ],
);
