/**
 * Owner, 31 Oct 2026: fill Marketing. The sample campaigns, ideas, calendar items, SEO/AIO/GEO items
 * and targets get real words instead of "Sample brief", and the week gets more planned work. Nothing
 * here claims a publication, a connection or a figure: published items keep their "nothing was
 * posted" evidence, observations say they were typed by hand, and the one metrics import is a file
 * whose rows were all rejected, so it adds no metric (markSampleRows records it: the table has no
 * is_sample column). Sample rows only; safe to run again.
 */
import { createHash } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  marketingCalendarItems,
  marketingCampaigns,
  marketingMetricImports,
  marketingOptimisationItems,
  marketingSocialAccounts,
  programmes,
  staffMembers,
  users,
  userRoles,
  type Database,
} from '@elevate/database';
import {
  markSampleRows,
  POOJA_EMAIL,
  ROHIT_EMAIL,
  SAMPLE_MARKETING_MANAGER_EMAIL,
} from '@elevate/database/seed';
import { addDays, toIsoDate, type IsoDate, type RoleKey, type UserId } from '@elevate/shared-types';
import type { CalendarAction } from '../src/domain/calendar';
import type { Actor } from '../src/server/access';
import { actOnCalendarItem, createCalendarItem } from '../src/server/calendar';
import { addObservation, createOptimisationItem } from '../src/server/optimisation';

const METRICS_FILE = 'Instagram export, October.csv';
const CHANNELS = {
  social_post: 'instagram',
  short_video: 'instagram',
  article: 'website',
  email_draft: 'email',
  landing_page_update: 'website',
  seminar: 'in_person',
} as const;

/** Calendar words by title: [brief, audience, programme]. */
const CALENDAR_TEXT: Readonly<Record<string, [string, string, string]>> = {
  'CUET general test tips carousel': [
    'Five slides on how to split time across the general test. Keep each slide to one idea.',
    'Class 12 students taking CUET',
    'CUET',
  ],
  'CLAT weekly quiz reel': [
    'A 30-second reel with three current-affairs questions from the week, answers at the end.',
    'CLAT aspirants in Class 11 and 12',
    'CLAT',
  ],
  'IPMAT mock analysis article': [
    'How to read a mock result: which sections to redo, and how to track mistakes. No score claims.',
    'IPMAT aspirants and parents',
    'IPMAT',
  ],
  'CA Foundation open-house poster': [
    'Poster for the open house: date, place and what families will see. No result claims.',
    'Class 12 commerce students and parents',
    'CA_FOUNDATION',
  ],
  'IPMAT webinar invitation email': [
    'Invitation to the parents’ webinar: what it covers and how to register. Draft only.',
    'Families who asked about IPMAT',
    'IPMAT',
  ],
  'Class 12 Maths revision tips post': [
    'Three revision habits for board Maths, in plain words.',
    'Class 12 students',
    'CLASS_12',
  ],
  'IPMAT webinar landing page update': [
    'Add the webinar date and the registration steps to the course page.',
    'Visitors to the IPMAT page',
    'IPMAT',
  ],
  'CLAT seminar at a partner school': [
    'A one-hour talk on what CLAT tests, at a partner school.',
    'Class 11 students at the school',
    'CLAT',
  ],
  'IPMAT quantitative practice': [
    'A short daily-practice video using one percentage question.',
    'Class 12 students preparing for IPMAT',
    'IPMAT',
  ],
  'Class 11 commerce: which stream after school': [
    'A short guide to the choices after Class 12 commerce.',
    'Class 11 commerce students and parents',
    'CLASS_11',
  ],
  'Monday motivation from a teacher': [
    'A teacher’s one-minute tip on keeping a study routine.',
    'All students',
    'CLAT',
  ],
  'CA Foundation fee instalment explainer': [
    'What instalments mean and when they fall due. Uses no figures.',
    'Parents asking about CA Foundation',
    'CA_FOUNDATION',
  ],
  'CLAT reading practice reel': [
    'One passage, one question, thirty seconds.',
    'CLAT aspirants',
    'CLAT',
  ],
};

/** More of this week: [title, type, owner, day, actions]. */
const MORE_CALENDAR: readonly [string, keyof typeof CHANNELS, string, number, CalendarAction[]][] =
  [
    ['Class 11 commerce: which stream after school', 'article', POOJA_EMAIL, 1, ['start']],
    ['Monday motivation from a teacher', 'short_video', ROHIT_EMAIL, 2, ['start', 'submit']],
    ['CA Foundation fee instalment explainer', 'social_post', POOJA_EMAIL, 3, []],
    [
      'CLAT reading practice reel',
      'short_video',
      ROHIT_EMAIL,
      4,
      ['start', 'submit', 'approve', 'schedule'],
    ],
  ];

