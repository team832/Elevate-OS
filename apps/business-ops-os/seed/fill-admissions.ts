/**
 * Owner, 31 Oct 2026: fill Business Operations: lead and enquiry details, guardians, exit records,
 * contact preferences, documents, onboarding, materials, meetings for the demo teacher, events and
 * a readmission. One table of statements fills what is still empty on sample rows (real rows are
 * never touched); the rest goes through the real services.
 * Left as they are, by the sample rule "never fake an approval, a signed form, a declaration or a
 * payment": verified documents, signature confirmations, final confirmations, admission approvals.
 * Phones are the fake block only (db:check enforces it). Safe to run again.
 */
import { and, eq, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';
import { markSampleRows, samplePerson, sampleRowIds } from '@elevate/database/seed';
import {
  opsAdmissions,
  opsAppointmentParticipants,
  opsAppointments,
  opsApplications,
  opsGuardians,
  opsKycDocuments,
  opsLeads,
  opsOnboardingItems,
  opsStudentSiblings,
  opsTeacherStudentFeedback,
  students,
  type Database,
} from '@elevate/database';
import { addDays, istInstant, type IsoDate } from '../src/domain/dates';
import { isExitStatus } from '../src/domain/student-lifecycle';
import { changeAppointment, scheduleAppointment } from '../src/server/appointments';
import { withdrawApplication } from '../src/server/applications-signing';
import {
  changeParticipant,
  draftEventMessage,
  scheduleEvent,
  sendEventMessage,
} from '../src/server/events';
import { changeChecklist, recordItemStatus, recordMaterial } from '../src/server/onboarding';
import { changeStudentLifecycle } from '../src/server/student-lifecycle';
import { addGuardian } from '../src/server/students';
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
      notes = coalesce(notes, ${pick(['Prefers morning classes; travels from outside Sikar (sample).', 'Parent wants to compare two programmes before deciding (sample).', 'Heard about us from a friend already in a batch (sample).', 'Asked about hostel options near the centre (sample).'], 'code')})
    WHERE is_sample`,
  sql`UPDATE ops.enquiries e SET
      channel = coalesce(e.channel, CASE WHEN e.source_code IN ('WALK_IN', 'SEMINAR') THEN 'In person' WHEN e.source_code LIKE '%ADS' THEN 'Website form' ELSE 'Call' END),
      discovery_source = coalesce(e.discovery_source, initcap(replace(lower(e.source_code), '_', ' '))),
      notes = coalesce(e.notes, 'Asked about batch timings, fee instalments and demo classes (sample).')
    FROM ops.leads l WHERE l.id = e.lead_id AND l.is_sample`,
  sql`UPDATE ops.guardians g SET
      notes = coalesce(g.notes, 'Evenings suit best (sample).')
    FROM core.students s WHERE s.id = g.student_id AND s.is_sample`,
  sql`UPDATE ops.exit_records x SET
      exit_feedback = coalesce(x.exit_feedback, CASE x.exit_status
        WHEN 'completed' THEN 'Finished the course and gave the batch a good review (sample).'
        WHEN 'transferred' THEN 'Family moved city; asked for a transfer letter (sample).'
        WHEN 'withdrawn' THEN 'Found the schedule hard alongside school (sample).'
        ELSE 'Changed plans before the first class (sample).' END),
      reason_code = coalesce(x.reason_code, CASE x.exit_status
        WHEN 'withdrawn' THEN 'timing_schedule'
        WHEN 'transferred' THEN 'location_mode'
        WHEN 'cancelled_before_enrolment' THEN 'not_interested' END),
      guardian_feedback = coalesce(x.guardian_feedback, 'The parent thanked the teachers and asked for the fee statement (sample).'),
      fee_reference = coalesce(x.fee_reference, 'See the fee statement on this record (sample).'),
      closing_notes = coalesce(x.closing_notes, 'Study material and dues checked at exit (sample).'),
      material_status = CASE WHEN x.material_status = 'not_recorded' AND x.exit_status <> 'cancelled_before_enrolment' THEN 'returned' ELSE x.material_status END
    FROM ops.admissions a JOIN ops.leads l ON l.id = a.lead_id
    WHERE a.id = x.admission_id AND l.is_sample`,
  sql`UPDATE ops.appointments ap SET
      objections = coalesce(ap.objections, 'Worried about travel time and the second instalment (sample).'),
      next_step = coalesce(ap.next_step, 'Send the batch timings and call back in a week (sample).'),
      follow_up_on = coalesce(ap.follow_up_on, (ap.starts_at AT TIME ZONE 'Asia/Kolkata')::date + 7),
      recommended_programme_id = coalesce(ap.recommended_programme_id, l.programme_id)
    FROM ops.leads l WHERE l.id = ap.lead_id AND l.is_sample AND ap.status = 'completed'`,
  sql`UPDATE ops.appointments ap SET programme_id = coalesce(ap.programme_id, l.programme_id)
    FROM ops.leads l WHERE l.id = ap.lead_id AND l.is_sample`,
  sql`INSERT INTO ops.contact_preferences (lead_id, consent_status, consent_by, allowed_channels, preferred_contact, note, recorded_by)
    SELECT l.id, CASE WHEN l.do_not_contact THEN 'refused' ELSE 'given' END, 'guardian',
      CASE WHEN l.do_not_contact THEN ARRAY[]::text[] ELSE ARRAY['call', 'email'] END,
      CASE WHEN l.do_not_contact THEN NULL ELSE 'guardian' END,
      CASE WHEN l.do_not_contact THEN 'Parent asked not to be contacted again (sample).' ELSE 'A call after 6 pm suits best; email for documents (sample).' END,
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
      outcome: 'She had missed two classes; agreed a catch-up plan (sample).',
      nextStep: 'Two timed sets a week and a check next Tuesday (sample).',
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
      outcome: 'Parents are happy with attendance and want more mock tests (sample).',
      nextStep: 'Share the mock test dates with them (sample).',
      followUpIn: 7,
    },
  },
  {
    type: 'teacher_academic',
    first: 'Vihaan',
    day: -1,
    hour: 16,
    purpose: 'Doubts in Number Systems',
    then: { action: 'cancel', reason: 'No-show: the student had a school exam (sample).' },
  },
  {
    type: 'teacher_academic',
    first: 'Anaya',
    day: 3,
    hour: 16,
    purpose: 'Review of the percentage worksheet',
    then: { action: 'reschedule', day: 5, reason: 'A class was moved to that slot (sample).' },
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
    message: 'The IPMAT parents’ webinar is next week. Details will follow (sample).',
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
    message: 'Thank you for coming to the CLAT open house (sample).',
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
 * (a lead with no student record holds the other parent as its emergency contact).
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
    const p = samplePerson(first);
    if (!p) continue;
    const [parent, other] =
      lead.guardianRelationship === 'father' ? [p.father, p.mother] : [p.mother, p.father];
    const wanted = {
      preferredName: first,
      studentPhone: p.phone,
      guardianPhone: parent.phone,
      city: p.city,
      schoolBoard: p.board,
      previousSchool: p.school,
      dateOfBirth: p.dateOfBirth,
      address: p.address,
      emergencyContactName: other.fullName,
      emergencyContactPhone: other.phone,
    };
    const empty = Object.entries(wanted).filter(([k]) => lead[k as keyof typeof wanted] === null);
    if (empty.length)
      await db
        .update(opsLeads)
        .set(Object.fromEntries(empty))
        .where(eq(opsLeads.id, lead.id));
    if (!studentId || done.has(studentId)) continue;
    done.add(studentId);
    const live = await db
      .select({ email: opsGuardians.email })
      .from(opsGuardians)
      .where(eq(opsGuardians.studentId, studentId));
    for (const g of [parent, other]) {
      if (live.some((x) => x.email === g.email)) continue;
      await addGuardian(db, actor, studentId, {
        fullName: g.fullName,
        relationship: g.relationship,
        email: g.email,
        phone: g.phone,
        address: p.address,
        isEmergency: g === other,
        preferredContact: 'call',
        consentStatus: 'not_recorded',
      } as never);
    }
    await db
      .update(opsGuardians)
      .set({ address: p.address })
      .where(and(eq(opsGuardians.studentId, studentId), isNull(opsGuardians.address)));
  }
}

