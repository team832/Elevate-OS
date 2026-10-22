/**
 * One lead, shared by the list pop-up (`<base>/leads?open=<id>`) and the full route
 * (`<base>/leads/<id>`; base `/ops` or `/marketing`, D-073): bordered sections as tabs, plus
 * the create/edit flows that open in their own FormModal (`act=<key>`), never a modal on a modal.
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { Alert, ButtonLink, StatusBadge } from '@elevate/shared-ui';
import {
  ADMISSION_STATUS_LABELS,
  FOLLOW_UP_KIND_LABELS,
  isOpenStatus,
  type FollowUpKind,
} from '../../domain';
import type { getLead } from '../../server/leads';
import type { formOptions } from '../../server/options';
import { CLASS_CATEGORY_LABELS, CLASS_CATEGORY_OPTIONS } from '../../domain/demos';
import { ActionForm, type ActionFormProps, type FieldSpec } from '../../ui/action-form';
import { fmtDate, fmtDateTime, humanise, statusTone } from '../../ui/format';
import { options as optionList } from '../../ui/list-controls';
import { FormModal, type ModalTab } from '../../ui/record-modal';
import { RecordTable } from '../../ui/record-table';
import { DetailTable, Segment } from '../../ui/sections';
import { SampleBadge } from '../admissions/_components/demo-bits';

export type LeadDetail = Awaited<ReturnType<typeof getLead>>;
type CaseRow = LeadDetail['admissions'][number];
type Options = Awaited<ReturnType<typeof formOptions>>;

const RESTRICTED = 'Restricted (needs permission to see private details)';
const known = (v: string | null | undefined) => v || 'Not recorded';
const GUARDIAN = 'Parent or guardian';

/** Student and guardian contacts: the New lead form and "Edit contact details". */
export const LEAD_CONTACT_FIELDS: FieldSpec[] = [
  { name: 'studentName', label: 'Student name', required: true, section: 'Student' },
  {
    name: 'studentPhone',
    label: 'Student phone',
    type: 'tel',
    hint: 'e.g. 98765 43210 or +91 98765 43210',
    section: 'Student',
  },
  { name: 'studentEmail', label: 'Student email', type: 'email', section: 'Student' },
  { name: 'previousSchool', label: 'School', section: 'Student' },
  {
    name: 'currentStage',
    label: 'Class / stage',
    type: 'select',
    options: CLASS_CATEGORY_OPTIONS,
    section: 'Student',
  },
  { name: 'guardianName', label: 'Parent / guardian name', section: GUARDIAN },
  {
    name: 'guardianRelationship',
    label: 'Relationship',
    type: 'select',
    options: optionList(['mother', 'father', 'guardian', 'other']),
    section: GUARDIAN,
  },
  { name: 'guardianPhone', label: 'Parent phone', type: 'tel', section: GUARDIAN },
  { name: 'guardianEmail', label: 'Parent email', type: 'email', section: GUARDIAN },
];

