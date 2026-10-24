/**
 * Marketing's sample leads (brief 23 Oct 2026 §11, §25; D-036): 19 more fictional leads, so the
 * set holds about 40. Most belong to the two fictional marketing employees (their own scope is
 * never empty), a few wait unassigned. Each goes through the real services: capture (createLead),
 * calls typed in by staff (logActivity; nothing is dialled or recorded), follow-ups due today and
 * overdue, stage changes with history, one duplicate pair waiting for the merge review and one
 * Do-not-contact lead. The demo cases of ./samples.ts get the stage their admission case shows.
 * They never reach Converted: a sample admission carries legacy_verification = 'required', and
 * Converted needs an Ops-confirmed admission (domain/lead-stages.ts), so they stay at
 * "Admission in progress" with their admission number. Idempotent per lead (by email).
 */
import { eq } from 'drizzle-orm';
import {
  opsAdmissions,
  opsDemos,
  opsLeads,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  ensureDemoStaff,
  MARKETING_EMPLOYEES,
  defineSeed,
  POOJA_EMAIL,
  ROHIT_EMAIL,
  SAMPLE_MARKETING_MANAGER_EMAIL,
  sampleText,
} from '@elevate/database/seed';
import { addDays, istToday } from '../src/domain';
import { createFollowUp, closeFollowUp } from '../src/server/follow-ups';
import { changeLeadStage } from '../src/server/lead-stages';
import { createLead, logActivity } from '../src/server/leads';
import { seedActor } from './samples';

const [POOJA, ROHIT] = [POOJA_EMAIL, ROHIT_EMAIL];

type Call = [
  outcome: 'connected_two_way' | 'no_answer' | 'busy',
  direction: 'outbound' | 'inbound',
  minutes: number | null,
  daysAgo: number,
];
interface SampleLead {
  first: string;
  owner: string | null;
  programme: 'IPMAT' | 'CLAT' | 'CA_FOUNDATION' | 'CLASS_12';
  source: string;
  campaign?: string;
  /** Stages walked through, in order (from New). */
  stages: string[];
  calls?: Call[];
  /** Next follow-up from the last call: days from today (0 = due today). */
  next?: number;
  /** An open follow-up already late by this many days. */
  overdue?: number;
  /** A follow-up done and closed with its outcome. */
  done?: true;
  /** Same parent email as this lead (duplicate pair). */
  parentOf?: string;
}