export async function seedFillAdmissions(db: Database, log: (m: string) => void = () => {}) {
  const manager = await seedActor(db, 'operations-manager@example.test');
  const counsellor = await seedActor(db, 'admissions-counsellor@example.test');
  if (!manager?.staffId || !counsellor?.staffId)
    return log('ops.fill-admissions skipped: no sample staff');
  await fillPeopleDetails(db, manager.actor);
  for (const statement of FILLS) await db.execute(statement);
  const anchor = anchorDay();
  const student = await studentByFirst(db);

  // Identity documents: what staff record, never verified (a verification is a fake approval).
  if (!(await db.$count(opsKycDocuments))) {
    const docs: [string, string, string, string?][] = [
      ['Zoya', 'school_id', 'XXXX-1021'],
      ['Arjun', 'school_id', 'XXXX-1022'],
      ['Arjun', 'previous_marksheet', 'XXXX-2022'],
      [
        'Diya',
        'address_proof',
        'XXXX-3041',
        'The address on the copy cannot be read; ask for a clearer copy (sample).',
      ],
    ];
    for (const [first, documentType, maskedReference, rejected] of docs) {
      const s = student(first);
      if (s)
        await db.insert(opsKycDocuments).values({
          studentId: s.id,
          subjectType: 'student',
          documentType,
          maskedReference,
          ...(rejected
            ? {
                verificationStatus: 'rejected' as const,
                verificationNote: rejected,
                verifiedBy: manager.actor.id,
                verifiedAt: istInstant(anchor, '10:00'),
              }
            : {}),
          createdBy: manager.actor.id,
        });
    }
  }
  const [zoya, kavya] = [student('Zoya'), student('Kavya')];
  if (zoya && kavya) {
    const [a, b] = [zoya.id, kavya.id].sort();
    await db
      .insert(opsStudentSiblings)
      .values({
        studentId: a!,
        siblingStudentId: b!,
        note: 'Cousins in the same household (sample).',
        createdBy: manager.actor.id,
      })
      .onConflictDoNothing();
  }

  // Onboarding for the students still studying: real checklist, real status events.
  if (!(await db.$count(opsOnboardingItems))) {
    const progress: Record<string, number> = {
      Zoya: 4,
      Arjun: 2,
      Diya: 3,
      Kavya: 4,
      Rohan: 1,
      Anaya: 0,
      Vihaan: 2,
    };
    for (const [first, steps] of Object.entries(progress)) {
      const s = student(first);
      if (s?.status !== 'enrolled') continue;
      await changeChecklist(db, manager.actor, s.id, {
        action: 'generate',
        admissionId: s.admissionId,
      });
      const items = await db
        .select()
        .from(opsOnboardingItems)
        .where(eq(opsOnboardingItems.admissionId, s.admissionId));
      const item = (key: string) => items.find((i) => i.itemKey === key);
      const notes: [string, 'in_progress' | 'completed' | 'blocked', string][] = [
        ['batch_allocation', 'completed', 'Placed in the sample batch (sample).'],
        ['counselling', 'completed', 'Onboarding talk held with the parent (sample).'],
        [
          'kyc_verification',
          'blocked',
          'The address proof could not be read; waiting for a clearer copy (sample).',
        ],
        ['id_card', 'in_progress', 'Photo taken; card not printed yet (sample).'],
      ];
      for (const [key, status, note] of notes.slice(0, steps)) {
        const it = item(key);
        if (it)
          await recordItemStatus(db, manager.actor, s.id, it.id, {
            status,
            note,
            ownerStaffId: counsellor.staffId,
            dueDate: addDays(anchor, 7),
          } as never);
      }
      const set = items.find((i) => i.kind === 'material');
      if (set && steps > 1)
        await recordMaterial(db, manager.actor, s.id, {
          itemId: set.id,
          kind: 'issue',
          quantity: 1,
          edition: '2026-27',
          issuedOn: addDays(anchor, -3),
          note: 'First part of the set issued (sample).',
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
    .where(inArray(opsAppointments.id, await sampleRowIds(db, 'ops.appointments')));
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
    const notes: [string, 'final' | 'draft', string, string, string][] = [
      [
        'Zoya',
        'final',
        'Follows new methods quickly and asks good questions.',
        'Speed in mixed sets.',
        'One timed mixed set a week.',
      ],
      [
        'Arjun',
        'final',
        'Regular with homework; careful with units.',
        'Word problems take him too long.',
        'Five word problems a day.',
      ],
      [
        'Diya',
        'draft',
        'Scores dropped after two missed classes.',
        'Needs the percentage chapter again.',
        'Catch-up class next week.',
      ],
    ];
    for (const [first, status, observations, areasToImprove, actionPlan] of notes) {
      const s = student(first);
      if (s)
        await db.insert(opsTeacherStudentFeedback).values({
          teacherStaffId: writer.staffId,
          studentId: s.id,
          subject: 'Quantitative Aptitude',
          observedOn: addDays(anchor, -4),
          observations: `${observations} (sample)`,
          strengths: 'Attends regularly (sample).',
          areasToImprove: `${areasToImprove} (sample)`,
          actionPlan: `${actionPlan} (sample)`,
          status,
          createdBy: writer.actor.id,
        });
    }
  }

  // One readmission through the real path (a new case at admission pending) and one withdrawn application.
  const left = student('Reyansh');
  // Only once the student has left: a held-back enrolment request keeps Reyansh from exiting.
  if (
    left &&
    isExitStatus(left.status) &&
    !(await db.$count(opsApplications, eq(opsApplications.origin, 'readmission')))
  ) {
    await changeStudentLifecycle(db, manager.actor, left.admissionId, {
      action: 'readmit',
      reason: 'Family moved back to Sikar and asked to rejoin (sample).',
      academicYear: null,
    } as never);
    await db
      .update(opsLeads)
      .set({ notes: 'Left on transfer, now asking to rejoin (sample).' })
      .where(eq(opsLeads.id, left.leadId));
  }
  const open = await db
    .select({ id: opsApplications.id, status: opsApplications.status, name: opsLeads.studentName })
    .from(opsApplications)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(and(eq(opsLeads.isSample, true), like(opsLeads.studentName, 'Sana %')));
  for (const app of open)
    if (app.status === 'draft')
      await withdrawApplication(db, manager.actor, app.id, {
        reason: 'The family cancelled before enrolment (sample).',
      } as never);
  log(`ops.fill-admissions: details filled around ${anchor}`);
}
