/**
 * Migration 0016 marketing tables and columns (owner brief 23 Oct 2026 §12–§15): campaign and
 * idea fields, calendar items, SEO/AIO/GEO work, targets.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import {
  MARKETING_CALENDAR_ITEM_TYPES,
  MARKETING_CALENDAR_STATUSES,
  MARKETING_CHANNELS,
  MARKETING_EFFORT_SIZES,
  MARKETING_IDEA_STATUSES,
  MARKETING_OBSERVATION_SOURCES,
  MARKETING_REVIEW_STATES,
  MARKETING_TARGET_METRIC_KEYS,
  MARKETING_TARGET_SCOPES,
} from '../../src/schema/index';
import { LATER, NOW, insert, runCases, setup, variants, vocab, type Row } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const id = (name: string) => () => ids[name];
const by = () => ctx.ids.user;

const idea = (o: Row = {}): Row => ({
  code: 'CLAT-101',
  course_prefix: 'CLAT',
  title: 'Sample current-affairs recap',
  normalized_title: 'sample current affairs recap',
  scope: 'single_exam',
  ...o,
});
const calendar = (o: Row = {}): Row => ({
  title: 'Sample webinar',
  item_type: 'webinar',
  planned_at: NOW,
  original_planned_at: NOW,
  created_by: by(),
  ...o,
});
const approved = { approved_at: NOW, approved_by: by };
const published = { ...approved, published_at: LATER, published_by: by };
const item = (o: Row = {}): Row => ({
  page_url: 'https://example.test/clat',
  topic: 'CLAT syllabus page',
  category_key: 'seo',
  created_by: by(),
  ...o,
});
const target = (o: Row = {}): Row => ({
  scope: 'team',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  metric_key: 'qualified_leads',
  target_value: 10,
  created_by: by(),
  ...o,
});
const forScope = (scope: string): Row =>
  scope === 'employee'
    ? { staff_id: ctx.ids.staff }
    : scope === 'campaign'
      ? { campaign_id: ids.campaign }
      : {};

beforeAll(async () => {
  ctx = await setup();
  const { pg } = ctx;
  ids.campaign = await insert(pg, 'marketing.campaigns', { code: 'SAMPLE-1', name: 'Sample' });
  ids.idea = await insert(
    pg,
    'marketing.ideas',
    idea({ code: 'CLAT-100', title: 'x', normalized_title: 'x' }),
  );
  ids.item = await insert(pg, 'marketing.content_items', {
    idea_id: ids.idea,
    title: 'Sample post',
    format: 'post',
  });
  ids.account = await insert(pg, 'marketing.social_accounts', {
    code: 'IGC',
    platform: 'instagram',
    scope: 'exam',
    status: 'live',
  });
  ids.placement = await insert(pg, 'marketing.placements', {
    code: 'CLAT-100-IGC',
    idea_id: ids.idea,
    content_item_id: ids.item,
    account_id: ids.account,
  });
  await insert(pg, 'marketing.calendar_items', calendar({ placement_id: ids.placement }));
  await insert(pg, 'marketing.optimisation_categories', {
    key: 'seo',
    label: 'SEO',
    meaning: 'Search engine optimisation',
  });
  ids.optItem = await insert(pg, 'marketing.optimisation_items', item());
  await insert(pg, 'marketing.targets', target());
});
afterAll(() => ctx.t.close());

describe('campaigns and ideas (§12, §13)', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'campaign channels',
        'marketing.campaigns',
        (o) => ({ code: 'SAMPLE-2', name: 'Sample', ...o }),
        {
          'known channels': [{ channels: '{instagram,website}' }, 'ok'],
          'unknown channel': [{ channels: '{tiktok}' }, 'campaigns_channels_check'],
        },
      ),
      vocab(
        'idea statuses incl. review (MARKETING_IDEA_STATUSES)',
        'marketing.ideas',
        MARKETING_IDEA_STATUSES,
        'ideas_status_check',
        (v) => idea({ status: v }),
      ),
      ...(
        [
          ['effort', MARKETING_EFFORT_SIZES],
          ['proposed_format', MARKETING_CALENDAR_ITEM_TYPES],
          ['proposed_channel', MARKETING_CHANNELS],
        ] as const
      ).map(([column, values]) =>
        vocab(`ideas.${column} vocabulary`, 'marketing.ideas', values, 'ideas_board_check', (v) =>
          idea({ [column]: v }),
        ),
      ),
    ],
  );
});

describe('calendar items (§12)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'types (MARKETING_CALENDAR_ITEM_TYPES)',
        'marketing.calendar_items',
        MARKETING_CALENDAR_ITEM_TYPES,
        'calendar_items_type_check',
        (v) => calendar({ item_type: v }),
      ),
      vocab(
        'channels (MARKETING_CHANNELS)',
        'marketing.calendar_items',
        MARKETING_CHANNELS,
        'calendar_items_channel_check',
        (v) => calendar({ channel: v }),
      ),
      vocab(
        'statuses (MARKETING_CALENDAR_STATUSES)',
        'marketing.calendar_items',
        MARKETING_CALENDAR_STATUSES,
        'calendar_items_status_check',
        (v) =>
          calendar({
            status: v,
            approved_at: NOW,
            approved_by: by(),
            review_note: 'Shorten the intro',
            cancelled_reason: 'Event moved',
            ...(v === 'published'
              ? { published_at: LATER, published_by: by(), published_url: 'https://example.test/w' }
              : {}),
          }),
      ),
      variants('calendar rules', 'marketing.calendar_items', calendar, {
        'idea without a date': [
          { status: 'idea', planned_at: null, original_planned_at: null },
          'ok',
        ],
        'planned without a date': [{ planned_at: null }, 'calendar_items_planned_check'],
        'date without the original': [
          { original_planned_at: null },
          'calendar_items_planned_check',
        ],
        'approved without approval': [{ status: 'approved' }, 'calendar_items_approved_check'],
        'approval without approver': [{ approved_at: NOW }, 'calendar_items_approved_check'],
        'published with evidence only': [
          { status: 'published', ...published, publication_evidence: 'Screenshot in Drive' },
          'ok',
        ],
        'published without URL or evidence': [
          { status: 'published', ...published },
          'calendar_items_published_check',
        ],
        'published time on an unpublished item': [
          { status: 'approved', ...published, published_url: 'https://example.test/p' },
          'calendar_items_published_check',
        ],
        'not an http link': [
          { status: 'published', ...published, published_url: 'example.test/p' },
          'calendar_items_url_check',
        ],
        'cancelled without reason': [{ status: 'cancelled' }, 'calendar_items_reason_check'],
        'changes requested without note': [
          { status: 'changes_requested' },
          'calendar_items_reason_check',
        ],
        '21 asset links': [
          { asset_links: `{${Array(21).fill('https://example.test/a').join(',')}}` },
          'calendar_items_assets_check',
        ],
        'placement already on the calendar': [
          { placement_id: id('placement') },
          'calendar_items_placement_key',
        ],
        'linked to idea and content': [{ idea_id: id('idea'), content_item_id: id('item') }, 'ok'],
      }),
    ],
  );
});

describe('SEO / AIO / GEO work (§14)', () => {
  runCases(
    () => ctx.pg,
    [
      variants(
        'category rules',
        'marketing.optimisation_categories',
        (o) => ({ key: 'aio', label: 'AIO', meaning: 'AI search optimisation', ...o }),
        {
          'new category': [{}, 'ok'],
          'key not lower snake case': [{ key: 'GEO' }, 'optimisation_categories_key_format'],
          'blank meaning': [{ meaning: ' ' }, 'optimisation_categories_text_check'],
          'key reused': [{ key: 'seo' }, 'optimisation_categories_key_key'],
        },
      ),
      vocab(
        'review states (MARKETING_REVIEW_STATES)',
        'marketing.optimisation_items',
        MARKETING_REVIEW_STATES,
        'optimisation_items_review_state_check',
        (v) => item({ review_state: v, evidence: 'Title updated', review_note: 'Add FAQ' }),
      ),
      variants('work item rules', 'marketing.optimisation_items', item, {
        'approved without evidence': [
          { review_state: 'approved' },
          'optimisation_items_review_check',
        ],
        'changes requested without note': [
          { review_state: 'changes_requested' },
          'optimisation_items_review_check',
        ],
        'page is not a link': [{ page_url: 'clat page' }, 'optimisation_items_url_check'],
        'checklist not a list': [{ checklist: '{}' }, 'optimisation_items_checklist_check'],
        'checklist list': [
          { checklist: '[{"key":"title","label":"Page title","done":false}]' },
          'ok',
        ],
        'unknown category': [
          { category_key: 'xyz' },
          'optimisation_items_category_key_optimisation_categories_key_fk',
        ],
      }),
      vocab(
        'observation sources (MARKETING_OBSERVATION_SOURCES)',
        'marketing.optimisation_observations',
        MARKETING_OBSERVATION_SOURCES,
        'optimisation_observations_source_check',
        (v) => ({
          item_id: ids.optItem,
          platform: 'ChatGPT',
          query: 'best CLAT coaching in Sikar',
          observed_on: '2026-10-22',
          result: 'Not mentioned',
          source: v,
          recorded_by: by(),
        }),
      ),
    ],
  );
});

describe('targets (§15)', () => {
  runCases(
    () => ctx.pg,
    [
      vocab(
        'scopes (MARKETING_TARGET_SCOPES)',
        'marketing.targets',
        MARKETING_TARGET_SCOPES,
        'targets_scope_check',
        (v) => target({ scope: v, metric_key: 'demo_bookings', ...forScope(v) }),
      ),
      vocab(
        'metrics (MARKETING_TARGET_METRIC_KEYS)',
        'marketing.targets',
        MARKETING_TARGET_METRIC_KEYS,
        'targets_metric_check',
        (v) => target({ metric_key: v, period_end: '2026-11-29' }),
      ),
      variants('target rules', 'marketing.targets', target, {
        'same team target twice': [{}, 'targets_identity_key'],
        'employee target without employee': [{ scope: 'employee' }, 'targets_scope_ids_check'],
        'team target naming an employee': [
          { staff_id: () => ctx.ids.staff },
          'targets_scope_ids_check',
        ],
        'campaign target naming an employee': [
          { scope: 'campaign', campaign_id: id('campaign'), staff_id: () => ctx.ids.staff },
          'targets_scope_ids_check',
        ],
        'zero target': [{ metric_key: 'demo_bookings', target_value: 0 }, 'targets_value_check'],
        'period ends before it starts': [
          { metric_key: 'demo_bookings', period_end: '2026-10-31' },
          'targets_period_check',
        ],
      }),
    ],
  );
});
