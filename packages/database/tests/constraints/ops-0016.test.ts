/**
 * Migration 0016, Business Ops side (owner brief 23 Oct 2026 §6–8, §11, §19–20): requests sent
 * through HR, task reminders, lead stages and call fields, file versions and release, score
 * imports, personal settings.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  OPS_ATTACHMENT_PENDING_OWNER_KINDS,
  OPS_HR_REQUEST_EVENT_KINDS,
  OPS_HR_REQUEST_RELATED_KINDS,
  OPS_HR_REQUEST_STATUSES,
  OPS_HR_REQUEST_URGENCIES,
  OPS_LEAD_STAGE_KINDS,
  OPS_SCORE_IMPORT_SOURCES,
  OPS_SCORE_IMPORT_STATUSES,
  OPS_SCORE_MATCH_BASES,
  OPS_SCORE_MATCH_STATUSES,
  OPS_SCORE_ROW_CHANGES,
  OPS_SCORE_ROW_RESOLUTIONS,
  OPS_TASK_REMINDER_KINDS,
} from '../../src/schema/index';
import { NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

const SHA = 'a'.repeat(64);
const UUID = '00000000-0000-4000-8000-0000000000aa';
let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const by = () => ctx.ids.user;
const staff = () => ctx.ids.staff;

const request = (o: Row = {}): Row => ({
  sender_staff_id: staff(),
  category: 'Timetable',
  subject: 'Swap Friday class',
  message: 'Please ask the coordinator about Friday.',
  created_by: by(),
  ...o,
});
const submitted = (o: Row = {}): Row => request({ status: 'submitted', submitted_at: NOW, ...o });
const event = (o: Row = {}): Row => ({
  request_id: ids.request,
  kind: 'reviewed',
  actor_user_id: by(),
  ...o,
});
const reminder = (o: Row = {}): Row => ({
  task_id: ids.task,
  staff_id: staff(),
  kind: 'due_soon',
  window_key: '2026-10-23',
  ...o,
});
const stage = (o: Row = {}): Row => ({
  key: `s_${Math.random().toString(36).slice(2, 8)}`,
  label: 'Sample stage',
  ...o,
});
const history = (o: Row = {}): Row => ({
  lead_id: ctx.ids.lead,
  to_key: 'new',
  actor_user_id: by(),
  ...o,
});
const activity = (o: Row = {}): Row => ({
  lead_id: ctx.ids.lead,
  kind: 'call',
  outcome: 'connected_two_way',
  occurred_at: NOW,
  created_by: by(),
  ...o,
});
const attachment = (o: Row = {}): Row => ({
  owner_kind: 'task',
  owner_id: UUID,
  purpose: 'reference',
  original_name: 'paper.pdf',
  mime: 'application/pdf',
  size_bytes: 1024,
  sha256: SHA,
  storage_key: `k-${Math.random()}`,
  uploaded_by_user_id: by(),
  ...o,
});
const scoreImport = (o: Row = {}): Row => ({
  assessment_id: UUID,
  attachment_id: ids.file,
  source: 'csv',
  sha256: 'b'.repeat(64),
  created_by: by(),
  ...o,
});
const row = (o: Row = {}): Row => ({
  import_id: ids.import,
  row_no: 2,
  original: '{}',
  parsed: '{}',
  match_status: 'unmatched',
  ...o,
});
const matched = { match_status: 'matched', roster_entry_id: UUID, student_id: UUID };

beforeAll(async () => {
  ctx = await setup();
  const ins = (table: string, r: Row) => insert(ctx.pg, table, r);
  ids.task = await ins('ops.staff_tasks', {
    staff_id: staff(),
    title: 'Sample task',
    due_on: '2026-10-25',
    original_due_on: '2026-10-25',
    created_by: by(),
  });
  ids.request = await ins('ops.hr_requests', submitted());
  await ins('ops.hr_requests', submitted({ subject: 'Second' }));
  for (const key of ['new', 'lost']) await ins('ops.lead_stages', { key, label: key });
  await ins('ops.task_reminders', reminder({ window_key: 'taken' }));
  ids.file = await ins('ops.attachments', attachment({ owner_kind: 'score_import' }));
  ids.import = await ins('ops.score_imports', scoreImport({ sha256: SHA }));
  await ins('ops.score_import_rows', row({ row_no: 1 }));
  await ins('core.user_preferences', { user_id: ctx.ids.user2 });
});
afterAll(() => ctx.t.close());

describe('requests sent through HR (§6)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'request statuses (OPS_HR_REQUEST_STATUSES)',
        'ops.hr_requests',
        OPS_HR_REQUEST_STATUSES,
        'hr_requests_status_check',
        (v) =>
          request({
            status: v,
            submitted_at: v === 'draft' ? null : NOW,
            decided_at: ['resolved', 'declined'].includes(v) ? NOW : null,
          }),
      ),
      vocab(
        'urgencies (OPS_HR_REQUEST_URGENCIES)',
        'ops.hr_requests',
        OPS_HR_REQUEST_URGENCIES,
        'hr_requests_urgency_check',
        (v) => request({ urgency: v }),
      ),
      vocab(
        'related kinds (OPS_HR_REQUEST_RELATED_KINDS)',
        'ops.hr_requests',
        OPS_HR_REQUEST_RELATED_KINDS,
        'hr_requests_related_kind_check',
        (v) => request({ related_kind: v, related_id: v === 'none' ? null : UUID }),
      ),
      variants('request rules', 'ops.hr_requests', request, {
        'draft, blank message': [{ message: ' ' }, 'ok'],
        'submitted, blank message': [
          { status: 'submitted', submitted_at: NOW, message: ' ' },
          'hr_requests_text_check',
        ],
        'for HR itself (no recipient)': [{}, 'ok'],
        'for a configured recipient': [{ recipient_key: 'schar' }, 'ok'],
        'staff and key both': [
          { recipient_key: 'schar', recipient_staff_id: staff },
          'hr_requests_recipient_check',
        ],
        'bad recipient key': [{ recipient_key: 'Schar Sir' }, 'hr_requests_recipient_check'],
        'related id without kind': [{ related_id: UUID }, 'hr_requests_related_check'],
        'submitted without time': [{ status: 'submitted' }, 'hr_requests_submitted_check'],
        'draft with submit time': [{ submitted_at: NOW }, 'hr_requests_submitted_check'],
        'resolved without decision time': [
          { status: 'resolved', submitted_at: NOW },
          'hr_requests_decided_check',
        ],
        'linked task': [{ linked_task_id: id('task') }, 'ok'],
      }),
      vocab(
        'event kinds (OPS_HR_REQUEST_EVENT_KINDS)',
        'ops.hr_request_events',
        OPS_HR_REQUEST_EVENT_KINDS,
        'hr_request_events_kind_check',
        (v) =>
          event({
            kind: v,
            body: 'Shown text',
            forwarded_to_staff_id: v === 'forwarded' ? staff() : null,
          }),
      ),
      variants('routing log rules', 'ops.hr_request_events', event, {
        'forwarded with recipient and text': [
          {
            kind: 'forwarded',
            forwarded_to_staff_id: staff,
            body: 'Original',
            visible_to_recipient: true,
          },
          'ok',
        ],
        'forwarded to nobody': [
          { kind: 'forwarded', body: 'x' },
          'hr_request_events_forwarded_check',
        ],
        'recipient on a non-forward': [
          { forwarded_to_staff_id: staff },
          'hr_request_events_forwarded_check',
        ],
        'forwarded without text': [
          { kind: 'forwarded', forwarded_to_staff_id: staff },
          'hr_request_events_body_check',
        ],
        'declined without reason': [{ kind: 'declined' }, 'hr_request_events_body_check'],
        'empty response': [
          { kind: 'recipient_responded', body: ' ' },
          'hr_request_events_body_check',
        ],
        'empty note': [{ kind: 'note' }, 'hr_request_events_note_check'],
        'HR-only note': [{ kind: 'note', hr_note: 'Checked with the coordinator' }, 'ok'],
      }),
    ],
  );
});

describe('task reminders and related kinds (§7–8)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'reminder kinds (OPS_TASK_REMINDER_KINDS)',
        'ops.task_reminders',
        OPS_TASK_REMINDER_KINDS,
        'task_reminders_kind_check',
        (v) => reminder({ kind: v }),
      ),
      variants('reminder dedupe', 'ops.task_reminders', reminder, {
        'same window again': [{ window_key: 'taken' }, 'task_reminders_window_key'],
        'other kind, same window': [{ window_key: 'taken', kind: 'overdue' }, 'ok'],
        'blank window': [{ window_key: ' ' }, 'task_reminders_window_check'],
      }),
    ],
  );
});

describe('lead stages, history and call fields (§11)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'stage kinds (OPS_LEAD_STAGE_KINDS)',
        'ops.lead_stages',
        OPS_LEAD_STAGE_KINDS,
        'lead_stages_kind_check',
        (v) => stage({ kind: v }),
      ),
      variants('stage rules', 'ops.lead_stages', stage, {
        'key reused': [{ key: 'new' }, 'lead_stages_key_key'],
        'key not snake case': [{ key: 'Demo Booked' }, 'lead_stages_key_format'],
        'blank label': [{ label: ' ' }, 'lead_stages_label_check'],
      }),
      variants('stage history', 'ops.lead_stage_history', history, {
        'first stage': [{}, 'ok'],
        'moved with reason': [
          { from_key: 'new', to_key: 'lost', reason: 'Joined elsewhere' },
          'ok',
        ],
        'unknown stage': [{ to_key: 'nope' }, 'lead_stage_history_to_key_lead_stages_key_fk'],
        'no change': [{ from_key: 'new' }, 'lead_stage_history_changed_check'],
        'blank reason': [{ reason: ' ' }, 'lead_stage_history_reason_check'],
      }),
      variants(
        'lead stage columns',
        'ops.leads',
        (o) => ({
          code: `LEAD-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
          student_name: 'Sample Student',
          student_email: 'sample@example.test',
          first_received_at: NOW,
          created_by: by(),
          ...o,
        }),
        {
          'staged with time': [{ stage_key: 'new', stage_changed_at: NOW }, 'ok'],
          'stage without time': [{ stage_key: 'new' }, 'leads_stage_changed_check'],
          'unknown stage': [
            { stage_key: 'nope', stage_changed_at: NOW },
            'leads_stage_key_lead_stages_key_fk',
          ],
          'do not contact': [{ do_not_contact: true }, 'ok'],
        },
      ),
      variants('call log fields', 'ops.lead_activities', activity, {
        'outbound call, 3 minutes, next step': [
          {
            direction: 'outbound',
            duration_seconds: 180,
            next_action: 'Send demo slots',
            next_follow_up_on: '2026-10-25',
          },
          'ok',
        ],
        'bad direction': [{ direction: 'sideways' }, 'lead_activities_direction_check'],
        'negative duration': [{ duration_seconds: -1 }, 'lead_activities_duration_check'],
        'duration on a WhatsApp message': [
          { kind: 'whatsapp', outcome: 'message_sent', duration_seconds: 10 },
          'lead_activities_duration_check',
        ],
      }),
    ],
  );
});

describe('file versions and release (§19)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'owner kinds added in 0016 (OPS_ATTACHMENT_PENDING_OWNER_KINDS)',
        'ops.attachments',
        OPS_ATTACHMENT_PENDING_OWNER_KINDS,
        'attachments_owner_kind_check',
        (v) => attachment({ owner_kind: v }),
      ),
      variants('versions', 'ops.attachments', attachment, {
        'second version': [{ version: 2, supersedes_attachment_id: id('file') }, 'ok'],
        'version 2 replacing nothing': [{ version: 2 }, 'attachments_version_check'],
        'version 1 replacing a file': [
          { supersedes_attachment_id: id('file') },
          'attachments_version_check',
        ],
        'released answer key': [
          { owner_kind: 'assessment_key', released_at: NOW, release_note: 'After the test' },
          'ok',
        ],
        'note without release': [{ release_note: 'Soon' }, 'attachments_release_check'],
      }),
    ],
  );
});

describe('score imports (§20)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'sources (OPS_SCORE_IMPORT_SOURCES)',
        'ops.score_imports',
        OPS_SCORE_IMPORT_SOURCES,
        'score_imports_source_check',
        (v) =>
          v === 'manual'
            ? scoreImport({ source: v, attachment_id: null, sha256: null })
            : scoreImport({ source: v }),
      ),
      vocab(
        'statuses (OPS_SCORE_IMPORT_STATUSES)',
        'ops.score_imports',
        OPS_SCORE_IMPORT_STATUSES,
        'score_imports_status_check',
        (v) =>
          scoreImport({
            status: v,
            confirmed_at: v === 'confirmed' ? NOW : null,
            confirmed_by: v === 'confirmed' ? by() : null,
            error: v === 'failed' ? 'Could not read the PDF' : null,
          }),
      ),
      variants('import rules', 'ops.score_imports', scoreImport, {
        'same file into the same test': [{ sha256: SHA }, 'score_imports_file_key'],
        'same file after a cancelled try': [{ sha256: SHA, status: 'cancelled' }, 'ok'],
        'same file into another test': [
          { sha256: SHA, assessment_id: '00000000-0000-4000-8000-0000000000bb' },
          'ok',
        ],
        'file import without a file': [
          { attachment_id: null, sha256: null },
          'score_imports_file_check',
        ],
        'manual with a file': [{ source: 'manual' }, 'score_imports_file_check'],
        'not a sha-256': [{ sha256: 'abc' }, 'score_imports_file_check'],
        'confirmed without who': [
          { status: 'confirmed', confirmed_at: NOW },
          'score_imports_confirmed_check',
        ],
        'failed without a reason': [{ status: 'failed' }, 'score_imports_error_check'],
        'negative row count': [{ rows_total: -1 }, 'score_imports_rows_check'],
      }),
      vocab(
        'match statuses (OPS_SCORE_MATCH_STATUSES)',
        'ops.score_import_rows',
        OPS_SCORE_MATCH_STATUSES,
        'score_import_rows_match_status_check',
        (v) => row({ ...matched, match_status: v }),
      ),
      vocab(
        'match bases (OPS_SCORE_MATCH_BASES)',
        'ops.score_import_rows',
        OPS_SCORE_MATCH_BASES,
        'score_import_rows_match_basis_check',
        (v) => row({ match_basis: v }),
      ),
      vocab(
        'resolutions (OPS_SCORE_ROW_RESOLUTIONS)',
        'ops.score_import_rows',
        OPS_SCORE_ROW_RESOLUTIONS,
        'score_import_rows_resolution_check',
        (v) => row({ ...matched, resolution: v }),
      ),
      vocab(
        'changes (OPS_SCORE_ROW_CHANGES)',
        'ops.score_import_rows',
        OPS_SCORE_ROW_CHANGES,
        'score_import_rows_change_check',
        (v) => row({ ...matched, change: v }),
      ),
      variants('row rules', 'ops.score_import_rows', row, {
        'row number reused': [{ row_no: 1 }, 'score_import_rows_row_key'],
        'row 0': [{ row_no: 0 }, 'score_import_rows_number_check'],
        'matched without a student': [
          { match_status: 'matched' },
          'score_import_rows_student_check',
        ],
        'student without roster entry': [{ student_id: UUID }, 'score_import_rows_student_check'],
        'person resolved without a student': [
          { match_status: 'suggested', resolution: 'matched' },
          'score_import_rows_student_check',
        ],
        'skipped unmatched row': [{ resolution: 'skip' }, 'ok'],
        'overwrite confirmed on a new score': [
          { ...matched, change: 'new', overwrite_confirmed: true },
          'score_import_rows_overwrite_check',
        ],
        'overwrite confirmed': [
          { ...matched, change: 'overwrite', overwrite_confirmed: true },
          'ok',
        ],
      }),
    ],
  );
});

describe('personal settings (core.user_preferences)', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'one row per user, settings an object',
        'core.user_preferences',
        (o) => ({ user_id: by(), ...o }),
        {
          'first row': [{}, 'ok'],
          'second row for a user': [{ user_id: () => ctx.ids.user2 }, 'user_preferences_pkey'],
          'settings not an object': [{ settings: '[]' }, 'user_preferences_settings_check'],
        },
      ),
    ],
  );
});
