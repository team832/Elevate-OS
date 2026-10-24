/**
 * Marketing SAMPLE set (brief 23 Oct 2026 §12–§15, §25; D-036): campaigns with their owner and
 * members, the six sample idea proposals named in §13, calendar items in every workflow state, one
 * SEO, one AIO and one GEO work item with manual observations, and targets by employee, team and
 * campaign. Everything goes through the Marketing services (audit, review rules, no self-approval)
 * and is then marked `is_sample`; titles say "(sample)". Owners are the two fictional marketing
 * employees (`MARKETING_EMPLOYEES`, @example.test), reviewer the Sample Marketing Manager. No
 * figure is invented: observations are labelled typed by hand, nothing is published anywhere and
 * the only "publication" carries evidence text, not a link. Skipped once sample campaigns exist;
 * `npm run db:clear-samples` removes it all.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  marketingCalendarItems,
  marketingCampaigns,
  marketingIdeas,
  marketingOptimisationCategories,
  marketingOptimisationItems,
  marketingTargets,
  programmes,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import {
  defineSeed,
  ensureDemoStaff,
  MARKETING_EMPLOYEES,
  POOJA_EMAIL,
  ROHIT_EMAIL,
  SAMPLE_MARKETING_MANAGER_EMAIL,
} from '@elevate/database/seed';
import { addDays, toIsoDate, type RoleKey, type UserId } from '@elevate/shared-types';
import type { CalendarAction } from '../src/domain/calendar';
import type { Actor } from '../src/server/access';
import { actOnCalendarItem, createCalendarItem } from '../src/server/calendar';
import { planIdea } from '../src/server/calendar-plan';
import { addCampaignMember } from '../src/server/campaign-members';
import { createCampaign } from '../src/server/groups';
import { changeIdeaStatus, createIdea } from '../src/server/ideas';
import {
  addObservation,
  createOptimisationItem,
  reviewOptimisationItem,
  submitOptimisationItem,
  updateOptimisationItem,
} from '../src/server/optimisation';
import { createTarget } from '../src/server/targets';

const [POOJA, ROHIT] = [POOJA_EMAIL, ROHIT_EMAIL];

/** SEO / AIO / GEO as the brief labels them (§14); reference data, kept by db:clear-samples. */
export const OPTIMISATION_CATEGORIES = [
  {
    key: 'seo',
    label: 'SEO',
    meaning:
      'Search engine optimization: work that helps a page be found and read well in ordinary search results (page title, headings, content, links, speed).',
  },
  {
    key: 'aio',
    label: 'AIO',
    meaning:
      'AI search optimization: work that helps AI answers shown by search engines find and quote the page correctly.',
  },
  {
    key: 'geo',
    label: 'GEO',
    meaning:
      'Generative engine optimization: work that helps chat assistants that write answers describe Elevate accurately and point to the right page.',
  },
] as const;

/** Inserted only when missing: the marketing manager may relabel or switch them off. */
export async function seedOptimisationCategories(db: Database) {
  await db
    .insert(marketingOptimisationCategories)
    .values([...OPTIMISATION_CATEGORIES])
    .onConflictDoNothing();
}

export const SAMPLE_CAMPAIGNS = [
  {
    code: 'SAMPLE-IPMAT-WEBINAR',
    name: 'IPMAT webinar invitations (sample)',
    status: 'active',
    owner: POOJA,
    member: ROHIT,
  },
  {
    code: 'SAMPLE-CLAT-CA',
    name: 'CLAT current-affairs series (sample)',
    status: 'active',
    owner: ROHIT,
    member: null,
  },
  {
    code: 'SAMPLE-CAF-OPEN-HOUSE',
    name: 'CA Foundation open house (sample)',
    status: 'draft',
    owner: POOJA,
    member: null,
  },
] as const;
type CampaignCode = (typeof SAMPLE_CAMPAIGNS)[number]['code'];

