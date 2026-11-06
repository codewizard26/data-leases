# Data Leases v1 — Integration Contract

> **Status:** proposed v1 baseline. Both contributors should review and approve in the first shared PR, then freeze it for the sprint. Schema types are illustrative TypeScript shapes; create the **actual Zod implementations** and tests in `packages/contracts/src`.
>
> No remote payment, no onchain proof, and no live CRE guarantee are implied by this document.

## 1. Protocol versions and identifiers

- `schemaVersion = "1.0.0"` for all project-level contract payloads.
- `runId`: unique ID joining answer, payment (future), verification, and receipt (future). Generate exactly once before requesting the answer.
- `sessionId`: one dashboard discovery/negotiation session, preserved across reconnects.
- `negotiationId`: uniquely identifies the buyer/seller negotiation.
- `verificationId`: uniquely identifies a verification attempt, may differ from `runId` on retry.
- `eventId`: immutable ID per emitted event, used to prevent duplicates in the event index and Parquet.
- `questionTemplateId`: names a typed, supported measurement, not arbitrary executable instructions.
- All timestamps: ISO-8601 UTC `...Z`; Parquet stores timestamps as `TIMESTAMP_MILLIS`.
- All monetary values: decimal-string **integer minor units**, with explicit `currency` and `decimals` from a trusted network token registry. Never infer conversion rate from USD/INR labels.

## 2. Zod/TypeScript contract targets

```ts
export type DiscoveryMode =
  | "DIRECT_URL"
  | "LOCAL_REGISTRY"
  | "ARKIV"
  | "HYBRID";

export interface DiscoveryQuery {
  schemaVersion: "1.0.0";
  sessionId: string;
  mode: DiscoveryMode;
  questionTemplateId: string;
  directCardUrl?: string;
  maxPriceMinor: string; // integer >= 0 in explicitly selected token decimals
  currency: string; // e.g. demo:USD6; future: CAIP-19 asset ID
  maxAgeSeconds: number;
  requestedAt: string;
}

export interface DiscoveredAgent {
  providerId: string;
  cardUrl: string;
  a2aEndpoint: string;
  displayName: string;
  supportedQuestionTemplates: string[];
  discoverySource: "DIRECT_URL" | "LOCAL_REGISTRY" | "ARKIV";
  cardFingerprintSha256: string;
  fetchedAt: string;
  capabilityMatched: boolean;
}

export type NegotiationAction =
  | "REQUEST_FOR_QUOTE" | "PROPOSE" | "COUNTER"
  | "ACCEPT" | "REJECT" | "EXPIRE" | "ERROR";

export interface NegotiationMessage {
  schemaVersion: "1.0.0";
  sessionId: string;
  negotiationId: string;
  messageId: string;
  runId?: string;
  action: NegotiationAction;
  fromAgentId: string;
  toAgentId: string;
  round: number;
  questionTemplateId: string;
  quoteId?: string;
  offerId?: string;
  revision?: number;
  priceMinor?: string;
  currency?: string;
  evidencePolicyId: string;
  maxAgeSeconds: number;
  deliverySlaSeconds?: number;
  expiresAt: string;
  termsHash?: string;
  reasonCode?: string;
}

export interface AnswerEnvelope {
  schemaVersion: "1.0.0";
  sessionId: string;
  negotiationId: string;
  runId: string;
  questionTemplateId: string;
  providerId: string;
  acceptedQuoteId: string;
  deliveredAt: string;
  chainId: string; // CAIP-2, e.g. eip155:1
  metric: string; // stable documented metric identifier
  value: string; // integer raw-unit value or exact decimal string
  unit: string;
  sourceContract?: string;
  sourceBlockNumber?: string; // decimal integer string
  sourceBlockHash?: string;
  methodologyVersion: string;
  evidenceRefs: string[];
  evidencePolicyId: string;
  providerSignature?: string;
  demoTrustMode: "UNTRUSTED_MOCK" | "SIGNED_PROVIDER";
}

export interface VerificationRequest {
  schemaVersion: "1.0.0";
  verificationId: string;
  runId: string;
  sessionId: string;
  questionTemplateId: string;
  providerId: string;
  answer: AnswerEnvelope;
  policy: {
    policyId: string;
    version: string;
    allowedChainIds: string[];
    allowedMetricIds: string[];
    maxAgeSeconds: number;
    maxAbsDeltaRaw?: string; // when exact same units/block
  };
  requestedAt: string;
}

export type VerificationMode = "MOCK" | "CRE_CLI_SIMULATION" | "LIVE_CRE";
export type VerificationStatus = "ACCEPTED" | "REJECTED" | "INCONCLUSIVE";

export interface VerificationCheck {
  checkId: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  observed?: string;
  expected?: string;
  reasonCode: string;
  evidenceRef?: string;
}

export interface VerificationResult {
  schemaVersion: "1.0.0";
  verificationId: string;
  runId: string;
  providerId: string;
  executionMode: VerificationMode;
  status: VerificationStatus;
  checks: VerificationCheck[];
  referenceChainId?: string;
  referenceBlockNumber?: string;
  referenceBlockHash?: string;
  executedAt: string;
  evidenceRefs: string[];
  rawArtifactRef?: string; // local path, hash, or authenticated report ID
  reportSignature?: string; // optional ONLY if a real verifiable report exists
}

export interface VerificationClient {
  submit(req: VerificationRequest): Promise<{
    verificationId: string;
    state: "PENDING" | "COMPLETED";
  }>;
  getResult(verificationId: string): Promise<VerificationResult | null>;
}

export interface ConversationEvent {
  schemaVersion: "1.0.0";
  eventId: string;
  sessionId: string;
  negotiationId?: string;
  a2aTaskId?: string;
  runId?: string;
  sequence: number; // assigned by durable event index per session
  occurredAt: string;
  ingestedAt: string;
  eventType: string; // validate against finite event-type enum
  actorRole: "BUYER_AGENT" | "PROVIDER_AGENT" | "GATEWAY" | "CRE_ADAPTER";
  actorId: string;
  providerId?: string;
  direction: "IN" | "OUT" | "INTERNAL";
  messageId?: string;
  status: string;
  priceMinor?: string;
  currency?: string;
  payloadJson: string; // canonical, redacted, validated JSON
  payloadSha256: string;
  errorCode?: string;
}
```

