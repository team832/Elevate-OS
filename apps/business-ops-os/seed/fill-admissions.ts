/**
 * Owner, 31 Oct 2026: fill Business Operations: lead and enquiry details, parents, contact
 * preferences, onboarding, materials, meetings for the demo teacher, events, duplicates and a
 * readmission. One table of statements fills what is still empty on sample rows and puts dates back
 * to when things happened (real rows are never touched); the rest goes through the real services.
 * Applications, documents and money are ./fill-application.ts and ./fill-fees.ts.
 * Phones are the fake block only (db:check enforces it). Safe to run again.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { knownPerson, markSampleRows, sampleRowIds } from '@elevate/database/seed';
import {
  opsAdmissions,
  opsAppointmentParticipants,
  opsAppointments,
  opsApplications,
  opsDuplicateFlags,
  opsGuardians,
  opsLeads,
  opsOnboardingItems,
  opsStudentSiblings,
  opsTeacherStudentFeedback,
  students,
  type Database,
} from '@elevate/database';
import { addDays, istInstant, type IsoDate } from '../src/domain/dates';
import { isExitStatus } from '../src/domain/student-lifecycle';
import { transitionAdmission } from '../src/server/admissions';
import { changeAppointment, scheduleAppointment } from '../src/server/appointments';
import {
  changeParticipant,
  draftEventMessage,
  scheduleEvent,
  sendEventMessage,
} from '../src/server/events';
import { updateGuardian } from '../src/server/guardians';
import { linkSibling } from '../src/server/kyc';
import { dismissDuplicateFlag } from '../src/server/lead-duplicates';
import { createLead } from '../src/server/leads';
import { mergeLeads } from '../src/server/leads-actions';
import { changeChecklist, recordItemStatus, recordMaterial } from '../src/server/onboarding';
import { changeStudentLifecycle } from '../src/server/student-lifecycle';
import { addParents, leadDetails } from './fill-application';
import { DEMO_TEACHER_EMAIL } from './fill-people';
import { sampleAnchorDate } from './sample-staff';
import { seedActor } from './samples';

type Actor = NonNullable<Awaited<ReturnType<typeof seedActor>>>['actor'];

const pick = (list: string[], key: string) =>
  sql.raw(
    `(ARRAY[${list.map((x) => `'${x}'`).join(', ')}])[1 + abs(hashtext(${key})) % ${list.length}]`,
  );

/** Fill what is still empty; every statement is limited to sample rows. */
const FILLS = [
  sql`UPDATE ops.leads SET
      notes = coalesce(notes, ${pick(['Prefers morning classes; travels from outside Sikar.', 'Parent wants to compare two programmes before deciding.', 'Heard about us from a friend already in a batch.', 'Asked about hostel options near the centre.'], 'code')})
    WHERE is_sample`,
  sql`UPDATE ops.enquiries e SET
      channel = coalesce(e.channel, CASE WHEN e.source_code IN ('WALK_IN', 'SEMINAR') THEN 'In person' WHEN e.source_code LIKE '%ADS' THEN 'Website form' ELSE 'Call' END),
      discovery_source = coalesce(e.discovery_source, initcap(replace(lower(e.source_code), '_', ' '))),
      content_ref = coalesce(e.content_ref, CASE WHEN e.source_code IN ('INSTAGRAM_ORGANIC', 'YOUTUBE_ORGANIC', 'META_ADS') THEN ${pick(['Reel: three months to IPMAT', 'Video: how the CLAT paper changed', 'Post: Commerce after Class 10'], 'e.id::text')} END),
      notes = coalesce(e.notes, ${pick(['Asked about batch timings, fee instalments and demo classes.', 'Wants to know how many students sit in one batch.', 'Asked whether the demo fee counts towards the course fee.', 'Parent asked about transport from the bus stand.'], 'e.id::text')})
    FROM ops.leads l WHERE l.id = e.lead_id AND l.is_sample`,
  sql`UPDATE ops.leads l SET interested_programme_codes = s.codes
    FROM (SELECT a.lead_id, array_agg(DISTINCT p.code ORDER BY p.code) AS codes
          FROM ops.admissions a JOIN core.programmes p ON p.id = a.programme_id GROUP BY 1) s
    WHERE s.lead_id = l.id AND l.is_sample`,
  sql`UPDATE ops.admissions a SET intended_start_date = coalesce(a.intended_start_date, (timezone('Asia/Kolkata', now()))::date + 21)
    FROM ops.leads l WHERE l.id = a.lead_id AND l.is_sample AND a.status NOT IN ('lost')`,
  sql`UPDATE ops.demo_sessions s SET
      notes = coalesce(s.notes, CASE s.attendance
        WHEN 'present' THEN ${pick(['Followed the class well and asked two questions.', 'Quiet at first, answered confidently by the end.', 'Came ten minutes early with a parent.', 'Took notes throughout; stayed back to ask about homework.'], 's.id::text')}
        WHEN 'absent' THEN 'Parent called in the morning to say the student was unwell.' END)
    FROM ops.demos d JOIN ops.leads l ON l.id = d.lead_id
    WHERE d.id = s.demo_id AND l.is_sample`,
  sql`UPDATE ops.fee_instalments i SET note = coalesce(i.note, CASE i.sequence
      WHEN 1 THEN 'Half the tuition, due at admission.'
      WHEN 2 THEN 'Quarter of the tuition, reminder goes a week before.'
      ELSE 'Last quarter of the tuition.' END)
    FROM ops.fee_plans p JOIN core.students s ON s.id = p.student_id
    WHERE p.id = i.plan_id AND s.is_sample`,
  sql`UPDATE ops.follow_ups f SET last_reminder_on = f.due_date
    FROM ops.leads l WHERE l.id = f.lead_id AND l.is_sample AND f.status = 'open'
      AND f.due_date < (timezone('Asia/Kolkata', now()))::date`,
  // Money and its history on the day it moved, not the day of the seed.
  sql`WITH t AS (
      SELECT r.id, (coalesce(r.payment_date, r.due_date,
          (SELECT min(i.due_date) FROM ops.fee_instalments i WHERE i.plan_id = r.plan_id),
          (timezone('Asia/Kolkata', now()))::date)::timestamp + interval '11 hours') AT TIME ZONE 'Asia/Kolkata' AS at
      FROM ops.fee_records r JOIN ops.leads l ON l.id = r.lead_id WHERE l.is_sample)
    UPDATE ops.fee_records r SET recorded_at = t.at,
      verified_at = CASE WHEN r.verified_at IS NULL THEN NULL ELSE t.at + interval '3 hours' END,
      voided_at = CASE WHEN r.voided_at IS NULL THEN NULL ELSE t.at + interval '2 hours' END
    FROM t WHERE t.id = r.id`,
  sql`UPDATE core.audit_events e SET at = CASE e.action
        WHEN 'fee_record.verified' THEN r.verified_at
        WHEN 'fee_record.voided' THEN r.voided_at
        ELSE r.recorded_at END
    FROM ops.fee_records r JOIN ops.leads l ON l.id = r.lead_id
    WHERE e.entity_type = 'fee_record' AND e.entity_id = r.id::text AND l.is_sample`,
  // The admission journey: up to the admission spread from the enquiry on, then its own days.
  sql`WITH t AS (
      SELECT t.id, t.to_status, a.admission_date, x.exit_date, l.first_received_at AS received_at,
        row_number() OVER w AS n, count(*) OVER (PARTITION BY t.admission_id) AS c
      FROM ops.admission_transitions t
      JOIN ops.admissions a ON a.id = t.admission_id
      JOIN ops.leads l ON l.id = a.lead_id
      LEFT JOIN ops.exit_records x ON x.admission_id = a.id AND x.exit_status = t.to_status
      WHERE l.is_sample
      WINDOW w AS (PARTITION BY t.admission_id ORDER BY t.at, t.id))
    UPDATE ops.admission_transitions u SET at = CASE
        WHEN t.to_status = 'admitted' THEN (t.admission_date + time '16:00') AT TIME ZONE 'Asia/Kolkata'
        WHEN t.to_status = 'enrolment_requested' THEN (t.admission_date + time '16:30') AT TIME ZONE 'Asia/Kolkata'
        WHEN t.to_status = 'enrolled' THEN (t.admission_date + 1 + time '09:00') AT TIME ZONE 'Asia/Kolkata'
        WHEN t.exit_date IS NOT NULL THEN (t.exit_date + time '12:00') AT TIME ZONE 'Asia/Kolkata'
        ELSE t.received_at + (coalesce((t.admission_date + time '10:00') AT TIME ZONE 'Asia/Kolkata', date_trunc('day', now())) - t.received_at) * t.n / (t.c + 1)
      END
    FROM t WHERE t.id = u.id AND (t.admission_date IS NOT NULL OR t.to_status NOT IN ('admitted', 'enrolment_requested', 'enrolled'))`,
  sql`UPDATE ops.admissions a SET
      enrolled_at = CASE WHEN a.enrolled_at IS NULL THEN NULL ELSE (a.admission_date + 1 + time '09:00') AT TIME ZONE 'Asia/Kolkata' END,
      admitted_at = CASE WHEN a.admitted_at IS NULL OR a.admission_date IS NULL THEN a.admitted_at ELSE (a.admission_date + time '16:00') AT TIME ZONE 'Asia/Kolkata' END
    FROM ops.leads l WHERE l.id = a.lead_id AND l.is_sample AND a.admission_date IS NOT NULL`,
  sql`UPDATE ops.appointments ap SET
      objections = coalesce(ap.objections, 'Worried about travel time and the second instalment.'),
      next_step = coalesce(ap.next_step, 'Send the batch timings and call back in a week.'),
      follow_up_on = coalesce(ap.follow_up_on, (ap.starts_at AT TIME ZONE 'Asia/Kolkata')::date + 7),
      recommended_programme_id = coalesce(ap.recommended_programme_id, l.programme_id)
    FROM ops.leads l WHERE l.id = ap.lead_id AND l.is_sample AND ap.status = 'completed'`,
  sql`UPDATE ops.appointments ap SET programme_id = coalesce(ap.programme_id, l.programme_id)
    FROM ops.leads l WHERE l.id = ap.lead_id AND l.is_sample`,
  sql`INSERT INTO ops.contact_preferences (lead_id, consent_status, consent_by, allowed_channels, preferred_contact, note, recorded_by)
    SELECT l.id, CASE WHEN l.do_not_contact THEN 'refused' ELSE 'given' END,
      ${pick(['guardian', 'guardian', 'both', 'student'], 'l.code')},
      CASE WHEN l.do_not_contact THEN ARRAY[]::text[] WHEN abs(hashtext(l.code)) % 3 = 0 THEN ARRAY['call', 'email'] WHEN abs(hashtext(l.code)) % 3 = 1 THEN ARRAY['call', 'whatsapp'] ELSE ARRAY['call', 'whatsapp', 'email'] END,
      CASE WHEN l.do_not_contact THEN NULL ELSE ${pick(['guardian', 'guardian', 'student'], 'l.code')} END,
      CASE WHEN l.do_not_contact THEN 'Parent asked not to be contacted again.' ELSE ${pick(['A call after 6 pm suits best; email for documents.', 'WhatsApp first; calls only on weekends.', 'The student handles messages; the parent wants a call for fees.'], 'l.code')} END,
      l.created_by
    FROM ops.leads l WHERE l.is_sample AND NOT EXISTS (SELECT 1 FROM ops.contact_preferences c WHERE c.lead_id = l.id)`,
];

