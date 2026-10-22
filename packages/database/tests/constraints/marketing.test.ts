import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError } from '../../src/errors';
import {
  MARKETING_ACCOUNT_SCOPES,
  MARKETING_ACCOUNT_STATUSES,
  MARKETING_ASSIGNEE_ROLES,
  MARKETING_CADENCE_ENFORCEMENT,
  MARKETING_CAMPAIGN_STATUSES,
  MARKETING_CONTENT_FORMATS,
  MARKETING_CONTENT_STATES,
  MARKETING_COURSE_PREFIXES,
  MARKETING_IDEA_SCOPES,
  MARKETING_IDEA_STATUSES,
  MARKETING_INTEGRATION_STATUSES,
  MARKETING_MATCH_STATUSES,
  MARKETING_METRIC_KEYS,
  MARKETING_METRIC_STATES,
  MARKETING_PLACEMENT_STATUSES,
  MARKETING_PLACEMENT_VARIANTS,
  MARKETING_PLATFORMS,
  MARKETING_PUBLICATION_MODES,
  MARKETING_PUBLISHING_STATUSES,
  MARKETING_QUARANTINE_STATES,
  MARKETING_RIGHTS_STATES,
  MARKETING_RULE_KINDS,
  MARKETING_RULE_STATUSES,
  MARKETING_SETTING_STATUSES,
  MARKETING_SNAPSHOT_SOURCES,
} from '../../src/schema/index';
import { NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const at = (table: string) => (table.includes('.') ? table : `marketing.${table}`);

/** One vocab case per enum-like column of `table`: [column, TS values, check name, extra fields]. */
const enums = (
  table: string,
  base: (o: Row) => Row,
  columns: [string, readonly string[], string, ((v: string) => Row)?][],
) =>
  columns.map(([column, values, constraint, extra]) =>
    vocab(`${table}.${column} vocabulary`, at(table), values, constraint, (v) =>
      base({ [column]: v, ...extra?.(v) }),
    ),
  );

/**
 * Deletes `table`.`id` in a rolled-back transaction, then reports what happened to the child row:
 * `'deleted'` (cascade), `'set null'`, `'kept'`, or the constraint that refused the delete.
 */
async function afterDelete(
  pg: PGlite,
  table: string,
  rowId: string,
  child: [string, string, string],
) {
  const [childTable, childId, column] = child;
  await pg.exec('BEGIN');
  try {
    await pg.query(`DELETE FROM ${table} WHERE id = $1`, [rowId]);
    const { rows } = await pg.query<{ cleared: boolean }>(
      `SELECT ${column} IS NULL AS cleared FROM ${childTable} WHERE id = $1`,
      [childId],
    );
    return rows[0] ? (rows[0].cleared ? 'set null' : 'kept') : 'deleted';
  } catch (error) {
    const pgError = findPgError(error);
    return pgError?.constraint ?? pgError?.code ?? String(error);
  } finally {
    await pg.exec('ROLLBACK');
  }
}

const setting = (o: Row = {}): Row => ({
  key: 'sample.cadence',
  value: '{}',
  description: 'Sample setting',
  ...o,
});
const conflict = (o: Row = {}): Row => ({
  code: 'SAMPLE-CONFLICT-002',
  title: 'Sample conflict',
  description: 'Sample',
  ...o,
});
const account = (o: Row = {}): Row => ({
  code: 'LI',
  platform: 'linkedin',
  scope: 'company',
  status: 'later',
  ...o,
});
const rule = (o: Row = {}): Row => ({
  code: 'CR-902',
  kind: 'banned_phrase',
  description: 'Sample rule',
  manual_check: false,
  status: 'proposed',
  ...o,
});
const campaign = (o: Row = {}): Row => ({ code: 'SAMPLE-2', name: 'Sample campaign', ...o });
const idea = (o: Row = {}): Row => ({
  code: 'CLAT-002',
  course_prefix: 'CLAT',
  title: 'Sample second idea',
  normalized_title: 'sample second idea',
  scope: 'single_exam',
  created_by: ctx.ids.user,
  ...o,
});
const item = (o: Row = {}): Row => ({
  idea_id: ids.idea,
  title: 'Sample post',
  format: 'post',
  created_by: ctx.ids.user,
  ...o,
});
const version = (o: Row = {}): Row => ({
  content_item_id: ids.item,
  version_number: 2,
  title: 'Sample post',
  body: 'Sample body',
  content_hash: 'h2',
  author_user_id: ctx.ids.user,
  ...o,
});
const asset = (o: Row = {}): Row => ({
  version_id: ids.version,
  file_name: 'sample.png',
  mime_type: 'image/png',
  ...o,
});
const assignment = (o: Row = {}): Row => ({
  content_item_id: ids.item,
  role: 'writer',
  staff_member_id: ctx.ids.staff,
  ...o,
});
const review = (o: Row = {}): Row => ({
  content_item_id: ids.item,
  version_id: ids.version,
  version_hash: 'h1',
  approval_id: ids.approval2,
  rule_check: '{}',
  ...o,
});
const group = (o: Row = {}): Row => ({
  code: 'COLLAB-2',
  idea_id: ids.idea,
  platform: 'youtube',
  ...o,
});
const placement = (o: Row = {}): Row => ({
  code: 'CLAT-001-YTCL',
  idea_id: ids.idea,
  content_item_id: ids.item,
  account_id: ids.account,
  ...o,
});
const record = (o: Row = {}): Row => ({
  placement_id: ids.placement2,
  version_id: ids.version,
  idempotency_key: 'placement:2:version:1',
  adapter: 'mock',
  max_attempts: 3,
  is_sandbox: true,
  ...o,
});
const metricImport = (o: Row = {}): Row => ({
  account_id: ids.account,
  file_name: 'sample-export.csv',
  file_sha256: 'b'.repeat(64),
  format: 'csv',
  date_format: 'DD/MM/YYYY',
  captured_at: NOW,
  rows_total: 0,
  rows_accepted: 0,
  rows_rejected: 0,
  rejected: '[]',
  ...o,
});
const snapshot = (o: Row = {}): Row => ({
  source: 'csv_import',
  source_label: 'Sample export',
  account_id: ids.account,
  match_status: 'unmatched',
  post_key: 'https://example.test/p/2',
  captured_at: NOW,
  ...o,
});
const metricValue = (o: Row = {}): Row => ({
  snapshot_id: ids.snapshot2,
  metric: 'reach',
  value: 5,
  state: 'reported',
  ...o,
});

beforeAll(async () => {
  ctx = await setup();
  const { pg } = ctx;
  const add = async (name: string, table: string, row: Row) => {
    ids[name] = await insert(pg, at(table), row);
  };
  ids.owner = await insert(pg, 'core.staff_members', { full_name: 'Sample Social Owner' });
  ids.assignee = await insert(pg, 'core.users', {
    email: 'assignee@example.test',
    display_name: 'Sample Assignee',
  });
  for (const n of ['approval', 'approval2'])
    ids[n] = await insert(pg, 'core.approvals', {
      subject_module: 'marketing',
      subject_type: 'content_item',
      subject_id: crypto.randomUUID(),
      policy: 'marketing.content.publish',
      requested_by: ctx.ids.user,
    });
  await insert(pg, at('policy_settings'), setting({ key: 'sample.seeded' }));
  await insert(pg, at('legacy_conflicts'), conflict({ code: 'SAMPLE-CONFLICT-001' }));
  await insert(pg, at('content_rules'), rule({ code: 'CR-901' }));
  await insert(pg, at('code_counters'), { scope: 'CLAT', last_number: 1 });
  await add(
    'account',
    'social_accounts',
    account({ code: 'IGC', platform: 'instagram', owner_staff_id: ids.owner }),
  );
  await add('account2', 'social_accounts', account({ code: 'YTC', platform: 'youtube' }));
  await add('campaign', 'campaigns', campaign({ code: 'SAMPLE-1' }));
  await add(
    'idea',
    'ideas',
    idea({ code: 'CLAT-001', normalized_title: 'sample idea', legacy_ref: 'ideas.csv#L2' }),
  );
  await add('item', 'content_items', item({ legacy_ref: 'content.csv#L2' }));
  await add('item2', 'content_items', item({ format: 'caption' }));
  await add('version', 'content_versions', version({ version_number: 1, content_hash: 'h1' }));
  await add(
    'editor',
    'content_assignments',
    assignment({
      content_item_id: ids.item2,
      role: 'editor',
      user_id: ctx.ids.user2,
      staff_member_id: ids.owner,
    }),
  );
  await add(
    'designer',
    'content_assignments',
    assignment({
      content_item_id: ids.item2,
      role: 'designer',
      user_id: ids.assignee,
      staff_member_id: null,
    }),
  );
  await insert(pg, at('content_reviews'), review({ approval_id: ids.approval }));
  await add('group', 'placement_groups', group({ code: 'COLLAB-1', platform: 'instagram' }));
  await add(
    'placement',
    'placements',
    placement({
      code: 'CLAT-001-IGC',
      placement_group_id: ids.group,
      campaign_id: ids.campaign,
      legacy_ref: 'calendar.csv#L2',
    }),
  );
  await add(
    'placement2',
    'placements',
    placement({ code: 'CLAT-001-YTC', account_id: ids.account2 }),
  );
  await add(
    'record',
    'publishing_records',
    record({ placement_id: ids.placement, idempotency_key: 'placement:1:version:1' }),
  );
  await add('attempt', 'publishing_attempts', {
    record_id: ids.record,
    attempt_number: 1,
    outcome: 'failed',
  });
  await insert(pg, at('metric_imports'), metricImport());
  await add(
    'snapshot',
    'metric_snapshots',
    snapshot({
      post_key: 'https://example.test/p/1',
      placement_id: ids.placement2,
      suggested_placement_id: ids.placement2,
    }),
  );
  await add('snapshot2', 'metric_snapshots', snapshot({ post_key: 'https://example.test/p/3' }));
  await add('value', 'metric_values', metricValue({ snapshot_id: ids.snapshot, metric: 'views' }));
});
afterAll(() => ctx.t.close());

describe('settings, accounts, rules, counters and campaigns', () => {
  runCases(
    () => ctx.pg,
    [
      ...enums('policy_settings', setting, [
        ['status', MARKETING_SETTING_STATUSES, 'policy_settings_status_check'],
      ]),
      variants('policy setting key', at('policy_settings'), setting, {
        'same key twice': [{ key: 'sample.seeded' }, 'policy_settings_key_key'],
      }),
      ...enums('legacy_conflicts', conflict, [
        ['status', ['unreconciled', 'resolved'], 'legacy_conflicts_status_check'],
      ]),
      variants('legacy conflict rules', at('legacy_conflicts'), conflict, {
        'same code twice': [{ code: 'SAMPLE-CONFLICT-001' }, 'legacy_conflicts_code_key'],
      }),
      ...enums('social_accounts', account, [
        ['platform', MARKETING_PLATFORMS, 'social_accounts_platform_check'],
        ['status', MARKETING_ACCOUNT_STATUSES, 'social_accounts_status_check'],
        ['scope', MARKETING_ACCOUNT_SCOPES, 'social_accounts_scope_check'],
        ['integration_status', MARKETING_INTEGRATION_STATUSES, 'social_accounts_integration_check'],
        [
          'cadence_enforcement',
          MARKETING_CADENCE_ENFORCEMENT,
          'social_accounts_cadence_enforcement_check',
        ],
        ['cadence_status', MARKETING_SETTING_STATUSES, 'social_accounts_cadence_status_check'],
      ]),
      variants('social account rules', at('social_accounts'), account, {
        'lower-case code': [{ code: 'li' }, 'social_accounts_code_format'],
        'one-letter code': [{ code: 'L' }, 'social_accounts_code_format'],
        'six-letter code': [{ code: 'LINKED' }, 'social_accounts_code_format'],
        'five-letter code': [{ code: 'LINKD' }, 'ok'],
        'same code twice': [{ code: 'IGC' }, 'social_accounts_code_key'],
        'zero posts a day': [{ cadence_max_per_day: 0 }, 'social_accounts_cadence_positive'],
        'zero posts a week': [{ cadence_max_per_week: 0 }, 'social_accounts_cadence_positive'],
        'one a day, three a week': [{ cadence_max_per_day: 1, cadence_max_per_week: 3 }, 'ok'],
      }),
      ...enums('content_rules', rule, [
        ['kind', MARKETING_RULE_KINDS, 'content_rules_kind_check'],
        ['status', MARKETING_RULE_STATUSES, 'content_rules_status_check'],
      ]),
      variants('content rule code', at('content_rules'), rule, {
        'same code twice': [{ code: 'CR-901' }, 'content_rules_code_key'],
      }),
      variants(
        'code counters',
        at('code_counters'),
        (o) => ({ scope: 'IPMAT', last_number: 0, ...o }),
        {
          'starts at 0': [{}, 'ok'],
          negative: [{ last_number: -1 }, 'code_counters_non_negative'],
          'same scope twice': [{ scope: 'CLAT' }, 'code_counters_pkey'],
        },
      ),
      ...enums('campaigns', campaign, [
        ['status', MARKETING_CAMPAIGN_STATUSES, 'campaigns_status_check'],
        ['kind', ['organic'], 'campaigns_kind_check'],
      ]),
      variants('campaign rules', at('campaigns'), campaign, {
        'lower-case code': [{ code: 'sample-2' }, 'campaigns_code_format'],
        'one-character code': [{ code: 'S' }, 'campaigns_code_format'],
        'code starting with a dash': [{ code: '-SAMPLE' }, 'campaigns_code_format'],
        'same code twice': [{ code: 'SAMPLE-1' }, 'campaigns_code_key'],
        'ends before it starts': [
          { starts_on: '2026-11-02', ends_on: '2026-11-01' },
          'campaigns_dates_order',
        ],
        'one-day campaign': [{ starts_on: '2026-11-01', ends_on: '2026-11-01' }, 'ok'],
      }),
    ],
  );
});

describe('ideas and content', () => {
  runCases(
    () => ctx.pg,
    [
      ...enums('ideas', idea, [
        [
          'course_prefix',
          MARKETING_COURSE_PREFIXES,
          'ideas_course_prefix_check',
          () => ({ code: null, quarantine_state: 'quarantined' }),
        ],
        ['status', MARKETING_IDEA_STATUSES, 'ideas_status_check'],
        ['scope', MARKETING_IDEA_SCOPES, 'ideas_scope_check'],
        ['quarantine_state', MARKETING_QUARANTINE_STATES, 'ideas_quarantine_check'],
      ]),
      variants('idea rules', at('ideas'), idea, {
        'two-digit number': [{ code: 'CLAT-02' }, 'ideas_code_format'],
        'four-digit number': [{ code: 'CLAT-1000' }, 'ok'],
        'code of another course': [{ code: 'IPMAT-002' }, 'ideas_code_matches_prefix'],
        'no code, not quarantined': [{ code: null }, 'ideas_code_or_quarantine'],
        'no code while quarantined': [{ code: null, quarantine_state: 'quarantined' }, 'ok'],
        'same code twice': [{ code: 'CLAT-001' }, 'ideas_code_key'],
        'same title in the same course': [
          { normalized_title: 'sample idea' },
          'ideas_course_title_key',
        ],
        'same title in another course': [
          { code: 'GEN-001', course_prefix: 'GEN', normalized_title: 'sample idea' },
          'ok',
        ],
        'same legacy row twice': [{ legacy_ref: 'ideas.csv#L2' }, 'ideas_legacy_ref_key'],
      }),
      ...enums('content_items', item, [
        ['format', MARKETING_CONTENT_FORMATS, 'content_items_format_check'],
        ['state', MARKETING_CONTENT_STATES, 'content_items_state_check'],
      ]),
      variants('content item rules', at('content_items'), item, {
        'approved version without an approval': [
          { approved_version_id: id('version') },
          'content_items_approved_needs_approval',
        ],
        'approved version with its approval': [
          { approved_version_id: id('version'), approval_id: id('approval') },
          'ok',
        ],
        'same legacy row twice': [{ legacy_ref: 'content.csv#L2' }, 'content_items_legacy_ref_key'],
        'idea that does not exist': [
          { idea_id: crypto.randomUUID() },
          'content_items_idea_id_ideas_id_fk',
        ],
      }),
      variants('content version rules', at('content_versions'), version, {
        'version 2': [{}, 'ok'],
        'version 0': [{ version_number: 0 }, 'content_versions_number_positive'],
        'version 1 twice': [{ version_number: 1 }, 'content_versions_item_number_key'],
      }),
      ...enums('content_assets', asset, [
        ['rights_state', MARKETING_RIGHTS_STATES, 'content_assets_rights_check'],
      ]),
      variants('content asset size', at('content_assets'), asset, {
        'empty file': [{ size_bytes: 0 }, 'ok'],
        'negative size': [{ size_bytes: -1 }, 'content_assets_size_non_negative'],
      }),
      ...enums('content_assignments', assignment, [
        ['role', MARKETING_ASSIGNEE_ROLES, 'content_assignments_role_check'],
      ]),
      variants('content assignment rules', at('content_assignments'), assignment, {
        'nobody assigned': [{ staff_member_id: null }, 'content_assignments_has_assignee'],
        'a user only': [{ staff_member_id: null, user_id: () => ctx.ids.user }, 'ok'],
        'same role twice on one item': [
          { content_item_id: id('item2'), role: 'editor' },
          'content_assignments_item_role_key',
        ],
      }),
      ...enums('content_reviews', review, [
        [
          'outcome',
          ['pending', 'approved', 'changes_requested', 'withdrawn', 'voided'],
          'content_reviews_outcome_check',
        ],
      ]),
      variants('content review rules', at('content_reviews'), review, {
        'one approval bound to two reviews': [
          { approval_id: id('approval') },
          'content_reviews_approval_key',
        ],
      }),
    ],
  );
});

describe('placements and publishing', () => {
  runCases(
    () => ctx.pg,
    [
      variants('collab group rules', at('placement_groups'), group, {
        'YouTube collab': [{}, 'ok'],
        'LinkedIn collab': [{ platform: 'linkedin' }, 'placement_groups_platform_check'],
        'not a collab': [{ kind: 'bogus' }, 'placement_groups_kind_check'],
        'same code twice': [{ code: 'COLLAB-1' }, 'placement_groups_code_key'],
      }),
      ...enums('placements', placement, [
        [
          'status',
          MARKETING_PLACEMENT_STATUSES,
          'placements_status_check',
          () => ({ scheduled_at: NOW }),
        ],
        ['variant', MARKETING_PLACEMENT_VARIANTS, 'placements_variant_check'],
        ['publication_mode', MARKETING_PUBLICATION_MODES, 'placements_publication_mode_check'],
      ]),
      variants('placement rules', at('placements'), placement, {
        'scheduled without a time': [{ status: 'scheduled' }, 'placements_scheduled_has_time'],
        'no content item': [{ content_item_id: null }, 'placements_linked_unless_ambiguous'],
        'no code': [{ code: null }, 'placements_linked_unless_ambiguous'],
        'ambiguous legacy row with no links': [
          { ambiguous: true, code: null, idea_id: null, content_item_id: null },
          'ok',
        ],
        'same code twice': [{ code: 'CLAT-001-IGC' }, 'placements_code_key'],
        'same legacy row twice': [{ legacy_ref: 'calendar.csv#L2' }, 'placements_legacy_ref_key'],
      }),
      ...enums('publishing_records', record, [
        ['status', MARKETING_PUBLISHING_STATUSES, 'publishing_records_status_check'],
      ]),
      variants('publishing record rules', at('publishing_records'), record, {
        'second pending record for a placement': [
          { placement_id: id('placement') },
          'publishing_records_one_active_per_placement',
        ],
        'succeeded beside a pending one': [
          { placement_id: id('placement'), status: 'succeeded' },
          'publishing_records_one_active_per_placement',
        ],
        'failed beside a pending one': [{ placement_id: id('placement'), status: 'failed' }, 'ok'],
        'same idempotency key': [
          { idempotency_key: 'placement:1:version:1' },
          'publishing_records_idempotency_key',
        ],
        'more attempts than allowed': [{ attempts: 4 }, 'publishing_records_attempts_range'],
        'no attempts allowed': [{ max_attempts: 0 }, 'publishing_records_attempts_range'],
        'negative attempts': [{ attempts: -1 }, 'publishing_records_attempts_range'],
        'sandbox claiming a live link': [
          { published_url: 'https://example.test/p/9' },
          'publishing_records_sandbox_no_url',
        ],
        'live post with a link': [
          { is_sandbox: false, published_url: 'https://example.test/p/9' },
          'ok',
        ],
      }),
      variants(
        'publishing attempt rules',
        at('publishing_attempts'),
        (o) => ({ record_id: ids.record, attempt_number: 2, outcome: 'succeeded', ...o }),
        {
          'second attempt': [{}, 'ok'],
          'attempt 1 twice': [{ attempt_number: 1 }, 'publishing_attempts_record_number_key'],
          'unknown outcome': [{ outcome: 'bogus' }, 'publishing_attempts_outcome_check'],
        },
      ),
    ],
  );
});

describe('metrics (missing is not zero)', () => {
  runCases(
    () => ctx.pg,
    [
      variants('metric import rules', at('metric_imports'), metricImport, {
        'negative total': [{ rows_total: -1 }, 'metric_imports_counts'],
        'negative accepted': [{ rows_accepted: -1 }, 'metric_imports_counts'],
        'negative rejected': [{ rows_rejected: -1 }, 'metric_imports_counts'],
        'negative skipped': [{ rows_skipped: -1 }, 'metric_imports_counts'],
        'same file for the same account': [{}, 'metric_imports_file_account_key'],
        'same file for another account': [{ account_id: id('account2') }, 'ok'],
      }),
      ...enums('metric_snapshots', snapshot, [
        ['source', MARKETING_SNAPSHOT_SOURCES, 'metric_snapshots_source_check'],
        ['match_status', MARKETING_MATCH_STATUSES, 'metric_snapshots_match_check'],
        ['window', ['lifetime_at_capture', '24h', '7d'], 'metric_snapshots_window_check'],
        ['captured_precision', ['instant', 'date'], 'metric_snapshots_precision_check'],
      ]),
      variants('metric snapshot capture key', at('metric_snapshots'), snapshot, {
        'same post, time and source': [
          { post_key: 'https://example.test/p/1' },
          'metric_snapshots_capture_key',
        ],
        'same post and time, another source': [
          { post_key: 'https://example.test/p/1', source: 'manual_audit' },
          'ok',
        ],
      }),
      ...enums('metric_values', metricValue, [
        ['metric', MARKETING_METRIC_KEYS, 'metric_values_metric_check'],
        [
          'state',
          MARKETING_METRIC_STATES,
          'metric_values_state_check',
          (v) => ({ value: v === 'missing' || v === 'not_applicable' ? null : 1 }),
        ],
      ]),
      variants('metric value matches its state', at('metric_values'), metricValue, {
        'reported 0': [{ value: 0 }, 'ok'],
        'reported without a value': [{ value: null }, 'metric_values_value_matches_state'],
        'reported negative': [{ value: -1 }, 'metric_values_value_matches_state'],
        'estimated without a value': [
          { state: 'estimated', value: null },
          'metric_values_value_matches_state',
        ],
        'missing stored as 0': [
          { state: 'missing', value: 0 },
          'metric_values_value_matches_state',
        ],
        'not applicable with a value': [
          { state: 'not_applicable', value: 3 },
          'metric_values_value_matches_state',
        ],
        'same metric twice in a snapshot': [
          { snapshot_id: id('snapshot'), metric: 'views' },
          'metric_values_snapshot_metric_key',
        ],
      }),
    ],
  );
});

describe('what a delete does to the rows that point at it', () => {
  const cases: [string, string, string, [string, string, string], string][] = [
    [
      'a content item takes its assignments (cascade)',
      'content_items',
      'item2',
      ['content_assignments', 'editor', 'id'],
      'deleted',
    ],
    [
      'a snapshot takes its metric values (cascade)',
      'metric_snapshots',
      'snapshot',
      ['metric_values', 'value', 'id'],
      'deleted',
    ],
    [
      'a campaign leaves its placements (set null)',
      'campaigns',
      'campaign',
      ['placements', 'placement', 'campaign_id'],
      'set null',
    ],
    [
      'a collab group leaves its placements (set null)',
      'placement_groups',
      'group',
      ['placements', 'placement', 'placement_group_id'],
      'set null',
    ],
    [
      'a placement leaves its snapshots (set null)',
      'placements',
      'placement2',
      ['metric_snapshots', 'snapshot', 'placement_id'],
      'set null',
    ],
    [
      'a placement leaves suggested matches (set null)',
      'placements',
      'placement2',
      ['metric_snapshots', 'snapshot', 'suggested_placement_id'],
      'set null',
    ],
    [
      'a publishing record with attempts stays (restrict)',
      'publishing_records',
      'record',
      ['publishing_attempts', 'attempt', 'id'],
      'publishing_attempts_record_id_publishing_records_id_fk',
    ],
    [
      'a staff member leaves the account they owned (set null)',
      'core.staff_members',
      'owner',
      ['social_accounts', 'account', 'owner_staff_id'],
      'set null',
    ],
    [
      'a staff member leaves an assignment a user still holds (set null)',
      'core.staff_members',
      'owner',
      ['content_assignments', 'editor', 'staff_member_id'],
      'set null',
    ],
    [
      'the only assignee cannot be deleted (set null meets has_assignee)',
      'core.users',
      'assignee',
      ['content_assignments', 'designer', 'user_id'],
      'content_assignments_has_assignee',
    ],
  ];
  it.each(cases)('%s', async (_rule, table, target, [childTable, childId, column], expected) => {
    expect(
      await afterDelete(ctx.pg, at(table), ids[target]!, [at(childTable), ids[childId]!, column]),
    ).toBe(expected);
  });
});
