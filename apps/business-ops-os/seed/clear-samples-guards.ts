/**
 * What db:clear-samples does about REAL rows that point at sample rows (R-SEED ruling): it never
 * deletes a real record. A real record that only refers to a sample one in an optional field is
 * unlinked (the field set to empty, one plain line per table, audited). A real record that cannot
 * lose its link (a target on a sample campaign, a test mixing real and sample batches or students,
 * a content item made from a sample idea…) stops the whole command before anything changes, with a
 * plain list of what to fix. Both run after the sample id sets (clear-samples.ts SETS) exist.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@elevate/database';
import { recordAudit } from '@elevate/server-kit';

const IN = (set: string) => `IN (SELECT id FROM ${set})`;

/** Raised before anything is deleted; `problems` are the lines to show. */
export class ClearSamplesRefused extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Nothing was deleted: these real records depend on sample records. Fix them first:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

/** Each query returns one `problem` text per real record that would lose a required link. */
const PRECHECKS: readonly string[] = [
  `SELECT 'Target "' || t.metric_key || '" (' || t.period_start || ' to ' || t.period_end || ') is set on sample campaign '
     || c.code || '; delete it or set it on a real campaign first.' AS problem
   FROM marketing.targets t JOIN marketing.campaigns c ON c.id = t.campaign_id
   WHERE NOT t.is_sample AND c.id ${IN('s_campaigns')}`,
  `WITH uses AS (
     SELECT a.id, a.code, a.is_sample, b.code AS batch, b.is_sample AS sample_batch
     FROM academic.assessments a
     JOIN (SELECT id AS aid, batch_id FROM academic.assessments
           UNION SELECT assessment_id, batch_id FROM academic.assessment_batches) x ON x.aid = a.id
     JOIN academic.batches b ON b.id = x.batch_id)
   SELECT 'Test ' || code || CASE
       WHEN bool_or(sample_batch) AND bool_or(NOT sample_batch) THEN
         ' covers real batch ' || string_agg(DISTINCT batch, ', ') FILTER (WHERE NOT sample_batch)
         || ' and sample batch ' || string_agg(DISTINCT batch, ', ') FILTER (WHERE sample_batch)
         || '; remove the sample batch from it first.'
       ELSE ' is a real test on sample batch ' || string_agg(DISTINCT batch, ', ')
         || '; delete it or mark it as sample first.' END AS problem
   FROM uses GROUP BY id, code, is_sample
   HAVING (bool_or(sample_batch) AND bool_or(NOT sample_batch)) OR (NOT is_sample AND bool_and(sample_batch))`,
  `SELECT 'Test ' || a.code || ' has ' || count(*) || CASE WHEN a.is_sample
       THEN ' real student(s) on its roster; remove them from the roster first.'
       ELSE ' sample student(s) on its roster; remove them from the roster first.' END AS problem
   FROM academic.assessment_roster r JOIN academic.assessments a ON a.id = r.assessment_id
   WHERE a.is_sample <> (r.student_id ${IN('s_academic_students')})
   GROUP BY a.id, a.code, a.is_sample`,
  `SELECT 'Score import of ' || coalesce(a.code, i.assessment_id::text) || ' is a real import on a sample test; cancel it first.' AS problem
   FROM ops.score_imports i LEFT JOIN academic.assessments a ON a.id = i.assessment_id
   WHERE NOT i.is_sample AND a.is_sample`,
  `SELECT 'Content item "' || c.title || '" was made from sample idea ' || i.code || '; move it to a real idea first.' AS problem
   FROM marketing.content_items c JOIN marketing.ideas i ON i.id = c.idea_id WHERE i.id ${IN('s_ideas')}`,
  `SELECT 'Placement ' || coalesce(p.code, p.id::text) || ' belongs to sample idea ' || i.code || '; move it to a real idea first.' AS problem
   FROM marketing.placements p JOIN marketing.ideas i ON i.id = p.idea_id WHERE i.id ${IN('s_ideas')}`,
  `SELECT 'Placement group ' || g.code || ' belongs to sample idea ' || i.code || '; move it to a real idea first.' AS problem
   FROM marketing.placement_groups g JOIN marketing.ideas i ON i.id = g.idea_id WHERE i.id ${IN('s_ideas')}`,
  `SELECT 'Task "' || t.title || '" waits on sample task "' || s.title || '"; remove that dependency first.' AS problem
   FROM ops.task_dependencies d JOIN ops.staff_tasks t ON t.id = d.task_id JOIN ops.staff_tasks s ON s.id = d.depends_on_task_id
   WHERE d.depends_on_task_id ${IN('s_tasks')} AND d.task_id NOT ${IN('s_tasks')}`,
  `SELECT 'Request "' || r.subject || '" was sent to or by a sample staff member; resolve it with HR first.' AS problem
   FROM ops.hr_requests r
   WHERE NOT r.is_sample AND (r.sender_staff_id ${IN('s_staff')} OR r.recipient_staff_id ${IN('s_staff')}
     OR EXISTS (SELECT 1 FROM ops.hr_request_events e WHERE e.request_id = r.id AND e.forwarded_to_staff_id ${IN('s_staff')}))`,
];

