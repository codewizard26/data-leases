/** Proposed additive handoff: Developer 2 must review before this boundary is frozen.
 * This package defines interfaces only; no Arkiv SDK, entities or implementation. */
import type {DiscoveredAgent, DiscoveryQuery, VerificationResult} from './index.js';
export interface RunPublicationInput {
  runId: string;
  providerId: string;
  quoteId: string;
  payment: {network: 'hedera:testnet'; transactionId: string; amountTinybars: string; hashScanUrl: string};
  verification: VerificationResult;
}
export interface RunReceiptReference {runId: string; reference: string; url?: string}
export interface ArkivClient {
  publishVerifiedRun(input: RunPublicationInput): Promise<RunReceiptReference>;
  getRunReceipts(runId: string): Promise<RunReceiptReference[]>;
  findProviderOffers(filters: DiscoveryQuery): Promise<DiscoveredAgent[]>;
}
