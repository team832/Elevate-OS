import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_EOD_REVIEW_EVENT_KINDS,
  OPS_EOD_STATUSES,
  OPS_REPORT_PERIOD_KINDS,
  OPS_TASK_EVENT_KINDS,
  OPS_TASK_EVENT_STATUSES,
  OPS_TASK_IMPORT_OUTCOMES,
  OPS_TASK_RELATED_KINDS,
  OPS_TASK_REVIEW_DECISIONS,
  OPS_TASK_SOURCES,
  OPS_TASK_STATUSES,
  OPS_TASK_VISIBILITIES,
} from '../../src/schema/index';
import { LATER, NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

const SHA = 'a'.repeat(64);
let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];

const task = (o: Row = {}): Row => ({
  staff_id: ctx.ids.staff,
  title: 'Sample task',
  due_on: '2026-10-21',
  original_due_on: '2026-10-21',
  created_by: ctx.ids.user,
  ...o,
});
const event = (o: Row = {}): Row => ({
  task_id: ids.task,
  kind: 'comment',
  actor_user_id: ctx.ids.user,
  ...o,
});
const update = (o: Row = {}): Row => ({
  task_id: ids.task,
  author_user_id: ctx.ids.user,
  author_staff_id: ctx.ids.staff,
  occurred_on: '2026-10-21',
  work_performed: 'Called the sample guardian',
  ...o,
});
const report = (o: Row = {}): Row => ({
  staff_id: ctx.ids.staff,
  report_date: '2026-10-20',
  period_start: '2026-10-20',
  period_end: '2026-10-20',
  snapshot: '{}',
  created_by: ctx.ids.user,
  ...o,
});
const version = (o: Row = {}): Row => ({
  report_id: ids.report,
  version: 1,
  snapshot: '{}',
  narrative: '{}',
  source_cutoff_at: NOW,
  submitted_by_user_id: ctx.ids.user,
  ...o,
});
const reviewEvent = (o: Row = {}): Row => ({
  report_id: ids.report,
  kind: 'viewed',
  actor_user_id: ctx.ids.user,
  ...o,
});
const submission = (o: Row = {}): Row => ({
  task_id: ids.task,
  version: 1,
  completion_note: 'Sheet and answer key attached',
  submitted_by_user_id: ctx.ids.user,
  ...o,
});
const review = (o: Row = {}): Row => ({
  task_id: ids.task,
  submission_id: ids.submission,
  decision: 'comment',
  reviewer_user_id: ctx.ids.user2,
  ...o,
});
const checklist = (o: Row = {}): Row => ({
  task_id: ids.task,
  position: 0,
  text: 'Answer key',
  ...o,
});
const batch = (o: Row = {}): Row => ({
  source_filename: 'Task-EOD-backup-2026-10-21.json',
  source_sha256: 'b'.repeat(64),
  staff_id: ctx.ids.staff,
  raw: '{}',
  created_by_user_id: ctx.ids.user,
  ...o,
});
const importRow = (o: Row = {}): Row => ({
  batch_id: ids.batch,
  kind: 'task',
  legacy_id: 't-2',
  content_hash: 'h',
  outcome: 'accepted',
  ...o,
});
const ack = (o: Row = {}): Row => ({
  review_key: '00000000-0000-4000-8000-000000000001',
  review_version: 2,
  acknowledged_by_user_id: ctx.ids.user,
  ...o,
});

