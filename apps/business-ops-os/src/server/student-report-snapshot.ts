/**
 * The frozen snapshot of a student report (split from ./student-report): Academic evidence,
 * reviews, KYC, guardians and fee totals, cut to the kind (D-078) and the author's permissions.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { can } from '@elevate/authorization';
import { opsLeads, type Database } from '@elevate/database';
import type { StudentIdentityId } from '@elevate/shared-types';
import { ADMISSION_STATUS_LABELS, istToday, type AdmissionStatus } from '../domain';
import { documentChecklist } from '../domain/admission-form';
import { ageOn } from '../domain/applications';
import { FEE_BALANCE_LABELS } from '../domain/fees';
import {
  constructiveSummary,
  inIstPeriod,
  isFamily,
  REPORT_TEMPLATE_VERSION,
  toneOf,
  type ReportPermissions,
  type ReportSection,
} from '../domain/student-report';
import { reviewDate, studentReviews } from './academic-reviews';
import { academicEvidence } from './academic-summary';
import type { Actor } from './context';
import { getStudentKyc } from './kyc';
import type { reportBody } from './report-schemas';
import type { getStudent } from './students';

type Profile = Awaited<ReturnType<typeof getStudent>>;
const statusLabel = (s: string) => ADMISSION_STATUS_LABELS[s as AdmissionStatus] ?? s;

export function permissionsOf(actor: Actor, profile: Profile): ReportPermissions {
  return {
    fees: can(actor, 'ops:fees:read'),
    privateData: profile.guardians !== 'hidden',
    // Own-scope readers (counsellors) get only the reviews their scope allows (academic-reviews.ts).
    feedback: can(actor, 'ops:feedback:read'),
  };
}

/**
 * Current submitted Academic reviews about the period, oldest first (withdrawn hidden, reader's
 * scope applied by studentReviews). `null` when Academic could not be read.
 */
async function submittedReviews(
  db: Database,
  actor: Actor,
  studentId: StudentIdentityId,
  from: string,
  to: string,
) {
  const r = await studentReviews(db, actor, studentId);
  if (r.status === 'unavailable') return { source: r, reviews: null };
  const reviews = r.reviews
    .filter((x) => !x.superseded && reviewDate(x) >= from && reviewDate(x) <= to)
    .sort((x, y) => reviewDate(x).localeCompare(reviewDate(y)));
  return { source: r, reviews };
}

/**
 * KYC block of the internal kind (D-078): DOB and age, class, school, city, guardians with
 * contacts, document checklist. Built only when the author may read private data; getStudentKyc
 * re-checks `ops:student_private:read` and own scope on the server.
 */
async function kycFacts(db: Database, actor: Actor, profile: Profile) {
  const p = profile.person;
  const [[lead], kyc] = await Promise.all([
    db
      .select({ dateOfBirth: opsLeads.dateOfBirth })
      .from(opsLeads)
      .where(eq(opsLeads.id, p.leadId)),
    getStudentKyc(db, actor, profile.identity!.id),
  ]);
  const dateOfBirth = lead?.dateOfBirth ?? null;
  const guardians = profile.guardians === 'hidden' ? [] : profile.guardians;
  return {
    dateOfBirth,
    age: ageOn(dateOfBirth, istToday(new Date())),
    class: p.currentStage,
    board: p.schoolBoard,
    school: p.previousSchool ?? null,
    city: p.city ?? null,
    guardians: guardians
      .filter((g) => !g.archivedAt)
      .map((g) => ({
        name: g.fullName,
        relationship: g.relationship,
        phone: g.phone,
        email: g.email,
        consent: g.consentStatus,
      })),
    documents: documentChecklist(
      kyc.documents.filter((d) => d.current && d.subjectType === 'student'),
    ),
  };
}

