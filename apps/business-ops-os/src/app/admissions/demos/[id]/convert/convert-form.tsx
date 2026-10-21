/**
 * Convert to admission (owner brief §6): what is checked before converting and the form
 * itself, in titled sections. Converting creates the admission APPLICATION (draft, version 1);
 * the admission number and the admission itself come only from "Confirm admission". Shown in the pop-up from the demo list
 * (`/ops/admissions?convert=<demoId>`) and on the full route
 * `/ops/admissions/demos/<id>/convert`. The server validates everything again.
 */
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert } from '@elevate/shared-ui';
import { istToday } from '../../../../../domain';
import { combinationLabel } from '../../../../../domain/catalog';
import { previewConversion } from '../../../../../server/conversion';
import { listFeeStructures } from '../../../../../server/fees';
import { ActionForm, type FieldSpec } from '../../../../../ui/action-form';
import { fmtPaise, humanise } from '../../../../../ui/format';
import { load } from '../../../../../ui/frame';
import { RecordTable } from '../../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../../ui/sections';
import { Badge } from '../../../_components/demo-bits';

const MODE_LABELS: Record<string, string> = {
  online: 'Online',
  offline_sikar: 'Offline (Sikar centre)',
  both: 'Online or offline',
};
const SOURCE_LABELS: Record<string, string> = {
  sample: 'sample figure',
  website_stated: 'price stated on the website',
  owner_approved: 'owner-approved',
};

/** The conversion preview plus the fee structures (when the user may read fees). */
export const loadConversion = (user: AuthenticatedUser, demoId: string) =>
  load(async (db) => {
    const [d, fees] = await Promise.all([
      previewConversion(db, user, demoId),
      can(user, 'ops:fees:read') ? listFeeStructures(db, user) : null,
    ]);
    return { d, structures: fees?.items ?? [] };
  });
export type Conversion = Extract<Awaited<ReturnType<typeof loadConversion>>, { ok: true }>['data'];

