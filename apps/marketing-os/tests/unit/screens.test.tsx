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
import { DecisionTiles, LeadFunnel, Provenance } from '../../src/ui/overview';
import type { DashboardFilters } from '../../src/server/dashboard-filters';
import { CampaignResultsTable, type CampaignRow } from '../../src/ui/campaigns';
import type { Overview } from '../../src/server/dashboard-overview';
import type { RuleCheckResult } from '../../src/domain';

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

const tasks = (total: number, href = '/marketing/tasks?tab=all&due=overdue') => ({
  rows: [],
  total,
  page: 1,
  pageSize: 1,
  href,
});
const overview = (over: Partial<Overview> = {}) =>
  ({
    filters: { from: '2026-10-01', to: '2026-10-31', fromDefaults: true },
    leads: {
      awaitingContact: 4,
      awaitingHref: '/marketing/leads?flag=awaiting_contact',
      hasSample: false,
      funnel: [],
    },
    followUps: undefined,
    awaitingReview: [{}, {}],
    dashboard: { upcomingScheduled: [{}], overdueScheduled: [] },
    tasks: {
      overdue: tasks(3),
      dueInPeriod: tasks(5),
      blocked: tasks(1, '/marketing/tasks?tab=all&flag=blocked'),
    },
    ...over,
  }) as unknown as Overview;
const tile = (label: string, value: string) =>
  `<span class="el-stat-label">${label}</span><span class="el-stat-value">${value}</span>`;

describe('Overview decision tiles (§10)', () => {
  it('counts link to the list they count', () => {
    const out = html(<DecisionTiles o={overview()} />);
    expect(out).toContain(
      `href="/marketing/leads?flag=awaiting_contact" class="el-stat el-kpi">${tile('Leads awaiting first contact', '4')}`,
    );
    expect(out).toContain(
      `href="#awaiting" class="el-stat el-kpi">${tile('Content awaiting review', '2')}`,
    );
    expect(out).toContain(
      `href="/marketing/tasks?tab=all&amp;due=overdue" class="el-stat el-kpi">${tile('Overdue tasks', '3')}`,
    );
    expect(out).toContain(
      `href="/marketing/tasks?tab=all&amp;flag=blocked" class="el-stat el-kpi">${tile('Blocked tasks', '1')}`,
    );
    expect(out).toContain('2026-10-01 to 2026-10-31 (IST) · everyone in your scope');
  });

  it.each([
    ['failed', 'Follow-up counts could not be loaded.'],
    [null, 'so your follow-ups cannot be shown'],
  ] as const)('follow-ups %s: "Not available" with the reason, never 0', (state, text) => {
    const out = html(<DecisionTiles o={overview({ followUps: state })} />);
    expect(out).toContain(tile('Follow-ups', 'Not available'));
    expect(out).toContain(text);
    expect(out).not.toContain('follow-ups?view=');
  });

  it('a failed task load is said in words; without task access the tiles are not shown', () => {
    const failed = html(
      <DecisionTiles
        o={overview({ tasks: { overdue: 'failed', dueInPeriod: undefined, blocked: undefined } })}
      />,
    );
    expect(failed).toContain('Task counts could not be loaded.');
    expect(failed).not.toContain('Blocked tasks');
  });

  it('a failed lead load is said in words, never 0', () => {
    const out = html(<DecisionTiles o={overview({ leads: 'failed' })} />);
    expect(out).toContain(tile('Leads awaiting first contact', 'Not available'));
    expect(out).toContain('Lead figures could not be loaded.');
  });
});

const f = { from: '2026-10-01', to: '2026-10-31', fromDefaults: false } as DashboardFilters;
const stage = (key: string, label: string, count: number) => ({
  key,
  label,
  active: true,
  count,
  href: `/marketing/leads?from=2026-10-01&to=2026-10-31&leadStage=${key}&reached=1`,
});

describe('LeadFunnel', () => {
  it.each([
    ['no stages configured', { funnel: [] }, 'Lead stages are not set up yet.'],
    ['a failed load', 'failed', 'Lead figures could not be loaded.'],
  ] as const)('%s: says so, no chart', (_, leads, text) => {
    const out = html(<LeadFunnel leads={leads as never} f={f} />);
    expect(out).toContain(text);
    expect(out).not.toContain('el-funnel');
  });

  it('stages in order, each row of the table opens exactly that stage’s leads', () => {
    const out = html(
      <LeadFunnel
        f={f}
        leads={{
          awaitingContact: 0,
          awaitingHref: '',
          hasSample: true,
          funnel: [stage('new', 'New', 4), stage('demo_booked', 'Demo booked', 2)],
        }}
      />,
    );
    expect(out).toContain('class="el-funnel"');
    expect(out).toContain('Show as table');
    expect(out).toContain(
      'href="/marketing/leads?from=2026-10-01&amp;to=2026-10-31&amp;leadStage=demo_booked&amp;reached=1">Demo booked</a>',
    );
    expect(out).toContain('Sample data');
  });
});

describe('Provenance and campaign rows', () => {
  it.each([
    [{}, 'Elevate OS records', false],
    [{ manual: true }, 'Manual import', false],
    [{ sample: true }, 'Elevate OS records', true],
  ] as const)('%o names its source', (props, text, sample) => {
    const out = html(<Provenance {...props} />);
    expect(out).toContain(text);
    expect(out.includes('el-badge-sample')).toBe(sample);
  });

  it('a sample campaign carries the SAMPLE DATA badge and its status in words', () => {
    const row = {
      id: 'c1',
      code: 'IPMAT-OCT',
      name: 'Sample IPMAT push',
      startsOn: null,
      endsOn: null,
      status: 'active',
      isSample: true,
      placements: 0,
      publishedLive: 0,
      results: { posts: 0, latestCaptureAt: null, metrics: {} },
    } as unknown as CampaignRow;
    const out = html(<CampaignResultsTable rows={[row]} empty="None" />);
    expect(out).toContain('el-badge-sample');
    expect(out).toContain('>Active<');
    expect(html(<CampaignResultsTable rows={[]} empty="No campaign is active" />)).toContain(
      'No campaign is active',
    );
  });
});
