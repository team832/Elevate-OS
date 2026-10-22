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