/** Extra SEO/AIO/GEO work: [category, topic, query, platform, what was seen]. */
const MORE_SEO: readonly [string, string, string, string, string][] = [
  [
    'seo',
    'CA Foundation course page',
    'CA Foundation coaching in Sikar',
    'Google search',
    'The page appeared on the second results page.',
  ],
  [
    'aio',
    'Class 12 commerce page',
    'best commerce coaching near Sikar',
    'Chat assistant',
    'The answer named two other institutes and not this one.',
  ],
];

const FILLS = (programmeOf: (c: string) => string | null) => [
  sql`UPDATE marketing.campaigns SET
      audience = coalesce(audience, CASE code
        WHEN 'IPMAT-WEBINAR' THEN 'Class 12 students and parents asking about IPMAT'
        WHEN 'CLAT-CA-SERIES' THEN 'CLAT aspirants in Class 11 and 12'
        ELSE 'Class 12 commerce students and parents' END),
      objective = CASE code
        WHEN 'IPMAT-WEBINAR' THEN 'Fill the parents’ webinar and follow up each family who registers (sample).'
        WHEN 'CLAT-CA-SERIES' THEN 'Keep CLAT aspirants reading the week’s news with one post and one quiz a week (sample).'
        ELSE 'Bring families to the CA Foundation open house (sample).' END,
      channels = CASE WHEN cardinality(channels) = 0 THEN ARRAY['instagram', 'email'] ELSE channels END,
      programme_id = coalesce(programme_id, CASE code
        WHEN 'IPMAT-WEBINAR' THEN ${programmeOf('IPMAT')}::uuid
        WHEN 'CLAT-CA-SERIES' THEN ${programmeOf('CLAT')}::uuid
        ELSE ${programmeOf('CA_FOUNDATION')}::uuid END)
    WHERE is_sample`,
  sql`UPDATE marketing.ideas SET
      series = coalesce(series, course_prefix || ' basics'),
      objective = coalesce(objective, 'Answer one question families ask often, in their words (sample).'),
      brief = coalesce(brief, coalesce(problem_need, title) || ' One clear idea, no result claims (sample).'),
      audience = CASE WHEN audience = 'Sample audience' THEN CASE course_prefix
        WHEN 'IPMAT' THEN 'Class 12 students preparing for IPMAT'
        WHEN 'CLAT' THEN 'CLAT aspirants in Class 11 and 12'
        WHEN 'COM' THEN 'Class 11 and 12 commerce students'
        ELSE 'Students and parents in and around Sikar' END ELSE audience END,
      hypothesis = CASE WHEN hypothesis LIKE 'Sample proposal%' THEN 'If it answers the question plainly, more families will ask for a demo class. To be tested; no result claimed (sample).' ELSE hypothesis END
    WHERE is_sample`,
  sql`UPDATE marketing.optimisation_items SET
      baseline_observation = CASE WHEN baseline_observation LIKE 'Sample baseline%' THEN 'The page has no clear title and no answer to the first question families ask. Typed by hand (sample).' ELSE baseline_observation END,
      required_change = CASE WHEN required_change LIKE 'Sample change%' THEN 'Add a plain title, a short answer at the top and links to the course pages (sample).' ELSE required_change END,
      measurement_source = coalesce(measurement_source, 'Typed by hand after a search; no tool is connected (sample)'),
      observation_on = coalesce(observation_on, ${anchor()}::date - 10)
    WHERE is_sample`,
  sql`UPDATE marketing.targets SET note = CASE metric_key
      WHEN 'qualified_leads' THEN 'Leads who have a programme and a next step (sample target).'
      WHEN 'follow_ups_completed' THEN 'Every follow-up closed with an outcome (sample target).'
      WHEN 'demo_bookings' THEN 'Demo classes booked this month (sample target).'
      WHEN 'approved_content' THEN 'Items the manager approved this month (sample target).'
      WHEN 'published_content' THEN 'Items marked published; sample items were not really posted (sample target).'
      ELSE 'Deliverables of this campaign (sample target).' END
    WHERE is_sample`,
];

async function actorOf(
  db: Database,
  email: string,
): Promise<(Actor & { staffId: string | null }) | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  const [s] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, u.id));
  return { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey), staffId: s?.id ?? null };
}

/** Mirror of the Ops seed's anchor (same env SAMPLE_ANCHOR_DATE, default today in IST). */
const anchor = () => (process.env.SAMPLE_ANCHOR_DATE || toIsoDate()) as IsoDate;

const at = (day: number, hour = 11) =>
  new Date(`${addDays(anchor(), day)}T${String(hour).padStart(2, '0')}:00:00+05:30`);

