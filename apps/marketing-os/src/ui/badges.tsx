import { StatusBadge, type Tone } from '@elevate/shared-ui';
import type {
  ContentState,
  IntegrationStatus,
  PlacementStatus,
  PublicationMode,
  RuleCheckResult,
} from '../domain';

const CONTENT_TONES: Record<ContentState, Tone> = {
  draft: 'neutral',
  in_review: 'info',
  changes_requested: 'warning',
  approved: 'success',
  scheduled: 'info',
  published: 'success',
  archived: 'neutral',
};

export function ContentStateBadge({ state }: { state: ContentState }) {
  return <StatusBadge tone={CONTENT_TONES[state]}>{state.replace('_', ' ')}</StatusBadge>;
}

const INTEGRATION_TONES: Record<IntegrationStatus, Tone> = {
  not_configured: 'neutral',
  sandbox: 'warning',
  connected: 'success',
  error: 'danger',
};

const INTEGRATION_LABELS: Record<IntegrationStatus, string> = {
  not_configured: 'not configured',
  sandbox: 'sandbox (mock only)',
  connected: 'connected',
  error: 'error',
};

export function IntegrationBadge({ status }: { status: IntegrationStatus }) {
  return <StatusBadge tone={INTEGRATION_TONES[status]}>{INTEGRATION_LABELS[status]}</StatusBadge>;
}

export function PlacementBadge({
  status,
  mode,
}: {
  status: PlacementStatus;
  mode?: PublicationMode | null;
}) {
  if (status === 'published') {
    if (mode === 'sandbox')
      return <StatusBadge tone="warning">sandbox — nothing posted</StatusBadge>;
    if (mode === 'legacy_reported')
      return <StatusBadge tone="info">published (legacy tracker, unverified)</StatusBadge>;
    return <StatusBadge tone="success">published</StatusBadge>;
  }
  const tone: Tone =
    status === 'scheduled' ? 'info' : status === 'cancelled' ? 'neutral' : 'neutral';
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

export function ProposedBadge({ status }: { status: string }) {
  return <StatusBadge tone={status === 'approved' ? 'success' : 'warning'}>{status}</StatusBadge>;
}

export function RuleCheckSummary({ check }: { check: RuleCheckResult }) {
  return (
    <p>
      <StatusBadge tone={check.blocking.length ? 'danger' : 'success'}>
        {check.blocking.length} blocking
      </StatusBadge>{' '}
      <StatusBadge tone={check.review.length ? 'warning' : 'neutral'}>
        {check.review.length} flagged for review
      </StatusBadge>{' '}
      <StatusBadge tone="info">{check.checklist.length} checklist items</StatusBadge>{' '}
      <span className="el-field-hint">
        Accounts checked: {check.accountsChecked.join(', ') || 'none'}
        {check.assumedAllAccounts ? ' (no placements yet — every account’s rules applied)' : ''}
      </span>
    </p>
  );
}
