/** Demo KYC tab (brief §5): the basic details on the lead and the case, duplicates to review, edit form. */
import { can } from '@elevate/authorization';
import { Alert } from '@elevate/shared-ui';
import { ADMISSION_STATUS_LABELS } from '../../../domain';
import { CLASS_CATEGORY_LABELS, CLASS_CATEGORY_OPTIONS } from '../../../domain/demos';
import type { DemoRecord } from '../../../server/demos';
import { ActionForm, type FieldSpec } from '../../../ui/action-form';
import { fmtDate, fmtDateTime, humanise } from '../../../ui/format';
import { DetailTable, Segment } from '../../../ui/sections';
import { Disclosure } from './demo-bits';
import type { DemoTabProps } from './demo-record';

type Lead = DemoRecord['kyc']['lead'];
type Option = { value: string; label: string };

/**
 * The KYC fields of the booking form (`prefix` "kyc.") and the edit form (no prefix); blank
 * keeps what is recorded. Values pre-fill from `lead` when given.
 */
export function kycFields(
  options: { staff: readonly Option[]; programmes: readonly Option[] },
  prefix = '',
  lead?: Lead,
): FieldSpec[] {
  const v = (k: keyof NonNullable<Lead>) => {
    const value = lead?.[k];
    return typeof value === 'string' ? value : undefined;
  };
  const f = (
    name: string,
    label: string,
    s: string,
    extra: Partial<FieldSpec> = {},
  ): FieldSpec => ({
    name: `${prefix}${name}`,
    label,
    section: s,
    defaultValue: v(name as keyof NonNullable<Lead>),
    ...extra,
  });
  return [
    f('preferredName', 'Preferred name', 'Student'),
    f('currentStage', 'Class or category', 'Student', {
      type: 'select',
      options: CLASS_CATEGORY_OPTIONS,
    }),
    f('previousSchool', 'School', 'Student'),
    f('city', 'City', 'Student'),
    f('studentPhone', 'Student phone (not needed when a guardian contact is given)', 'Student', {
      type: 'tel',
    }),
    f('studentEmail', 'Student email', 'Student', { type: 'email' }),
    ...options.programmes.map((p) =>
      f(`interestedProgrammeCodes.${p.value}`, p.label, 'Programme interests', {
        type: 'checkbox',
        defaultValue: lead?.interestedProgrammeCodes?.includes(p.value) ? 'true' : undefined,
      }),
    ),
    f('guardianName', 'Guardian name', 'Guardian and emergency contact'),
    f('guardianRelationship', 'Relationship', 'Guardian and emergency contact', {
      type: 'select',
      options: ['mother', 'father', 'guardian', 'other'].map((r) => ({
        value: r,
        label: humanise(r),
      })),
    }),
    f('guardianPhone', 'Guardian phone', 'Guardian and emergency contact', { type: 'tel' }),
    f('guardianEmail', 'Guardian email', 'Guardian and emergency contact', { type: 'email' }),
    f(
      'emergencyContactName',
      'Emergency contact (if not the guardian)',
      'Guardian and emergency contact',
    ),
    f('emergencyContactPhone', 'Emergency contact phone', 'Guardian and emergency contact', {
      type: 'tel',
    }),
    f('intendedStartDate', 'Planned start date', 'Demo', { type: 'date' }),
  ];
}

