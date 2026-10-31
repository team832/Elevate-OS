/**
 * Application state shared by the application services: the live snapshot of what the form
 * would print, version/staleness checks, the confirmation re-check, and the locked status change.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsApplicationForms,
  opsApplications,
  opsApplicationVersions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsGuardians,
  opsKycDocuments,
  opsLeads,
  opsSignatureConfirmations,
  programmes,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { ConflictError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { AdmissionId } from '@elevate/shared-types';
import {
  ADMISSION_STATUS_LABELS,
  EXIT_STATUSES,
  istToday,
  READINESS_GAP_LABELS,
  type AdmissionStatus,
  type ResolvedSettings,
} from '../domain';
import {
  applicationActionBlocked,
  canonicalJson,
  changedParts,
  confirmationGaps,
  partLabels,
  type ApplicationAction,
  type ApplicationSnapshot,
  type ApplicationStatus,
} from '../domain/applications';
import { EMPTY_FORM_FIELDS, type ApplicationFormFields } from '../domain/admission-form';
import { ledgerSums, type FeeRecordLike } from '../domain/fees';
import { lockAccessible, readinessOfMany } from './admissions';
import type { AccessScope, Actor } from './context';
import { groupBy, inOrder, opsAudit, rowById } from './ops-common';
import type { AdmissionRow } from './pipeline';

export type ApplicationRow = typeof opsApplications.$inferSelect;
const audit = opsAudit('application');
export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/** Closed extra cases (lost, exited) leave the bundle: a material change, so the form is re-signed. */
const CLOSED: AdmissionStatus[] = ['lost', ...EXIT_STATUSES];

type SnapshotApp = Pick<ApplicationRow, 'id' | 'admissionId' | 'studentId' | 'academicYear'>;

/** Each application's bundle: its own case first, then its open extra programme cases. */
async function bundlesOf(
  tx: Database,
  apps: readonly Pick<ApplicationRow, 'id' | 'admissionId'>[],
) {
  const rows = await tx
    .select({ a: opsAdmissions, code: programmes.code, name: programmes.name })
    .from(opsAdmissions)
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(
      or(
        inArray(
          opsAdmissions.id,
          apps.map((app) => app.admissionId),
        ),
        and(
          inArray(
            opsAdmissions.applicationId,
            apps.map((app) => app.id),
          ),
          notInArray(opsAdmissions.status, CLOSED),
        ),
      ),
    )
    .orderBy(asc(opsAdmissions.createdAt));
  return new Map(
    apps.map((app) => [
      app.id as string,
      rows
        .filter(
          (r) =>
            r.a.id === app.admissionId ||
            (r.a.applicationId === app.id && !CLOSED.includes(r.a.status)),
        )
        .sort((x, y) => Number(y.a.id === app.admissionId) - Number(x.a.id === app.admissionId)),
    ]),
  );
}

/**
 * What the live snapshots of these applications read, one statement per table however many there
 * are (RVD-004: statements per application were most of an Overview's cost).
 */
async function snapshotReads(tx: Database, apps: readonly SnapshotApp[]) {
  const bundles = await bundlesOf(tx, apps);
  const primaryOf = (app: SnapshotApp) => bundles.get(app.id)![0]!.a;
  const studentIds = apps.map((app) => app.studentId);
  const [leads, people, guardians, plans] = await inOrder([
    tx
      .select()
      .from(opsLeads)
      .where(
        inArray(
          opsLeads.id,
          apps.map((app) => primaryOf(app).leadId),
        ),
      ),
    tx
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(inArray(students.id, studentIds)),
    tx
      .select()
      .from(opsGuardians)
      .where(and(inArray(opsGuardians.studentId, studentIds), isNull(opsGuardians.archivedAt)))
      .orderBy(desc(opsGuardians.isPrimary), asc(opsGuardians.createdAt)),
    tx
      .select()
      .from(opsFeePlans)
      .where(
        and(
          inArray(
            opsFeePlans.admissionId,
            [...bundles.values()].flat().map((b) => b.a.id),
          ),
          eq(opsFeePlans.status, 'active'),
        ),
      ),
  ]);
  const leadById = new Map(leads.map((l) => [l.id as string, l]));
  const planOf = new Map(
    apps.map((app) => {
      const primary = primaryOf(app);
      const ids = new Set<string>(bundles.get(app.id)!.map((b) => b.a.id));
      const own = plans.filter((p) => ids.has(p.admissionId));
      // One agreement covers the bundle (D-039), on whichever of its cases it was made.
      const plan =
        own.find((p) => p.academicYear === app.academicYear) ??
        own.find((p) => p.admissionId === primary.id) ??
        own[0];
      return [app.id as string, plan];
    }),
  );
  const planIds = [...planOf.values()].flatMap((p) => p?.id ?? []);
  const counsellorIds = apps.flatMap((app) => {
    const primary = primaryOf(app);
    return primary.counsellorStaffId ?? leadById.get(primary.leadId)!.ownerStaffId ?? [];
  });
  const [instalments, counsellors] = await inOrder([
    planIds.length
      ? tx
          .select()
          .from(opsFeeInstalments)
          .where(inArray(opsFeeInstalments.planId, planIds))
          .orderBy(asc(opsFeeInstalments.sequence))
      : [],
    counsellorIds.length
      ? tx
          .select({ id: staffMembers.id, fullName: staffMembers.fullName })
          .from(staffMembers)
          .where(inArray(staffMembers.id, counsellorIds))
      : [],
  ]);
  return {
    bundles,
    leadById,
    studentName: new Map(people.map((p) => [p.id as string, p.fullName])),
    guardiansOf: groupBy(guardians, (g) => g.studentId),
    planOf,
    instalmentsOf: groupBy(instalments, (i) => i.planId),
    counsellorName: new Map(counsellors.map((c) => [c.id as string, c.fullName])),
  };
}