/** Who the demo teacher meets: [type, student's first name, day, hour, purpose, then what happened]. */
const TEACHER_MEETINGS: readonly {
  type: 'teacher_academic' | 'parent_teacher_meeting';
  first: string;
  day: number;
  hour: number;
  purpose: string;
  status?: 'proposed';
  then?:
    | { action: 'complete'; outcome: string; nextStep: string; followUpIn: number }
    | { action: 'cancel'; reason: string }
    | { action: 'reschedule'; day: number; reason: string }
    | { action: 'confirm' };
}[] = [
  {
    type: 'teacher_academic',
    first: 'Zoya',
    day: 1,
    hour: 16,
    purpose: 'Go through her mock test mistakes in Quant',
    then: { action: 'confirm' },
  },
  {
    type: 'parent_teacher_meeting',
    first: 'Arjun',
    day: 2,
    hour: 17,
    purpose: 'Progress in Quant and homework habits',
  },
  {
    type: 'teacher_academic',
    first: 'Kavya',
    day: 4,
    hour: 15,
    purpose: 'Plan extra practice before the next chapter test',
    status: 'proposed',
  },
  {
    type: 'teacher_academic',
    first: 'Diya',
    day: -3,
    hour: 16,
    purpose: 'Why her last two test scores dropped',
    then: {
      action: 'complete',
      outcome: 'She had missed two classes; agreed a catch-up plan.',
      nextStep: 'Two timed sets a week and a check next Tuesday.',
      followUpIn: 4,
    },
  },
  {
    type: 'parent_teacher_meeting',
    first: 'Rohan',
    day: -6,
    hour: 17,
    purpose: 'Parents asked for a progress review',
    then: {
      action: 'complete',
      outcome: 'Parents are happy with attendance and want more mock tests.',
      nextStep: 'Share the mock test dates with them.',
      followUpIn: 7,
    },
  },
  {
    type: 'teacher_academic',
    first: 'Vihaan',
    day: -1,
    hour: 16,
    purpose: 'Doubts in Number Systems',
    then: { action: 'cancel', reason: 'No-show: the student had a school exam.' },
  },
  {
    type: 'teacher_academic',
    first: 'Anaya',
    day: 3,
    hour: 16,
    purpose: 'Review of the percentage worksheet',
    then: { action: 'reschedule', day: 5, reason: 'A class was moved to that slot.' },
  },
];

