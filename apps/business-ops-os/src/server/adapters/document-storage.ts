/**
 * Employment-document storage adapter (OPS-035, D-014). No storage service is
 * configured, so the default is a MOCK that reports `not_configured`, refuses
 * to store bytes and never issues download URLs. A real adapter must issue
 * SHORT-LIVED signed URLs only — never permanent public links — and report
 * `connected` only after a successful verification call. Choosing a provider
 * (and whether identity documents are stored at all, OD-014) is an owner decision.
 */
import type { ConnectionStatus } from '@elevate/shared-contracts';

export interface StorageStatus {
  connection: ConnectionStatus;
  detail: string;
  verifiedAt: string | null;
}

type Refused = { ok: false; connection: ConnectionStatus; detail: string };
export type PutResult = { ok: true; storageKey: string } | Refused;
export type UrlResult = { ok: true; url: string; expiresAt: string } | Refused;

export interface DocumentStorage {
  readonly name: string;
  status(): Promise<StorageStatus>;
  /** Store bytes; the caller has already validated type, size and sha256. */
  put(input: { bytes: Uint8Array; contentType: string; sha256: string }): Promise<PutResult>;
  /** Short-lived download URL (seconds ≤ 900). */
  downloadUrl(storageKey: string, ttlSeconds: number): Promise<UrlResult>;
}

const NOT_CONFIGURED =
  'Document storage is not configured (D-014). Record a reference-only document (where the paper or file is kept) instead.';

const refused: Refused = { ok: false, connection: 'not_configured', detail: NOT_CONFIGURED };
const mockStorage: DocumentStorage = {
  name: 'Document storage (mock — not configured)',
  status: async () => ({ connection: 'not_configured', detail: NOT_CONFIGURED, verifiedAt: null }),
  put: async () => refused,
  downloadUrl: async () => refused,
};

let override: DocumentStorage | undefined;

export function getDocumentStorage(): DocumentStorage {
  return override ?? mockStorage;
}

/** Tests only: install a fake adapter (undefined restores the mock). */
export function setDocumentStorageForTesting(adapter: DocumentStorage | undefined): void {
  override = adapter;
}
