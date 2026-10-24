import { StatusBadge, type Tone } from '@elevate/shared-ui';
import { REVIEW_STATE_LABELS, type ReviewState } from '../../domain/optimisation';

const TONES: Record<ReviewState, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  changes_requested: 'warning',
};

export const ReviewStateBadge = ({ state }: { state: ReviewState }) => (
  <StatusBadge tone={TONES[state]}>{REVIEW_STATE_LABELS[state]}</StatusBadge>
);
