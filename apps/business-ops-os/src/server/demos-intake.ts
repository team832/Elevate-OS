/**
 * Demo KYC (owner brief 21 Oct 2026 §5): the basic details a demo needs, kept on the lead (one
 * person record, duplicate-checked by normalised contacts) and the case. Contact fields go through
 * `updateLead` (normalisation, duplicate flags that never merge, audit); interests, emergency
 * contact, start date, counsellor and notes are written here. Private fields follow
 * ops:student_private:read.
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import {
  opsAdmissions,
  opsDemos,
  opsDuplicateFlags,
  opsEnquiries,
  opsLeads,
  opsLeadSources,
  programmes,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { normalisePhone, PHONE_ERROR_MESSAGES } from '../domain';
import { KYC_FIELDS, PRIVATE_STUDENT_FIELDS } from '../domain/students';
import { activeStaff, clean, type Actor } from './context';
import type { DemoKycInput } from './demos-schemas';
import { updateLead } from './leads';
import { fieldError, opsAudit } from './ops-common';
import { contactFields } from './schemas';
import { loadSettings } from './settings';

type DemoRef = Pick<typeof opsDemos.$inferSelect, 'id' | 'leadId' | 'admissionId'>;
const LEAD_FIELDS = Object.keys(contactFields) as (keyof typeof contactFields)[];
const PRIVATE = [...PRIVATE_STUDENT_FIELDS, ...KYC_FIELDS] as const;
const camel = (f: string) => f.replace(/_(.)/g, (_, c: string) => c.toUpperCase());

/** Write the given KYC fields (absent = unchanged) inside the caller's transaction; audited. */
export async function applyDemoKyc(
  tx: Database,
  actor: Actor,
  demo: DemoRef,
  input: DemoKycInput,
  requestId?: string,
) {
  const leadPart = Object.fromEntries(
    LEAD_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]),
  );
  if (Object.keys(leadPart).length) await updateLead(tx, actor, demo.leadId, leadPart, requestId);
  const lead: Partial<typeof opsLeads.$inferInsert> = {};
  // An empty list (every box unticked, as in the booking form) leaves the interests unchanged.
  if (input.interestedProgrammeCodes?.length) {
    const codes = [...new Set(input.interestedProgrammeCodes)];
    const known = await tx
      .select({ code: programmes.code })
      .from(programmes)
      .where(and(inArray(programmes.code, codes), ne(programmes.status, 'retired')));
    if (known.length !== codes.length)
      throw fieldError('interestedProgrammeCodes', 'Unknown or retired programme.');
    lead.interestedProgrammeCodes = codes;
  }
  if ('emergencyContactName' in input)
    lead.emergencyContactName = clean(input.emergencyContactName);
  if ('emergencyContactPhone' in input) {
    const raw = clean(input.emergencyContactPhone);
    const phone = raw ? normalisePhone(raw) : null;
    if (phone && !phone.ok)
      throw fieldError('emergencyContactPhone', PHONE_ERROR_MESSAGES[phone.reason]);
    lead.emergencyContactPhone = phone?.e164 ?? null;
  }
  if (Object.keys(lead).length)
    await tx.update(opsLeads).set(lead).where(eq(opsLeads.id, demo.leadId));
  if (input.intendedStartDate)
    await tx
      .update(opsAdmissions)
      .set({ intendedStartDate: input.intendedStartDate })
      .where(eq(opsAdmissions.id, demo.admissionId));
  const own: Partial<typeof opsDemos.$inferInsert> = {};
  if (input.counsellorStaffId)
    own.counsellorStaffId = (await activeStaff(tx, input.counsellorStaffId, 'counsellorStaffId'))
      .id as StaffMemberId;
  if ('notes' in input) own.notes = clean(input.notes);
  if (Object.keys(own).length) await tx.update(opsDemos).set(own).where(eq(opsDemos.id, demo.id));
  await opsAudit('demo')(
    tx,
    actor,
    demo.id,
    'demo.kyc_updated',
    // Field names only: the values are private and already audited on the lead.
    { metadata: { leadId: demo.leadId, fields: Object.keys(input) } },
    requestId,
  );
}

/** The KYC tab: lead details (private ones only when permitted), sources, open duplicate flags, missing configured fields. */
export async function demoKyc(db: Database, actor: Actor, demo: DemoRef) {
  const [[lead], [admission], sources, duplicates, settings] = await Promise.all([
    db.select().from(opsLeads).where(eq(opsLeads.id, demo.leadId)),
    db
      .select({
        intendedStartDate: opsAdmissions.intendedStartDate,
        intendedBatchId: opsAdmissions.intendedBatchId,
      })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, demo.admissionId)),
    db
      .select({
        label: opsLeadSources.label,
        code: opsEnquiries.sourceCode,
        at: opsEnquiries.receivedAt,
      })
      .from(opsEnquiries)
      .leftJoin(opsLeadSources, eq(opsLeadSources.code, opsEnquiries.sourceCode))
      .where(eq(opsEnquiries.leadId, demo.leadId))
      .orderBy(asc(opsEnquiries.receivedAt)),
    db
      .select({ level: opsDuplicateFlags.level, signals: opsDuplicateFlags.signals })
      .from(opsDuplicateFlags)
      .where(and(eq(opsDuplicateFlags.leadId, demo.leadId), eq(opsDuplicateFlags.status, 'open'))),
    loadSettings(db),
  ]);
  const values = lead as unknown as Record<string, unknown>;
  // The demo was already scope-checked, so own scope covers this lead.
  const privateVisible = scopeFor(actor, 'ops:student_private:read') !== null;
  const required = settings['admissions.kyc.required_fields'];
  const missing = required.value.student.filter((f) => !values[camel(f)]);
  const shown = Object.fromEntries(
    Object.entries(lead!).filter(
      ([k]) => privateVisible || !(PRIVATE as readonly string[]).includes(k),
    ),
  ) as Partial<NonNullable<typeof lead>>;
  return {
    lead: shown,
    privateVisible,
    startDate: admission?.intendedStartDate ?? null,
    batchId: admission?.intendedBatchId ?? null,
    sources,
    duplicates,
    /** Student fields named in the setting "Required KYC fields" that are still empty. */
    missing,
    requiredState: required.decisionState,
  };
}