export async function buildSnapshot(
  db: Database,
  actor: Actor,
  profile: Profile,
  input: z.output<typeof reportBody>,
  sections: ReportSection[],
) {
  const has = (s: ReportSection) => sections.includes(s);
  const period = { from: input.from, to: input.to };
  const studentId = profile.identity!.id as StudentIdentityId;
  const [academic, submitted] = await Promise.all([
    has('results') || has('attendance') || has('summary')
      ? academicEvidence(db, profile.academic.studentId, period)
      : null,
    // Needs ops:feedback:read; the reader's scope is applied again in studentReviews.
    (has('feedback') || has('summary')) && can(actor, 'ops:feedback:read')
      ? submittedReviews(db, actor, studentId, input.from, input.to)
      : null,
  ]);
  const family = isFamily(input.audience);
  const reviews = submitted?.reviews ?? [];
  // Family kinds: shareable reviews only, the 3 most recent (every PTM list is capped at 3).
  const shown = family ? reviews.filter((r) => r.visibility === 'shareable').slice(-3) : reviews;
  const available = academic?.status === 'available' ? academic : null;
  const snapshot = {
    template: REPORT_TEMPLATE_VERSION,
    audience: input.audience,
    /** The report kind (= audience) and wording tone, stored so a report prints the same later. */
    kind: input.audience,
    tone: toneOf(input.audience),
    sections,
    period,
    acknowledgement: input.acknowledgement,
    student: {
      name: profile.person.fullName,
      admissionNumber: profile.admission.admissionNumber,
      isSample: profile.identity!.isSample,
      counsellor: profile.owner?.fullName ?? null,
    },
    programmes: profile.cases.map((c) => ({
      programme: c.programme?.name ?? 'Not recorded',
      batch: c.enrolledBatchId
        ? (available?.enrolments.find((e) => e.programmeCode === c.programme?.code)?.batchName ??
          'Assigned in Academic OS')
        : c.intendedBatchId
          ? 'Requested from Academic OS'
          : 'To be assigned',
      status: c.statusLabel,
    })),
    academic,
    history:
      has('overview') && !['guardian', 'student'].includes(input.audience)
        ? {
            changes: profile.history
              .filter((h) => inIstPeriod(h.at, input.from, input.to))
              .map((h) => ({
                at: new Date(h.at).toISOString(),
                status: statusLabel(h.toStatus),
                reason: h.reason,
              })),
            exits: profile.exitRecords
              .filter((x) => inIstPeriod(x.recordedAt, input.from, input.to))
              .map((x) => ({
                status: statusLabel(x.exitStatus),
                date: x.exitDate,
                reason: x.reason,
              })),
          }
        : undefined,
    /** Where the reviews came from (Academic OS) and when; `unavailable` is never "no reviews". */
    reviewsSource: submitted
      ? {
          status: submitted.source.status,
          checkedAt: submitted.source.checkedAt,
          ...(submitted.source.status === 'unavailable' ? { reason: submitted.source.reason } : {}),
        }
      : undefined,
    feedback: has('feedback')
      ? shown.map((r) => ({
          id: r.reviewKey,
          teacher: r.authorName,
          subject: r.subjectName ?? 'Subject not recorded',
          observedOn: reviewDate(r),
          type: r.reviewType,
          version: r.version,
          visibility: r.visibility,
          strengths: r.strengths,
          areasToImprove: r.areasForSupport,
          actionPlan: r.suggestedAction,
          // Internal evidence fields: never in family kinds (acceptance 15).
          ...(family
            ? {}
            : {
                attendanceEvidence: r.attendanceEvidence,
                homeworkEvidence: r.homeworkEvidence,
                academicConcerns: r.academicConcerns,
              }),
        }))
      : undefined,
    // Only the three shareable fields of shareable reviews; internal remarks are never read here.
    summary: has('summary')
      ? constructiveSummary(
          {
            attendance: available?.attendance ?? null,
            results: available
              ? available.results.map(({ percent: _p, comparison: _c, rescored: _r, ...r }) => r)
              : null,
            feedback: submitted?.reviews
              ? shown
                  .filter((r) => r.visibility === 'shareable')
                  .map((r) => ({
                    subject: r.subjectName ?? 'Subject not recorded',
                    strengths: r.strengths,
                    areasToImprove: r.areasForSupport,
                    actionPlan: r.suggestedAction,
                  }))
              : null,
          },
          { tone: toneOf(input.audience) },
        )
      : undefined,
    kyc: has('kyc') ? await kycFacts(db, actor, profile) : undefined,
    guardians:
      has('guardians') && profile.guardians !== 'hidden'
        ? profile.guardians
            .filter((g) => !g.archivedAt)
            .map((g) => ({
              name: g.fullName,
              relationship: g.relationship,
              consent: g.consentStatus,
            }))
        : undefined,
    // Totals only (a statement): no payment rows, methods or receipts.
    fees:
      has('fees') && profile.fees
        ? {
            duePaise: profile.fees.duePaise,
            netReceivedPaise: profile.fees.netReceivedPaise,
            balancePaise: profile.fees.balancePaise,
            balance: FEE_BALANCE_LABELS[profile.fees.balanceState],
            disclaimer: profile.fees.disclaimer,
          }
        : undefined,
  };
  const sourceRefs = {
    academicStudentId: profile.academic.studentId,
    academic: academic
      ? {
          status: academic.status,
          checkedAt: 'checkedAt' in academic ? academic.checkedAt : null,
          assessmentIds: available?.results.map((r) => r.assessmentId) ?? [],
        }
      : null,
    reviews: reviews.map((r) => ({ reviewKey: r.reviewKey, version: r.version })),
    admissionIds: profile.cases.map((c) => c.id),
  };
  return { snapshot, sourceRefs };
}
export type ReportSnapshot = Awaited<ReturnType<typeof buildSnapshot>>['snapshot'];
