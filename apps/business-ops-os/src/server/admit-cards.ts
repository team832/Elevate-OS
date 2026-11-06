/**
 * Admit cards in Business Ops (F4-03). Roll numbers, venue and instructions live on the test in
 * Academic (internal route, `academic.admit_cards` v1; Ops keeps no copy). Ops prints the cards,
 * two per A4, for the whole test or one batch. With setting `tests.admit_card_block_defaulters`
 * on, students with a tuition instalment past its due date (the Overdue fees rule) get no card and
 * are listed on the test page instead. Academic is never called inside a transaction.
 */
import { and, inArray, isNotNull } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { opsAdmissions, type Database } from '@elevate/database';
import { fetchInternal, sendInternal } from '@elevate/server-kit';
import {
  academicAdmitCardsV1Schema,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  sourceReasonWords,
  type AcademicAdmitCardsV1,
  type AdmitCardWrite,
} from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { academicUrl } from './academic-summary';
import { assertCan, refusal } from './assessments';
import type { Actor } from './context';
import { outstandingInstalments } from './fee-collections';
import { admitCardsPdf } from './pdf/admit-card';
import { loadSettings } from './settings';

const url = (id: string) =>
  academicUrl(`/academic/api/internal/v1/assessments/${encodeURIComponent(id)}/admit-cards`);

/** Academic's admit-card record; `unavailable` is shown as "Source unavailable". */
export async function admitCardRecord(actor: Actor, id: string) {
  assertCan(actor, 'ops:assessments:manage');
  const r = await fetchInternal(url(id), academicAdmitCardsV1Schema, {
    caller: 'ops',
    timeoutMs: 8000,
  });
  if (r.status === 'unavailable' && r.reason === 'HTTP 404')
    throw new NotFoundError('Test not found.');
  return r;
}

/** Give roll numbers, or set the venue and instructions, in Academic as the acting user. */
export async function writeAdmitCards(actor: Actor, id: string, body: AdmitCardWrite) {
  assertCan(actor, 'ops:assessments:manage');
  const r = await sendInternal(url(id), academicAdmitCardsV1Schema, {
    caller: 'ops',
    actingUserId: actor.id,
    body,
  });
  if (!r.ok) throw refusal(r);
  return r.data;
}

/** Who gets a card (one batch or all), who is left out for overdue fees, and the instructions. */
export async function admitCardPlan(
  db: Database,
  actor: Actor,
  d: AcademicAdmitCardsV1,
  batchId?: string,
) {
  const settings = await loadSettings(db);
  const leaveOut = settings['tests.admit_card_block_defaulters'].value.leaveOut;
  if (leaveOut && !can(actor, 'ops:fees:read'))
    throw new ForbiddenError('Leaving out students with overdue fees needs fee access.');
  const overdue = new Set(
    leaveOut
      ? (await outstandingInstalments(db, actor))
          .filter((i) => i.status === 'overdue')
          .map((i) => i.studentId as string)
      : [],
  );
  // The student's admission number now (Ops owns it), not the copy taken with the roster.
  const ids = d.rows.flatMap((r) => (r.coreStudentId ? [r.coreStudentId] : []));
  const numbers = new Map(
    (ids.length
      ? await db
          .select({ id: opsAdmissions.studentId, number: opsAdmissions.admissionNumber })
          .from(opsAdmissions)
          .where(
            and(
              inArray(opsAdmissions.studentId, ids as StudentIdentityId[]),
              isNotNull(opsAdmissions.admissionNumber),
            ),
          )
      : []
    ).map((a) => [a.id as string, a.number]),
  );
  const rows = d.rows
    .filter((r) => !batchId || r.batchId === batchId)
    .map((r) => ({
      ...r,
      admissionNumber: (r.coreStudentId && numbers.get(r.coreStudentId)) || r.admissionNumber,
    }));
  const blocked = (r: (typeof rows)[number]) =>
    Boolean(r.coreStudentId && overdue.has(r.coreStudentId));
  return {
    leaveOut,
    cards: rows.filter((r) => !blocked(r)),
    leftOut: rows.filter(blocked),
    instructions: d.assessment.instructions ?? settings['tests.admit_card_instructions'].value.text,
  };
}

/** The cards PDF: refused until every card to print has its roll number. */
export async function admitCardsPdfFor(db: Database, actor: Actor, id: string, batchId?: string) {
  const r = await admitCardRecord(actor, id);
  if (r.status !== 'available')
    throw new ConflictError(
      `Academic OS could not be read (${sourceReasonWords(r.reason)}). Try again in a minute.`,
    );
  if (r.data.assessment.status === 'cancelled')
    throw new ConflictError('This test is cancelled: no admit cards are printed.');
  const plan = await admitCardPlan(db, actor, r.data, batchId);
  if (!plan.cards.length) throw new ConflictError('No admit card to print for this choice.');
  if (plan.cards.some((c) => c.rollNumber === null))
    throw new ConflictError('Give roll numbers first (Admit cards, on the test page).');
  const pdf = await admitCardsPdf(r.data, plan.cards, plan.instructions);
  return { bytes: pdf.bytes, filename: `admit-cards-${r.data.assessment.code}.pdf` };
}