For local development, the recommended package exports are:

```ts
export { DiscoveryQuerySchema, DiscoveredAgentSchema, NegotiationMessageSchema } from "./discovery";
export { AnswerEnvelopeSchema, VerificationRequestSchema, VerificationResultSchema } from "./verification";
export type { VerificationClient } from "./verification";
```

**Member A** implements the Zod schemas and fixture tests in the bootstrap PR; **Member B** reviews and supplies CRE-specific reason codes and tests before it is merged. No breaking changes without both members' approval.

## 3. A2A transport mapping

A2A Agent Card describes capabilities and transport. Use the SDK's protocol-native Task/Message types and carry `NegotiationMessage` in an A2A `DataPart` or documented extension field with application MIME/namespace `application/vnd.data-leases.negotiation+json;v=1`, **only after checking the installed SDK's supported encoding fields**. Example `NegotiationMessage` is **application payload**, not a fabricated replacement for a protocol-native A2A JSON-RPC message.

Sequence:

```text
Buyer                 Provider
  │                      │
  │-- A2A REQUEST_FOR_QUOTE -->│
  │<-- A2A PROPOSE -----------│
  │-- A2A COUNTER ----------->│
  │<-- A2A ACCEPT -----------│
  │-- A2A ANSWER_REQUEST ---->│   # distinct service task/capability
  │<-- AnswerEnvelope -------│
  │                      │
  └── submit VerificationRequest to VerificationClient
```

Every A2A send/receive creates a redacted `ConversationEvent` and persists before/after sending according to idempotency requirements. Transport acknowledgments are not acceptance of economic terms.

## 4. Verification logic and strict failure semantics

Check IDs initially supported:

- `ANSWER_SCHEMA_VALID`
- `PROVIDER_ALLOWED`
- `SOURCE_CHAIN_SUPPORTED`
- `SOURCE_CONTRACT_ALLOWED`
- `SOURCE_BLOCK_REFERENCE_VALID`
- `SOURCE_FRESHNESS_VALID`
- `METRIC_UNITS_MATCH`
- `ONCHAIN_REFERENCE_MATCH`
- `EXTERNAL_HTTP_REFERENCE_MATCH`
- `PROVIDER_SIGNATURE_VALID` (only if origin signature implementation exists)