beforeAll(async () => {
  ctx = await setup();
  const { pg } = ctx;
  ids.task = await insert(pg, 'ops.staff_tasks', task({ legacy_ref: 'deskday_backup_json:s:t-1' }));
  ids.task2 = await insert(pg, 'ops.staff_tasks', task());
  ids.update = await insert(pg, 'ops.task_updates', update());
  ids.submission = await insert(pg, 'ops.task_submissions', submission());
  ids.submission2 = await insert(pg, 'ops.task_submissions', submission({ version: 2 }));
  await insert(pg, 'ops.task_reviews', review({ decision: 'approved' }));
  await insert(pg, 'ops.task_collaborators', {
    task_id: ids.task,
    staff_id: ctx.ids.staff,
    added_by: ctx.ids.user,
  });
  await insert(
    pg,
    'ops.task_updates',
    update({ corrects_update_id: ids.update, correction_reason: 'Wrong day' }),
  );
  await insert(pg, 'ops.task_dependencies', {
    task_id: ids.task,
    depends_on_task_id: ids.task2,
    created_by_user_id: ctx.ids.user,
  });
  ids.report = await insert(pg, 'ops.eod_reports', report());
  ids.version = await insert(pg, 'ops.eod_report_versions', version());
  ids.batch = await insert(pg, 'ops.task_import_batches', batch({ source_sha256: SHA }));
  await insert(pg, 'ops.task_import_rows', importRow({ legacy_id: 't-1' }));
  await insert(pg, 'ops.review_acknowledgements', ack({ review_version: 1 }));
});
afterAll(() => ctx.t.close());