/** Events and webinars (the table has no flag of its own: markSampleRows records them). */
const EVENTS: readonly {
  type: 'event' | 'webinar';
  title: string;
  day: number;
  hour: number;
  mode: 'offline' | 'online';
  purpose: string;
  programme: string;
  capacity: number;
  message: string;
  simulate?: true;
  mark?: true;
}[] = [
  {
    type: 'webinar',
    title: 'IPMAT parents’ webinar',
    day: 6,
    hour: 18,
    mode: 'online',
    purpose: 'How IPMAT works and how classes run. No joining link: nothing real is hosted.',
    programme: 'IPMAT',
    capacity: 60,
    message: 'The IPMAT parents’ webinar is next week. Details will follow.',
  },
  {
    type: 'event',
    title: 'CLAT open house',
    day: -5,
    hour: 11,
    mode: 'offline',
    purpose: 'Families meet the CLAT teachers and see a practice class.',
    programme: 'CLAT',
    capacity: 40,
    message: 'Thank you for coming to the CLAT open house.',
    simulate: true,
    mark: true,
  },
];

const anchorDay = () => sampleAnchorDate() as IsoDate;
const iso = (day: number, hour: number) =>
  istInstant(addDays(anchorDay(), day), `${String(hour).padStart(2, '0')}:00`).toISOString();