/** Optional links of real rows to sample rows: [plain line, table, UPDATE … RETURNING id]. */
const REAL_LINKS: readonly [string, string, string][] = [
  [
    'real calendar item(s) from sample ideas, campaigns or tasks',
    'marketing.calendar_items',
    `UPDATE marketing.calendar_items SET
       idea_id = CASE WHEN idea_id ${IN('s_ideas')} THEN NULL ELSE idea_id END,
       campaign_id = CASE WHEN campaign_id ${IN('s_campaigns')} THEN NULL ELSE campaign_id END,
       related_task_id = CASE WHEN related_task_id ${IN('s_tasks')} THEN NULL ELSE related_task_id END
     WHERE NOT is_sample AND (idea_id ${IN('s_ideas')} OR campaign_id ${IN('s_campaigns')} OR related_task_id ${IN('s_tasks')})
     RETURNING id`,
  ],
  [
    'real idea(s) from sample campaigns',
    'marketing.ideas',
    `UPDATE marketing.ideas SET campaign_id = NULL
     WHERE NOT is_sample AND campaign_id ${IN('s_campaigns')} RETURNING id`,
  ],
  [
    'real task(s) about sample leads, students, tests, batches, requests or parent tasks',
    'ops.staff_tasks',
    `UPDATE ops.staff_tasks SET
       lead_id = CASE WHEN lead_id ${IN('s_leads')} THEN NULL ELSE lead_id END,
       admission_id = CASE WHEN admission_id ${IN('s_admissions')} THEN NULL ELSE admission_id END,
       student_id = CASE WHEN student_id ${IN('s_students')} THEN NULL ELSE student_id END,
       parent_task_id = CASE WHEN parent_task_id ${IN('s_tasks')} THEN NULL ELSE parent_task_id END,
       recurrence_parent_id = CASE WHEN recurrence_parent_id ${IN('s_tasks')} THEN NULL ELSE recurrence_parent_id END,
       related_kind = CASE WHEN related_id ${IN('s_related')} THEN NULL ELSE related_kind END,
       related_label = CASE WHEN related_id ${IN('s_related')} THEN NULL ELSE related_label END,
       related_id = CASE WHEN related_id ${IN('s_related')} THEN NULL ELSE related_id END
     WHERE id NOT ${IN('s_tasks')} AND (lead_id ${IN('s_leads')} OR admission_id ${IN('s_admissions')}
       OR student_id ${IN('s_students')} OR parent_task_id ${IN('s_tasks')} OR recurrence_parent_id ${IN('s_tasks')}
       OR related_id ${IN('s_related')})
     RETURNING id`,
  ],
  [
    'real request(s) through HR linked to sample tasks or records',
    'ops.hr_requests',
    `UPDATE ops.hr_requests SET
       linked_task_id = CASE WHEN linked_task_id ${IN('s_tasks')} THEN NULL ELSE linked_task_id END,
       related_kind = CASE WHEN related_id ${IN('s_related')} THEN 'none' ELSE related_kind END,
       related_id = CASE WHEN related_id ${IN('s_related')} THEN NULL ELSE related_id END
     WHERE NOT is_sample AND (linked_task_id ${IN('s_tasks')} OR related_id ${IN('s_related')})
     RETURNING id`,
  ],
];

/** Every sample id another record may name in a free "related" field (task, test, batch, request…). */
export const RELATED_SET: [string, string] = [
  's_related',
  `SELECT id FROM s_tasks UNION SELECT id FROM s_assessments UNION SELECT id FROM s_academic_batches
   UNION SELECT id FROM s_hr_requests UNION SELECT id FROM s_campaigns UNION SELECT id FROM s_students
   UNION SELECT id FROM s_academic_students UNION SELECT id FROM s_leads`,
];

const rows = (r: unknown) => (r as { rows: Record<string, unknown>[] }).rows;

/** Throws ClearSamplesRefused when a real record needs a sample one. */
export async function refuseRequiredLinks(tx: Database) {
  const problems: string[] = [];
  for (const q of PRECHECKS)
    problems.push(...rows(await tx.execute(sql.raw(q))).map((r) => String(r.problem)));
  if (problems.length) throw new ClearSamplesRefused(problems);
}

/** Empty the optional links of real rows; one plain line per table, each audited. */
export async function unlinkRealRows(tx: Database) {
  const lines: string[] = [];
  for (const [what, table, statement] of REAL_LINKS) {
    const ids = rows(await tx.execute(sql.raw(statement))).map((r) => String(r.id));
    if (!ids.length) continue;
    lines.push(`Unlinked ${ids.length} ${what}`);
    await recordAudit(tx, {
      actorType: 'system',
      actorUserId: null,
      module: 'ops',
      action: 'samples.real_rows_unlinked',
      entityType: table,
      after: { ids },
      metadata: { reason: 'db:clear-samples removed the sample records they pointed at' },
    });
  }
  return lines;
}