/** Stage of the current case (open first, then newest, as in the list), code and sample label. */
export function LeadMeta({ d }: { d: LeadDetail }) {
  const current = [...d.admissions].sort(
    (a, b) =>
      Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  return (
    <>
      {current ? (
        <StatusBadge tone={statusTone(current.status)}>
          {ADMISSION_STATUS_LABELS[current.status]}
        </StatusBadge>
      ) : (
        <StatusBadge tone="neutral">No case yet</StatusBadge>
      )}{' '}
      {d.lead.code} <SampleBadge show={d.lead.isSample} />
    </>
  );
}

/** "Book a demo" opens the existing booking pop-up (it lists the cases ready for a demo; Ops only). */
export const BookDemoLink = ({
  d,
  user,
  base,
}: {
  d: LeadDetail;
  user: AuthenticatedUser;
  base: string;
}) =>
  base === '/ops' && can(user, 'ops:leads:write') && !d.lead.mergedIntoLeadId ? (
    <ButtonLink variant="primary" href={`${base}/admissions?new=1`}>
      Book a demo
    </ButtonLink>
  ) : null;

/** The lead's sections. `actHref(key)` opens that flow; `level` 3 inside the pop-up, 2 on the page. */
export function leadTabs(
  d: LeadDetail,
  user: AuthenticatedUser,
  actHref: (act: LeadAct) => string,
  level: 2 | 3,
  base: string,
): ModalTab[] {
  const { lead } = d;
  // Without admissions access the server sends only each case's stage (getLead).
  const cases = can(user, 'ops:admissions:read');
  const write = can(user, 'ops:leads:write');
  const contact = (v: string | null | undefined) => (d.privateVisible ? known(v) : RESTRICTED);
  const firstEnquiry = d.enquiries.at(-1);
  const attribution = can(user, 'ops:lead_attribution:read');
  const action = (act: LeadAct, label: string, allowed: boolean) =>
    allowed ? <a href={actHref(act)}>{label}</a> : undefined;
  return [
    {
      key: 'overview',
      label: 'Overview',
      content: (
        <>
          {lead.mergedIntoLeadId ? (
            <Alert tone="info" title="Merged">
              This lead was merged into{' '}
              <a href={`${base}/leads/${lead.mergedIntoLeadId}`}>another lead</a>. Its history is
              kept.
            </Alert>
          ) : null}
          {d.duplicates
            .filter((x) => x.status === 'open')
            .map((x) => (
              <Alert
                key={x.id}
                tone="warning"
                title={x.level === 'exact' ? 'Existing contact' : 'Possible duplicate'}
              >
                Matches{' '}
                {x.otherAccessible ? (
                  <a href={`${base}/leads/${x.otherLeadId}`}>{x.otherCode}</a>
                ) : (
                  x.otherCode
                )}{' '}
                on {x.signals.join(', ').replace(/_/g, ' ')}. Nothing was merged.
                {can(user, 'ops:leads:merge') ? (
                  <div className="el-stack">
                    <ActionForm
                      action={`${base}/api/v1/leads/${x.leadId}/merge`}
                      submitLabel={`Merge ${x.leadId === lead.id ? 'this lead' : x.otherCode} into ${x.leadId === lead.id ? x.otherCode : 'this lead'}`}
                      extra={{ targetLeadId: x.matchedLeadId }}
                      fields={[{ name: 'note', label: 'Merge note', required: true }]}
                      variant="danger"
                      compact
                    />
                    <ActionForm
                      action={`${base}/api/v1/leads/duplicates/${x.id}`}
                      submitLabel="Not a duplicate: dismiss"
                      extra={{ decision: 'dismissed' }}
                      fields={[{ name: 'note', label: 'Why', required: true }]}
                      variant="secondary"
                      compact
                    />
                  </div>
                ) : null}
              </Alert>
            ))}
          <Segment
            title="Contact"
            level={level}
            flush
            actions={action('details', 'Edit contact details', write && d.privateVisible)}
            description="Only staff allowed to see private student details can read these contacts; many students are minors."
          >
            <DetailTable
              rows={[
                { label: 'Student phone', value: contact(lead.studentPhone) },
                { label: 'Student email', value: contact(lead.studentEmail) },
                {
                  label: 'Parent / guardian',
                  value: d.privateVisible
                    ? `${known(lead.guardianName)}${lead.guardianRelationship ? ` (${humanise(lead.guardianRelationship)})` : ''}`
                    : RESTRICTED,
                },
                { label: 'Guardian phone', value: contact(lead.guardianPhone) },
                { label: 'Guardian email', value: contact(lead.guardianEmail) },
                { label: 'School', value: contact(lead.previousSchool) },
                { label: 'City', value: contact(lead.city) },
                {
                  label: 'Class / stage',
                  value:
                    (lead.currentStage && CLASS_CATEGORY_LABELS[lead.currentStage]) ||
                    'Not recorded',
                },
                {
                  label: 'First two-way contact',
                  value: lead.firstSuccessfulContactAt
                    ? fmtDateTime(lead.firstSuccessfulContactAt)
                    : 'Not yet reached',
                },
              ]}
            />
          </Segment>
          <Segment
            title="Owner"
            level={level}
            flush
            description="A lead is handoff-pending until its owner accepts it."
            actions={action('assign', 'Assign owner', can(user, 'ops:leads:assign'))}
          >
            <DetailTable
              rows={[
                { label: 'Owner', value: d.owner?.fullName ?? 'Unassigned' },
                {
                  label: 'Assignment',
                  value: (
                    <StatusBadge tone={statusTone(d.assignment)}>
                      {humanise(d.assignment)}
                    </StatusBadge>
                  ),
                },
                d.assignment === 'handoff_pending' &&
                  write && {
                    label: 'Next step',
                    value: (
                      <ActionForm
                        action={`${base}/api/v1/leads/${lead.id}/accept`}
                        submitLabel="Accept handoff"
                        compact
                      />
                    ),
                  },
              ]}
            />
          </Segment>
        </>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      count: d.enquiries.length,
      content: (
        <>
          <Segment title="Source and attribution" level={level} flush>
            <DetailTable
              rows={[
                { label: 'Programme interest', value: d.programme?.code ?? 'Undecided' },
                { label: 'Mode', value: humanise(lead.interestMode) },
                { label: 'Received', value: fmtDateTime(lead.firstReceivedAt) },
                { label: 'First source', value: firstEnquiry?.sourceLabel ?? 'Not recorded' },
                { label: 'Account / channel', value: known(firstEnquiry?.channel) },
                {
                  label: 'Campaign',
                  value: attribution
                    ? known(firstEnquiry?.campaignRef)
                    : 'Restricted (needs permission to see lead sources)',
                },
              ]}
            />
          </Segment>
          <Segment
            title="Enquiries"
            level={level}
            flush
            description="Each enquiry keeps its own source."
            actions={action('enquiry', 'Add enquiry', write)}
          >
            <RecordTable
              rows={d.enquiries}
              rowKey={(e) => e.id}
              empty="No enquiries recorded."
              columns={[
                { key: 'receivedAt', header: 'Received', render: (e) => fmtDateTime(e.receivedAt) },
                { key: 'sourceLabel', header: 'Source' },
                {
                  key: 'programmeCode',
                  header: 'Programme',
                  render: (e) => e.programmeCode ?? 'Undecided',
                },
                {
                  key: 'merged',
                  header: 'Note',
                  render: (e) => (e.mergedFromLeadId ? 'Moved here by a merge' : known(e.notes)),
                },
              ]}
            />
          </Segment>
        </>
      ),
    },
    {
      key: 'cases',
      label: 'Admission cases',
      count: d.admissions.length,
      content: (
        <Segment
          title="Admission cases"
          level={level}
          flush
          description={
            cases
              ? 'One pipeline record per programme.'
              : 'Conversion stage per programme. Admission details stay in Business Operations.'
          }
        >
          <RecordTable
            rows={d.admissions}
            rowKey={(a) => a.id}
            rowHref={cases && base === '/ops' ? (a) => `${base}/admissions/${a.id}` : undefined}
            empty="No admission case yet. Log an enquiry with a programme to open one; a demo can be booked once that case is counselled."
            columns={[
              { key: 'code', header: 'Case' },
              {
                key: 'programmeCode',
                header: 'Programme',
                render: (a) => a.programmeCode ?? 'Undecided',
              },
              {
                key: 'status',
                header: 'Status',
                render: (a) => (
                  <StatusBadge tone={statusTone(a.status)}>
                    {ADMISSION_STATUS_LABELS[a.status]}
                  </StatusBadge>
                ),
              },
              ...(cases
                ? [
                    {
                      key: 'counsellorName',
                      header: 'Counsellor',
                      render: (a: CaseRow) =>
                        ('counsellorName' in a && a.counsellorName) || 'Not assigned',
                    },
                    {
                      key: 'reason',
                      header: 'Last reason',
                      render: (a: CaseRow) => known('statusReason' in a ? a.statusReason : null),
                    },
                  ]
                : []),
            ]}
          />
        </Segment>
      ),
    },
    {
      key: 'follow-ups',
      label: 'Follow-ups',
      count: d.followUps.length,
      content: (
        <Segment
          title="Follow-ups"
          level={level}
          flush
          description="Every follow-up has an owner and an IST due date."
          actions={action('follow_up', 'Add follow-up', write)}
        >
          <RecordTable
            rows={d.followUps}
            rowKey={(f) => f.id}
            empty="No follow-ups. An open lead without a next action is flagged."
            columns={[
              {
                key: 'kind',
                header: 'Kind',
                render: (f) => FOLLOW_UP_KIND_LABELS[f.kind as FollowUpKind],
              },
              { key: 'title', header: 'Next action' },
              { key: 'dueDate', header: 'Due', render: (f) => fmtDate(f.dueDate) },
              { key: 'ownerName', header: 'Owner' },
              {
                key: 'status',
                header: 'Status',
                render: (f) => (
                  <StatusBadge tone={statusTone(f.status)}>{humanise(f.status)}</StatusBadge>
                ),
              },
              {
                key: 'act',
                header: 'Outcome',
                render: (f) =>
                  f.status === 'open' && write ? (
                    <ActionForm
                      action={`${base}/api/v1/follow-ups/${f.id}`}
                      submitLabel="Mark done"
                      extra={{ action: 'complete' }}
                      fields={[{ name: 'outcome', label: 'Outcome', required: true }]}
                      compact
                    />
                  ) : (
                    known(f.outcome)
                  ),
              },
            ]}
          />
        </Segment>
      ),
    },
    {
      key: 'activity',
      label: 'Activity',
      count: d.activities.length,
      content: (
        <>
          <Segment
            title="Contact attempts"
            level={level}
            flush
            description="Only a successful two-way contact counts as contacted."
            actions={action('contact', 'Log contact', write)}
          >
            <RecordTable
              rows={d.activities}
              rowKey={(a) => a.id}
              empty="No contact logged yet."
              columns={[
                { key: 'occurredAt', header: 'When', render: (a) => fmtDateTime(a.occurredAt) },
                { key: 'kind', header: 'Channel', render: (a) => humanise(a.kind) },
                { key: 'outcome', header: 'Outcome', render: (a) => humanise(a.outcome) },
                { key: 'staffName', header: 'By', render: (a) => a.staffName ?? 'Not recorded' },
              ]}
            />
          </Segment>
          <Segment
            title="History"
            level={level}
            flush
            description="Append-only audit trail of this lead and linked records."
          >
            <RecordTable
              rows={d.history}
              rowKey={(h) => h.id}
              empty="No history recorded."
              columns={[
                { key: 'at', header: 'When', render: (h) => fmtDateTime(h.at) },
                { key: 'action', header: 'Action', render: (h) => humanise(h.action) },
                {
                  key: 'actorType',
                  header: 'Actor',
                  render: (h) =>
                    h.actorType === 'system' ? 'System (job or Academic OS)' : 'User',
                },
                {
                  key: 'detail',
                  header: 'Detail',
                  render: (h) =>
                    h.after && typeof h.after === 'object' && 'status' in h.after
                      ? `Status → ${humanise(String((h.after as { status: string }).status))}`
                      : '',
                },
              ]}
            />
          </Segment>
        </>
      ),
    },
  ];
}

export const LEAD_ACTS = ['details', 'assign', 'follow_up', 'contact', 'enquiry'] as const;
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
        ],
      },
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
