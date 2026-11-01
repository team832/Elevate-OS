/**
 * Owner, 31 Oct 2026: fill Marketing, every data point. Content on sample ideas, walked through the
 * real services so versions, reviews, approvals, comments, assets, assignments, placements, groups,
 * sandbox runs and recorded publications are genuine: draft, in review, changes requested, approved,
 * scheduled, published, on hold and archived. Links are on example.test; numbers come from a made-up
 * export of made-up posts. Tables with no is_sample column are recorded with markSampleRows, and
 * db:clear-samples removes exactly those (a real item under a sample idea still stops the clear).
 * Written once: sample-marked content is the marker. Personal settings live here too.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  auditEvents,
  marketingCalendarItems,
  marketingCampaigns,
  marketingContentItems,
  marketingIdeas,
  marketingMetricImports,
  marketingMetricSnapshots,
  marketingMetricValues,
  marketingPlacements,
  marketingPublishingAttempts,
  marketingPublishingRecords,
  marketingSocialAccounts,
  marketingTargets,
  staffMembers,
  userPreferences,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { markSampleRows, POOJA_EMAIL, ROHIT_EMAIL, SAMPLE_MARKETING_MANAGER_EMAIL, sampleRowIds } from '@elevate/database/seed';
import { addDays, toIsoDate, type IsoDate, type RoleKey, type UserId } from '@elevate/shared-types';
import type { Actor } from '../src/server/access';
import { addComment, addVersion, archiveContentItem, createContentItem, decideContent, setAssignment, submitForReview } from '../src/server/content';
import { createPlacementGroup, setPlacementCampaign } from '../src/server/groups';
import { changeIdeaStatus, createIdea } from '../src/server/ideas';
import { createPlacement, publishPlacement, recordManualPublication, schedulePlacement } from '../src/server/placements';

const anchor = () => (process.env.SAMPLE_ANCHOR_DATE || toIsoDate()) as IsoDate;
const at = (day: number, time = '11:00') => new Date(`${addDays(anchor(), day)}T${time}:00+05:30`);

async function actorOf(db: Database, email: string): Promise<(Actor & { staffId: string | null }) | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id));
  const [s] = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.userId, u.id));
  return { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey), staffId: s?.id ?? null };
}

/** More proposals, one in each state not yet shown. [prefix, title, need, then]. */
const MORE_IDEAS: readonly [string, string, string, 'approved' | 'rejected' | 'archived'][] = [
  ['CLAT', 'How to read a legal passage in five minutes', 'Students ask how to get through long passages in time.', 'approved'],
  ['CLAT', 'Current affairs: what to skip', 'Families worry that the news is endless; show what the paper actually asks.', 'approved'],
  ['IPMAT', 'Percentages without a calculator', 'Quant students lose time on simple percentages.', 'approved'],
  ['CUET', 'Choosing your CUET subjects', 'Class 12 students ask which subject combinations keep options open.', 'approved'],
  ['COM', 'Class 11 commerce: the first month', 'Parents ask what a new commerce student should expect.', 'approved'],
  ['GEN', 'A week in the life of a batch', 'New families ask how a normal week runs.', 'approved'],
  ['COM', 'Accountancy tricks that do not last', 'Duplicate of an older idea on revision habits.', 'rejected'],
  ['IPMAT', 'IPMAT versus school exams', 'Overlaps with the webinar series; kept for later.', 'archived'],
];

/**
 * [idea title, format, title, accounts, state]. Account codes obey the idea's scope; every state an
 * item can be in appears at least once.
 */