async function studentByFirst(db: Database) {
  const rows = await db
    .select({
      id: students.id,
      name: students.fullName,
      admissionId: opsAdmissions.id,
      status: opsAdmissions.status,
      leadId: opsAdmissions.leadId,
    })
    .from(students)
    .innerJoin(opsAdmissions, eq(opsAdmissions.studentId, students.id))
    .where(and(eq(students.isSample, true), isNotNull(opsAdmissions.admissionNumber)));
  return (first: string) => rows.find((r) => r.name.startsWith(`${first} `));
}

/**
 * What a person would see on a lead or student: their own details and numbers, and both parents
 * (a lead with no student record holds the other parent as its emergency contact). A converted
 * case already holds all of it: nothing here touches what its signed form printed.
 */
async function fillPeopleDetails(db: Database, actor: Actor) {
  const leads = await db
    .select({ lead: opsLeads, studentId: opsAdmissions.studentId })
    .from(opsLeads)
    .leftJoin(opsAdmissions, eq(opsAdmissions.leadId, opsLeads.id))
    .where(eq(opsLeads.isSample, true));
  const done = new Set<string>();
  for (const { lead, studentId } of leads) {
    const first = lead.studentName.split(' ')[0]!;
    const d = leadDetails(first, lead.guardianRelationship);
    if (!d) continue;
    const empty = Object.entries(d.lead).filter(([k]) => lead[k as keyof typeof d.lead] === null);
    if (empty.length)
      await db.update(opsLeads).set(Object.fromEntries(empty)).where(eq(opsLeads.id, lead.id));
    if (!studentId || done.has(studentId)) continue;
    done.add(studentId);
    await addParents(db, actor, studentId, first, lead.guardianRelationship);
  }
}