export function ConvertForm({
  data: { d, structures },
  demoId,
  level,
  cancelHref,
}: {
  data: Conversion;
  demoId: string;
  /** 3 inside the pop-up (its title is the h2), 2 on the full page. */
  level: 2 | 3;
  cancelHref: string;
}) {
  const s = d.student;
  const names = Object.fromEntries(d.programmes.map((p) => [p.code, p.name]));
  const demoProgramme = d.programmes.find((p) => p.id === d.demo.programmeId)?.code;
  const combos = d.allowedCombinations.filter((c) => c.every((code) => names[code]));
  const fields: FieldSpec[] = [
    {
      name: 'identityVerified',
      label: `I have checked ${s.fullName}'s name, phone and email with the family`,
      type: 'checkbox',
      section: 'Identity check',
    },
    ...(d.identity.candidates.length
      ? ([
          {
            name: 'existingStudentIdentityId',
            label: 'Same person as an existing student?',
            type: 'select',
            hint: 'Records with the same phone or email were found. Choose one only if it is the same person; siblings often share a guardian’s number.',
            options: d.identity.candidates.map((c) => ({ value: c.id, label: c.fullName })),
            section: 'Identity check',
          },
          {
            name: 'createNewStudent',
            label: 'This is a different person: create a new student record',
            type: 'checkbox',
            section: 'Identity check',
          },
        ] satisfies FieldSpec[])
      : []),
    {
      name: 'programmeCodes',
      label: 'Programme or combination',
      type: 'select',
      required: true,
      defaultValue: combos.find((c) => c.length === 1 && c[0] === demoProgramme)?.join(','),
      options: combos.map((c) => ({ value: c.join(','), label: combinationLabel(c, names) })),
      hint: 'Only the combinations Elevate offers: Class 11 or 12 Commerce alone or with one entrance programme, an entrance programme alone, or Dropper with one exam.',
      section: 'Programmes',
    },
    {
      name: 'intendedBatchId',
      label: 'Batch (Academic OS batch ID)',
      hint: 'Leave empty for "to be assigned"; Academic OS assigns the batch on enrolment.',
      section: 'Batch and start date',
    },
    {
      name: 'deliveryMode',
      label: 'Mode',
      type: 'select',
      required: true,
      options: [
        { value: 'offline', label: 'Offline (Sikar centre)' },
        { value: 'online', label: 'Online' },
      ],
      section: 'Batch and start date',
    },
    {
      name: 'effectiveDate',
      label: 'Start date',
      type: 'date',
      required: true,
      defaultValue: istToday(new Date()),
      section: 'Batch and start date',
    },
    structures.length
      ? {
          name: 'feePlanReference',
          label: 'Fee structure',
          type: 'select',
          hint: 'Optional. Saved as a reference only; no amount is charged or computed here. Each line says where its figure comes from.',
          options: structures.map((f) => ({
            value: `${f.label} · ${MODE_LABELS[f.mode] ?? f.mode}`.slice(0, 120),
            label: `${f.label} · ${MODE_LABELS[f.mode] ?? f.mode} · ${fmtPaise(f.amountPaise)} ${
              f.billingPeriod === 'per_month' ? 'per month' : 'course total'
            } (${SOURCE_LABELS[f.source] ?? f.source}, ${f.status})`,
          })),
          section: 'Fees',
        }
      : {
          name: 'feePlanReference',
          label: 'Fee plan or approved pricing reference',
          hint: 'Optional. A reference only; no amount is computed here.',
          section: 'Fees',
        },
    {
      name: 'discountRequest',
      label: 'Discount or exception requested',
      type: 'textarea',
      hint: 'Sends a fee-arrangement approval request to an authorised approver. You cannot approve your own request.',
      section: 'Discount or exception',
    },
    {
      name: 'guardianConfirmation',
      label: 'Guardian confirmation',
      type: 'select',
      required: true,
      options: [
        { value: 'confirmed', label: 'Guardian has confirmed the admission' },
        { value: 'not_applicable', label: 'Not applicable (adult student)' },
      ],
      section: 'Guardian confirmation',
    },
  ];
  return (
    <>
      {d.demo.isSample ? (
        <p>
          <span className="el-badge el-badge-sample">Sample data</span>
        </p>
      ) : null}
      {!d.admission.convertible ? (
        <Alert tone="warning" title="This demo cannot be converted">
          {d.demo.outcome === 'converted' && d.demo.convertedAdmissionId ? (
            <>
              It was already converted.{' '}
              <a href={`/ops/admissions/${d.demo.convertedAdmissionId}`}>Open the admission</a>.
            </>
          ) : (
            `The demo is ${humanise(d.demo.outcome)} and the admission is ${humanise(d.admission.status)}.`
          )}
        </Alert>
      ) : null}
      <Segment title="Student and contacts to verify" level={level} flush>
        <DetailTable
          rows={[
            { label: 'Student', value: s.fullName },
            { label: 'Student phone', value: s.studentPhone ?? 'Not recorded' },
            { label: 'Student email', value: s.studentEmail ?? 'Not recorded' },
            { label: 'Guardian', value: s.guardianName ?? 'Not recorded' },
            { label: 'Guardian phone', value: s.guardianPhone ?? 'Not recorded' },
            {
              label: 'Student record',
              value: d.identity.sameLead
                ? `Already a student record: ${d.identity.sameLead.fullName} (same enquiry). It will be reused.`
                : d.identity.candidates.length
                  ? `${d.identity.candidates.length} existing student record(s) share a phone or email. Decide in the form; records are never merged automatically.`
                  : 'No existing student record shares these contacts; a new one will be created.',
            },
          ]}
        />
      </Segment>
      <Segment title="What converting does" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Creates',
              value:
                'An admission application (draft, version 1) linked to this student and demo. The demo history is kept.',
            },
            {
              label: 'Does not',
              value:
                'Admit the student, give an admission number or request enrolment. Those happen only when an authorised approver confirms the signed application with their password.',
            },
          ]}
        />
      </Segment>
      <Segment
        title="Checklist summary"
        level={level}
        flush
        meta={<span className="el-field-hint">{d.checklist.label}</span>}
        description={`Demo checklist. ${
          d.checklistRequired.value.requiredBeforeConversion
            ? 'Every item must be resolved before conversion (setting on).'
            : `Completing every item is not required (setting ${humanise(d.checklistRequired.decisionState).toLowerCase()}). A fee discussion is never evidence of payment.`
        }`}
      >
        <RecordTable
          rows={d.checklist.items}
          rowKey={(i) => i.key}
          columns={[
            { key: 'item', header: 'Item', render: (i) => i.label },
            { key: 'status', header: 'Status', render: (i) => <Badge value={i.status} /> },
            { key: 'note', header: 'Note', render: (i) => i.entry?.reason ?? '—' },
          ]}
        />
      </Segment>
      {d.admission.convertible ? (
        <ActionForm
          action={`/ops/api/v1/demos/${demoId}/convert`}
          submitLabel="Convert to admission"
          headers={{ 'idempotency-key': `convert-${randomUUID()}` }}
          redirectTo="/ops/admissions/applications/{id}"
          secondary={<a href={cancelHref}>Cancel</a>}
          fields={fields}
        />
      ) : null}
    </>
  );
}