describe('staff tasks, events, updates and dependencies', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'task statuses (OPS_TASK_STATUSES)',
        'ops.staff_tasks',
        OPS_TASK_STATUSES,
        'staff_tasks_status_check',
        (v) =>
          task({
            status: v,
            reason: 'Sample reason',
            ...(v === 'done' ? { completed_at: NOW, progress_percent: 100 } : {}),
            ...(v === 'in_review' ? { first_submitted_at: NOW, last_submitted_at: NOW } : {}),
          }),
      ),
      vocab(
        'task sources (OPS_TASK_SOURCES)',
        'ops.staff_tasks',
        OPS_TASK_SOURCES,
        'staff_tasks_source_check',
        (v) => task({ source: v }),
      ),
      variants('task rules', 'ops.staff_tasks', task, {
        'cancelled without a reason': [{ status: 'cancelled' }, 'staff_tasks_reason_check'],
        'in review without a reason': [
          { status: 'in_review', first_submitted_at: NOW, last_submitted_at: NOW },
          'ok',
        ],
        'in review never submitted': [{ status: 'in_review' }, 'staff_tasks_submitted_check'],
        'blocked is no longer a status': [
          { status: 'blocked', reason: 'Waiting' },
          'staff_tasks_status_check',
        ],
        'blocked flag with kind and reason (status kept)': [
          {
            status: 'in_progress',
            blocked_at: NOW,
            blocked_kind: 'on_hold',
            blocked_reason: 'Waiting',
          },
          'ok',
        ],
        'blocked flag without a reason': [
          { blocked_at: NOW, blocked_kind: 'blocked' },
          'staff_tasks_blocked_check',
        ],
        'blocked reason without the flag': [
          { blocked_reason: 'Waiting' },
          'staff_tasks_blocked_check',
        ],
        'blocked kind bogus': [
          { blocked_at: NOW, blocked_kind: 'bogus', blocked_reason: 'Waiting' },
          'staff_tasks_blocked_kind_check',
        ],
        'latest submission before the first': [
          { first_submitted_at: LATER, last_submitted_at: NOW },
          'staff_tasks_submitted_check',
        ],
        'first submission without the latest': [
          { first_submitted_at: NOW },
          'staff_tasks_submitted_check',
        ],
        'no original deadline': [{ original_due_on: null }, '23502'],
        'related id without a kind': [
          { related_id: () => ctx.ids.student },
          'staff_tasks_related_check',
        ],
        'related label without a record': [{ related_label: 'IPMAT' }, 'staff_tasks_related_check'],
        'related batch and a student': [
          {
            related_kind: 'batch',
            related_id: () => ctx.ids.student,
            student_id: () => ctx.ids.student,
          },
          'staff_tasks_one_related',
        ],
        'own parent': [
          {
            id: '00000000-0000-4000-8000-0000000000aa',
            parent_task_id: '00000000-0000-4000-8000-0000000000aa',
          },
          'staff_tasks_not_own_parent',
        ],
        'child of a task': [{ parent_task_id: id('task') }, 'ok'],
        'acknowledged time without who': [
          { acknowledged_at: NOW },
          'staff_tasks_acknowledged_check',
        ],
        'backup owner is the owner': [
          { backup_staff_id: () => ctx.ids.staff },
          'staff_tasks_backup_check',
        ],
        'legacy ref imported twice': [
          { legacy_ref: 'deskday_backup_json:s:t-1' },
          'staff_tasks_legacy_ref_key',
        ],
        'version 0': [{ version: 0 }, 'staff_tasks_version_check'],
      }),
      vocab(
        'task related kinds (OPS_TASK_RELATED_KINDS)',
        'ops.staff_tasks',
        OPS_TASK_RELATED_KINDS,
        'staff_tasks_related_kind_check',
        (v) => task({ related_kind: v, related_id: ctx.ids.student, related_label: 'Sample' }),
      ),
      vocab(
        'task visibility (OPS_TASK_VISIBILITIES)',
        'ops.staff_tasks',
        OPS_TASK_VISIBILITIES,
        'staff_tasks_visibility_check',
        (v) => task({ visibility: v }),
      ),
      vocab(
        'event statuses keep the retired ones (OPS_TASK_EVENT_STATUSES)',
        'ops.task_events',
        OPS_TASK_EVENT_STATUSES,
        'task_events_status_check',
        (v) => event({ kind: 'status_changed', from_status: v, to_status: v }),
      ),
      vocab(
        'task event kinds (OPS_TASK_EVENT_KINDS)',
        'ops.task_events',
        OPS_TASK_EVENT_KINDS,
        'task_events_kind_check',
        (v) =>
          event({
            kind: v,
            to_status: 'in_progress',
            to_staff_id: ctx.ids.staff,
            reason: 'Sample reason',
          }),
      ),
      variants('task event rules', 'ops.task_events', event, {
        'status change without a status': [
          { kind: 'status_changed' },
          'task_events_status_change_check',
        ],
        'reassigned without the new owner': [
          { kind: 'reassigned' },
          'task_events_owner_change_check',
        ],
        'cancelled without a reason': [{ kind: 'cancelled' }, 'task_events_reason_check'],
        'blocked without a reason': [{ kind: 'blocked_set' }, 'task_events_reason_check'],
        'unknown status': [{ from_status: 'bogus' }, 'task_events_status_check'],
        'imported with an original time': [{ kind: 'imported', occurred_at: NOW }, 'ok'],
      }),
      variants('work update rules', 'ops.task_updates', update, {
        'duration 0': [{ duration_minutes: 0 }, 'task_updates_duration_check'],
        'duration 1440': [{ duration_minutes: 1440 }, 'ok'],
        'duration 1441': [{ duration_minutes: 1441 }, 'task_updates_duration_check'],
        'stop without start': [{ ended_at: LATER }, 'task_updates_interval_check'],
        'stop before start': [{ started_at: LATER, ended_at: NOW }, 'task_updates_interval_check'],
        'start and stop': [{ started_at: NOW, ended_at: LATER }, 'ok'],
        'correction without a reason': [
          { corrects_update_id: id('update') },
          'task_updates_correction_check',
        ],
        'second correction of one update': [
          { corrects_update_id: id('update'), correction_reason: 'Again' },
          'task_updates_corrects_key',
        ],
        'blank work': [{ work_performed: '  ' }, 'task_updates_work_check'],
      }),
      variants(
        'dependencies',
        'ops.task_dependencies',
        (o) => ({
          task_id: ids.task2,
          depends_on_task_id: ids.task,
          created_by_user_id: ctx.ids.user,
          ...o,
        }),
        {
          'reverse link (cycles are the service’s job)': [{}, 'ok'],
          'depends on itself': [{ depends_on_task_id: id('task2') }, 'task_dependencies_not_self'],
          'same pair twice': [
            { task_id: id('task'), depends_on_task_id: id('task2') },
            'task_dependencies_pair_key',
          ],
        },
      ),
    ],
  );
});

