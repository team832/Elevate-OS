/**
 * External CRM adapter (D-014, OD-010). Whether Elevate OS replaces the existing
 * CRM or imports from it is an open owner decision, and the CRM's capabilities
 * are reported, not verified (handover Claude.md §2.5). So there is only an
 * interface and a MOCK that never claims a connection and never returns leads.
 * Vacademy (LMS) is Academic OS's integration; Ops does not call it.
 */
import type { ConnectionStatus } from '@elevate/shared-contracts';

export interface CrmLeadExportRow {
  externalId: string;
  receivedAt: string;
  studentName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
}

export interface CrmAdapter {
  readonly name: string;
  /** Honest connection status; `connected` only after a real verification call. */
  status(): Promise<{ connection: ConnectionStatus; detail: string; verifiedAt: string | null }>;
  /** Pull leads changed since an instant (OPS-026, only if OD-010 keeps an external CRM). */
  fetchLeadsSince(since: Date): Promise<{ rows: CrmLeadExportRow[]; asOf: string | null }>;
}

export class MockCrmAdapter implements CrmAdapter {
  readonly name = 'CRM (mock — not connected)';

  async status() {
    return {
      connection: 'not_configured' as const,
      detail:
        'No CRM is connected. OD-010 (replace or import from the existing CRM) is open; this mock returns no data.',
      verifiedAt: null,
    };
  }

  async fetchLeadsSince(_since: Date) {
    return { rows: [], asOf: null };
  }
}

export function getCrmAdapter(): CrmAdapter {
  return new MockCrmAdapter();
}