/** What each student has done of the checklist, with the books they took and gave back. */
const ONBOARDING: Record<
  string,
  { steps: number; blocked?: string; moves?: ['issue' | 'return' | 'replacement', number, string][] }
> = {
  Zoya: {
    steps: 5,
    moves: [
      ['issue', 1, 'First set issued on joining.'],
      ['replacement', 1, 'Maths book had pages missing; swapped for a new copy.'],
    ],
  },
  Arjun: { steps: 2, moves: [['issue', 1, 'Set issued at the counter.']] },
  Diya: {
    steps: 3,
    blocked: 'The address proof could not be read; waiting for a clearer copy.',
    moves: [['issue', 1, 'Set issued with the timetable.']],
  },
  Kavya: {
    steps: 5,
    moves: [
      ['issue', 2, 'Two sets issued by mistake.'],
      ['return', 1, 'Extra set returned the same week.'],
    ],
  },
  Rohan: { steps: 1 },
  Anaya: { steps: 0 },
  Vihaan: { steps: 2, moves: [['issue', 1, 'First part of the set issued.']] },
  Tanya: { steps: 1 },
};

/** Teacher notes the student profile shows, one per student still studying. */
const TEACHER_NOTES: [string, 'final' | 'draft', string, string, string, string][] = [
  [
    'Zoya',
    'final',
    'Follows new methods quickly and asks good questions.',
    'Attends every class and revises before tests.',
    'Speed in mixed sets.',
    'One timed mixed set a week.',
  ],
  [
    'Arjun',
    'final',
    'Regular with homework; careful with units.',
    'Neat working and steady marks.',
    'Word problems take him too long.',
    'Five word problems a day.',
  ],
  [
    'Diya',
    'draft',
    'Scores dropped after two missed classes.',
    'Strong in algebra when she is present.',
    'Needs the percentage chapter again.',
    'Catch-up class next week.',
  ],
  [
    'Kavya',
    'final',
    'Top of the class in the last two tests.',
    'Explains methods to others in the group.',
    'Sometimes rushes the last section.',
    'Practise full papers under time.',
  ],
  [
    'Rohan',
    'final',
    'Back in study mode after a gap year; keeps up well.',
    'Motivated and on time.',
    'Basic arithmetic has rusted a little.',
    'Ten minutes of mental maths every day.',
  ],
  [
    'Anaya',
    'final',
    'Shy in class but her written work is good.',
    'Accurate with fractions and ratios.',
    'Does not ask when she is stuck.',
    'Ten minutes with the teacher after class on Fridays.',
  ],
  [
    'Vihaan',
    'draft',
    'Missed a doubt session for a school exam.',
    'Picks up shortcuts fast.',
    'Careless slips in long calculations.',
    'Check every answer by estimation.',
  ],
];