const ITEMS: readonly (readonly [string, string, string, readonly string[], 'draft' | 'in_review' | 'changes' | 'approved' | 'scheduled' | 'published' | 'hold' | 'archived'])[] = [
  ['How to read a legal passage in five minutes', 'video_brief', 'Read a legal passage in five minutes', ['IGC', 'YTC'], 'published'],
  ['Current affairs: what to skip', 'carousel', 'What to skip in current affairs', ['IGC'], 'scheduled'],
  ['Percentages without a calculator', 'video_brief', 'Percentages without a calculator', ['IGI', 'YTI'], 'published'],
  ['IPMAT quantitative practice', 'post', 'Daily Quant question: mixture and ratio', ['IGI'], 'approved'],
  ['Choosing your CUET subjects', 'carousel', 'Choosing your CUET subjects', ['IGU'], 'in_review'],
  ['Class 11 commerce: the first month', 'caption', 'Class 11 commerce: what the first month looks like', ['IGU', 'YTU'], 'changes'],
  ['A week in the life of a batch', 'script', 'A week in the life of a batch', ['IGS'], 'draft'],
  ['Admission webinar', 'post', 'Admission webinar: how to register', ['IGC', 'IGU'], 'published'],
  ['Teacher-led doubt-solving session', 'video_brief', 'A teacher answers your doubts', ['IGS'], 'hold'],
  ['CA Accounts concept explainer', 'image', 'CA Foundation: what a ledger is', ['LIP'], 'archived'],
];

const BODY = (title: string, line: string) =>
  `${title}.\n\n${line}\n\nAsk at the front desk or write to us for the class timings. No result is promised here; what a student gains depends on their own work.`;
const LINES = [
  'Three short steps a student can try tonight, in plain words.',
  'One worked question from start to finish, then one for you to try.',
  'The common mistakes we see in class, and how to avoid them.',
  'What a normal week looks like and what we ask of families.',
];
const COMMENTS = [
  'Can we shorten the first line? It reads long on a phone.',
  'Please check this against the course page wording.',
  'Good. Keep the last line as it is.',
  'The image needs a clearer heading.',
];

const assets = (slug: string, i: number) => [
  { fileName: `${slug}-cover.png`, mimeType: 'image/png', sizeBytes: 182_000 + i * 900, externalUrl: `https://example.test/assets/${slug}-cover.png`, rightsState: 'own' as const, showsStudents: false },
  ...(i % 2 ? [{ fileName: `${slug}-clip.mp4`, mimeType: 'video/mp4', sizeBytes: 9_400_000 + i * 12_000, externalUrl: `https://example.test/assets/${slug}-clip.mp4`, rightsState: 'third_party_cleared' as const, showsStudents: false }] : []),
];

