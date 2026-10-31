import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContentStateBadge,
  IntegrationBadge,
  PlacementBadge,
  ProposedBadge,
  RuleCheckSummary,
  ruleText,
} from '../../src/ui/badges';
import { VersionsPanel } from '../../src/ui/content-panels';
import { Choice } from '../../src/app/calendar/item-ui';
import { sessionGate } from '../../src/ui/session-guard';
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
    ['in_review', 'info', 'In review'],
    ['changes_requested', 'warning', 'Changes requested'],
    ['published', 'success', 'Published'],
  ] as const)('content state %s reads as words', (state, tone, text) => {
    expect(html(<ContentStateBadge state={state} />)).toBe(badge(tone, text));
  });

  it.each([
    ['not_configured', 'neutral', 'Not configured'],
    ['sandbox', 'warning', 'Test mode only'],
    ['connected', 'success', 'Connected'],
    ['error', 'danger', 'Error'],
  ] as const)('integration %s never claims more than it is', (status, tone, text) => {
    expect(html(<IntegrationBadge status={status} />)).toBe(badge(tone, text));
  });

  it.each([
    ['published', 'sandbox', 'warning', 'Test run: nothing posted'],
    ['published', 'legacy_reported', 'info', 'Published (old tracker, unverified)'],
    ['published', 'manual', 'success', 'Published'],
    ['planned', null, 'neutral', 'Planned'],
    ['scheduled', null, 'info', 'Scheduled'],
    ['scheduled', 'sandbox', 'warning', 'Scheduled, test run: nothing posted'],
  ] as const)(
    'placement %s via %s: planned or mock is never shown as posted',
    (status, mode, tone, text) => {
      expect(html(<PlacementBadge status={status} mode={mode} />)).toBe(badge(tone, text));
    },
  );

  it('a proposed setting is flagged until the owner approves it', () => {
    expect(html(<ProposedBadge status="proposed" />)).toBe(badge('info', 'In use, not yet approved'));
    expect(html(<ProposedBadge status="approved" />)).toBe(badge('success', 'Approved'));
  });

  it.each([
    ['Facts only from BRAND.md or the founder.', 'Facts only from the brand guide or the founder.'],
    ['No sole self-approval (offline marketing SOP MKT-03).', 'No sole self-approval (offline marketing SOP).'],
  ])('a brand rule names no file or SOP number: %s (RVC-015)', (stored, shown) => {
    expect(ruleText(stored)).toBe(shown);
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
    expect(out).toContain('1 Oct 2026 to 31 Oct 2026 (IST) · everyone in your scope');
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

describe('a required choice is never made for the person (HUS-003)', () => {
  const root = new URL('../../src/', import.meta.url);
  const source = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(new URL(f.replaceAll('\\', '/'), root), 'utf8'))
    .join('\n');
  const selects = [...source.matchAll(/<Select\b([^>]*)>([\s\S]*?)<\/Select>/g)];

  it('every required select opens on an empty choice or a stated value', () => {
    const wrong = selects
      .filter(([, attrs]) => /\brequired\b/.test(attrs!) && !/defaultValue=/.test(attrs!))
      .filter(([, , options]) => !options!.includes('<option value="">'))
      .map(([tag]) => tag!.slice(0, 60));
    expect(wrong).toEqual([]);
  });

  it.each([
    'as-role',
    'pl-account',
    'metricKey',
    'coursePrefix',
    'ci-format',
    'st',
    'categoryKey',
    'decision',
    'accountCode',
  ])('%s must be chosen', (id) => {
    const [tag] = selects.filter(([, attrs]) => attrs!.includes(`id="${id}"`));
    expect(tag?.[1]).toMatch(/\brequired\b/);
    expect(tag?.[2]).toContain('Choose…');
  });

  it('a calendar choice with no value and no empty option opens on Choose…', () => {
    const out = (value?: string) =>
      html(<Choice id="t" label="Type" value={value} options={[['a', 'Alpha']]} />);
    expect(out()).toContain('<option value="" selected="">Choose…</option>');
    expect(out('a')).not.toContain('Choose…');
  });
});

describe('an ended session never throws away what was typed (HUS-022)', () => {
  const setup = (signedIn: boolean | 'offline') => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), submitter: null };
    const form = { requestSubmit: vi.fn() };
    const onEnded = vi.fn();
    const check = vi.fn(async () => signedIn);
    return { event, form, onEnded, check, gate: sessionGate(check, onEnded) };
  };

  it('signed in: the held submit is sent once, and that second pass is left alone', async () => {
    const { event, form, onEnded, gate } = setup(true);
    gate(event, form);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledOnce());
    gate(event, form);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('network down: nothing is sent, the typing stays, and the person is told why (RVC-004)', async () => {
    const { event, form, onEnded, gate } = setup('offline');
    gate(event, form);
    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledWith('offline'));
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it('signed out: nothing is sent and the person is told', async () => {
    const { event, form, onEnded, gate } = setup(false);
    gate(event, form);
    await vi.waitFor(() => expect(onEnded).toHaveBeenCalledOnce());
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it('a double click checks once and sends once', async () => {
    const { event, form, check, gate } = setup(true);
    gate(event, form);
    gate(event, form);
    await vi.waitFor(() => expect(form.requestSubmit).toHaveBeenCalledOnce());
    expect(check).toHaveBeenCalledOnce();
  });
});
