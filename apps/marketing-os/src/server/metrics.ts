/**
 * Metrics CSV import (MKT-028, MKT-029, MKT-030). Parsing and validation are pure
 * (domain/metrics-csv.ts); this service matches rows to placements, stores snapshots with a
 * capture time and per-value states, and keeps the import idempotent per (account, file hash).
 */
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingMetricImports,
  marketingMetricSnapshots,
  marketingMetricValues,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
  type MarketingPlacementId,
} from '@elevate/database';
import { ValidationError, withTransaction } from '@elevate/server-kit';
import {
  DATE_FORMATS,
  METRIC_KEYS,
  istDate,
  parseMetricsCsv,
  type CsvFormatId,
  type MatchStatus,
  type MetricCell,
  type MetricKey,
  type ParsedMetricRow,
} from '../domain';
import { assertCan, type Actor } from './access';
import { auditMarketing } from './common';
import { getAccountByCode } from './accounts';

export const importMetricsBody = z
  .object({
    accountCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,5}$/),
    fileName: z.string().trim().min(1).max(200),
    /** CSV text (the browser reads the file; nothing is uploaded or stored as a file). */
    csv: z.string().min(1).max(5_000_000),
    dateFormat: z.enum(DATE_FORMATS),
    /** When the export was taken (lifetime numbers are as of this instant). Default: now. */
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

const FORMAT_BY_PLATFORM: Partial<Record<string, CsvFormatId>> = {
  instagram: 'instagram_meta_business_suite',
  youtube: 'youtube_studio_table_data',
};

interface MatchResult {
  status: MatchStatus;
  placementId: string | null;
  suggestedPlacementId: string | null;
}

async function matchRows(db: Database, accountId: string, rows: readonly ParsedMetricRow[]) {
  const placements = await db
    .select({
      id: marketingPlacements.id,
      url: marketingPlacements.publishedUrl,
      publishedAt: marketingPlacements.publishedAt,
      status: marketingPlacements.status,
    })
    .from(marketingPlacements)
    .where(
      and(
        eq(marketingPlacements.accountId, accountId as never),
        eq(marketingPlacements.status, 'published'),
      ),
    );
  const byUrl = new Map(placements.filter((p) => p.url).map((p) => [p.url!, p.id as string]));
  const byDay = new Map<string, string[]>();
  for (const p of placements) {
    if (!p.publishedAt) continue;
    const d = istDate(p.publishedAt);
    byDay.set(d, [...(byDay.get(d) ?? []), p.id]);
  }
  const out = new Map<number, MatchResult>();
  for (const r of rows) {
    const exact = r.link ? byUrl.get(r.link) : undefined;
    if (exact) {
      out.set(r.rowNumber, {
        status: 'matched_link',
        placementId: exact,
        suggestedPlacementId: null,
      });
      continue;
    }
    const sameDay = byDay.get(r.publishedOn) ?? [];
    out.set(
      r.rowNumber,
      sameDay.length === 1
        ? { status: 'suggested_title_date', placementId: null, suggestedPlacementId: sameDay[0]! }
        : { status: 'unmatched', placementId: null, suggestedPlacementId: null },
    );
  }
  return out;
}

function valueRows(snapshotId: string, metrics: Record<MetricKey, MetricCell>) {
  return METRIC_KEYS.map((metric) => ({
    snapshotId: snapshotId as never,
    metric,
    value: metrics[metric].value,
    state: metrics[metric].state,
    basis: metrics[metric].basis,
  }));
}

