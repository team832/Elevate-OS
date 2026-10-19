/**
 * Legacy import, part 3 (MKT-035): the 60-post CLAT Instagram audit of 7 Oct 2026 as
 * HISTORICAL snapshots labelled as manual audit data — not a platform export. Blank cells
 * stay missing (never 0); metrics the audit did not record are missing; watch hours and CTR
 * do not apply to Instagram. Verdicts are kept as tags.
 */
import { marketingMetricSnapshots, marketingMetricValues, type Database } from '@elevate/database';
import { METRIC_KEYS, type MetricKey, type MetricState } from '../../domain';
import { getAccountByCode } from '../accounts';
import type { ImportCount } from './import-registry';
import type { LegacyPostAuditFile } from './types';

export const POST_AUDIT_LABEL =
  'Manual audit of the CLAT Instagram page, 7 Oct 2026 (legacy post-audit.csv) — numbers read by hand, not a platform export';

export async function importLegacyPostAudit(
  db: Database,
  file: LegacyPostAuditFile,
): Promise<ImportCount> {
  const account = await getAccountByCode(db, file.summary.account_code);
  // The audit records a date only; midnight IST with precision `date` (no time is invented).
  const capturedAt = new Date(`${file.summary.audited_on}T00:00:00+05:30`);
  let inserted = 0;
  for (const r of file.records) {
    const postKey = r.link ?? `audit-row-${r.n}|${r.posted ?? ''}`;
    const tags = [
      ...r.verdict_actions.map((v) => `verdict:${v}`),
      ...(r.ownership ? [`ownership:${r.ownership}`] : []),
      ...(r.likely_boosted ? ['likely_boosted'] : []),
    ];
    const [snap] = await db
      .insert(marketingMetricSnapshots)
      .values({
        source: 'manual_audit',
        sourceLabel: POST_AUDIT_LABEL,
        accountId: account.id,
        matchStatus: 'historical',
        postKey,
        postLink: r.link,
        postTitle: r.topic,
        publishedOn: r.posted,
        platformFormat: r.type,
        capturedAt,
        capturedPrecision: 'date',
        window: 'lifetime_at_capture',
        sourceRow: r.n + 1,
        tags,
        notes: r.reason,
      })
      .onConflictDoNothing()
      .returning({ id: marketingMetricSnapshots.id });
    if (!snap) continue;
    inserted += 1;
    const recorded: Partial<Record<MetricKey, number | null>> = {
      views: r.views,
      likes: r.likes,
      comments: r.comments,
    };
    await db.insert(marketingMetricValues).values(
      METRIC_KEYS.map((metric) => {
        let state: MetricState;
        let value: number | null = null;
        let basis: string;
        if (metric === 'watch_hours' || metric === 'ctr_pct') {
          state = 'not_applicable';
          basis = 'Instagram does not report this metric';
        } else if (!(metric in recorded)) {
          state = 'missing';
          basis = 'not recorded in the manual audit';
        } else if (recorded[metric] === null || recorded[metric] === undefined) {
          state = 'missing';
          basis = 'blank in the manual audit';
        } else {
          state = 'reported';
          value = recorded[metric]!;
          basis = 'manual audit (as reported in the legacy CSV)';
        }
        return { snapshotId: snap.id, metric, value, state, basis };
      }),
    );
  }
  return { inserted, existing: file.records.length - inserted };
}
