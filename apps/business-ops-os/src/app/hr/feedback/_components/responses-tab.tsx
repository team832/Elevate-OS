/** Responses: every raw feedback row (HR only), its record pop-up and the entry form. */
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { StatusBadge } from '@elevate/shared-ui';
import { listAttachments } from '../../../../server/attachments';
import { batchOptions, feedbackPolicy } from '../../../../server/feedback-refs';
import {
  listResponses,
  responseDetail,
  type ResponseRow,
} from '../../../../server/feedback-responses';
import { responsesQuery } from '../../../../server/feedback-schemas';
import { formOptions } from '../../../../server/options';
import { ActionForm, type FieldSpec } from '../../../../ui/action-form';
import { AttachmentList, AttachmentUpload } from '../../../../ui/attachments';
import { fmtDate, fmtDateTime } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { listHref, Pager, SearchPanel } from '../../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../../ui/record-modal';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { API, asOptions, BASE, METHOD, MODERATION, type Params, type TabProps } from './shared';

const rated = (v: number | null, max: number) => (v === null ? 'Not rated' : `${v} of ${max}`);
const period = (r: { periodStart: string | null; periodEnd: string | null }) =>
  r.periodStart ? `${fmtDate(r.periodStart)} to ${fmtDate(r.periodEnd)}` : 'Not recorded';

export async function ResponsesTab({ user, params }: TabProps) {
  const filter = responsesQuery.parse(params);
  const result = await load(async (db) => ({
    list: await listResponses(db, user, filter),
    staff: (await formOptions(db)).staff,
  }));
  if (!result.ok) return result.view;
  const { list, staff } = result.data;
  const close = listHref(BASE, params, {
    open: undefined,
    record: undefined,
    recordFor: undefined,
    corrects: undefined,
  });
  return (
    <>
      <SearchPanel
        action={BASE}
        hidden={{ tab: 'responses' }}
        search={{ name: 'batch', label: 'Batch code', value: filter.batch }}
        filters={[
          {
            name: 'teacher',
            label: 'Teacher',
            type: 'select',
            options: staff,
            value: filter.teacher,
          },
          { name: 'from', label: 'Period from', type: 'date', value: filter.from },
          { name: 'to', label: 'Period to', type: 'date', value: filter.to },
          {
            name: 'method',
            label: 'Collected by',
            type: 'select',
            options: asOptions(METHOD),
            value: filter.method,
          },
          {
            name: 'moderation',
            label: 'Moderation',
            type: 'select',
            options: asOptions(MODERATION),
            value: filter.moderation,
          },
        ]}
      />
      <RecordTable<ResponseRow>
        rows={list.rows}
        rowKey={(r) => r.id}
        caption={`${list.total} ${list.total === 1 ? 'response' : 'responses'}, newest first`}
        rowHref={(r) => listHref(BASE, params, { open: r.id })}
        empty="No feedback matches. Record a response or import a file from the Imports tab."
        columns={[
          { key: 'teacher', header: 'Teacher', render: (r) => r.teacherName },
          { key: 'batch', header: 'Batch', render: (r) => r.courseLabel ?? 'Not recorded' },
          { key: 'period', header: 'Period', render: period },
          { key: 'rating', header: 'Overall', render: (r) => rated(r.rating, r.ratingScaleMax) },
          {
            key: 'method',
            header: 'Collected by',
            render: (r) => (r.collectionMethod ? METHOD[r.collectionMethod] : 'Not recorded'),
          },
          {
            key: 'moderation',
            header: 'Moderation',
            render: (r) => (
              <StatusBadge tone={MODERATION[r.moderationStatus]![1]}>
                {MODERATION[r.moderationStatus]![0]}
              </StatusBadge>
            ),
          },
        ]}
      />
      <Pager
        basePath={BASE}
        params={params}
        page={list.page}
        pageSize={list.pageSize}
        total={list.total}
      />
      {params.open ? (
        <ResponseModal user={user} id={params.open} params={params} close={close} />
      ) : null}
      {params.record && can(user, 'ops:teacher_feedback:manage') ? (
        <EntryModal params={params} staff={staff} close={close} />
      ) : null}
    </>
  );
}