const why = sampleText;
export const SAMPLE_MARKETING_LEADS: readonly SampleLead[] = [
  {
    first: 'Aanya',
    owner: POOJA,
    programme: 'IPMAT',
    source: 'WEBINAR',
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    stages: [],
  },
  {
    first: 'Bhavya',
    owner: POOJA,
    programme: 'IPMAT',
    source: 'INSTAGRAM_ORGANIC',
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    stages: ['contacted'],
    calls: [['connected_two_way', 'outbound', 6, 1]],
    next: 0,
  },
  {
    first: 'Charvi',
    owner: POOJA,
    programme: 'CLASS_12',
    source: 'GOOGLE_SEARCH_MAPS',
    stages: ['contacted', 'qualified'],
    calls: [
      ['no_answer', 'outbound', null, 4],
      ['connected_two_way', 'outbound', 9, 3],
    ],
    overdue: 2,
  },
  {
    first: 'Dhruv',
    owner: POOJA,
    programme: 'IPMAT',
    source: 'REFERRAL',
    campaign: 'SAMPLE-IPMAT-WEBINAR',
    stages: ['contacted', 'qualified', 'demo_booked'],
    calls: [['connected_two_way', 'inbound', 12, 2]],
    done: true,
  },
  {
    first: 'Eshan',
    owner: POOJA,
    programme: 'CA_FOUNDATION',
    source: 'META_ADS',
    stages: ['contacted', 'qualified'],
    calls: [['connected_two_way', 'outbound', 7, 1]],
    next: 0,
  },
  {
    first: 'Farah',
    owner: POOJA,
    programme: 'CLAT',
    source: 'YOUTUBE_ORGANIC',
    stages: ['contacted', 'nurture'],
    calls: [
      ['busy', 'outbound', null, 5],
      ['connected_two_way', 'outbound', 4, 3],
    ],
    next: 14,
  },
  {
    first: 'Gauri',
    owner: POOJA,
    programme: 'CLASS_12',
    source: 'NEWSPAPER',
    stages: ['contacted', 'lost'],
    calls: [['connected_two_way', 'outbound', 5, 6]],
  },
  {
    first: 'Ishita',
    owner: POOJA,
    programme: 'CLAT',
    source: 'SEMINAR',
    stages: ['contacted'],
    calls: [['connected_two_way', 'outbound', 3, 2]],
    next: 1,
  },
  {
    first: 'Hriday',
    owner: ROHIT,
    programme: 'CLAT',
    source: 'INSTAGRAM_ORGANIC',
    campaign: 'SAMPLE-CLAT-CA',
    stages: [],
  },
  {
    first: 'Jiya',
    owner: ROHIT,
    programme: 'CLAT',
    source: 'WEBINAR',
    campaign: 'SAMPLE-CLAT-CA',
    stages: ['contacted'],
    calls: [['connected_two_way', 'outbound', 8, 4]],
    overdue: 1,
  },
  {
    first: 'Kiaan',
    owner: ROHIT,
    programme: 'IPMAT',
    source: 'GOOGLE_ADS',
    stages: ['contacted', 'qualified'],
    calls: [['connected_two_way', 'inbound', 10, 1]],
    next: 0,
  },
  {
    first: 'Lavanya',
    owner: ROHIT,
    programme: 'CLAT',
    source: 'REFERRAL',
    campaign: 'SAMPLE-CLAT-CA',
    stages: ['contacted', 'qualified', 'demo_booked'],
    calls: [['connected_two_way', 'outbound', 11, 2]],
    done: true,
  },
  {
    first: 'Manav',
    owner: ROHIT,
    programme: 'CA_FOUNDATION',
    source: 'WALK_IN',
    stages: ['contacted', 'qualified', 'demo_booked', 'demo_attended'],
    calls: [['connected_two_way', 'outbound', 6, 7]],
  },
  {
    first: 'Nysa',
    owner: ROHIT,
    programme: 'CLASS_12',
    source: 'META_ADS',
    stages: ['contacted', 'do_not_contact'],
    calls: [['connected_two_way', 'outbound', 2, 3]],
  },
  {
    first: 'Ojas',
    owner: ROHIT,
    programme: 'IPMAT',
    source: 'YOUTUBE_ORGANIC',
    stages: ['contacted'],
    calls: [['no_answer', 'outbound', null, 1]],
    next: 1,
  },
  {
    first: 'Ishika',
    owner: ROHIT,
    programme: 'CLAT',
    source: 'SEMINAR',
    stages: [],
    parentOf: 'Ishita',
  },
  { first: 'Pranav', owner: null, programme: 'IPMAT', source: 'GOOGLE_ADS', stages: [] },
  { first: 'Rehan', owner: null, programme: 'CLAT', source: 'UNKNOWN', stages: [] },
  { first: 'Siya', owner: null, programme: 'CA_FOUNDATION', source: 'OTHER', stages: [] },
];

const emailOf = (first: string) => `${first.toLowerCase()}.sample@example.test`;
const REASONED = new Set(['nurture', 'lost', 'do_not_contact', 'duplicate']);
const STAGE_REASON: Record<string, string> = {
  nurture: why('Wants to start next year'),
  lost: why('Chose a school-based course'),
  do_not_contact: why('Parent asked not to be contacted again'),
};

/** Stage of a demo case of ./samples.ts from what its demo and admission show. */
async function demoCaseStages(db: Database) {
  return db
    .select({
      leadId: opsLeads.id,
      stageKey: opsLeads.stageKey,
      outcome: opsDemos.outcome,
      admissionNumber: opsAdmissions.admissionNumber,
      admissionStatus: opsAdmissions.status,
    })
    .from(opsLeads)
    .innerJoin(opsDemos, eq(opsDemos.leadId, opsLeads.id))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .where(eq(opsLeads.isSample, true));
}
const caseTarget = (c: Awaited<ReturnType<typeof demoCaseStages>>[number]) =>
  c.admissionNumber || c.outcome === 'converted'
    ? 'admission_in_progress'
    : ['declined', 'not_converted', 'withdrawn'].includes(c.outcome ?? '')
      ? 'lost'
      : 'demo_booked';

