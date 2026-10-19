/**
 * Publishing rules (MKT-024, MKT-025, MKT-026; docs/ALGORITHMS.md §6).
 * - Only an approved item's scheduled placement can publish, and only the approved version.
 * - One publishing record per (placement, version): its idempotency key. A second request
 *   returns the existing outcome instead of calling the adapter again.
 * - A failed record is retried on the same key until `maxAttempts`, then refused.
 */
import type { ContentState, PlacementStatus, PublishingStatus } from './vocabulary';

export function publishingIdempotencyKey(placementId: string, versionId: string): string {
  return `placement:${placementId}:version:${versionId}`;
}

export interface PublishGate {
  placementStatus: PlacementStatus;
  contentState: ContentState | null;
  /** A core approval with status approved exists for the item. */
  approvalApproved: boolean;
  approvedVersionId: string | null;
  currentVersionId: string | null;
}

export type PublishBlock =
  'ALREADY_PUBLISHED' | 'CANCELLED' | 'NOT_SCHEDULED' | 'NOT_APPROVED' | 'VERSION_NOT_APPROVED';

export type PublishEligibility = { ok: true } | { ok: false; code: PublishBlock; message: string };

export function checkPublishEligibility(gate: PublishGate): PublishEligibility {
  if (gate.placementStatus === 'published') {
    return {
      ok: false,
      code: 'ALREADY_PUBLISHED',
      message: 'This placement is already published.',
    };
  }
  if (gate.placementStatus === 'cancelled') {
    return { ok: false, code: 'CANCELLED', message: 'This placement was cancelled.' };
  }
  if (gate.placementStatus !== 'scheduled') {
    return { ok: false, code: 'NOT_SCHEDULED', message: 'Only scheduled placements can publish.' };
  }
  if (
    !gate.approvalApproved ||
    !gate.approvedVersionId ||
    (gate.contentState !== 'scheduled' && gate.contentState !== 'published')
  ) {
    return {
      ok: false,
      code: 'NOT_APPROVED',
      message: 'Nothing is published without an explicit approval (AP-001).',
    };
  }
  if (gate.approvedVersionId !== gate.currentVersionId) {
    return {
      ok: false,
      code: 'VERSION_NOT_APPROVED',
      message: 'The current version is not the approved version; it needs re-approval.',
    };
  }
  return { ok: true };
}

export interface ExistingPublishingRecord {
  status: PublishingStatus;
  attempts: number;
  maxAttempts: number;
}

export type PublishAttemptDecision =
  | { action: 'create' }
  | { action: 'retry'; attemptNumber: number }
  | { action: 'already_published' }
  | { action: 'in_progress' }
  | { action: 'exhausted'; attempts: number };

export function decidePublishAttempt(
  existing: ExistingPublishingRecord | null,
): PublishAttemptDecision {
  if (!existing) return { action: 'create' };
  if (existing.status === 'succeeded') return { action: 'already_published' };
  if (existing.status === 'pending') return { action: 'in_progress' };
  if (existing.attempts >= existing.maxAttempts) {
    return { action: 'exhausted', attempts: existing.attempts };
  }
  return { action: 'retry', attemptNumber: existing.attempts + 1 };
}

/** MKT-025: a manual publication needs the actual time (not in the future) and an http(s) live link. */
export function validateManualPublication(
  input: { publishedAt: Date; url: string },
  now: Date,
): string[] {
  const problems: string[] = [];
  if (Number.isNaN(input.publishedAt.getTime())) problems.push('Publish time is not a valid time.');
  else if (input.publishedAt.getTime() > now.getTime() + 5 * 60_000) {
    problems.push('Publish time cannot be in the future.');
  }
  let parsed: URL | null;
  try {
    parsed = new URL(input.url);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    problems.push('The live link must be an http(s) URL.');
  }
  return problems;
}
