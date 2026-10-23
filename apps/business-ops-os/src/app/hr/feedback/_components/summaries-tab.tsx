/**
 * Summaries: HR's write-up per teacher and period. While drafting, the original comments sit
 * beside the edited text (meaning kept, no invented positives); the teacher's preview applies
 * the minimum group size exactly as Academic OS will.
 */
import { can } from '@elevate/authorization';
import { ButtonLink, StatusBadge, Subnav, type Tone } from '@elevate/shared-ui';
import { meanLabel, readMeans } from '../../../../domain/feedback';
import { feedbackPolicy } from '../../../../server/feedback-refs';
import { listSummaries, summaryDetail } from '../../../../server/feedback-summaries';
import { formOptions } from '../../../../server/options';
import { aiBlocked } from '../../../../server/ai-drafts';
import { ActionForm } from '../../../../ui/action-form';
import { AiDraft } from '../../../../ui/ai-draft';
import { ActionsTable, SummaryView } from '../../../../ui/feedback-development';
import { fmtDate } from '../../../../ui/format';
import { load } from '../../../../ui/frame';
import { listHref, Pager } from '../../../../ui/list-controls';
import { FormModal, RecordModal } from '../../../../ui/record-modal';
import { RecordTable } from '../../../../ui/record-table';
import { DetailTable, Segment } from '../../../../ui/sections';
import { API, BASE, type TabProps } from './shared';

export const SUMMARY_STATUS: Record<string, [string, Tone]> = {
  draft: ['Draft', 'warning'],
  approved: ['Approved (teacher can see it)', 'success'],
  withdrawn: ['Withdrawn', 'neutral'],
};
const period = (s: { periodStart: string; periodEnd: string }) =>
  `${fmtDate(s.periodStart)} to ${fmtDate(s.periodEnd)}`;