async function ResponseModal({
  user,
  id,
  params,
  close,
}: TabProps & { id: string; close: string }) {
  const result = await load(async (db) => ({
    r: await responseDetail(db, user, id),
    files: await listAttachments(db, user, 'feedback_evidence', id),
    categories: (await feedbackPolicy(db)).categories,
  }));
  if (!result.ok) return result.view;
  const { r, files, categories } = result.data;
  const manage = can(user, 'ops:teacher_feedback:manage');
  const [label, tone] = MODERATION[r.moderationStatus]!;
  return (
    <RecordModal
      id="feedback-modal"
      title={`Feedback about ${r.teacherName}`}
      meta={<StatusBadge tone={tone}>{label}</StatusBadge>}
      closeHref={close}
      returnId={r.id}
      tabs={[
        {
          key: 'feedback',
          label: 'Feedback',
          content: (
            <Segment
              title="As recorded"
              level={3}
              flush
              description="Never edited. A correction is a new entry; this one is then hidden."
            >
              <DetailTable
                rows={[
                  { label: 'Batch', value: r.courseLabel ?? 'Not recorded' },
                  { label: 'Subject', value: r.subjectRef ?? 'Not recorded' },
                  { label: 'Review period', value: period(r) },
                  { label: 'Given on', value: fmtDate(r.feedbackOn) },
                  {
                    label: 'Given by',
                    value: r.submittedByKind === 'guardian' ? 'Guardian' : 'Student',
                  },
                  {
                    label: 'Student',
                    value:
                      r.studentName ??
                      (r.isAnonymous ? 'Given anonymously' : 'Student not recorded'),
                  },
                  {
                    label: 'Collected by',
                    value: r.collectionMethod ? METHOD[r.collectionMethod] : 'Not recorded',
                  },
                  { label: 'Overall rating', value: rated(r.rating, r.ratingScaleMax) },
                  ...Object.entries(r.categoryRatings ?? {}).map(([k, v]) => ({
                    label: categories.find((c) => c.code === k)?.label ?? k,
                    value: rated(v, r.ratingScaleMax),
                  })),
                  { label: 'Written feedback', value: r.comment || 'None' },
                  r.importRow && { label: 'Imported from', value: `File row ${r.importRow}` },
                  { label: 'Recorded', value: fmtDateTime(r.createdAt) },
                  r.moderationNote && { label: 'Moderation note', value: r.moderationNote },
                ]}
              />
            </Segment>
          ),
        },
        {
          key: 'decide',
          label: 'Moderate',
          content:
            manage && r.moderationStatus !== 'rejected' ? (
              <>
                <ActionForm
                  action={`${API}/about-teachers/${r.id}`}
                  method="PATCH"
                  submitLabel="Save decision"
                  fields={[
                    {
                      name: 'action',
                      label: 'Decision',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'approve', label: 'Approve (counts in summaries)' },
                        { value: 'reject', label: 'Reject (final)' },
                        { value: 'hide', label: 'Hide' },
                      ],
                    },
                    { name: 'note', label: 'Note (why)', type: 'textarea' },
                  ]}
                />
                <p>
                  <a
                    href={listHref(BASE, params, {
                      open: undefined,
                      record: 'new',
                      recordFor: r.teacherStaffId,
                      corrects: r.id,
                    })}
                  >
                    Record a correction
                  </a>
                </p>
              </>
            ) : (
              <p>
                {manage
                  ? 'Rejected feedback cannot be changed.'
                  : 'Needs permission to manage feedback.'}
              </p>
            ),
        },
        {
          key: 'files',
          label: 'Evidence',
          count: files.length,
          content: (
            <>
              <AttachmentList rows={files} apiBase="/ops/api/v1" empty="No supporting documents." />
              {manage ? (
                <AttachmentUpload
                  apiBase="/ops/api/v1"
                  ownerKind="feedback_evidence"
                  ownerId={r.id}
                  purpose="evidence"
                  label="Attach a supporting document"
                />
              ) : null}
            </>
          ),
        },
      ]}
    />
  );
}