export async function seedFillContent(db: Database, log: (m: string) => void = () => {}) {
  if ((await sampleRowIds(db, 'marketing.content_items')).length)
    return log('marketing.fill-content skipped: sample content exists');
  const [manager, pooja, rohit, contributor] = await Promise.all(
    [SAMPLE_MARKETING_MANAGER_EMAIL, POOJA_EMAIL, ROHIT_EMAIL, 'marketing-contributor@example.test'].map((e) => actorOf(db, e)),
  );
  if (!manager || !pooja || !rohit) return log('marketing.fill-content skipped: marketing staff missing');
  const writers = [pooja, rohit, contributor ?? pooja];

  for (const [i, [coursePrefix, title, problemNeed, then]] of MORE_IDEAS.entries()) {
    const writer = writers[i % writers.length]!;
    const { idea } = await createIdea(db, writer, {
      title,
      coursePrefix,
      problemNeed,
      audience: 'Students and parents in and around Sikar',
      hypothesis: 'If it answers the question plainly, more families will ask for a demo class.',
      expectedOutcome: 'More enquiries from the audience named, to be measured.',
      effort: 'm',
      ownerStaffId: writer.staffId,
    } as never);
    await db.update(marketingIdeas).set({ isSample: true }).where(eq(marketingIdeas.id, idea.id));
    if (then === 'rejected') {
      await changeIdeaStatus(db, manager, idea.id, { status: 'rejected', reason: problemNeed } as never);
      continue;
    }
    await changeIdeaStatus(db, writer, idea.id, { status: 'submitted' });
    await changeIdeaStatus(db, manager, idea.id, { status: 'approved' });
    if (then === 'archived')
      await changeIdeaStatus(db, manager, idea.id, { status: 'archived', reason: problemNeed } as never);
  }

  const ideas = await db.select().from(marketingIdeas).where(eq(marketingIdeas.isSample, true));
  const [campaign] = await db.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(eq(marketingCampaigns.isSample, true)).limit(1);
  const contentIds: string[] = [];
  const placementIds: string[] = [];
  const groupIds: string[] = [];
  const published: { placementId: string; accountId: string; title: string; on: string; url: string | null }[] = [];
  for (const [i, [ideaTitle, format, title, accounts, state]] of ITEMS.entries()) {
    const idea = ideas.find((x) => x.title === ideaTitle);
    if (!idea) continue;
    const writer = writers[i % writers.length]!;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    const item = await createContentItem(db, writer, idea.id, {
      title,
      format,
      initialVersion: { title, body: BODY(title, LINES[i % LINES.length]!), assets: assets(slug, i), showsStudents: false, changeNote: 'First draft.' },
    } as never);
    contentIds.push(item.id);
    await setAssignment(db, manager, item.id, { role: 'writer', staffMemberId: writer.staffId } as never);
    await setAssignment(db, manager, item.id, { role: i % 2 ? 'editor' : 'designer', staffMemberId: writers[(i + 1) % writers.length]!.staffId } as never);
    await addComment(db, manager, item.id, { body: COMMENTS[i % COMMENTS.length]! } as never);
    if (state !== 'draft') {
      const second = await addVersion(db, writer, item.id, {
        title,
        body: BODY(title, `${LINES[(i + 1) % LINES.length]!} Shortened after the first comments.`),
        assets: assets(slug, i),
        showsStudents: false,
        changeNote: 'Shortened after comments.',
      } as never);
      await addComment(db, writer, item.id, { body: 'Shortened the opening; please check this version.', versionId: second.version.id } as never);
    }
    const placements: { id: string; account: string }[] = [];
    for (const account of accounts) {
      const { placement } = await createPlacement(db, writer, item.id, { accountCode: account } as never);
      placements.push({ id: placement.id, account });
      placementIds.push(placement.id);
    }
    // Two Instagram accounts posting one collab: a group, before anything is scheduled.
    if (placements.length > 1 && accounts.every((a) => a.startsWith('IG'))) {
      const made = await createPlacementGroup(db, manager, {
        ideaId: idea.id,
        platform: 'instagram',
        placementIds: placements.map((p) => p.id),
      });
      groupIds.push(made.group.id);
    }
    if (campaign && placements[0]) await setPlacementCampaign(db, manager, placements[0].id, campaign.id);
    if (state === 'draft') continue;
    if (state === 'archived') {
      await archiveContentItem(db, manager, item.id, 'The topic moved into the CA Foundation webinar series.');
      continue;
    }
    if (state === 'hold') {
      await db.execute(sql`UPDATE marketing.content_items SET hold_reason = 'Waiting for the teacher to agree a recording date.', hold_since = ${at(-3)} WHERE id = ${item.id}`);
      continue;
    }
    const { ruleCheck } = await submitForReview(db, writer, item.id, 'Ready for your review.');
    if (state === 'in_review') continue;
    const acknowledgedRuleCodes = (ruleCheck?.checklist ?? []).map((c: { ruleCode: string }) => c.ruleCode);
    if (state === 'changes') {
      await decideContent(db, manager, item.id, { decision: 'request_changes', comment: 'Please add where the parent can ask for class timings.', acknowledgedRuleCodes: [] });
      continue;
    }
    await decideContent(db, manager, item.id, { decision: 'approve', comment: 'Approved; no result claims, wording fine.', acknowledgedRuleCodes });
    if (state === 'approved') continue;
    const [first] = placements;
    if (state === 'scheduled') {
      for (const [k, p] of placements.entries())
        await schedulePlacement(db, manager, p.id, { publishAt: at(3 + k * 2, '18:30').toISOString() });
      if (first) await publishPlacement(db, manager, first.id); // a sandbox run: nothing is posted
      continue;
    }
    for (const p of placements) {
      await schedulePlacement(db, manager, p.id, { publishAt: at(5 + i, '10:30').toISOString() });
      const url = `https://example.test/posts/${slug}-${p.account.toLowerCase()}`;
      const on = at(-8 + i, '18:30');
      await recordManualPublication(db, manager, p.id, { publishedAt: on.toISOString(), url });
      const [a] = await db.select({ id: marketingSocialAccounts.id }).from(marketingSocialAccounts).where(eq(marketingSocialAccounts.code, p.account));
      published.push({ placementId: p.id, accountId: a!.id, title, on: addDays(anchor(), -8 + i), url });
    }
  }
  await markSampleRows(db, 'marketing.content_items', contentIds);
  await markSampleRows(db, 'marketing.placements', placementIds);
  await markSampleRows(db, 'marketing.placement_groups', groupIds);

  // One failed adapter run on a planned placement, then the numbers of the published posts.
  const [planned] = await db
    .select({ id: marketingPlacements.id, version: marketingContentItems.currentVersionId })
    .from(marketingPlacements)
    .innerJoin(marketingContentItems, eq(marketingContentItems.id, marketingPlacements.contentItemId))
    .where(
      and(
        inArray(marketingPlacements.id, placementIds as never[]),
        eq(marketingPlacements.status, 'planned'),
        isNotNull(marketingContentItems.currentVersionId),
      ),
    )
    .limit(1);
  if (planned) {
    const [record] = await db
      .insert(marketingPublishingRecords)
      .values({
        placementId: planned.id as never,
        versionId: planned.version as never,
        idempotencyKey: `placement:${planned.id}:version:${planned.version}`,
        adapter: 'mock',
        status: 'failed',
        attempts: 2,
        maxAttempts: 3,
        isSandbox: true,
        lastError: 'The sandbox refused the file size; try a smaller image.',
        lastResponse: { message: 'Sandbox run; nothing was posted.' },
        requestedBy: manager.id,
      })
      .returning({ id: marketingPublishingRecords.id });
    await db.insert(marketingPublishingAttempts).values(
      [1, 2].map((attemptNumber) => ({
        recordId: record!.id,
        attemptNumber,
        outcome: 'failed' as const,
        error: 'The sandbox refused the file size; try a smaller image.',
        attemptedAt: at(-3 + attemptNumber),
        attemptedBy: manager.id,
      })),
    );
  }

  const byAccount = new Map<string, typeof published>();
  for (const p of published) byAccount.set(p.accountId, [...(byAccount.get(p.accountId) ?? []), p]);
  for (const [accountId, posts] of byAccount) {
    const file = `Post export ${posts[0]!.title}.csv`;
    const [imp] = await db
      .insert(marketingMetricImports)
      .values({
        accountId: accountId as never,
        fileName: file,
        fileSha256: createHash('sha256').update(file).digest('hex'),
        format: 'csv',
        dateFormat: 'YYYY-MM-DD',
        capturedAt: at(-1, '09:00'),
        rowsTotal: posts.length,
        rowsAccepted: posts.length,
        rowsRejected: 0,
        rejected: [],
        importedBy: manager.id,
      } as never)
      .returning({ id: marketingMetricImports.id });
    await markSampleRows(db, 'marketing.metric_imports', [imp!.id]);
    for (const [i, p] of posts.entries()) {
      const [snap] = await db
        .insert(marketingMetricSnapshots)
        .values({
          importId: imp!.id,
          source: 'csv_import',
          sourceLabel: file,
          accountId: accountId as never,
          placementId: p.placementId as never,
          matchStatus: 'matched_link',
          postKey: p.url ?? `${p.title}|${p.on}`,
          postLink: p.url,
          postTitle: p.title,
          publishedOn: p.on,
          platformFormat: 'Reel',
          capturedAt: at(-1, '09:00'),
          sourceRow: i + 2,
          notes: 'Figures from a made-up export of a made-up post.',
        } as never)
        .returning({ id: marketingMetricSnapshots.id });
      const base = 400 + (p.title.length * 37) % 900;
      await db.insert(marketingMetricValues).values(
        (
          [
            ['views', base * 3],
            ['likes', Math.round(base * 0.22)],
            ['comments', Math.round(base * 0.02)],
            ['shares', Math.round(base * 0.05)],
          ] as const
        ).map(([metric, value]) => ({ snapshotId: snap!.id, metric, value, state: 'reported' as const, basis: 'Export column' })),
      );
    }
  }

  // Calendar items that point at their content, with reviewer's notes and links.
  const calendar = await db.select().from(marketingCalendarItems).where(eq(marketingCalendarItems.isSample, true));
  const items = await db.select().from(marketingContentItems).where(inArray(marketingContentItems.id, contentIds as never[]));
  for (const [i, c] of calendar.entries()) {
    const item = items[i % Math.max(items.length, 1)];
    await db
      .update(marketingCalendarItems)
      .set({
        contentItemId: i % 2 && item ? item.id : c.contentItemId,
        assetLinks: [`https://example.test/assets/calendar-${i + 1}.png`],
        reviewNote: c.approvedAt ? 'Checked the wording; fine to go.' : c.reviewNote,
        publishedUrl: c.publishedAt ? `https://example.test/posts/calendar-${i + 1}` : c.publishedUrl,
      })
      .where(eq(marketingCalendarItems.id, c.id));
  }

  // Targets for the team next to the existing ones: an earlier month, so a comparison has two periods.
  const targets = await db.select().from(marketingTargets).where(eq(marketingTargets.isSample, true));
  const known = new Set(targets.map((t) => t.periodStart));
  if (targets.length && known.size === 1) {
    const start = addDays(targets[0]!.periodStart as IsoDate, -30);
    await db.insert(marketingTargets).values(
      targets.map(({ id: _i, createdAt: _c, updatedAt: _u, ...t }) => ({
        ...t,
        periodStart: start,
        periodEnd: addDays(targets[0]!.periodStart as IsoDate, -1),
        targetValue: Math.max(1, Math.round(Number(t.targetValue) * 0.8)),
        note: `${t.note ?? ''} Last month’s figure.`.trim(),
      })) as never,
    );
  }

  // Personal settings: the people who use the Marketing workspace, their own rows only.
  const prefs: Record<string, unknown>[] = [
    { calendarView: 'week', goals: ['Finish the CLAT reel series', 'Reply to every comment within a day'], checklist: [{ label: 'Check the calendar', done: true }, { label: 'Clear my reviews', done: false }], workingHours: { start: '10:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }, focusBlocks: [{ day: 'tue', start: '11:00', end: '12:30', label: 'Writing' }] },
    { calendarView: 'list', goals: ['Two posts a week for each programme'], checklist: [{ label: 'Read the morning list', done: true }], workingHours: { start: '09:30', end: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, focusBlocks: [] },
    { calendarView: 'month', goals: ['Keep the follow-up list under ten'], checklist: [], workingHours: null, focusBlocks: [{ day: 'thu', start: '15:00', end: '16:00', label: 'Follow-ups' }] },
  ];
  const owners = [manager, pooja, rohit, contributor].filter(Boolean) as Actor[];
  const saved = await db
    .insert(userPreferences)
    .values(
      owners.map((o, i) => ({
        userId: o.id,
        settings: {
          marketing: prefs[i % prefs.length]!,
          notifications: { reminderIntervalHours: i % 2 ? 4 : null, popUps: i !== 1 },
        },
      })),
    )
    .onConflictDoNothing()
    .returning({ id: userPreferences.userId });
  await markSampleRows(db, 'core.user_preferences', saved.map((s) => s.id));
  await db.insert(auditEvents).values(
    saved.map((s) => ({
      at: at(-12),
      actorType: 'user' as const,
      actorUserId: s.id,
      module: 'marketing' as const,
      action: 'user_preferences.updated',
      entityType: 'user_preferences',
      entityId: s.id,
    })),
  );
  log(`marketing.fill-content: ${contentIds.length} content item(s), ${placementIds.length} placement(s), ${published.length} recorded publication(s)`);
}