export async function importMetricsCsv(
  db: Database,
  actor: Actor,
  input: z.output<typeof importMetricsBody>,
  requestId?: string,
  now: Date = new Date(),
) {
  assertCan(actor, 'marketing:metrics:import');
  const account = await getAccountByCode(db, input.accountCode);
  const expectedFormat = FORMAT_BY_PLATFORM[account.platform];
  if (!expectedFormat) {
    throw new ValidationError(
      `No CSV importer exists for ${account.platform} (${account.code}); only Instagram and YouTube exports are supported.`,
    );
  }
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : now;
  if (capturedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new ValidationError('The capture time cannot be in the future.');
  }
  const parsed = parseMetricsCsv(input.csv, { dateFormat: input.dateFormat, expectedFormat });
  if (parsed.errors.length) {
    throw new ValidationError(parsed.errors.join(' '), { details: { errors: parsed.errors } });
  }
  const fileSha256 = createHash('sha256').update(input.csv).digest('hex');
  const [previous] = await db
    .select()
    .from(marketingMetricImports)
    .where(
      and(
        eq(marketingMetricImports.accountId, account.id),
        eq(marketingMetricImports.fileSha256, fileSha256),
      ),
    );
  const matches = await matchRows(db, account.id, parsed.rows);
  const report = {
    accountCode: account.code,
    format: parsed.format,
    dateFormat: input.dateFormat,
    capturedAt: capturedAt.toISOString(),
    headerMap: parsed.headerMap,
    rowsTotal: parsed.rows.length + parsed.rejected.length + parsed.skipped.length,
    rowsAccepted: parsed.rows.length,
    rowsRejected: parsed.rejected.length,
    rowsSkipped: parsed.skipped.length,
    rejected: parsed.rejected,
    skipped: parsed.skipped,
    rows: parsed.rows.slice(0, 200).map((r) => ({ ...r, match: matches.get(r.rowNumber)! })),
    matchCounts: {
      matched_link: [...matches.values()].filter((m) => m.status === 'matched_link').length,
      suggested_title_date: [...matches.values()].filter((m) => m.status === 'suggested_title_date')
        .length,
      unmatched: [...matches.values()].filter((m) => m.status === 'unmatched').length,
    },
  };
  if (previous) return { ...report, dryRun: input.dryRun, duplicate: true, importId: previous.id };
  if (input.dryRun) return { ...report, dryRun: true, duplicate: false, importId: null };

  return withTransaction(db, async (tx) => {
    const [imp] = await tx
      .insert(marketingMetricImports)
      .values({
        accountId: account.id,
        fileName: input.fileName,
        fileSha256,
        format: parsed.format!,
        dateFormat: input.dateFormat,
        capturedAt,
        rowsTotal: report.rowsTotal,
        rowsAccepted: report.rowsAccepted,
        rowsRejected: report.rowsRejected,
        rowsSkipped: report.rowsSkipped,
        rejected: parsed.rejected as unknown as object,
        importedBy: actor.id,
      })
      .returning();
    for (const r of parsed.rows) {
      const m = matches.get(r.rowNumber)!;
      const [snap] = await tx
        .insert(marketingMetricSnapshots)
        .values({
          importId: imp!.id,
          source: 'csv_import',
          sourceLabel: `${parsed.format} export "${input.fileName}"`,
          accountId: account.id,
          placementId: m.placementId as MarketingPlacementId | null,
          suggestedPlacementId: m.suggestedPlacementId as MarketingPlacementId | null,
          matchStatus: m.status,
          postKey: r.postKey,
          postLink: r.link,
          postTitle: r.title,
          publishedOn: r.publishedOn,
          platformFormat: r.platformFormat,
          formatEstimated: r.formatEstimated,
          capturedAt,
          capturedPrecision: 'instant',
          window: 'lifetime_at_capture',
          sourceRow: r.rowNumber,
        })
        .onConflictDoUpdate({
          target: [
            marketingMetricSnapshots.accountId,
            marketingMetricSnapshots.postKey,
            marketingMetricSnapshots.capturedAt,
            marketingMetricSnapshots.source,
          ],
          set: {
            importId: imp!.id,
            placementId: m.placementId as MarketingPlacementId | null,
            matchStatus: m.status,
            sourceRow: r.rowNumber,
          },
        })
        .returning({ id: marketingMetricSnapshots.id });
      await tx.delete(marketingMetricValues).where(eq(marketingMetricValues.snapshotId, snap!.id));
      await tx.insert(marketingMetricValues).values(valueRows(snap!.id, r.metrics));
    }
    await auditMarketing(tx, actor, {
      action: 'metrics.imported',
      entityType: 'metric_import',
      entityId: imp!.id,
      after: {
        fileName: input.fileName,
        fileSha256,
        rowsAccepted: report.rowsAccepted,
        rowsRejected: report.rowsRejected,
      },
      requestId,
    });
    return { ...report, dryRun: false, duplicate: false, importId: imp!.id };
  });
}

export async function listMetricImports(db: Database) {
  return db
    .select({ imp: marketingMetricImports, accountCode: marketingSocialAccounts.code })
    .from(marketingMetricImports)
    .innerJoin(
      marketingSocialAccounts,
      eq(marketingSocialAccounts.id, marketingMetricImports.accountId),
    )
    .orderBy(desc(marketingMetricImports.createdAt))
    .limit(100);
}