/** What the form would print now, from the live sources. */
export async function liveSnapshot(
  tx: Database,
  app: SnapshotApp,
  settings: ResolvedSettings,
  form: ApplicationFormFields = EMPTY_FORM_FIELDS,
): Promise<ApplicationSnapshot> {
  return snapshotFrom(await snapshotReads(tx, [app]), app, settings, form);
}

function snapshotFrom(
  reads: Awaited<ReturnType<typeof snapshotReads>>,
  app: SnapshotApp,
  settings: ResolvedSettings,
  form: ApplicationFormFields,
): ApplicationSnapshot {
  const bundle = reads.bundles.get(app.id)!;
  const primary = bundle[0]!.a;
  const l = reads.leadById.get(primary.leadId)!;
  const guardians = reads.guardiansOf.get(app.studentId) ?? [];
  const plan = reads.planOf.get(app.id);
  const instalments = plan ? (reads.instalmentsOf.get(plan.id) ?? []) : [];
  const counsellorId = primary.counsellorStaffId ?? l.ownerStaffId;
  const declarations = settings['admissions.declarations'];
  return {
    student: {
      fullName: reads.studentName.get(app.studentId) ?? l.studentName,
      preferredName: l.preferredName,
      phone: l.studentPhone,
      email: l.studentEmail,
      dateOfBirth: l.dateOfBirth,
      currentStage: l.currentStage,
      schoolBoard: l.schoolBoard,
      previousSchool: l.previousSchool,
      city: l.city,
      address: l.address,
      emergencyContactName: l.emergencyContactName,
      emergencyContactPhone: l.emergencyContactPhone,
    },
    guardians: guardians.length
      ? guardians.map((g) => ({
          id: g.id,
          fullName: g.fullName,
          relationship: g.relationship,
          phone: g.phone,
          email: g.email,
          address: g.address,
          isPrimary: g.isPrimary,
          isEmergency: g.isEmergency,
        }))
      : l.guardianName
        ? [
            {
              id: null,
              fullName: l.guardianName,
              relationship: l.guardianRelationship,
              phone: l.guardianPhone,
              email: l.guardianEmail,
              address: null,
              isPrimary: true,
              isEmergency: false,
            },
          ]
        : [],
    programmes: bundle.flatMap((b) =>
      b.code ? [{ admissionId: b.a.id, code: b.code, name: b.name ?? b.code }] : [],
    ),
    intendedBatchId: primary.intendedBatchId,
    deliveryMode: primary.deliveryMode,
    startDate: primary.intendedStartDate,
    academicYear: app.academicYear,
    feeAgreement: plan
      ? {
          planId: plan.id,
          version: plan.version,
          label: plan.label,
          totalPaise: plan.totalPaise,
          academicYear: plan.academicYear,
          instalments: instalments.map((i) => ({
            sequence: i.sequence,
            dueDate: i.dueDate,
            amountPaise: i.amountPaise,
          })),
        }
      : null,
    registrationFeePaise: settings['fees.registration'].value.amountPaise,
    // Only owner-approved text counts (brief §6); entered text stays "proposed" until approved.
    declarations:
      declarations.value.text &&
      declarations.value.version &&
      declarations.decisionState === 'approved'
        ? { text: declarations.value.text, version: declarations.value.version }
        : null,
    form,
    counsellorName: reads.counsellorName.get(counsellorId ?? '') ?? null,
  };
}

/** The counsellor is shown, not signed for: reassigning one never makes a signed form stale. */
export const hashOf = ({ counsellorName: _shown, ...material }: ApplicationSnapshot) =>
  sha256(canonicalJson(material));

