import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_EOD_REVIEW_EVENT_KINDS,
  OPS_EOD_STATUSES,
  OPS_TASK_EVENT_KINDS,
  OPS_TASK_IMPORT_OUTCOMES,
  OPS_TASK_SOURCES,
  OPS_TASK_STATUSES,
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
        'in review without a reason': [{ status: 'in_review' }, 'ok'],
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

describe('EOD reports, versions and review events', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'EOD statuses (OPS_EOD_STATUSES)',
        'ops.eod_reports',
        OPS_EOD_STATUSES,
        'eod_reports_status_check',
        (v) =>
          report({
            report_date: '2026-10-21',
            status: v,
            ...(v === 'draft' ? {} : { submitted_at: NOW }),
          }),
      ),
      variants(
        'EOD report rules',
        'ops.eod_reports',
        (o) => report({ report_date: '2026-10-21', ...o }),
        {
          'submitted without a time': [{ status: 'submitted' }, 'eod_reports_submitted_check'],
          'draft with a submit time': [{ submitted_at: NOW }, 'eod_reports_submitted_check'],
          'reviewed draft': [
            { reviewed_by: () => ctx.ids.user, reviewed_at: NOW },
            'eod_reports_reviewed_check',
          ],
          'second report for the day': [
            { report_date: '2026-10-20' },
            'eod_reports_staff_date_key',
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