export async function SummariesTab({ user, params }: TabProps) {
  const result = await load(async (db) => ({
    list: await listSummaries(db, user, {
      status: params.status && params.status in SUMMARY_STATUS ? params.status : undefined,
      page: Math.max(1, Number(params.page) || 1),
    }),
    staff: (await formOptions(db)).staff,
  }));
  if (!result.ok) return result.view;
  const { list, staff } = result.data;
  const close = listHref(BASE, params, { open: undefined, new: undefined });
  const manage = can(user, 'ops:teacher_feedback:manage');
  return (
    <>
      {manage ? (
        <p>
          <ButtonLink href={listHref(BASE, params, { new: 'summary' })}>Start a summary</ButtonLink>
        </p>
      ) : null}
      <Subnav
        label="Summaries by status"
        items={[
          [listHref(BASE, { tab: 'summaries' }), 'All'],
          ...Object.entries(SUMMARY_STATUS).map(
            ([k, [text]]) =>
              [listHref(BASE, { tab: 'summaries', status: k }), text.split(' (')[0]!] as const,
          ),
        ]}
        current={listHref(BASE, { tab: 'summaries', status: params.status })}
      />
      <RecordTable
        rows={list.rows}
        rowKey={(r) => r.id}
        caption={`${list.total} ${list.total === 1 ? 'summary' : 'summaries'}`}
        rowHref={(r) => listHref(BASE, params, { open: r.id })}
        empty="No summaries yet. Start one when a teacher's feedback for a period has been moderated."
        columns={[
          { key: 'teacher', header: 'Teacher', render: (r) => r.teacherName },
          { key: 'period', header: 'Period', render: period },
          { key: 'n', header: 'Responses', numeric: true, render: (r) => r.responseCount },
          {
            key: 'eligible',
            header: 'Students asked',
            numeric: true,
            render: (r) => r.eligiblePopulation ?? 'Not recorded',
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <StatusBadge tone={SUMMARY_STATUS[r.status]![1]}>
                {SUMMARY_STATUS[r.status]![0]}
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
      {params.new === 'summary' && manage ? (
        <FormModal id="new-summary" title="Start a feedback summary" closeHref={close}>
          <ActionForm
            action={`${API}/summaries`}
            submitLabel="Start summary"
            redirectTo={`${BASE}?tab=summaries&open={id}`}
            secondary={<a href={close}>Cancel</a>}
            fields={[
              {
                name: 'teacherStaffId',
                label: 'Teacher',
                type: 'select',
                required: true,
                options: staff,
              },
              { name: 'periodStart', label: 'Period from', type: 'date', required: true },
              { name: 'periodEnd', label: 'Period to', type: 'date', required: true },
              {
                name: 'eligiblePopulation',
                label: 'Students who could have answered',
                type: 'number',
                hint: 'Leave empty when not known; the response rate then shows as not recorded.',
              },
            ]}
          />
        </FormModal>
      ) : null}
      {params.open ? (
        <SummaryModal user={user} params={params} id={params.open} staff={staff} />
      ) : null}
    </>
  );
}

async function SummaryModal({
  user,
  params,
  id,
  staff,
}: TabProps & { id: string; staff: { value: string; label: string }[] }) {
  const result = await load(async (db) => ({
    s: await summaryDetail(db, user, id),
    categories: (await feedbackPolicy(db)).categories,
    ai: await aiBlocked(db, user, 'feedbackSummary'),
  }));
  if (!result.ok) return result.view;
  const { s, categories, ai } = result.data;
  const draft = s.status === 'draft' && can(user, 'ops:teacher_feedback:manage');
  const manage = can(user, 'ops:teacher_feedback:manage');
  return (
    <RecordModal
      id="summary-modal"
      title={`${s.teacherName}: ${period(s)}`}
      meta={
        <StatusBadge tone={SUMMARY_STATUS[s.status]![1]}>
          {SUMMARY_STATUS[s.status]![0]}
        </StatusBadge>
      }
      closeHref={listHref(BASE, params, { open: undefined })}
      returnId={s.id}
      tabs={[
        {
          key: 'write',
          label: 'Write-up',
          content: (
            <div className="ops-panels">
              <Segment title="What students said (originals, approved only)" level={3} flush>
                <RecordTable
                  rows={s.originals}
                  rowKey={(o) => o.id}
                  empty="No approved feedback in this period."
                  columns={[
                    { key: 'on', header: 'Date', render: (o) => fmtDate(o.feedbackOn) },
                    {
                      key: 'r',
                      header: 'Overall',
                      render: (o) =>
                        o.rating === null ? 'Not rated' : `${o.rating} of ${o.ratingScaleMax}`,
                    },
                    { key: 'comment', header: 'Comment', render: (o) => o.comment || 'None' },
                  ]}
                />
              </Segment>
              <Segment
                title="HR's write-up"
                level={3}
                description="Keep the meaning; do not add strengths nobody mentioned."
              >
                {draft ? (
                  <AiDraft
                    api="/ops/api/v1/ai/feedback-summary"
                    body={{ summaryId: s.id }}
                    blocked={
                      ai ??
                      (s.responseCount < s.preview.minGroupSize
                        ? `AI drafts need at least ${s.preview.minGroupSize} approved responses.`
                        : null)
                    }
                  >
                    <ActionForm
                      action={`${API}/summaries/${s.id}`}
                      method="PATCH"
                      submitLabel="Save draft"
                      successText="Draft saved; figures counted again."
                      extra={{ action: 'edit' }}
                      fields={[
                        {
                          name: 'strengths',
                          label: 'Strengths',
                          type: 'textarea',
                          defaultValue: s.strengths ?? undefined,
                        },
                        {
                          name: 'areasToImprove',
                          label: 'Areas to improve',
                          type: 'textarea',
                          defaultValue: s.areasToImprove ?? undefined,
                        },
                        {
                          name: 'summaryText',
                          label: 'Comments, edited for the teacher',
                          type: 'textarea',
                          defaultValue: s.summaryText ?? undefined,
                        },
                        {
                          name: 'eligiblePopulation',
                          label: 'Students who could have answered',
                          type: 'number',
                          defaultValue: s.eligiblePopulation?.toString(),
                        },
                      ]}
                    />
                  </AiDraft>
                ) : (
                  <DetailTable
                    rows={[
                      { label: 'Strengths', value: s.strengths ?? 'Not written' },
                      { label: 'Areas to improve', value: s.areasToImprove ?? 'Not written' },
                      { label: 'Comments for the teacher', value: s.summaryText ?? 'Not written' },
                    ]}
                  />
                )}
              </Segment>
            </div>
          ),
        },
        {
          key: 'figures',
          label: 'Figures',
          content: (
            <DetailTable
              caption="Figures"
              rows={[
                { label: 'Responses (approved)', value: s.responseCount },
                {
                  label: 'Response rate',
                  value: s.eligiblePopulation
                    ? `${Math.round((s.responseCount / s.eligiblePopulation) * 100)}% of ${s.eligiblePopulation}`
                    : 'Not recorded',
                },
                { label: 'Rating scale', value: `1 to ${s.ratingScaleMax}` },
                ...readMeans(s.categoryMeans).map((m) => ({
                  label: meanLabel(m.code, categories),
                  value: `${m.mean.toFixed(2)} of ${s.ratingScaleMax} (${m.n} ratings${m.n >= s.preview.minGroupSize ? '' : '; not shown to the teacher'})`,
                })),
              ]}
            />
          ),
        },
        {
          key: 'teacher',
          label: 'Teacher’s view',
          content: (
            <>
              <p>
                {s.teacherVisibility === 'nothing'
                  ? 'Teachers are not shown summaries at present (setting “What teachers see of their feedback”).'
                  : 'Once approved, the teacher sees exactly this in Academic OS.'}
              </p>
              <SummaryView s={s.preview} categories={categories} level={3} />
              {manage && s.status !== 'withdrawn' ? (
                <div className="el-inline-form">
                  {s.status === 'draft' ? (
                    <ActionForm
                      action={`${API}/summaries/${s.id}`}
                      method="PATCH"
                      extra={{ action: 'approve' }}
                      submitLabel="Approve and share with the teacher"
                      successText="Approved."
                    />
                  ) : null}
                  <ActionForm
                    action={`${API}/summaries/${s.id}`}
                    method="PATCH"
                    extra={{ action: 'withdraw' }}
                    submitLabel="Withdraw"
                    variant="secondary"
                    successText="Withdrawn."
                  />
                </div>
              ) : null}
            </>
          ),
        },
        {
          key: 'actions',
          label: 'Development actions',
          count: s.actions.length,
          content: (
            <>
              <ActionsTable
                rows={s.actions.map((a) => ({
                  ...a,
                  ownerName: staff.find((x) => x.value === a.ownerStaffId)?.label ?? null,
                }))}
              />
              {manage && s.status !== 'withdrawn' ? (
                <ActionForm
                  action={`${API}/actions`}
                  submitLabel="Add action"
                  resetOnSuccess
                  extra={{ teacherStaffId: s.teacherStaffId, summaryId: s.id }}
                  fields={[
                    { name: 'action', label: 'Agreed action', type: 'textarea', required: true },
                    { name: 'ownerStaffId', label: 'Supported by', type: 'select', options: staff },
                    { name: 'dueOn', label: 'Due', type: 'date' },
                    { name: 'agreed', label: 'Agreed with the teacher', type: 'checkbox' },
                  ]}
                />
              ) : null}
            </>
          ),
        },
      ]}
    />
  );
}
