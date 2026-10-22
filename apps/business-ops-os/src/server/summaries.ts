/**
 * Cross-module summaries for the Ops dashboard (D-011.2, PLT-009). Fetched with
 * `fetchInternal`, which never throws: any failure (endpoint not built yet,
 * network, wrong shape) becomes `unavailable` and the UI says "source
 * unavailable" — never zeros.
 */
import { appOrigin } from '@elevate/configuration/workspaces';
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

const base = (explicit: string | undefined, app: 'academic' | 'marketing') =>
  explicit?.replace(/\/+$/, '') ?? appOrigin(app);

const fetchSummary =
  <S extends Parameters<typeof fetchInternal>[1]>(app: 'academic' | 'marketing', schema: S) =>
  (window: { from: string; to: string }, options: SummaryFetchOptions = {}) =>
    fetchInternal(
      `${base(app === 'academic' ? options.academicBaseUrl : options.marketingBaseUrl, app)}/${app}/api/internal/v1/summary?${new URLSearchParams(window)}`,
      schema,
      {
        caller: 'ops',
        fetchImpl: options.fetchImpl,
        token: options.token,
        timeoutMs: options.timeoutMs ?? 4000,
      },
    );

export const fetchAcademicSummary = fetchSummary('academic', academicDeliverySummaryV1Schema);
export const fetchMarketingSummary = fetchSummary('marketing', marketingSummaryV1Schema);

export async function fetchCrossModuleSummaries(
  window: { from: string; to: string },
  options: SummaryFetchOptions = {},
): Promise<CrossModuleSummaries> {
  const [academic, marketing] = await Promise.all([
    fetchAcademicSummary(window, options),
    fetchMarketingSummary(window, options),
  ]);
  return { academic, marketing };
}