**Acceptance rule:** `ACCEPTED` only when every *required* check for the policy is `PASS` and independent sources actually match within the permitted tolerance. `FAIL` on required check → `REJECTED`; unavailable source, unsupported historical block access or incomplete data → `INCONCLUSIVE`.

A local CRE CLI simulator can perform genuine EVM and HTTP reads, but it is **not** a DON-signed decentralized execution. Use `CRE_CLI_SIMULATION` with CLI log artifact evidence, not `LIVE_CRE`. A mock validator never produces `CRE_CLI_SIMULATION`.

## 5. Event persistence handoff

Only `packages/event-store` writes Parquet. The CRE adapter returns a `VerificationResult` to Agent Gateway, and the gateway emits `VERIFICATION_RESULT` through the existing event sink. Member B must **not** directly write Parquet, which would duplicate events and break event order.

Parquet `payload_json` for verification response should include the **complete public-safe** `VerificationResult`, not the raw log with secret headers. Store full unredacted local CRE simulator log only in controlled local file paths when necessary; git may include a sanitized proof snippet.

## 6. Integration contracts and smoke tests

| Test | Stimulus | Required result |
|---|---|---|
| `adapter-contract` | Submit valid `VerificationRequest` fixture | Valid `VerificationResult`, matching `runId` |
| `accept` | Correct provider answer and matching independent state | `ACCEPTED`; required checks pass |
| `reject` | Tampered value with comparable sources | `REJECTED` with `ONCHAIN_REFERENCE_MATCH: FAIL` |
| `inconclusive` | EVM RPC unreachable or inconsistent block ref | `INCONCLUSIVE`; no verified claim |
| `idempotency` | Same run and verification twice | No duplicate committed result or Parquet event |
| `traceability` | Provider→Buyer negotiation and answer | Same `sessionId`, `negotiationId`, `runId` in UI and Parquet |

## 7. Later payment and Arkiv contracts (not current sprint)

- `PaymentClient` will plug in **Hedera x402** once provider's HTTP payment endpoint is real. Maintain a dedicated budget-controlled payer, enforce per-merchant caps, and treat payment and answer verification as separate statuses.
- `PublicRecordPublisher` will plug in **Arkiv** for publicly queryable offer discovery and accepted/policy-labeled answer metadata. Never store trade secrets or private paid answers on public Arkiv entities.
- Do not turn a mock payment into a fake `paymentTxId` or a mock verifier into a signed Chainlink proof.

## 8. Signoff

- [ ] Member A validates the schemas, fixtures, and two-provider A2A negotiation.
- [ ] Member B validates the schemas, fixtures, and CRE adapter's checks.
- [ ] Both agree the event format and interface versions are frozen for v1.
- [ ] Both can independently run their work without editing the other's paths.

## Bootstrap implementation notes

`packages/contracts/src/index.ts` now implements the proposed v1 Zod schemas. This remains a proposed contract until both contributors complete the signoff above. Fixtures under `packages/contracts/fixtures` use synthetic data and explicitly use `MOCK` verification; the tampered answer is structurally valid so that verification can reject its contradictory value.

Validation additionally enforces exact numeric answer strings, nonnegative integer minor units, rounds 1–3, UTC timestamps, URL syntax, SHA-256 hex strings, and matching request/answer correlation IDs and evidence policy IDs. `SIGNED_PROVIDER` requires a signature field, but structural validation does not cryptographically verify it. `ACCEPTED` requires at least one check with every supplied check passing; the verifier still must enforce policy-required checks and independent evidence.

Conversation event types are finite: `DISCOVERY_STARTED`, `DISCOVERY_RESULT`, `DISCOVERY_FAILED`, `A2A_SENT`, `A2A_RECEIVED`, `QUOTE`, `NEGOTIATION_OUTCOME`, `ANSWER_REQUESTED`, `ANSWER_DELIVERED`, `VERIFICATION_REQUEST`, `VERIFICATION_RESULT`, `TIMEOUT`, and `ERROR`. URL validation is syntactic only; transport code must enforce destination allowlists and SSRF protection.