async function EntryModal({
  params,
  staff,
  close,
}: {
  params: Params;
  staff: { value: string; label: string }[];
  close: string;
}) {
  const teacherId = params.recordFor;
  const teacher = staff.find((s) => s.value === teacherId);
  const [policy, batches] = await Promise.all([
    feedbackPolicy(getDb()),
    teacher ? batchOptions(teacher.value) : null,
  ]);
  const fields: FieldSpec[] = [
    {
      name: 'batch',
      label: 'Batch and subject',
      type: 'select',
      options: batches ?? [],
      hint: batches
        ? 'From the teacher’s assignments in Academic OS.'
        : 'Source unavailable: Academic OS could not be read. Leave empty and write the subject below, or try later.',
      section: 'Class',
    },
    { name: 'subjectRef', label: 'Subject (when no batch)', section: 'Class' },
    { name: 'periodStart', label: 'Review period from', type: 'date', section: 'Class' },
    { name: 'periodEnd', label: 'Review period to', type: 'date', section: 'Class' },
    {
      name: 'submittedByKind',
      label: 'Given by',
      type: 'select',
      required: true,
      options: [
        { value: 'student', label: 'Student' },
        { value: 'guardian', label: 'Guardian' },
      ],
      section: 'Who and how',
    },
    {
      name: 'feedbackOn',
      label: 'Date given',
      type: 'date',
      required: true,
      section: 'Who and how',
    },
    {
      name: 'collectionMethod',
      label: 'Collected by',
      type: 'select',
      options: asOptions(METHOD).filter((o) => o.value !== 'import'),
      section: 'Who and how',
    },
    {
      name: 'admissionNumber',
      label: 'Student admission number (if collected)',
      section: 'Who and how',
    },
    {
      name: 'isAnonymous',
      label: 'Given anonymously (no name collected)',
      type: 'checkbox',
      hint: 'Other details may still identify the student, so this is never shown as a promise of anonymity.',
      section: 'Who and how',
    },
    {
      name: 'rating',
      label: `Overall rating (1–${policy.scaleMax})`,
      type: 'number',
      section: 'Ratings',
    },
    ...policy.categories.map((c): FieldSpec => ({
      name: `categoryRatings.${c.code}`,
      label: `${c.label} (1–${policy.scaleMax})`,
      type: 'number',
      section: 'Ratings',
    })),
    {
      name: 'comment',
      label: 'Written feedback, in their words',
      type: 'textarea',
      required: true,
      section: 'Feedback',
    },
  ];
  return (
    <FormModal
      id="record-feedback"
      title={teacher ? `Record feedback about ${teacher.label}` : 'Record feedback'}
      closeHref={close}
    >
      {teacher ? (
        <ActionForm
          action={`${API}/about-teachers`}
          submitLabel={params.corrects ? 'Record correction' : 'Record feedback'}
          extra={{ teacherStaffId: teacher.value, correctsId: params.corrects }}
          redirectTo={`${BASE}?tab=responses&open={id}`}
          secondary={<a href={close}>Cancel</a>}
          fields={fields}
        />
      ) : (
        <form method="get" action={BASE} className="el-stack">
          <input type="hidden" name="tab" value="responses" />
          <input type="hidden" name="record" value="new" />
          <div className="el-field">
            <label htmlFor="record-for">Which teacher is it about?</label>
            <select id="record-for" name="recordFor" className="el-select" required defaultValue="">
              <option value="" disabled>
                Choose a teacher
              </option>
              {staff.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="el-form-actions">
            <a href={close}>Cancel</a>
            <button type="submit" className="el-button el-button-primary">
              Continue
            </button>
          </div>
        </form>
      )}
    </FormModal>
  );
}
