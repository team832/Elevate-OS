/**
 * Publishing adapter interface (MKT-024, D-014). Only a MOCK and a DISABLED adapter exist.
 * The mock returns a clearly labelled sandbox result: it never claims a real post and
 * never returns a URL. Real adapters (Metricool, native platforms) wait for OD-006 and a
 * real verification call before any account may be marked `connected`.
 */
import { createHash } from 'node:crypto';
import { loadEnvKeys } from '@elevate/configuration';
import type { IntegrationStatus, Platform } from '../../domain';

export interface PublishRequest {
  idempotencyKey: string;
  placementCode: string;
  accountCode: string;
  platform: Platform;
  title: string;
  body: string;
  assets: readonly { fileName: string; externalUrl: string | null }[];
  scheduledAt: Date | null;
}

export type PublishResult =
  | {
      ok: true;
      sandbox: boolean;
      externalPostId: string | null;
      /** Always null for the mock. */
      url: string | null;
      message: string;
      raw: Record<string, unknown>;
    }
  | { ok: false; retryable: boolean; error: string; raw: Record<string, unknown> };

export interface ConnectionCheck {
  status: IntegrationStatus;
  note: string;
}

export interface PublishingAdapter {
  readonly name: string;
  verifyConnection(account: { code: string; platform: Platform }): Promise<ConnectionCheck>;
  publish(request: PublishRequest): Promise<PublishResult>;
}

export class MockPublishingAdapter implements PublishingAdapter {
  readonly name = 'mock';

  async verifyConnection(account: { code: string; platform: Platform }): Promise<ConnectionCheck> {
    return {
      status: 'sandbox',
      note: `Sandbox adapter only: no ${account.platform} credentials exist and nothing can be posted for ${account.code} (D-014).`,
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const id = createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 16);
    return {
      ok: true,
      sandbox: true,
      externalPostId: `sandbox-${id}`,
      url: null,
      message: `SANDBOX: nothing was posted to ${request.platform}. ${request.placementCode} was accepted by the mock adapter only; there is no live post and no URL.`,
      raw: { adapter: 'mock', sandbox: true, idempotencyKey: request.idempotencyKey },
    };
  }
}

export class DisabledPublishingAdapter implements PublishingAdapter {
  readonly name = 'disabled';

  async verifyConnection(): Promise<ConnectionCheck> {
    return {
      status: 'not_configured',
      note: 'Publishing adapter is disabled (MARKETING_PUBLISHING_ADAPTER=disabled).',
    };
  }

  async publish(): Promise<PublishResult> {
    return {
      ok: false,
      retryable: false,
      error: 'Publishing adapter is disabled (MARKETING_PUBLISHING_ADAPTER=disabled).',
      raw: { adapter: 'disabled' },
    };
  }
}

let override: PublishingAdapter | undefined;

/** The configured adapter (`mock` by default). Tests may inject one with setPublishingAdapterForTesting. */
export function getPublishingAdapter(): PublishingAdapter {
  if (override) return override;
  const { MARKETING_PUBLISHING_ADAPTER } = loadEnvKeys(
    ['MARKETING_PUBLISHING_ADAPTER'],
    process.env,
    'marketing-publishing',
  );
  return MARKETING_PUBLISHING_ADAPTER === 'disabled'
    ? new DisabledPublishingAdapter()
    : new MockPublishingAdapter();
}

/** Test-only: replace the adapter (pass undefined to restore). */
export function setPublishingAdapterForTesting(adapter: PublishingAdapter | undefined): void {
  override = adapter;
}
