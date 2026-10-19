/**
 * Cross-module summaries for the Ops dashboard (D-011.2, PLT-009). Fetched with
 * `fetchInternal`, which never throws: any failure (endpoint not built yet,
 * network, wrong shape) becomes `unavailable` and the UI says "source
 * unavailable" — never zeros.
 */
import { fetchInternal } from '@elevate/server-kit';
import {
  academicDeliverySummaryV1Schema,
  marketingSummaryV1Schema,
  type AcademicDeliverySummaryV1,
  type MarketingSummaryV1,
  type SourceResult,
} from '@elevate/shared-contracts';

export interface CrossModuleSummaries {
  academic: SourceResult<AcademicDeliverySummaryV1>;
  marketing: SourceResult<MarketingSummaryV1>;
}

export interface SummaryFetchOptions {
  /** Origin that serves /academic and /marketing (default: ACADEMIC_OS_URL / MARKETING_OS_URL, else PLATFORM_URL). */
  academicBaseUrl?: string;
  marketingBaseUrl?: string;
  fetchImpl?: typeof fetch;
  token?: string;
  timeoutMs?: number;
}

function base(explicit: string | undefined, envKey: string): string {
  return (
    explicit ??
    process.env[envKey] ??
    process.env.PLATFORM_URL ??
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export async function fetchCrossModuleSummaries(
  window: { from: string; to: string },
  options: SummaryFetchOptions = {},
): Promise<CrossModuleSummaries> {
  const qs = `from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;
  const common = {
    caller: 'ops' as const,
    fetchImpl: options.fetchImpl,
    token: options.token,
    timeoutMs: options.timeoutMs ?? 4000,
  };
  const [academic, marketing] = await Promise.all([
    fetchInternal(
      `${base(options.academicBaseUrl, 'ACADEMIC_OS_URL')}/academic/api/internal/v1/summary?${qs}`,
      academicDeliverySummaryV1Schema,
      common,
    ),
    fetchInternal(
      `${base(options.marketingBaseUrl, 'MARKETING_OS_URL')}/marketing/api/internal/v1/summary?${qs}`,
      marketingSummaryV1Schema,
      common,
    ),
  ]);
  return { academic, marketing };
}
