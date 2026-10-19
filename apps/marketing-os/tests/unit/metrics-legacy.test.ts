import { describe, expect, it } from 'vitest';
import * as schema from '@elevate/database';
import {
  ACCOUNT_SCOPES,
  CONTENT_FORMATS,
  CONTENT_STATES,
  COURSE_PREFIXES,
  IDEA_STATUSES,
  INTEGRATION_STATUSES,
  METRIC_KEYS,
  METRIC_STATES,
  PLACEMENT_STATUSES,
  PLATFORMS,
  PUBLICATION_MODES,
  aggregateMetric,
  aggregateWeekly,
  coverageLabel,
  detectCsvFormat,
  legacyIstDateTime,
  mapLegacyFormat,
  mapLegacyIdeaScope,
  mapLegacyIdeaStatus,
  mapLegacyPlacementStatus,
  parseCadenceText,
  parseCsv,
  parseDeclaredDate,
  parseMetricNumber,
  parseMetricsCsv,
  type PostSnapshot,
} from '../../src/domain';

describe('CSV parsing (port of import-metrics.mjs)', () => {
  it('handles quotes, embedded commas/newlines, BOM and blank rows', () => {
    expect(parseCsv('﻿a,b\n"x, y","line1\nline2"\n\n"say ""hi""",2\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['say "hi"', '2'],
    ]);
  });
  it('detects formats like the legacy script (YouTube first)', () => {
    expect(detectCsvFormat(['Content', 'Video title', 'Views'])).toBe('youtube_studio_table_data');
    expect(detectCsvFormat(['Permalink', 'Reach'])).toBe('instagram_meta_business_suite');
    expect(detectCsvFormat(['foo'])).toBeNull();
  });
  it('parses dates only in the declared format (no US-style guessing)', () => {
    expect(parseDeclaredDate('10/12/2026 18:00', 'DD/MM/YYYY')).toEqual({
      ok: true,
      date: '2026-12-10',
    });
    expect(parseDeclaredDate('10/12/2026 18:00', 'MM/DD/YYYY')).toEqual({
      ok: true,
      date: '2026-10-12',
    });
    expect(parseDeclaredDate('Oct 13, 2026', 'MMM D, YYYY')).toEqual({
      ok: true,
      date: '2026-10-13',
    });
    expect(parseDeclaredDate('2026-10-13T05:00:00Z', 'YYYY-MM-DD')).toEqual({
      ok: true,
      date: '2026-10-13',
    });
    expect(parseDeclaredDate('31/02/2026', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDeclaredDate('2026-10-13', 'DD/MM/YYYY').ok).toBe(false);
    expect(parseDeclaredDate('', 'DD/MM/YYYY').ok).toBe(false);
  });
  it('keeps blank as missing and 0 as a reported zero; rejects negatives and text', () => {
    expect(parseMetricNumber('')).toEqual({ state: 'missing' });
    expect(parseMetricNumber('--')).toEqual({ state: 'missing' });
    expect(parseMetricNumber(undefined)).toEqual({ state: 'missing' });
    expect(parseMetricNumber('0')).toEqual({ state: 'reported', value: 0 });
    expect(parseMetricNumber('1,234')).toEqual({ state: 'reported', value: 1234 });
    expect(parseMetricNumber('4.5%')).toEqual({ state: 'reported', value: 4.5 });
    expect(parseMetricNumber('-3').state).toBe('invalid');
    expect(parseMetricNumber('abc').state).toBe('invalid');
  });
  it('never stores Instagram impressions as views (audit defect 1)', () => {
    const r = parseMetricsCsv(
      'Permalink,Publish time,Impressions,Reach\nhttps://i.test/p/1,2026-10-12,500,300',
      { dateFormat: 'YYYY-MM-DD' },
    );
    expect(r.rows[0]!.metrics.views).toMatchObject({ state: 'missing', value: null });
    expect(r.rows[0]!.metrics.impressions).toMatchObject({ state: 'reported', value: 500 });
  });
  it('YouTube: skips totals, builds links, marks duration-based format as estimated', () => {
    const csv = [
      'Content,Video title,Video publish time,Duration,Views,Watch time (hours),Impressions,Impressions click-through rate (%)',
      'Total,,,,900,10,5000,4',
      'abc123,Fictional short,Oct 12 2026,45,300,1.5,2000,3.2',
      'def456,Fictional long,Oct 13 2026,600,0,0,,',
    ].join('\n');
    const r = parseMetricsCsv(csv, { dateFormat: 'MMM D, YYYY' });
    expect(r.format).toBe('youtube_studio_table_data');
    expect(r.skipped).toEqual([{ rowNumber: 2, reason: 'Totals row' }]);
    expect(r.rows.map((x) => [x.link, x.platformFormat, x.formatEstimated])).toEqual([
      ['https://youtu.be/abc123', 'short', true],
      ['https://youtu.be/def456', 'video', true],
    ]);
    expect(r.rows[1]!.metrics.views).toMatchObject({ state: 'reported', value: 0 });
    expect(r.rows[1]!.metrics.impressions.state).toBe('missing');
    expect(r.rows[0]!.metrics.reach.state).toBe('not_applicable');
  });
  it('rejects unidentifiable, undated, invalid and duplicate rows with reasons', () => {
    const csv = [
      'Permalink,Description,Publish time,Views',
      ',,2026-10-12,1',
      'https://i.test/a,,nope,1',
      'https://i.test/b,,2026-10-12,x',
      'https://i.test/c,,2026-10-12,1',
      'https://i.test/c,,2026-10-12,2',
    ].join('\n');
    const r = parseMetricsCsv(csv, { dateFormat: 'YYYY-MM-DD' });
    expect(r.rows).toHaveLength(1);
    expect(r.rejected.map((x) => x.rowNumber)).toEqual([2, 3, 4, 6]);
    expect(r.rejected[3]!.reasons[0]).toMatch(/Duplicate of row 5/);
  });
  it('reports file-level errors', () => {
    expect(parseMetricsCsv('', { dateFormat: 'YYYY-MM-DD' }).errors).toEqual([
      'The file is empty.',
    ]);
    expect(parseMetricsCsv('a,b\n1,2', { dateFormat: 'YYYY-MM-DD' }).errors[0]).toMatch(
      /Not an Instagram/,
    );
    expect(
      parseMetricsCsv('Permalink\nx', {
        dateFormat: 'YYYY-MM-DD',
        expectedFormat: 'youtube_studio_table_data',
      }).errors[0],
    ).toMatch(/Expected/);
  });
});

const snap = (
  id: string,
  post: string,
  published: string | null,
  captured: string,
  metrics: PostSnapshot['metrics'],
  account = 'IGC',
  campaign: string | null = null,
): PostSnapshot => ({
  id,
  accountCode: account,
  campaignCode: campaign,
  postKey: post,
  postTitle: post,
  publishedOn: published as never,
  capturedAt: new Date(captured),
  source: 'csv_import',
  metrics,
});

describe('weekly aggregation', () => {
  const posts = [
    snap('1', 'a', '2026-10-12', '2026-10-14T00:00:00Z', {
      views: { value: 100, state: 'reported' },
      reach: { value: 80, state: 'reported' },
      saves: { value: 2, state: 'reported' },
      shares: { value: 2, state: 'reported' },
    }),
    snap('2', 'a', '2026-10-12', '2026-10-16T00:00:00Z', {
      views: { value: 150, state: 'reported' },
      reach: { value: 90, state: 'reported' },
    }),
    snap(
      '3',
      'b',
      '2026-10-18',
      '2026-10-19T00:00:00Z',
      { views: { value: null, state: 'missing' }, reach: { value: 0, state: 'reported' } },
      'IGC',
      'CAMP-1',
    ),
    snap('4', 'c', '2026-10-19', '2026-10-19T00:00:00Z', {
      views: { value: 999, state: 'reported' },
    }),
  ];
  it('uses the latest snapshot per post and never sums missing as zero', () => {
    const w = aggregateWeekly(posts, { weekOf: '2026-10-15' as never, groupBy: 'account' });
    expect(w.weekStart).toBe('2026-10-12');
    const g = w.groups[0]!;
    expect(g.posts).toBe(2); // c is next week
    expect(g.metrics.views).toEqual({ status: 'partial', value: 150, withData: 1, applicable: 2 });
    expect(g.metrics.reach).toEqual({ status: 'ok', value: 90, withData: 2, applicable: 2 });
    expect(g.metrics.likes).toEqual({ status: 'missing', value: null, withData: 0, applicable: 2 });
    expect(g.patternReliable).toBe(false);
    expect(coverageLabel(g.metrics.views)).toBe('reported for 1 of 2 posts');
  });
  it('respects asOf and groups by campaign', () => {
    const asOf = aggregateWeekly(posts, {
      weekOf: '2026-10-12' as never,
      groupBy: 'account',
      asOf: new Date('2026-10-15T00:00:00Z'),
    });
    expect(asOf.groups[0]!.metrics.views.value).toBe(100);
    const byCampaign = aggregateWeekly(posts, {
      weekOf: '2026-10-12' as never,
      groupBy: 'campaign',
    });
    expect(byCampaign.groups.map((g) => g.key)).toEqual(['(no campaign)', 'CAMP-1']);
  });
  it('marks estimated values and not-applicable metrics', () => {
    expect(
      aggregateMetric(
        [snap('1', 'a', null, '2026-10-14T00:00:00Z', { views: { value: 5, state: 'estimated' } })],
        'views',
      ).status,
    ).toBe('estimated');
    expect(
      aggregateMetric(
        [
          snap('1', 'a', null, '2026-10-14T00:00:00Z', {
            watch_hours: { value: null, state: 'not_applicable' },
          }),
        ],
        'watch_hours',
      ).status,
    ).toBe('not_applicable');
    expect(aggregateMetric([], 'views')).toEqual({
      status: 'not_applicable',
      value: null,
      withData: 0,
      applicable: 0,
    });
  });
});

describe('legacy mappings', () => {
  it('maps idea and placement statuses per MKT-004 / PRD §2.5', () => {
    expect(
      [
        'idea',
        'scripted',
        'edited',
        'ready',
        'published',
        'held',
        'parked',
        'on hold',
        'rejected',
        'weird',
      ].map(mapLegacyIdeaStatus),
    ).toEqual([
      'idea',
      'in_development',
      'in_development',
      'ready',
      'ready',
      'held',
      'held',
      'held',
      'rejected',
      'idea',
    ]);
    expect(mapLegacyPlacementStatus('ready_to_post_pending_approval').contentState).toBe(
      'in_review',
    );
    expect(mapLegacyPlacementStatus('parked')).toEqual({
      contentState: 'draft',
      placementStatus: 'planned',
      hold: true,
    });
    expect(mapLegacyPlacementStatus('needs recording').contentState).toBe('draft');
  });
  it('maps formats, scopes, cadence and dates', () => {
    expect(['reel + YT Short', 'carousel', 'text + image', 'repost'].map(mapLegacyFormat)).toEqual([
      'video_brief',
      'carousel',
      'post',
      'post',
    ]);
    expect(mapLegacyIdeaScope('GEN', 'Founder story').scope).toBe('founder');
    expect(mapLegacyIdeaScope('CLAT', 'Paths')).toEqual({
      scope: 'single_exam',
      scopePrefixes: ['CLAT'],
    });
    expect(parseCadenceText('4 posts/week, max 1 a day')).toEqual({ maxPerDay: 1, maxPerWeek: 4 });
    expect(parseCadenceText('1 long video + 3-4 Shorts a week')).toEqual({
      maxPerDay: null,
      maxPerWeek: 5,
    });
    expect(parseCadenceText('Same-day repost within 1-2 h of founder posts')).toEqual({
      maxPerDay: null,
      maxPerWeek: null,
    });
    expect(parseCadenceText(null)).toEqual({ maxPerDay: null, maxPerWeek: null });
    expect(legacyIstDateTime('2026-10-07', '12:00')!.toISOString()).toBe(
      '2026-10-07T06:30:00.000Z',
    );
    expect(legacyIstDateTime('2026-10-28', null)).toBeNull();
  });
});

describe('vocabulary mirrors the schema file', () => {
  it('keeps domain lists and database check lists identical', () => {
    expect(schema.MARKETING_PLATFORMS).toEqual(PLATFORMS);
    expect(schema.MARKETING_ACCOUNT_SCOPES).toEqual(ACCOUNT_SCOPES);
    expect(schema.MARKETING_INTEGRATION_STATUSES).toEqual(INTEGRATION_STATUSES);
    expect(schema.MARKETING_COURSE_PREFIXES).toEqual(COURSE_PREFIXES);
    expect(schema.MARKETING_IDEA_STATUSES).toEqual(IDEA_STATUSES);
    expect(schema.MARKETING_CONTENT_FORMATS).toEqual(CONTENT_FORMATS);
    expect(schema.MARKETING_CONTENT_STATES).toEqual(CONTENT_STATES);
    expect(schema.MARKETING_PLACEMENT_STATUSES).toEqual(PLACEMENT_STATUSES);
    expect(schema.MARKETING_PUBLICATION_MODES).toEqual(PUBLICATION_MODES);
    expect(schema.MARKETING_METRIC_KEYS).toEqual(METRIC_KEYS);
    expect(schema.MARKETING_METRIC_STATES).toEqual(METRIC_STATES);
  });
});
