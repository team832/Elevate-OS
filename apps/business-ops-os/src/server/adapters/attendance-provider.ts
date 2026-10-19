/**
 * Attendance device / provider adapter (OPS-052, D-014, D-028). Biometric or
 * device integration is out of scope; only the interface and a MOCK exist.
 * The mock never claims a connection and never returns punches, so staff
 * attendance comes only from self clock-in, manual entries and CSV imports.
 */
import type { ConnectionStatus } from '@elevate/shared-contracts';

export interface ProviderPunch {
  externalEmployeeRef: string;
  /** UTC instant. */
  at: string;
  direction: 'in' | 'out' | 'unknown';
}

export interface AttendanceProviderAdapter {
  readonly name: string;
  /** Honest status; `connected` only after a real verification call. */
  status(): Promise<{ connection: ConnectionStatus; detail: string; verifiedAt: string | null }>;
  fetchPunchesSince(since: Date): Promise<{ punches: ProviderPunch[]; asOf: string | null }>;
}

export const NO_PROVIDER_MESSAGE =
  'No attendance device or provider is connected; manual and CSV only.';

export class MockAttendanceProvider implements AttendanceProviderAdapter {
  readonly name = 'Attendance provider (mock — not connected)';

  async status() {
    return {
      connection: 'not_configured' as const,
      detail: `${NO_PROVIDER_MESSAGE} Device integration is out of scope (D-028); this mock returns no data.`,
      verifiedAt: null,
    };
  }

  async fetchPunchesSince(_since: Date) {
    return { punches: [], asOf: null };
  }
}

export function getAttendanceProvider(): AttendanceProviderAdapter {
  return new MockAttendanceProvider();
}