/** Cases closed as lost, with the coded reason the closure list offers. */
const LOST: [string, string, string][] = [
  ['Dev', 'Joined another institute closer to home.', 'chose_competitor'],
  ['Ishaan', 'Moved to another city before the demo.', 'location_mode'],
  ['Riya', 'Family will decide again next year.', 'not_interested'],
];

async function casesOf(db: Database, first: string) {
  const { fullName } = knownPerson(first);
  return db
    .select({ id: opsAdmissions.id, status: opsAdmissions.status, leadId: opsAdmissions.leadId })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsLeads.studentName, fullName));
}

/** One lead per person: a parent's second enquiry merged, and a look-alike someone checked and dismissed. */
async function fillDuplicates(db: Database, manager: Actor) {
  const [rehan] = await casesOf(db, 'Rehan');
  const p = knownPerson('Rehan');
  if (rehan && !(await db.$count(opsLeads, eq(opsLeads.studentPhone, p.father.phone)))) {
    const { lead } = await createLead(db, manager, {
      studentName: p.fullName,
      studentPhone: p.father.phone,
      studentEmail: `${p.email.split('@')[0]}.second@example.test`,
      guardianName: p.father.fullName,
      guardianRelationship: 'father',
      guardianPhone: p.mother.phone,
      guardianEmail: p.mother.email,
      programmeCode: 'CLAT',
      interestMode: 'undecided',
      sourceCode: 'REFERRAL',
      acknowledgeDuplicates: { reason: 'Father enquired again from his own phone.' },
      isSample: true,
    } as never);
    await mergeLeads(db, manager, lead.id, rehan.leadId, 'Same student: the father enquired again.');
  }
  if (!(await db.$count(opsDuplicateFlags, eq(opsDuplicateFlags.status, 'dismissed')))) {
    const [[a], [b]] = await Promise.all([casesOf(db, 'Jiya'), casesOf(db, 'Riya')]);
    if (!a || !b) return;
    const [flag] = await db
      .insert(opsDuplicateFlags)
      .values({ leadId: a.leadId, matchedLeadId: b.leadId, level: 'possible', signals: ['similar_name'] })
      .returning({ id: opsDuplicateFlags.id });
    await dismissDuplicateFlag(db, manager, flag!.id, 'Different families: checked with both parents.');
  }
}

