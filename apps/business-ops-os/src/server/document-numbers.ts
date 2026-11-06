/**
 * Gap-free document numbers (ops.document_counters; F4-01 receipts, F4-02 certificates). Taken in
 * the transaction that writes the document: the counter row stays locked until commit, and a
 * rollback gives the number back. Sample records count in their own series (`sample.<series>`,
 * printed "SAMPLE-…"), so removing samples leaves no gap in a real series.
 */
import { eq, sql } from 'drizzle-orm';
import { opsDocumentCounters, type Database } from '@elevate/database';

/**
 * shortcut: the tables' unique (year, sequence) keys hold one series per year, so a sample's
 * stored sequence is offset by this; a real series would need 900,000 documents in a year to meet it.
 */
const SAMPLE_SEQUENCE_OFFSET = 900_000;

/** The next number of `series` (e.g. `receipt/2026-27`) from 1, and the sequence to store. */
export async function takeNumber(tx: Database, series: string, sample = false) {
  const key = sample ? `sample.${series}` : series;
  await tx.insert(opsDocumentCounters).values({ series: key }).onConflictDoNothing();
  const [row] = await tx
    .update(opsDocumentCounters)
    .set({ nextValue: sql`${opsDocumentCounters.nextValue} + 1` })
    .where(eq(opsDocumentCounters.series, key))
    .returning({ taken: sql<number>`${opsDocumentCounters.nextValue} - 1` });
  const n = Number(row!.taken);
  return { n, sequence: sample ? SAMPLE_SEQUENCE_OFFSET + n : n, mark: sample ? 'SAMPLE-' : '' };
}