/** The six sample proposals of brief §13 and the review state each one shows. */
export const SAMPLE_IDEAS: readonly {
  title: string;
  owner: string;
  prefix: 'IPMAT' | 'CLAT' | 'COM' | 'GEN';
  programme: string;
  format: 'short_video' | 'social_post' | 'article' | 'webinar' | 'seminar';
  channel: 'instagram' | 'youtube' | 'website' | 'online_event' | 'in_person';
  effort: 's' | 'm' | 'l';
  campaign?: CampaignCode;
  problemNeed: string;
  /** submitted → approved | changes_requested; `plan` puts the approved idea on the calendar. */
  review?: 'submitted' | 'approved' | 'changes_requested';
  plan?: number;
}[] = [
  {
    title: 'IPMAT quantitative practice',
    owner: POOJA,
    prefix: 'IPMAT',
    programme: 'IPMAT',
    format: 'short_video',
    channel: 'instagram',
    effort: 's',
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    problemNeed: 'Class 12 students ask how to practise quant daily.',
    review: 'approved',
    plan: 5,
  },
  {
    title: 'CLAT current-affairs recap',
    owner: ROHIT,
    prefix: 'CLAT',
    programme: 'CLAT',
    format: 'social_post',
    channel: 'instagram',
    effort: 's',
    campaign: 'SAMPLE-CLAT-CA',
    problemNeed: 'Aspirants lose track of the week’s news.',
    review: 'submitted',
  },
  {
    title: 'Class 12 Mathematics revision',
    owner: POOJA,
    prefix: 'COM',
    programme: 'CLASS_12',
    format: 'article',
    channel: 'website',
    effort: 'm',
    problemNeed: 'Board students want a short revision plan.',
    review: 'changes_requested',
  },
  {
    title: 'CA Accounts concept explainer',
    owner: ROHIT,
    prefix: 'GEN',
    programme: 'CA_FOUNDATION',
    format: 'short_video',
    channel: 'youtube',
    effort: 'm',
    problemNeed: 'CA Foundation students confuse capital and revenue items.',
  },
  {
    title: 'Admission webinar',
    owner: POOJA,
    prefix: 'GEN',
    programme: 'IPMAT',
    format: 'webinar',
    channel: 'online_event',
    effort: 'l',
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    problemNeed: 'Parents want one place to ask about admissions.',
    review: 'approved',
  },
  {
    title: 'Teacher-led doubt-solving session',
    owner: ROHIT,
    prefix: 'GEN',
    programme: 'CLAT',
    format: 'seminar',
    channel: 'in_person',
    effort: 'm',
    problemNeed: 'Students want a sample teacher to answer doubts live.',
    review: 'submitted',
  },
];

/** One calendar item per remaining state: [title, type, owner, planned day, campaign, actions]. */
const STEPS: Record<string, CalendarAction[]> = {
  idea: [],
  planned: [],
  in_production: ['start'],
  submitted: ['start', 'submit'],
  approved: ['start', 'submit', 'approve'],
  scheduled: ['start', 'submit', 'approve', 'schedule'],
  published: ['start', 'submit', 'approve', 'schedule', 'publish'],
  changes_requested: ['start', 'submit', 'request_changes'],
  cancelled: ['cancel'],
};
export const SAMPLE_CALENDAR: readonly {
  title: string;
  type:
    'social_post' | 'short_video' | 'article' | 'email_draft' | 'landing_page_update' | 'seminar';
  owner: string;
  day: number | null;
  campaign?: CampaignCode;
  state: keyof typeof STEPS;
}[] = [
  {
    title: 'CUET general test tips carousel',
    type: 'social_post',
    owner: ROHIT,
    day: null,
    state: 'idea',
  },
  {
    title: 'CLAT weekly quiz reel',
    type: 'short_video',
    owner: ROHIT,
    day: 3,
    campaign: 'SAMPLE-CLAT-CA',
    state: 'in_production',
  },
  {
    title: 'IPMAT mock analysis article',
    type: 'article',
    owner: POOJA,
    day: 2,
    state: 'submitted',
  },
  {
    title: 'CA Foundation open-house poster',
    type: 'social_post',
    owner: POOJA,
    day: 6,
    campaign: 'SAMPLE-CAF-OPEN-HOUSE',
    state: 'approved',
  },
  {
    title: 'IPMAT webinar invitation email',
    type: 'email_draft',
    owner: POOJA,
    day: 1,
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    state: 'scheduled',
  },
  {
    title: 'Class 12 Maths revision tips post',
    type: 'social_post',
    owner: ROHIT,
    day: -3,
    campaign: 'SAMPLE-CLAT-CA',
    state: 'published',
  },
  {
    title: 'IPMAT webinar landing page update',
    type: 'landing_page_update',
    owner: POOJA,
    day: 4,
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    state: 'changes_requested',
  },
  {
    title: 'CLAT seminar at a partner school',
    type: 'seminar',
    owner: ROHIT,
    day: 10,
    state: 'cancelled',
  },
];