export async function seedFillAdmissions(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  if (!manager?.staffId || !counsellor?.staffId)
    return log('ops.fill-admissions skipped: no sample staff');
  // First, so the second enquiry it adds gets the details and preferences below in the same run.
  await fillDuplicates(db, manager.actor);
  await fillPeopleDetails(db, manager.actor);
  for (const statement of FILLS) await db.execute(statement);
  const anchor = anchorDay();
  const student = await studentByFirst(db);

  for (const [first, reason, reasonCode] of LOST)
    for (const c of await casesOf(db, first))
      if (c.status !== 'lost')
        await transitionAdmission(db, manager.actor, c.id, { to: 'lost', reason, reasonCode });

  // Students related to each other, linked by staff (never merged).
  for (const [x, y, note] of [
    ['Zoya', 'Kavya', 'Cousins in the same household.'],
    ['Arjun', 'Harini', 'Cousins; the families share a fee reminder.'],
  ] as const) {
    const [a, b] = [student(x), (await casesOf(db, y))[0]];
    const [other] = b
      ? await db
          .select({ id: opsAdmissions.studentId })
          .from(opsAdmissions)
          .where(eq(opsAdmissions.id, b.id))
      : [];
    if (!a || !other?.id) continue;
    const [lo, hi] = [a.id as string, other.id as string].sort();
    if (
      !(await db.$count(
        opsStudentSiblings,
        and(
          eq(opsStudentSiblings.studentId, lo as never),
          eq(opsStudentSiblings.siblingStudentId, hi as never),
        ),
      ))
    )
      await linkSibling(db, manager.actor, a.id, { siblingStudentId: other.id, note });
  }

  // A parent's details updated after joining, so the record says who changed them.
  const kavya = student('Kavya');
  if (kavya) {
    const [g] = await db
      .select({ id: opsGuardians.id, updatedBy: opsGuardians.updatedBy })
      .from(opsGuardians)
      .where(and(eq(opsGuardians.studentId, kavya.id), eq(opsGuardians.isPrimary, true)));
    if (g && !g.updatedBy)
      await updateGuardian(db, manager.actor, kavya.id, g.id, {
        notes: 'Asked for fee reminders by email from now on.',
        preferredContact: 'email',
      } as never);
  }

  // Onboarding for the students still studying: real checklist, real status events.
  if (!(await db.$count(opsOnboardingItems))) {
    for (const [first, plan] of Object.entries(ONBOARDING)) {
      const s = student(first);
      if (s?.status !== 'enrolled' && s?.status !== 'admitted') continue;
      await changeChecklist(db, manager.actor, s.id, {
        action: 'generate',
        admissionId: s.admissionId,
      });
      const items = await db
        .select()
        .from(opsOnboardingItems)
        .where(eq(opsOnboardingItems.admissionId, s.admissionId));
      const item = (key: string) => items.find((i) => i.itemKey === key);
      const notes: [string, 'in_progress' | 'completed' | 'blocked', string, string?][] = [
        ['batch_allocation', 'completed', 'Placed in the batch.'],
        ['counselling', 'completed', 'Onboarding talk held with the parent.'],
        plan.blocked
          ? ['kyc_verification', 'blocked', plan.blocked]
          : ['kyc_verification', 'completed', 'All documents checked against originals.'],
        ['id_card', 'in_progress', 'Photo taken; card not printed yet.'],
        [
          'biometric_registration',
          'completed',
          'Registered on the attendance device.',
          `BIO-2026-${String(100 + first.length * 7)}`,
        ],
      ];
      for (const [key, status, note, evidenceRef] of notes.slice(0, plan.steps)) {
        const it = item(key);
        if (it)
          await recordItemStatus(db, manager.actor, s.id, it.id, {
            status,
            note,
            ...(evidenceRef ? { evidenceRef } : {}),
            ownerStaffId: counsellor.staffId,
            dueDate: addDays(anchor, 7),
          } as never);
      }
      const set = items.find((i) => i.kind === 'material');
      for (const [i, [kind, quantity, note]] of (plan.moves ?? []).entries())
        if (set)
          await recordMaterial(db, manager.actor, s.id, {
            itemId: set.id,
            kind,
            quantity,
            edition: i ? '2026-27 reprint' : '2026-27',
            issuedOn: addDays(anchor, -6 + i * 3),
            note,
          } as never);
    }
  }

  // The demo teacher's meetings, in each state.
  const teacher = await seedActor(db, DEMO_TEACHER_EMAIL);
  if (
    teacher?.staffId &&
    !(await db.$count(opsAppointments, eq(opsAppointments.staffId, teacher.staffId)))
  ) {
    for (const m of TEACHER_MEETINGS) {
      const s = student(m.first);
      if (!s) continue;
      const guardians =
        m.type === 'parent_teacher_meeting'
          ? await db
              .select({ id: opsGuardians.id })
              .from(opsGuardians)
              .where(eq(opsGuardians.studentId, s.id))
              .limit(1)
          : [];
      const row = await scheduleAppointment(db, manager.actor, {
        type: m.type,
        staffId: teacher.staffId,
        startsAt: iso(m.day, m.hour),
        mode: 'offline',
        location: 'Sikar centre, staff room',
        studentId: s.id,
        subject: 'Quantitative Aptitude',
        purpose: m.purpose,
        status: m.status ?? 'scheduled',
        otherStaffIds: [],
        guardianIds: guardians.map((g) => g.id),
      } as never);
      const t = m.then;
      if (!t) continue;
      const change =
        t.action === 'complete'
          ? {
              action: t.action,
              outcome: t.outcome,
              nextStep: t.nextStep,
              followUpOn: addDays(anchor, t.followUpIn),
            }
          : t.action === 'reschedule'
            ? { action: t.action, startsAt: iso(t.day, m.hour), reason: t.reason }
            : t;
      await changeAppointment(db, manager.actor, row.id, change as never);
    }
  }

  // Events with their audience, a message and attendance.
  const known = await db
    .select({ title: opsAppointments.title })
    .from(opsAppointments)
    .where(inArray(opsAppointments.id, (await sampleRowIds(db, 'ops.appointments')) as never[]));
  for (const e of EVENTS) {
    if (known.some((k) => k.title === e.title)) continue;
    const row = await scheduleEvent(db, manager.actor, {
      type: e.type,
      title: e.title,
      location: e.mode === 'offline' ? 'Sikar centre, seminar hall' : null,
      capacity: e.capacity,
      purpose: e.purpose,
      audience: { populations: [], programmeCodes: [e.programme], stages: [], batchIds: [] },
      startsAt: iso(e.day, e.hour),
      durationMinutes: 60,
      timezone: 'Asia/Kolkata',
      mode: e.mode,
      participantStudentIds: ['Zoya', 'Arjun', 'Kavya'].flatMap((f) => student(f)?.id ?? []),
    } as never);
    await markSampleRows(db, 'ops.appointments', [row.id]);
    const draft = await draftEventMessage(db, manager.actor, row.id, {
      channel: 'in_app',
      body: e.message,
    } as never);
    // `simulated` = the mock adapter ran and said so; nothing leaves the app.
    if (e.simulate) await sendEventMessage(db, manager.actor, row.id, (draft as { id: string }).id);
    if (e.mark) {
      const people = await db
        .select({ id: opsAppointmentParticipants.id })
        .from(opsAppointmentParticipants)
        .where(eq(opsAppointmentParticipants.appointmentId, row.id));
      for (const [i, p] of people.entries())
        await changeParticipant(db, manager.actor, row.id, {
          action: 'update',
          participantId: p.id,
          attendance: i % 3 === 2 ? 'absent' : 'present',
        } as never);
    }
  }

  // Teacher notes on students that the student profile shows (final and draft).
  const writer = await seedActor(db, 'arjun.menon@example.test');
  if (writer?.staffId && !(await db.$count(opsTeacherStudentFeedback))) {
    for (const [first, status, observations, strengths, areasToImprove, actionPlan] of TEACHER_NOTES) {
      const s = student(first);
      if (s)
        await db.insert(opsTeacherStudentFeedback).values({
          teacherStaffId: writer.staffId,
          studentId: s.id,
          subject: 'Quantitative Aptitude',
          observedOn: addDays(anchor, -4),
          observations,
          strengths,
          areasToImprove,
          actionPlan,
          status,
          createdBy: writer.actor.id,
        });
    }
  }

  // One readmission through the real path (a new case at admission pending).
  const left = student('Reyansh');
  // Only once the student has left: a held-back enrolment request keeps Reyansh from exiting.
  if (
    left &&
    isExitStatus(left.status) &&
    !(await db.$count(opsApplications, eq(opsApplications.origin, 'readmission')))
  ) {
    await changeStudentLifecycle(db, manager.actor, left.admissionId, {
      action: 'readmit',
      reason: 'Family moved back to Sikar and asked to rejoin.',
      academicYear: null,
    } as never);
    await db
      .update(opsLeads)
      .set({ notes: 'Left on transfer, now asking to rejoin.' })
      .where(eq(opsLeads.id, left.leadId));
  }
  log(`ops.fill-admissions: details filled around ${anchor}`);
}