export async function versionRow(tx: Database, app: Pick<ApplicationRow, 'id' | 'currentVersion'>) {
  const [row] = await tx
    .select()
    .from(opsApplicationVersions)
    .where(
      and(
        eq(opsApplicationVersions.applicationId, app.id),
        eq(opsApplicationVersions.version, app.currentVersion),
      ),
    );
  return row!;
}

const stateOf = (
  current: typeof opsApplicationVersions.$inferSelect,
  live: ApplicationSnapshot,
) => {
  const saved = current.snapshot as unknown as ApplicationSnapshot;
  return {
    live,
    saved,
    current,
    stale: hashOf(live) !== current.contentHash,
    changed: changedParts(saved, live),
  };
};

/** The current version and whether the live content still matches it. */
export async function currentState(
  tx: Database,
  app: ApplicationRow,
  settings: ResolvedSettings,
  /** The application's own answers to compare with: the saved ones unless a save changes them. */
  form?: ApplicationFormFields,
) {
  const current = await versionRow(tx, app);
  const saved = current.snapshot as unknown as ApplicationSnapshot;
  return stateOf(
    current,
    await liveSnapshot(tx, app, settings, form ?? saved.form ?? EMPTY_FORM_FIELDS),
  );
}

/** Gap settings in the shape the domain takes. */
export const gapSettings = (s: ResolvedSettings) => ({
  studentFields: s['admissions.kyc.required_fields'].value.student,
  guardianFields: s['admissions.kyc.required_fields'].value.guardian,
  signerRule: s['admissions.signatures.required_signers'].value,
  mandatoryDocuments: s['admissions.kyc.id_document_types'].value.mandatory,
  paymentRule: s['admission.payment_gate'].value.rule,
});

/** Money received (voided and reversed rows never count, net of refunds) per charge across the bundle's cases. */
function paidFrom(rows: readonly FeeRecordLike[]) {
  const net = (category: string) => {
    const s = ledgerSums(rows.filter((r) => r.chargeCategory === category));
    return s.received - s.refund;
  };
  return { registrationPaise: net('registration'), tuitionPaise: net('tuition') };
}

export async function paidOf(tx: Database, admissionIds: readonly AdmissionId[]) {
  return paidFrom(
    (await tx
      .select()
      .from(opsFeeRecords)
      .where(inArray(opsFeeRecords.admissionId, [...admissionIds]))) as FeeRecordLike[],
  );
}

/** At most this many signed applications are checked per read. */
export const APPROVAL_CHECK_LIMIT = 50;

/** The confirmation check of signed applications, oldest first: one reading for the Overview tile and the list it opens. */
export const approvalChecks = async (
  db: Database,
  rows: readonly { app: ApplicationRow; admission: AdmissionRow }[],
  settings: ResolvedSettings,
) => {
  const signed = rows
    .filter((a) => a.app.status === 'signatures_confirmed')
    .sort((a, b) => +a.app.createdAt - +b.app.createdAt)
    .slice(0, APPROVAL_CHECK_LIMIT);
  const checks = await confirmationChecks(db, signed, settings);
  return checks.map((check, i) => ({ id: signed[i]!.app.id, ...check }));
};

/** Everything final confirmation re-checks, except the password (shared by the preview and confirm). */
export async function confirmationCheck(
  tx: Database,
  app: ApplicationRow,
  admission: AdmissionRow,
  settings: ResolvedSettings,
) {
  return (await confirmationChecks(tx, [{ app, admission }], settings))[0]!;
}

