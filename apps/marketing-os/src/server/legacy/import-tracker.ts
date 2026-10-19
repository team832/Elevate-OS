/**
 * Legacy import, part 2 (MKT-034): ideas.csv and versions.csv.
 * - Rows sharing a legacy ID (CLAT-027, GEN-012, CUET-002, COM-005) are QUARANTINED: no
 *   live code; the proposed renumbering is stored as `proposed` and reserved, never applied
 *   (OD-003). Placements pointing at those IDs are imported as ambiguous, linked to the
 *   quarantine by legacy ID only.
 * - Each other placement becomes one content item (title = legacy idea title, state mapped
 *   from the legacy status, raw word kept) and one placement with the legacy version ID.
 * - Idempotent by `legacy_ref` (source path + line); existing rows are left untouched.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  marketingContentItems,
  marketingIdeas,
  marketingPlacements,
  marketingSocialAccounts,
  type Database,
} from '@elevate/database';
import {
  COURSE_PREFIXES,
  legacyIstDateTime,
  mapLegacyFormat,
  mapLegacyIdeaScope,
  mapLegacyIdeaStatus,
  mapLegacyPlacementStatus,
  normalizeTitle,
  parsePlacementCode,
  type CoursePrefix,
} from '../../domain';
import { bumpCounter } from '../codes';
import type { ImportCount } from './import-registry';
import { sourceRef, type LegacyIdeasFile, type LegacyPlacementsFile } from './types';

export async function importLegacyIdeas(
  db: Database,
  file: LegacyIdeasFile,
): Promise<ImportCount & { quarantined: number }> {
  const dupIds = new Set(file.duplicate_groups.map((g) => g.legacy_id));
  const rows = file.records.map((r) => {
    const prefix = r.course as CoursePrefix;
    if (!COURSE_PREFIXES.includes(prefix)) throw new Error(`Unknown course prefix ${r.course}`);
    const quarantined = dupIds.has(r.legacy_id);
    const group = file.duplicate_groups.find((g) => g.legacy_id === r.legacy_id);
    const { scope, scopePrefixes } = mapLegacyIdeaScope(prefix, r.pillar);
    return {
      code: quarantined ? null : r.legacy_id,
      coursePrefix: prefix,
      title: r.title,
      normalizedTitle: normalizeTitle(r.title),
      pillar: r.pillar,
      origin: r.origin,
      masterAsset: r.master_asset,
      scope,
      scopePrefixes,
      status: mapLegacyIdeaStatus(r.legacy_status),
      notes: r.notes,
      legacyCode: r.legacy_id,
      legacyStatus: r.legacy_status,
      legacyRef: sourceRef(r.source),
      quarantineState: quarantined ? ('quarantined' as const) : ('none' as const),
      quarantineReason: quarantined
        ? `Legacy ID ${r.legacy_id} is used by ${group?.occurrences.length ?? 2} rows (occurrence ${r.duplicate_occurrence ?? '?'}). Pending OD-003. ${group?.resolution_hint ?? ''}`.trim()
        : null,
      proposedCode: quarantined ? r.proposed_code : null,
      proposedCodeStatus: quarantined && r.proposed_code ? 'proposed' : null,
      provenance: {
        importedFrom: 'data/legacy/marketing/ideas.json',
        source: r.source,
        libraryFolders: r.library_folders,
      },
    };
  });
  const inserted = await db
    .insert(marketingIdeas)
    .values(rows)
    .onConflictDoNothing({ target: marketingIdeas.legacyRef })
    .returning({ id: marketingIdeas.id });
  // Reserve every legacy and proposed number so new codes start above them.
  for (const prefix of COURSE_PREFIXES) await bumpCounter(db, prefix);
  return {
    inserted: inserted.length,
    existing: rows.length - inserted.length,
    quarantined: rows.filter((r) => r.quarantineState === 'quarantined').length,
  };
}

export async function importLegacyPlacements(
  db: Database,
  file: LegacyPlacementsFile,
): Promise<ImportCount & { ambiguous: number; contentItems: number }> {
  const accounts = await db.select().from(marketingSocialAccounts);
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));
  const ideaCodes = [...new Set(file.records.map((r) => r.idea_legacy_id))];
  const ideas = await db
    .select()
    .from(marketingIdeas)
    .where(inArray(marketingIdeas.code, ideaCodes));
  const ideaByCode = new Map(ideas.map((i) => [i.code!, i]));
  const done = new Set(
    (await db.select({ ref: marketingPlacements.legacyRef }).from(marketingPlacements)).map(
      (r) => r.ref,
    ),
  );
  let inserted = 0;
  let ambiguous = 0;
  let contentItems = 0;
  for (const r of file.records) {
    const ref = sourceRef(r.source);
    if (r.ambiguous) ambiguous += 1;
    if (done.has(ref)) continue;
    const account = accountByCode.get(r.account_code);
    if (!account)
      throw new Error(`Legacy placement ${r.version_id}: unknown account ${r.account_code}`);
    const mapped = mapLegacyPlacementStatus(r.status);
    const at = legacyIstDateTime(r.date_ist, r.time_ist);
    const legacy = {
      legacyCode: r.version_id,
      legacyIdeaCode: r.idea_legacy_id,
      legacyStatus: r.legacy_status,
      legacyFormat: r.format,
      legacyDateRaw: r.date_ist_raw,
      legacyDatePrecision: r.date_precision,
      legacyLinkOrFile: r.link_or_file,
      legacyResult24h: r.result_24h_raw,
      legacyNotes: r.notes,
      legacyRef: ref,
      provenance: { importedFrom: 'data/legacy/marketing/placements.json', source: r.source },
    };
    // A scheduled row needs a time; without one it stays planned (the raw word is kept).
    const status =
      mapped.placementStatus === 'scheduled' && !at ? 'planned' : mapped.placementStatus;
    const timing = {
      originalPublishAt: at,
      scheduledAt: status === 'scheduled' ? at : null,
      publishedAt: status === 'published' ? at : null,
      publicationMode: status === 'published' ? ('legacy_reported' as const) : null,
    };
    if (r.ambiguous) {
      await db.insert(marketingPlacements).values({
        ...legacy,
        ...timing,
        code: null,
        ideaId: null,
        contentItemId: null,
        accountId: account.id,
        variant: r.variant,
        status,
        ambiguous: true,
        ambiguityReason: `${r.ambiguity_reason ?? 'Reused legacy idea ID'} — linked to the ${r.idea_legacy_id} quarantine (OD-003).`,
      });
      inserted += 1;
      continue;
    }
    const idea = ideaByCode.get(r.idea_legacy_id);
    if (!idea)
      throw new Error(`Legacy placement ${r.version_id}: idea ${r.idea_legacy_id} not imported`);
    const parsed = parsePlacementCode(r.version_id, [...accountByCode.keys()]);
    if (!parsed) throw new Error(`Legacy placement ${r.version_id} does not resolve to an account`);
    const itemRef = `${ref}#content-item`;
    let [item] = await db
      .select()
      .from(marketingContentItems)
      .where(eq(marketingContentItems.legacyRef, itemRef));
    if (!item) {
      [item] = await db
        .insert(marketingContentItems)
        .values({
          ideaId: idea.id,
          title: idea.title,
          format: mapLegacyFormat(r.format),
          state: mapped.contentState,
          holdReason: mapped.hold ? `Legacy status "${r.legacy_status}"` : null,
          holdSince: null,
          legacyStatus: r.legacy_status,
          legacyFormat: r.format,
          legacyRef: itemRef,
          provenance: { importedFrom: 'data/legacy/marketing/placements.json', source: r.source },
        })
        .returning();
      contentItems += 1;
    }
    await db.insert(marketingPlacements).values({
      ...legacy,
      ...timing,
      code: r.version_id,
      ideaId: idea.id,
      contentItemId: item!.id,
      accountId: account.id,
      variant: parsed.variant,
      status,
    });
    inserted += 1;
  }
  return { inserted, existing: file.records.length - inserted, ambiguous, contentItems };
}
