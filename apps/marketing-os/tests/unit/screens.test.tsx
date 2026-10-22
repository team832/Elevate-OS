import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContentStateBadge,
  IntegrationBadge,
  PlacementBadge,
  ProposedBadge,
  RuleCheckSummary,
} from '../../src/ui/badges';
import { VersionsPanel } from '../../src/ui/content-panels';
import { OverviewTiles, PipelineCharts } from '../../src/ui/overview';
import { CONTENT_STATES, type ContentState, type RuleCheckResult } from '../../src/domain';
import type { IsoDate } from '@elevate/shared-types';

vi.mock('../../src/app/actions/content', () => ({}));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const badge = (tone: string, text: string) =>
  `<span class="el-badge el-tone-${tone}">${text}</span>`;

describe('Marketing status badges', () => {
  it.each([
    ['in_review', 'info', 'in review'],
    ['changes_requested', 'warning', 'changes requested'],
    ['published', 'success', 'published'],
  ] as const)('content state %s reads as words', (state, tone, text) => {
    expect(html(<ContentStateBadge state={state} />)).toBe(badge(tone, text));
  });

  it.each([
    ['not_configured', 'neutral', 'not configured'],
    ['sandbox', 'warning', 'sandbox (mock only)'],
    ['connected', 'success', 'connected'],
    ['error', 'danger', 'error'],
  ] as const)('integration %s never claims more than it is', (status, tone, text) => {
    expect(html(<IntegrationBadge status={status} />)).toBe(badge(tone, text));
  });

  it.each([
    ['published', 'sandbox', 'warning', 'sandbox — nothing posted'],
    ['published', 'legacy_reported', 'info', 'published (legacy tracker, unverified)'],
    ['published', 'manual', 'success', 'published'],
    ['planned', null, 'neutral', 'planned'],
    ['scheduled', null, 'info', 'scheduled'],
  ] as const)(
    'placement %s via %s: planned or mock is never shown as posted',
    (status, mode, tone, text) => {
      expect(html(<PlacementBadge status={status} mode={mode} />)).toBe(badge(tone, text));
    },
  );

  it('a proposed setting is flagged until the owner approves it', () => {
    expect(html(<ProposedBadge status="proposed" />)).toBe(badge('warning', 'proposed'));
    expect(html(<ProposedBadge status="approved" />)).toBe(badge('success', 'approved'));
  });
});

describe('RuleCheckSummary', () => {
  const check = (over: Partial<RuleCheckResult>) =>
    ({
      blocking: [],
      review: [],
      checklist: [],
      accountsChecked: [],
      assumedAllAccounts: false,
      ...over,
    }) as RuleCheckResult;

  it('says "none" rather than leaving the checked accounts blank', () => {
    const out = html(<RuleCheckSummary check={check({})} />);
    expect(out).toContain(badge('success', '0 blocking'));
    expect(out).toContain('Accounts checked: none');
    expect(out).not.toContain('every account');
  });

  it('turns red for blockers and explains when every account’s rules were applied', () => {
    const out = html(
      <RuleCheckSummary
        check={check({
          blocking: [{}, {}] as never,
          accountsChecked: ['IG', 'YT'],
          assumedAllAccounts: true,
        })}
      />,
    );
    expect(out).toContain(badge('danger', '2 blocking'));
    expect(out).toContain(
      'Accounts checked: IG, YT (no placements yet — every account’s rules applied)',
    );
  });
});

describe('VersionsPanel', () => {
  type D = Parameters<typeof VersionsPanel>[0]['d'];
  const version = {
    id: 'v1',
    versionNumber: 1,
    title: '<b>Exam tips</b>',
    isApproved: false,
    authorName: null,
    createdAt: new Date('2026-10-20T06:30:00Z'),
    contentHash: 'abcdef0123456789',
    body: '',
    changeNote: null,
    showsStudents: false,
    consentReference: null,
    assets: [],
  };
  const panel = (versions: unknown[]) =>
    html(<VersionsPanel d={{ item: { currentVersionId: 'v1' }, versions } as unknown as D} />);

  it('empty: says there is no copy and what to do next', () => {
    expect(panel([])).toContain('No copy yet');
    expect(panel([])).toContain('Add the first version below.');
  });

  it('marks the current version, escapes user text and names missing values', () => {
    const out = panel([version]);
    expect(out).toContain('&lt;b&gt;Exam tips&lt;/b&gt;');
    expect(out).not.toContain('<b>Exam tips');
    expect(out).toContain(badge('info', 'current'));
    expect(out).not.toContain('approved');
    expect(out).toContain('unknown · ');
    expect(out).toContain('(empty)');
    expect(out).toContain('Consent reference: none');
  });
});