/** One statement per table however many applications. */
async function confirmationChecks(
  tx: Database,
  rows: readonly { app: ApplicationRow; admission: AdmissionRow }[],
  settings: ResolvedSettings,
) {
  if (!rows.length) return [];
  const apps = rows.map((r) => r.app);
  const ids = apps.map((app) => app.id);
  const versions = await tx
    .select()
    .from(opsApplicationVersions)
    .where(inArray(opsApplicationVersions.applicationId, ids));
  const reads = await snapshotReads(tx, apps);
  const [signatures, docs, owners, readiness, records] = await inOrder([
    tx
      .select({ s: opsSignatureConfirmations, formVersion: opsApplicationForms.version })
      .from(opsSignatureConfirmations)
      .innerJoin(opsApplicationForms, eq(opsApplicationForms.id, opsSignatureConfirmations.formId))
      .where(
        and(
          inArray(opsSignatureConfirmations.applicationId, ids),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      ),
    tx
      .select({ studentId: opsKycDocuments.studentId, type: opsKycDocuments.documentType })
      .from(opsKycDocuments)
      .where(
        and(
          inArray(
            opsKycDocuments.studentId,
            apps.map((app) => app.studentId),
          ),
          eq(opsKycDocuments.subjectType, 'student'),
          eq(opsKycDocuments.verificationStatus, 'verified'),
          isNull(opsKycDocuments.supersededAt),
        ),
      ),
    tx
      .select({ id: opsLeads.id, ownerStaffId: opsLeads.ownerStaffId })
      .from(opsLeads)
      .where(
        inArray(
          opsLeads.id,
          rows.map((r) => r.admission.leadId),
        ),
      ),
    () =>
      readinessOfMany(
        tx,
        rows.map((r) => r.admission),
        settings,
      ),
    tx
      .select()
      .from(opsFeeRecords)
      .where(
        inArray(
          opsFeeRecords.admissionId,
          [...reads.bundles.values()].flat().map((b) => b.a.id),
        ),
      ),
  ]);
  const versionOf = new Map(versions.map((v) => [`${v.applicationId}:${v.version}`, v]));
  const signatureOf = new Map(signatures.map((x) => [x.s.applicationId as string, x]));
  const docsOf = groupBy(docs, (d) => d.studentId);
  const ownerOf = new Map(owners.map((l) => [l.id as string, l.ownerStaffId]));
  const recordsOf = groupBy(records, (r) => r.admissionId);
  const declarations = settings['admissions.declarations'];
  return rows.map(({ app, admission }, i) => {
    const current = versionOf.get(`${app.id}:${app.currentVersion}`)!;
    const saved = current.snapshot as unknown as ApplicationSnapshot;
    const state = stateOf(
      current,
      snapshotFrom(reads, app, settings, saved.form ?? EMPTY_FORM_FIELDS),
    );
    const signature = signatureOf.get(app.id);
    const bundle = reads.bundles.get(app.id)!;
    const paid = paidFrom(bundle.flatMap((b) => recordsOf.get(b.a.id) ?? []) as FeeRecordLike[]);
    const gaps = confirmationGaps({
      snapshot: state.live,
      settings: gapSettings(settings),
      declarationsProposed:
        Boolean(declarations.value.text) && declarations.decisionState !== 'approved',
      currentVersion: app.currentVersion,
      signature: signature
        ? { ...signature.s, formVersion: signature.formVersion, signers: signature.s.signers }
        : null,
      verifiedDocuments: docsOf.get(app.studentId)?.map((d) => d.type) ?? [],
      paid,
      counsellorAssigned: Boolean(admission.counsellorStaffId ?? ownerOf.get(admission.leadId)),
      today: istToday(new Date()),
    });
    // BR-OPS-7 (approved): two fee verifications by different people; BR-OPS-6: documents item.
    // The approval itself is already required by the active fee plan.
    for (const g of readiness[i]!.gaps)
      if (g !== 'final_confirmation' && g !== 'fee_arrangement_approval')
        gaps.push({
          task:
            g === 'documents_verified'
              ? 'documents'
              : g === 'programme_missing'
                ? 'details'
                : 'fee_agreement',
          message: READINESS_GAP_LABELS[g],
        });
    for (const b of bundle)
      if (b.a.status !== 'admission_pending')
        gaps.push({
          task: 'details',
          message: `Programme case ${b.a.code} (${b.code ?? 'no programme'}) is "${ADMISSION_STATUS_LABELS[b.a.status]}": only pending cases can be admitted. Resume it, or close it and save the application.`,
        });
    if (state.stale)
      gaps.unshift({
        task: 'details',
        message: `Details changed since version ${app.currentVersion} (${partLabels(state.changed)}). Save to create a new version, then generate and sign the new form.`,
      });
    return { ...state, gaps, signature: signature?.s ?? null, paid };
  });
}

/** Lock the application and its case (scope checked), refuse when `action` is not allowed now. */
export async function lockApplication(
  tx: Database,
  access: AccessScope,
  id: string,
  action: ApplicationAction,
  expectedVersion?: number,
) {
  const app = await rowById(tx, opsApplications, id, 'Application', true);
  const admission = await lockAccessible(tx, access, app.admissionId);
  const blocked = applicationActionBlocked(app.status, action);
  if (blocked) throw new InvalidStateTransitionError(blocked);
  if (expectedVersion !== undefined && expectedVersion !== app.currentVersion)
    throw new ConflictError(
      `The application is now at version ${app.currentVersion} (you had version ${expectedVersion}). Reload and review it again.`,
      { details: { code: 'STALE_VERSION', currentVersion: app.currentVersion } },
    );
  return { app, admission };
}

export async function setStatus(
  tx: Database,
  actor: Actor,
  app: ApplicationRow,
  status: ApplicationStatus,
  action: string,
  metadata: Record<string, unknown>,
  requestId?: string,
) {
  const [after] = await tx
    .update(opsApplications)
    .set({ status, updatedAt: new Date() })
    .where(eq(opsApplications.id, app.id))
    .returning();
  await audit(
    tx,
    actor,
    app.id,
    action,
    {
      before: { status: app.status },
      after: { status },
      metadata: { version: app.currentVersion, ...metadata },
    },
    requestId,
  );
  return after!;
}