export async function seedFillMarketing(db: Database, log: (m: string) => void = () => {}) {
  if (!(await db.$count(marketingCampaigns, eq(marketingCampaigns.isSample, true))))
    return log('marketing.fill skipped: no sample campaigns');
  const manager = await actorOf(db, SAMPLE_MARKETING_MANAGER_EMAIL);
  if (!manager) return log('marketing.fill skipped: sample manager missing');
  const codes = await db.select({ id: programmes.id, code: programmes.code }).from(programmes);
  const programmeOf = (c: string) => codes.find((p) => p.code === c)?.id ?? null;

  const known = await db
    .select({ title: marketingCalendarItems.title })
    .from(marketingCalendarItems)
    .where(eq(marketingCalendarItems.isSample, true));
  const added: string[] = [];
  for (const [title, itemType, email, day, steps] of MORE_CALENDAR) {
    if (known.some((k) => k.title === title)) continue;
    const owner = (await actorOf(db, email))!;
    const item = await createCalendarItem(db, owner, {
      title,
      itemType,
      ownerStaffId: owner.staffId as never,
      brief: 'To be filled below.',
      plannedAt: at(day),
    });
    added.push(item.id);
    for (const step of steps)
      await actOnCalendarItem(
        db,
        ['approve', 'schedule'].includes(step) ? manager : owner,
        item.id,
        step,
        {},
      );
  }
  if (added.length)
    await db
      .update(marketingCalendarItems)
      .set({ isSample: true })
      .where(inArray(marketingCalendarItems.id, added as never[]));

  const items = await db
    .select({
      id: marketingCalendarItems.id,
      title: marketingCalendarItems.title,
      itemType: marketingCalendarItems.itemType,
    })
    .from(marketingCalendarItems)
    .where(eq(marketingCalendarItems.isSample, true));
  for (const i of items) {
    const text = CALENDAR_TEXT[i.title];
    if (!text) continue;
    await db
      .update(marketingCalendarItems)
      .set({
        brief: `${text[0]} (sample)`,
        audience: text[1],
        programmeId: programmeOf(text[2]) as never,
        channel: CHANNELS[i.itemType as keyof typeof CHANNELS] ?? 'other',
      })
      .where(eq(marketingCalendarItems.id, i.id));
  }

  const topics = await db
    .select({ topic: marketingOptimisationItems.topic })
    .from(marketingOptimisationItems)
    .where(eq(marketingOptimisationItems.isSample, true));
  const newItems: string[] = [];
  for (const [categoryKey, topic, targetQuery, platform, seen] of MORE_SEO) {
    if (topics.some((t) => t.topic === topic)) continue;
    const owner = (await actorOf(db, POOJA_EMAIL))!;
    const item = await createOptimisationItem(db, owner, {
      pageUrl: `https://www.example.test/courses/${categoryKey}-${newItems.length + 2}`,
      topic,
      targetQuery,
      categoryKey,
      baselineObservation: 'The page answers no common question yet. Typed by hand (sample).',
      requiredChange: 'Add a short answer at the top and a clear title (sample).',
      ownerStaffId: owner.staffId as never,
      dueOn: addDays(anchor(), 10),
      checks: [],
    });
    newItems.push(item.id);
    await addObservation(db, owner, item.id, {
      platform,
      query: targetQuery,
      observedOn: addDays(anchor(), -6),
      result: `Sample observation: ${seen} Typed by hand, not connected.`,
      note: 'Sample observation.',
    });
  }
  if (newItems.length)
    await db
      .update(marketingOptimisationItems)
      .set({ isSample: true })
      .where(inArray(marketingOptimisationItems.id, newItems as never[]));

  for (const s of FILLS(programmeOf)) await db.execute(s);

  // A file whose rows were all rejected: the import history has a row and no metric is invented.
  const [account] = await db
    .select({ id: marketingSocialAccounts.id })
    .from(marketingSocialAccounts)
    .limit(1);
  if (account) {
    const imported = await db
      .insert(marketingMetricImports)
      .values({
        accountId: account.id,
        fileName: METRICS_FILE,
        fileSha256: createHash('sha256').update(METRICS_FILE).digest('hex'),
        format: 'csv',
        dateFormat: 'YYYY-MM-DD',
        capturedAt: at(-3),
        rowsTotal: 2,
        rowsAccepted: 0,
        rowsRejected: 2,
        // The shape a real import stores (src/domain/metrics-csv.ts), which the import page reads.
        rejected: [1, 2].map((rowNumber) => ({
          rowNumber,
          reasons: ['Sample row: no real post, nothing stored.'],
        })),
        importedBy: manager.id,
      } as never)
      .onConflictDoNothing()
      .returning({ id: marketingMetricImports.id });
    await markSampleRows(db, 'marketing.metric_imports', imported.map((r) => r.id));
  }
  log(`marketing.fill: ${added.length} calendar item(s), ${newItems.length} SEO item(s) added`);
}