describe('OverviewTiles', () => {
  const base = { due: 2, awaiting: 1, running: 0, ideas: 59, quarantined: 8 };
  const label = (text: string) => `<span class="el-stat-label">${text}</span>`;

  it('shows every figure with its label and links to the list behind it', () => {
    const out = html(<OverviewTiles {...base} />);
    for (const t of ['Content due this week', 'Awaiting approval', 'Campaigns running', 'Ideas'])
      expect(out).toContain(label(t));
    expect(out).toContain('href="/marketing/ideas"');
    expect(out).toContain('<span class="el-stat-value">59</span>');
    expect(out).toContain('8 quarantined');
    expect(out).not.toContain('Follow-ups');
    expect(out).not.toContain('tasks');
  });

  it.each([
    ['failed', 'Follow-up counts could not be loaded.'],
    [null, 'so your follow-ups cannot be shown'],
  ] as const)('follow-ups %s: "Not available" with the reason, never 0', (state, text) => {
    const out = html(<OverviewTiles {...base} followUps={state} />);
    expect(out).toContain('el-stat-missing');
    expect(out).toContain('Not available');
    expect(out).toContain(text);
    expect(out).not.toContain('follow-ups?view=');
  });

  it('tasks: the open count, due and overdue in the note, the EOD state in words', () => {
    const out = html(
      <OverviewTiles
        {...base}
        tasks={{
          day: '2026-10-22' as IsoDate,
          asOf: new Date('2026-10-22T04:00:00Z'),
          open: 3,
          overdue: 1,
          dueToday: 2,
          eod: 'not_started',
        }}
      />,
    );
    expect(out).toContain(`${label('Open tasks')}<span class="el-stat-value">3</span>`);
    expect(out).toContain('2 due today · 1 overdue · as of 22 Oct 2026, 09:30 IST');
    expect(out).toContain(`${label('EOD report')}<span class="el-stat-value">not started</span>`);
  });
});

describe('PipelineCharts', () => {
  const byState = (over: Partial<Record<ContentState, number>>) =>
    Object.fromEntries(CONTENT_STATES.map((s) => [s, over[s] ?? 0])) as Record<
      ContentState,
      number
    >;
  const none = { not_configured: 0, sandbox: 0, connected: 0, error: 0 };

  it('bars from the state counts (legacy in the note) and status bars from the integration counts', () => {
    const out = html(
      <PipelineCharts
        d={{
          totalItems: 5,
          itemsByState: byState({ draft: 3, published: 2 }),
          legacyItemsByState: byState({ published: 2 }),
          accountsByIntegration: { ...none, not_configured: 9, sandbox: 1 },
        }}
      />,
    );
    expect(out).toContain(
      '5 items. Imported from the legacy tracker, keeping its status: published 2.',
    );
    expect(out).toContain('data-tip="draft: 3"');
    expect(out).toContain('<span class="el-hbar-value">3</span>');
    expect(out).toContain('sandbox (mock only)');
    expect(out).toContain('<span class="el-hbar-value">9</span>');
    expect(out).toContain('data-tip="not configured: 9"');
  });

  it('with no accounts every status bar reads its counted 0 and keeps its name', () => {
    const out = html(
      <PipelineCharts
        d={{
          totalItems: 0,
          itemsByState: byState({}),
          legacyItemsByState: byState({}),
          accountsByIntegration: none,
        }}
      />,
    );
    expect(out).toContain('data-tip="not configured: 0"');
    expect(out).toContain('data-tip="sandbox (mock only): 0"');
    expect(out).not.toContain('Not enough data');
  });
});
