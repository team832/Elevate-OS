/** Content item and version rows: version shape and hash, reads, state moves, version insert. */
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketingContentAssets,
  marketingContentItems,
  marketingContentVersions,
  type Database,
} from '@elevate/database';
import { InvalidStateTransitionError } from '@elevate/server-kit';
import { httpUrlSchema } from '@elevate/shared-contracts';
import type { ContentItemId } from '@elevate/shared-types';
import { RIGHTS_STATES, transitionContent, type ContentAction, type ContentState } from '../domain';
import type { Actor } from './access';
import { rowById } from './common';
import { assertContentVisible } from './scope';

export type ContentItemRow = typeof marketingContentItems.$inferSelect;
export type ContentVersionRow = typeof marketingContentVersions.$inferSelect;

const assetSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z
      .string()
      .trim()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'A MIME type such as image/png'),
    sizeBytes: z.int().min(0).max(5_000_000_000).nullable().optional(),
    externalUrl: httpUrlSchema.max(2000).nullable().optional(),
    showsStudents: z.boolean().default(false),
    rightsState: z.enum(RIGHTS_STATES).default('own'),
  })
  .strict();

export const versionBody = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(20_000),
    assets: z.array(assetSchema).max(30).default([]),
    showsStudents: z.boolean().default(false),
    consentReference: z.string().trim().max(200).nullable().optional(),
    changeNote: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type VersionInput = z.output<typeof versionBody>;

/** SHA-256 over a canonical JSON of what the approver sees. */
export function hashVersion(input: {
  title: string;
  body: string;
  showsStudents: boolean;
  consentReference: string | null;
  assets: readonly z.output<typeof assetSchema>[];
}): string {
  const canonical = JSON.stringify({
    title: input.title,
    body: input.body,
    showsStudents: input.showsStudents,
    consentReference: input.consentReference,
    assets: [...input.assets]
      .map((a) => [
        a.fileName,
        a.mimeType,
        a.sizeBytes ?? null,
        a.externalUrl ?? null,
        a.showsStudents,
        a.rightsState,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** One content item; with `actor`, NOT_FOUND unless it is in their scope (scope.ts). */
export async function getContentItem(db: Database, id: string, lock = false, actor?: Actor) {
  const item = await rowById(db, marketingContentItems, id, 'Content item not found.', lock);
  if (actor) await assertContentVisible(db, actor, item.id);
  return item;
}

export const lockItem = (db: Database, id: string, actor: Actor) =>
  getContentItem(db, id, true, actor);

export async function setItem(
  tx: Database,
  id: ContentItemId,
  set: Partial<typeof marketingContentItems.$inferInsert>,
) {
  const [row] = await tx
    .update(marketingContentItems)
    .set(set)
    .where(eq(marketingContentItems.id, id))
    .returning();
  return row!;
}

export const getVersion = (db: Database, id: string) =>
  rowById(db, marketingContentVersions, id, 'Version not found.');

export function nextState(state: ContentState, action: ContentAction): ContentState {
  const t = transitionContent(state, action);
  if (!t.ok)
    throw new InvalidStateTransitionError(t.reason, {
      details: { from: t.from, action: t.action },
    });
  return t.to;
}

export async function insertVersion(
  tx: Database,
  actor: Actor,
  item: ContentItemRow,
  input: VersionInput,
): Promise<ContentVersionRow> {
  const [last] = await tx
    .select({ n: marketingContentVersions.versionNumber })
    .from(marketingContentVersions)
    .where(eq(marketingContentVersions.contentItemId, item.id))
    .orderBy(desc(marketingContentVersions.versionNumber))
    .limit(1);
  const title = input.title ?? item.title;
  const consentReference = input.consentReference?.trim() || null;
  const [version] = await tx
    .insert(marketingContentVersions)
    .values({
      contentItemId: item.id,
      versionNumber: (last?.n ?? 0) + 1,
      title,
      body: input.body,
      contentHash: hashVersion({
        title,
        body: input.body,
        showsStudents: input.showsStudents,
        consentReference,
        assets: input.assets,
      }),
      showsStudents: input.showsStudents,
      consentReference,
      changeNote: input.changeNote ?? null,
      authorUserId: actor.id,
    })
    .returning();
  if (input.assets.length > 0) {
    await tx.insert(marketingContentAssets).values(
      input.assets.map((a) => ({
        versionId: version!.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes ?? null,
        externalUrl: a.externalUrl ?? null,
        showsStudents: a.showsStudents,
        rightsState: a.rightsState,
      })),
    );
  }
  return version!;
}
