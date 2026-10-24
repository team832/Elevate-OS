/**
 * The create/edit flows of one lead (`act=<key>`), each in its own FormModal: never a modal on a
 * modal. Shared by the list pop-up and the full lead page (./lead-record.tsx renders the record).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import type { formOptions } from '../../server/options';
import { ActionForm, type ActionFormProps } from '../../ui/action-form';
import { options as optionList } from '../../ui/list-controls';
import { FormModal } from '../../ui/record-modal';
import { LEAD_CONTACT_FIELDS, type LeadDetail } from './lead-record';
import { CALL_FIELDS, CALL_NOTE, stageFields } from './lead-stage-record';

type Options = Awaited<ReturnType<typeof formOptions>>;

export const LEAD_ACTS = ['details', 'assign', 'follow_up', 'contact', 'enquiry', 'stage'] as const;
export type LeadAct = (typeof LEAD_ACTS)[number];

/** The FormModal of one lead flow, or null when the user may not run it. */
export function LeadActModal({
  act,
  d,
  options,
  user,
  closeHref,
  base,
}: {
  act: LeadAct;
  d: LeadDetail;
  options: Options;
  user: AuthenticatedUser;
  closeHref: string;
  base: string;
}) {
  const api = `${base}/api/v1/leads/${d.lead.id}`;
  const flows: Record<LeadAct, { title: string; allowed: boolean; form: ActionFormProps }> = {
    details: {
      title: 'Edit contact details',
      allowed: can(user, 'ops:leads:write') && d.privateVisible,
      form: {
        action: api,
        method: 'PATCH',
        submitLabel: 'Save contact details',
        fields: LEAD_CONTACT_FIELDS.map((f) => ({
          ...f,
          defaultValue: (d.lead[f.name as keyof typeof d.lead] as string | null) ?? undefined,
        })),
      },
    },
    assign: {
      title: 'Assign owner',
      allowed: can(user, 'ops:leads:assign'),
      form: {
        action: `${api}/assign`,
        submitLabel: 'Assign owner',
        fields: [
          {
            name: 'ownerStaffId',
            label: 'New owner',
            type: 'select',
            required: true,
            options: options.staff,
            section: 'Owner',
          },
        ],
      },
    },
    follow_up: {
      title: 'Add follow-up',
      allowed: can(user, 'ops:leads:write'),
      form: {
        action: `${base}/api/v1/follow-ups`,
        submitLabel: 'Add follow-up',
        extra: { leadId: d.lead.id },
        fields: [
          { name: 'title', label: 'Next action', section: 'Follow-up' },
          {
            name: 'dueDate',
            label: 'Due date',
            type: 'date',
            required: true,
            section: 'Follow-up',
          },
          {
            name: 'ownerStaffId',
            label: 'Owner',
            type: 'select',
            options: options.staff,
            section: 'Follow-up',
          },
        ],
      },
    },
    contact: {
      title: 'Log contact',
      allowed: can(user, 'ops:leads:write'),
      form: {
        action: `${api}/activities`,
        submitLabel: 'Log contact',
        fields: [
          {
            name: 'kind',
            label: 'Channel',
            type: 'select',
            required: true,
            options: optionList(['call', 'whatsapp', 'sms', 'email', 'visit', 'note']),
            hint: CALL_NOTE,
            section: 'Contact attempt',
          },
          {
            name: 'outcome',
            label: 'Outcome',
            type: 'select',
            required: true,
            options: optionList([
              'connected_two_way',
              'replied',
              'visited',
              'no_answer',
              'busy',
              'wrong_number',
              'message_sent',
              'other',
            ]),
            section: 'Contact attempt',
          },
          { name: 'note', label: 'Note', type: 'textarea', section: 'Contact attempt' },
          ...CALL_FIELDS,
        ],
      },
    },
    stage: {
      title: 'Change stage',
      allowed: can(user, 'ops:leads:write') && d.stages.length > 0,
      form: { action: `${api}/stage`, submitLabel: 'Change stage', fields: stageFields(d) },
    },
    enquiry: {
      title: 'Add enquiry',
      allowed: can(user, 'ops:leads:write'),
      form: {
        action: `${api}/enquiries`,
        submitLabel: 'Add enquiry',
        fields: [
          {
            name: 'sourceCode',
            label: 'Source',
            type: 'select',
            required: true,
            defaultValue: 'UNKNOWN',
            options: options.sources,
            section: 'Enquiry',
          },
          {
            name: 'programmeCode',
            label: 'Programme',
            type: 'select',
            options: options.programmes,
            section: 'Enquiry',
          },
          { name: 'notes', label: 'Notes', type: 'textarea', section: 'Enquiry' },
        ],
      },
    },
  };
  const flow = flows[act];
  if (!flow.allowed) return null;
  return (
    <FormModal
      id={`lead-${act}`}
      title={`${flow.title}: ${d.lead.studentName}`}
      meta={d.lead.code}
      closeHref={closeHref}
    >
      <ActionForm
        {...flow.form}
        redirectTo={closeHref}
        secondary={<a href={closeHref}>Cancel</a>}
      />
    </FormModal>
  );
}