const at = (day: number, hour = 11) =>
  new Date(`${addDays(toIsoDate(), day)}T${String(hour).padStart(2, '0')}:00:00+05:30`);

async function actorOf(db: Database, email: string): Promise<Actor | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) return null;
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  return { id: u.id as UserId, roles: roles.map((r) => r.role as RoleKey) };
}

export async function seedMarketingSamples(db: Database, log: (m: string) => void = () => {}) {
  if (await db.$count(marketingCampaigns, eq(marketingCampaigns.isSample, true)))
    return log('marketing.samples skipped: sample campaigns exist');
  const manager = await actorOf(db, SAMPLE_MARKETING_MANAGER_EMAIL);
  const [managerStaff] = manager
    ? await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(eq(staffMembers.userId, manager.id))
    : [];
  if (!manager || !managerStaff)
    return log('marketing.samples skipped: the Sample Marketing Manager is missing (core seed)');
  const people = await ensureDemoStaff(db, MARKETING_EMPLOYEES, managerStaff.id);
  if (people.size < MARKETING_EMPLOYEES.length)
    return log('marketing.samples skipped: a marketing employee email belongs to another account');
  const staffOf = (email: string) => people.get(email)!.staffId;
  const as = new Map<string, Actor>();
  for (const email of [POOJA, ROHIT]) as.set(email, (await actorOf(db, email))!);
  const programmeOf = new Map(
    (await db.select({ id: programmes.id, code: programmes.code }).from(programmes)).map((p) => [
      p.code,
      p.id,
    ]),
  );
  const today = toIsoDate();

  const campaigns = new Map<string, string>();
  for (const c of SAMPLE_CAMPAIGNS) {
    const row = await createCampaign(db, manager, {
      code: c.code,
      name: c.name,
      objective: 'Sample campaign for local testing.',
      startsOn: addDays(today, -14),
      endsOn: addDays(today, 30),
      status: c.status,
    });
    campaigns.set(c.code, row.id);
    await addCampaignMember(db, manager, row.id, {
      staffId: staffOf(c.owner),
      role: 'owner',
      fromDate: addDays(today, -14),
    });
    if (c.member)
      await addCampaignMember(db, manager, row.id, {
        staffId: staffOf(c.member),
        role: 'member',
        fromDate: addDays(today, -7),
      });
  }

  const ideaIds: string[] = [];
  const calendarIds: string[] = [];
  for (const i of SAMPLE_IDEAS) {
    const owner = as.get(i.owner)!;
    const { idea } = await createIdea(db, owner, {
      title: `${i.title} (sample proposal)`,
      coursePrefix: i.prefix,
      problemNeed: i.problemNeed,
      audience: 'Sample audience',
      hypothesis: 'Sample proposal: to be tested, no result claimed.',
      expectedOutcome: 'More enquiries from the audience named (to be measured).',
      effort: i.effort,
      proposedFormat: i.format,
      proposedChannel: i.channel,
      programmeId: programmeOf.get(i.programme) ?? null,
      ownerStaffId: staffOf(i.owner),
      campaignId: i.campaign ? campaigns.get(i.campaign)! : null,
    });
    ideaIds.push(idea.id);
    if (!i.review) continue;
    await changeIdeaStatus(db, owner, idea.id, { status: 'submitted' });
    if (i.review === 'approved')
      await changeIdeaStatus(db, manager, idea.id, { status: 'approved' });
    if (i.review === 'changes_requested')
      await changeIdeaStatus(db, manager, idea.id, {
        status: 'changes_requested',
        reason: 'Name the chapters it covers (sample).',
      });
    if (i.plan !== undefined)
      calendarIds.push((await planIdea(db, owner, idea.id, { plannedAt: at(i.plan) })).item.id);
  }

  for (const c of SAMPLE_CALENDAR) {
    const owner = as.get(c.owner)!;
    const item = await createCalendarItem(db, owner, {
      title: `${c.title} (sample)`,
      itemType: c.type,
      ownerStaffId: staffOf(c.owner),
      campaignId: c.campaign ? campaigns.get(c.campaign)! : null,
      brief: 'Sample brief for local testing.',
      ...(c.day === null ? {} : { plannedAt: at(c.day) }),
    });
    calendarIds.push(item.id);
    for (const step of STEPS[c.state]!) {
      const reviewer = ['approve', 'request_changes', 'schedule', 'publish'].includes(step);
      await actOnCalendarItem(db, reviewer ? manager : owner, item.id, step, {
        note: step === 'request_changes' ? 'Use the course page wording (sample).' : undefined,
        reason: step === 'cancel' ? 'The partner school postponed (sample).' : undefined,
        evidence:
          step === 'publish'
            ? 'Sample evidence: screenshot of the post kept in the team folder (sample, nothing was posted).'
            : undefined,
        publishedAt: step === 'publish' ? at(c.day!, 12) : undefined,
      });
    }
  }

  const work = [
    {
      category: 'seo',
      owner: POOJA,
      topic: 'IPMAT course page',
      query: 'IPMAT coaching in Sikar',
      checks: ['title_description', 'internal_links', 'mobile_performance'] as const,
      review: 'approved' as const,
      observation: [
        'Google search',
        'IPMAT coaching in Sikar',
        'Sample observation: the page was not in the first ten results.',
      ],
    },
    {
      category: 'aio',
      owner: ROHIT,
      topic: 'CLAT current-affairs page',
      query: 'What current affairs topics come in CLAT?',
      checks: ['faqs', 'sources_facts', 'student_answers'] as const,
      review: 'submitted' as const,
      observation: [
        'Search AI answer',
        'What current affairs topics come in CLAT?',
        'Sample observation: the AI answer did not cite the page.',
      ],
    },
    {
      category: 'geo',
      owner: POOJA,
      topic: 'Admissions FAQ page',
      query: 'Which institutes in Sikar coach for CLAT?',
      checks: ['author_organisation', 'course_information'] as const,
      review: null,
      observation: [
        'Chat assistant',
        'Which institutes in Sikar coach for CLAT?',
        'Sample observation: Elevate was not named in the answer.',
      ],
    },
  ];
  const workIds: string[] = [];
  for (const w of work) {
    const owner = as.get(w.owner)!;
    const item = await createOptimisationItem(db, owner, {
      pageUrl: `https://www.example.test/sample/${w.category}`,
      topic: `${w.topic} (sample)`,
      targetQuery: w.query,
      categoryKey: w.category,
      baselineObservation: 'Sample baseline typed by hand.',
      requiredChange: 'Sample change to make on the page.',
      ownerStaffId: staffOf(w.owner),
      dueOn: addDays(today, 7),
      checks: [...w.checks],
    });
    workIds.push(item.id);
    const [platform, query, result] = w.observation;
    await addObservation(db, owner, item.id, {
      platform: platform!,
      query: query!,
      observedOn: addDays(today, -10),
      result: `${result} Typed by hand, not connected.`,
      note: 'Sample observation.',
    });
    if (!w.review) continue;
    await updateOptimisationItem(db, owner, item.id, {
      evidence: 'Sample evidence: before/after notes in the team folder (sample).',
      done: [...w.checks],
    });
    await submitOptimisationItem(db, owner, item.id);
    if (w.review === 'approved')
      await reviewOptimisationItem(db, manager, item.id, {
        decision: 'approved',
        note: 'Checked (sample).',
      });
  }

  const [y, m] = today.split('-').map(Number) as [number, number];
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const period = {
    periodStart: `${today.slice(0, 8)}01`,
    periodEnd: addDays(nextMonth as typeof today, -1),
  };
  const targets = [
    { scope: 'employee', staffId: staffOf(POOJA), metricKey: 'qualified_leads', targetValue: 6 },
    {
      scope: 'employee',
      staffId: staffOf(POOJA),
      metricKey: 'follow_ups_completed',
      targetValue: 10,
    },
    { scope: 'employee', staffId: staffOf(ROHIT), metricKey: 'qualified_leads', targetValue: 6 },
    { scope: 'employee', staffId: staffOf(ROHIT), metricKey: 'demo_bookings', targetValue: 3 },
    { scope: 'team', metricKey: 'approved_content', targetValue: 8 },
    { scope: 'team', metricKey: 'published_content', targetValue: 4 },
    {
      scope: 'campaign',
      campaignId: campaigns.get('SAMPLE-IPMAT-WEBINAR')!,
      metricKey: 'campaign_deliverables',
      targetValue: 4,
    },
  ] as const;
  const targetIds: string[] = [];
  for (const t of targets)
    targetIds.push(
      (
        await createTarget(db, manager, {
          ...t,
          ...period,
          note: 'Sample target for local testing.',
        })
      ).id,
    );

  // The services take no sample flag (no route may set it): label what this seed made.
  await db
    .update(marketingCampaigns)
    .set({ isSample: true })
    .where(inArray(marketingCampaigns.id, [...campaigns.values()] as never[]));
  await db
    .update(marketingIdeas)
    .set({ isSample: true })
    .where(inArray(marketingIdeas.id, ideaIds as never[]));
  await db
    .update(marketingCalendarItems)
    .set({ isSample: true })
    .where(inArray(marketingCalendarItems.id, calendarIds as never[]));
  await db
    .update(marketingOptimisationItems)
    .set({ isSample: true })
    .where(inArray(marketingOptimisationItems.id, workIds as never[]));
  await db
    .update(marketingTargets)
    .set({ isSample: true })
    .where(inArray(marketingTargets.id, targetIds as never[]));
  log(
    `marketing.samples: ${campaigns.size} campaigns, ${ideaIds.length} ideas, ${calendarIds.length} calendar items, ${workIds.length} SEO/AIO/GEO items, ${targetIds.length} targets`,
  );
}

export const marketingSampleSeeds = [
  defineSeed({
    name: 'marketing.optimisation-categories',
    module: 'marketing',
    description:
      'SEO, AIO and GEO work categories with their meanings (reference data, not sample)',
    run: ({ db }) => seedOptimisationCategories(db),
  }),
  defineSeed({
    name: 'marketing.samples',
    module: 'marketing',
    dependsOn: [
      'core.users',
      'core.staff_members',
      'core.programmes',
      'marketing.optimisation-categories',
      'marketing.legacy',
    ],
    description:
      'Sample campaigns, the six §13 idea proposals, calendar items in every state, SEO/AIO/GEO items and targets (is_sample)',
    run: ({ db, log }) => seedMarketingSamples(db, log),
  }),
];