describe('checklist, submissions, reviews and collaborators', () => {
  runCases(
    () => ctx.pg,
    [
      variants('checklist rules', 'ops.task_checklist_items', checklist, {
        item: [{}, 'ok'],
        'blank text': [{ text: ' ' }, 'task_checklist_items_text_check'],
        'negative position': [{ position: -1 }, 'task_checklist_items_position_check'],
        'done without who': [{ done_at: NOW }, 'task_checklist_items_done_check'],
      }),
      variants('submission rules', 'ops.task_submissions', submission, {
        'version 3': [{ version: 3 }, 'ok'],
        'version 1 twice': [{}, 'task_submissions_task_version_key'],
        'version 0': [{ version: 0 }, 'task_submissions_version_check'],
        'blank completion note': [
          { version: 4, completion_note: ' ' },
          'task_submissions_note_check',
        ],
      }),
      vocab(
        'review decisions (OPS_TASK_REVIEW_DECISIONS)',
        'ops.task_reviews',
        OPS_TASK_REVIEW_DECISIONS,
        'task_reviews_decision_check',
        (v) => review({ decision: v, note: 'Sample note', submission_id: ids.submission2 }),
      ),
      variants('review rules', 'ops.task_reviews', review, {
        'second decision on one submission': [
          { decision: 'changes_requested', note: 'Attach the key' },
          'task_reviews_one_decision_key',
        ],
        'comment on a decided submission': [{ decision: 'comment', note: 'Thanks' }, 'ok'],
        'changes without a reason': [
          { decision: 'changes_requested', submission_id: null },
          'task_reviews_note_check',
        ],
        'approval without a submission': [
          { decision: 'approved', submission_id: null },
          'task_reviews_submission_check',
        ],
      }),
      variants(
        'collaborator rules',
        'ops.task_collaborators',
        (o) => ({ task_id: ids.task, staff_id: ctx.ids.staff, added_by: ctx.ids.user, ...o }),
        { 'same person twice': [{}, 'task_collaborators_pkey'] },
      ),
    ],
  );
});