export function DemoKyc({ d, user, options, level }: DemoTabProps) {
  const { lead, privateVisible } = d.kyc;
  const hidden = 'Restricted (needs permission to see private details)';
  const show = (value: string | null | undefined) =>
    privateVisible ? value || 'Not recorded' : hidden;
  return (
    <>
      {d.kyc.duplicates.length ? (
        <Alert tone="warning" title="Possible duplicate: review on the lead">
          {d.kyc.duplicates.length} other lead(s) share a contact or look similar (
          {[...new Set(d.kyc.duplicates.flatMap((x) => x.signals))].map(humanise).join(', ')}).
          Nothing is merged automatically; a shared parent contact may belong to a sibling.{' '}
          <a href={`/ops/leads/${d.demo.leadId}`}>Open the lead</a>
        </Alert>
      ) : null}
      {d.kyc.missing.length ? (
        <p className="el-field-hint">
          Still missing for the application: {d.kyc.missing.map(humanise).join(', ')} (setting
          “Required KYC fields”, {d.kyc.requiredState}).
        </p>
      ) : null}
      <Segment title="Student" level={level} flush>
        <DetailTable
          rows={[
            { label: 'Name', value: lead.studentName },
            { label: 'Preferred name', value: lead.preferredName || 'Not recorded' },
            {
              label: 'Class or category',
              value: lead.currentStage
                ? (CLASS_CATEGORY_LABELS[lead.currentStage] ?? humanise(lead.currentStage))
                : 'Not recorded',
            },
            { label: 'School', value: show(lead.previousSchool) },
            { label: 'City', value: show(lead.city) },
            { label: 'Phone', value: show(lead.studentPhone) },
            { label: 'Email', value: show(lead.studentEmail) },
          ]}
        />
      </Segment>
      <Segment title="Guardian and emergency contact" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Guardian',
              value: privateVisible
                ? lead.guardianName
                  ? `${lead.guardianName}${lead.guardianRelationship ? ` (${humanise(lead.guardianRelationship)})` : ''}`
                  : 'Not recorded'
                : hidden,
            },
            { label: 'Guardian phone', value: show(lead.guardianPhone) },
            { label: 'Guardian email', value: show(lead.guardianEmail) },
            {
              label: 'Emergency contact',
              value: privateVisible
                ? lead.emergencyContactName
                  ? `${lead.emergencyContactName}${lead.emergencyContactPhone ? `, ${lead.emergencyContactPhone}` : ''}`
                  : 'Not recorded (the guardian is the emergency contact unless one is given)'
                : hidden,
            },
          ]}
        />
      </Segment>
      <Segment title="Demo and enquiry" level={level} flush>
        <DetailTable
          rows={[
            {
              label: 'Programme interests',
              value: lead.interestedProgrammeCodes?.length
                ? lead.interestedProgrammeCodes.join(', ')
                : 'Not recorded',
            },
            {
              label: 'Preferred batch',
              value: d.kyc.batchId
                ? 'Recorded (batch names come from Academic OS, not connected yet)'
                : 'Not recorded',
            },
            {
              label: 'Planned start date',
              value: d.kyc.startDate ? fmtDate(d.kyc.startDate) : 'Not recorded',
            },
            { label: 'Counsellor', value: d.counsellorName ?? 'Not assigned' },
            {
              label: 'Lead source',
              value: d.kyc.sources.length
                ? d.kyc.sources
                    .map((s) => `${s.label ?? humanise(s.code)} (${fmtDateTime(s.at)})`)
                    .join('; ')
                : 'Not recorded',
            },
            {
              label: 'Case status',
              value: ADMISSION_STATUS_LABELS[d.admissionStatus] ?? humanise(d.admissionStatus),
            },
            { label: 'Notes', value: d.demo.notes || 'None' },
          ]}
        />
      </Segment>
      {can(user, 'ops:leads:write') ? (
        <Disclosure summary="Edit KYC">
          <ActionForm
            action={`/ops/api/v1/demos/${d.demo.id}`}
            submitLabel="Save KYC"
            extra={{ action: 'kyc' }}
            fields={[
              {
                name: 'studentName',
                label: 'Student name',
                required: true,
                defaultValue: lead.studentName,
                section: 'Student',
              },
              ...kycFields(options, '', lead),
              {
                name: 'counsellorStaffId',
                label: 'Counsellor',
                type: 'select',
                options: options.staff,
                defaultValue: d.demo.counsellorStaffId ?? undefined,
                section: 'Demo',
              },
              {
                name: 'notes',
                label: 'Notes',
                type: 'textarea',
                defaultValue: d.demo.notes ?? undefined,
                section: 'Demo',
              },
            ]}
          />
        </Disclosure>
      ) : null}
    </>
  );
}