export async function seedSampleLeads(db: Database, log: (m: string) => void = () => {}) {
  const ops = await seedActor(db, 'operations-manager@example.test');
  const [manager] = await db
    .select({ staffId: staffMembers.id })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.email, SAMPLE_MARKETING_MANAGER_EMAIL));
  if (!ops || !manager) return log('ops.sample-leads skipped: sample users missing');
  await ensureDemoStaff(db, MARKETING_EMPLOYEES, manager.staffId);
  const owners = new Map<string, NonNullable<Awaited<ReturnType<typeof seedActor>>>>();
  for (const email of [POOJA, ROHIT]) {
    const a = await seedActor(db, email);
    if (!a?.staffId) return log(`ops.sample-leads skipped: ${email} is not a demo account here`);
    owners.set(email, a);
  }
  const today = istToday(new Date());
  let added = 0;
  for (const [i, l] of SAMPLE_MARKETING_LEADS.entries()) {
    if (await db.$count(opsLeads, eq(opsLeads.studentEmail, emailOf(l.first)))) continue;
    const who = l.owner ? owners.get(l.owner)! : ops;
    const parent = l.parentOf ?? l.first;
    const { lead } = await createLead(db, who.actor, {
      studentName: `${l.first} Sample Student`,
      studentEmail: emailOf(l.first),
      guardianName: `${parent} Sample Parent`,
      guardianRelationship: 'mother',
      guardianEmail: `${parent.toLowerCase()}.parent@example.test`,
      currentStage: 'class_12',
      programmeCode: l.programme,
      interestMode: 'offline',
      sourceCode: l.source,
      campaignRef: l.campaign ?? null,
      receivedAt: new Date(`${addDays(today, -20 + (i % 12))}T10:00:00+05:30`).toISOString(),
      ownerStaffId: l.owner ? who.staffId : null,
      acknowledgeDuplicates: l.parentOf
        ? { reason: why('Same parent email as an earlier enquiry; left for the merge review') }
        : null,
      isSample: true,
    } as never);
    for (const [n, [outcome, direction, minutes, daysAgo]] of (l.calls ?? []).entries()) {
      const last = n === l.calls!.length - 1;
      await logActivity(db, who.actor, lead.id, {
        kind: 'call',
        outcome,
        direction,
        durationMinutes: minutes,
        occurredAt: new Date(`${addDays(today, -daysAgo)}T${11 + n}:00:00+05:30`).toISOString(),
        note: why('Call details typed in by staff'),
        nextAction: last && l.next !== undefined ? why('Call back about the demo class') : null,
        nextFollowUpOn: last && l.next !== undefined ? addDays(today, l.next) : null,
      } as never);
    }
    for (const stageKey of l.stages)
      await changeLeadStage(db, who.actor, lead.id, {
        stageKey,
        reason: REASONED.has(stageKey) ? STAGE_REASON[stageKey] : null,
      });
    if (l.overdue)
      await createFollowUp(db, who.actor, {
        leadId: lead.id,
        kind: 'general',
        title: why('Send the batch timetable'),
        dueDate: addDays(today, -l.overdue),
        ownerStaffId: who.staffId,
      });
    if (l.done) {
      const f = await createFollowUp(db, who.actor, {
        leadId: lead.id,
        kind: 'demo_followup',
        title: why('Confirm the demo slot'),
        dueDate: addDays(today, -1),
        ownerStaffId: who.staffId,
      });
      await closeFollowUp(db, who.actor, f.id, {
        action: 'complete',
        outcome: why('Parent confirmed the slot by phone'),
      });
    }
    added += 1;
  }
  let staged = 0;
  for (const c of await demoCaseStages(db)) {
    const to = caseTarget(c);
    // Unstaged (seeded before stages existed) or still New: set once; a later change is kept.
    if (c.stageKey && c.stageKey !== 'new') continue;
    await changeLeadStage(db, ops.actor, c.leadId, {
      stageKey: to,
      reason: to === 'lost' ? why('Demo case closed without admission') : null,
    });
    staged += 1;
  }
  log(`ops.sample-leads: ${added} marketing lead(s) added, ${staged} demo case stage(s) set`);
}

export const sampleLeadSeeds = [
  defineSeed({
    name: 'ops.sample-leads',
    module: 'ops',
    dependsOn: ['ops.samples', 'ops.lead-stages', 'ops.lead-sources'],
    description: `${SAMPLE_MARKETING_LEADS.length} sample marketing leads (owners, calls, follow-ups, stages, a duplicate pair, Do not contact) + demo-case stages`,
    run: ({ db, log }) => seedSampleLeads(db, log),
  }),
];