describe('EOD reports, versions and review events', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'report periods (OPS_REPORT_PERIOD_KINDS)',
        'ops.eod_reports',
        OPS_REPORT_PERIOD_KINDS,
        'eod_reports_period_kind_check',
        (v) =>
          report({
            period_kind: v,
            // An unknown kind gets month-shaped dates, so only the kind check can refuse it.
            ...({
              day: {
                report_date: '2026-11-02',
                period_start: '2026-11-02',
                period_end: '2026-11-02',
              },
              week: { report_date: null, period_start: '2026-11-02', period_end: '2026-11-08' },
            }[v] ?? { report_date: null, period_start: '2026-11-01', period_end: '2026-11-30' }),
          }),
      ),
      vocab(
        'EOD statuses (OPS_EOD_STATUSES)',
        'ops.eod_reports',
        OPS_EOD_STATUSES,
        'eod_reports_status_check',
        (v) =>
          report({
            report_date: '2026-10-21',
            period_start: '2026-10-21',
            period_end: '2026-10-21',
            status: v,
            ...(v === 'draft' ? {} : { submitted_at: NOW }),
          }),
      ),
      variants(
        'EOD report rules',
        'ops.eod_reports',
        (o) =>
          report({
            report_date: '2026-10-21',
            period_start: '2026-10-21',
            period_end: '2026-10-21',
            ...o,
          }),
        {
          'submitted without a time': [{ status: 'submitted' }, 'eod_reports_submitted_check'],
          'draft with a submit time': [{ submitted_at: NOW }, 'eod_reports_submitted_check'],
          'reviewed draft': [
            { reviewed_by: () => ctx.ids.user, reviewed_at: NOW },
            'eod_reports_reviewed_check',
          ],
          'second report for the day': [
            { report_date: '2026-10-20', period_start: '2026-10-20', period_end: '2026-10-20' },
            'eod_reports_staff_period_key',
          ],
          'day report ending another day': [
            { period_end: '2026-10-22' },
            'eod_reports_period_check',
          ],
          'day report without its date': [{ report_date: null }, 'eod_reports_period_check'],
          'week of 7 days from the day report': [
            {
              period_kind: 'week',
              report_date: null,
              period_start: '2026-10-20',
              period_end: '2026-10-26',
            },
            'ok',
          ],
          'week of 6 days': [
            {
              period_kind: 'week',
              report_date: null,
              period_end: '2026-10-26',
              period_start: '2026-10-21',
            },
            'eod_reports_period_check',
          ],
          'week with a report date': [
            { period_kind: 'week', period_end: '2026-10-27' },
            'eod_reports_period_check',
          ],
          'calendar month': [
            {
              period_kind: 'month',
              report_date: null,
              period_start: '2026-02-01',
              period_end: '2026-02-28',
            },
            'ok',
          ],
          'month not starting on the 1st': [
            {
              period_kind: 'month',
              report_date: null,
              period_start: '2026-02-02',
              period_end: '2026-03-01',
            },
            'eod_reports_period_check',
          ],
        },
      ),
      variants('EOD version rules', 'ops.eod_report_versions', version, {
        'version 1 twice': [{}, 'eod_report_versions_report_version_key'],
        'version 2 not linked': [{ version: 2 }, 'eod_report_versions_revision_check'],
        'version 2 linked': [{ version: 2, revision_of_version_id: id('version') }, 'ok'],
        'version 0': [{ version: 0 }, 'eod_report_versions_revision_check'],
      }),
      vocab(
        'EOD review event kinds (OPS_EOD_REVIEW_EVENT_KINDS)',
        'ops.eod_review_events',
        OPS_EOD_REVIEW_EVENT_KINDS,
        'eod_review_events_kind_check',
        (v) =>
          reviewEvent({
            kind: v,
            text: 'Sample note',
            task_id: v === 'follow_up_task_created' ? ids.task : null,
          }),
      ),
      variants('EOD review event rules', 'ops.eod_review_events', reviewEvent, {
        'revision request without text': [
          { kind: 'revision_requested' },
          'eod_review_events_text_check',
        ],
        'follow-up without its task': [
          { kind: 'follow_up_task_created' },
          'eod_review_events_task_check',
        ],
        'viewed with a task': [{ task_id: id('task') }, 'eod_review_events_task_check'],
      }),
    ],
  );
});

describe('tracker imports and review acknowledgements', () => {
  runCases(
    () => ctx.pg,
    [
      variants('import batch rules', 'ops.task_import_batches', batch, {
        'same file for the same person': [
          { source_sha256: SHA },
          'task_import_batches_source_staff_key',
        ],
        'not a sha-256': [{ source_sha256: 'abc' }, 'task_import_batches_sha_check'],
        'committed without a time': [
          { status: 'committed' },
          'task_import_batches_committed_check',
        ],
        committed: [
          { status: 'committed', committed_at: NOW, committed_by_user_id: () => ctx.ids.user },
          'ok',
        ],
      }),
      vocab(
        'import outcomes (OPS_TASK_IMPORT_OUTCOMES)',
        'ops.task_import_rows',
        OPS_TASK_IMPORT_OUTCOMES,
        'task_import_rows_outcome_check',
        (v) => importRow({ outcome: v }),
      ),
      variants('import row rules', 'ops.task_import_rows', importRow, {
        'same legacy record twice in a batch': [
          { legacy_id: 't-1' },
          'task_import_rows_batch_record_key',
        ],
        'same legacy id as a report': [{ legacy_id: 't-1', kind: 'report' }, 'ok'],
        'task row pointing at a report': [
          { eod_report_id: id('report') },
          'task_import_rows_target_check',
        ],
      }),
      variants('review acknowledgement rules', 'ops.review_acknowledgements', ack, {
        'same person, same version twice': [{ review_version: 1 }, 'review_acknowledgements_key'],
        'follow-up date without a follow-up': [
          { follow_up_on: '2026-10-22' },
          'review_acknowledgements_follow_up_check',
        ],
        'version 0': [{ review_version: 0 }, 'review_acknowledgements_version_check'],
      }),
    ],
  );
});
