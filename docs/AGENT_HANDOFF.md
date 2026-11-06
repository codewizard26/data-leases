# Agent track handoff: first communication slice

## Implemented

- Runtime Zod contracts and deterministic proposed v1 fixtures in `packages/contracts`.
- Official `@a2a-js/sdk` 1.3.0, A2A 1.0 JSON-RPC, structured negotiation data parts.
- Local direct/registry discovery with exact card and endpoint allowlists.
- Independently running provider processes and a separate buyer CLI.
- Three-turn maximum, deadline/quote expiry, immutable accepted terms, exact integer-string prices, and deterministic budget rejection.
- Server-only `ComputeAdapter`, mock and 0G Direct HTTP implementations. Claude can implement the same interface later.

## Reproduce

```sh
pnpm install
pnpm demo:a2a
pnpm test
pnpm test:integration
pnpm typecheck
pnpm lint
pnpm build
```

Provider ports: 4101, 4102. The buyer prints actual A2A message IDs plus sessionId, negotiationId and runId. Provider A agrees at 350 `demo:USD6` minor units; Provider B rejects because its 400 floor exceeds the buyer's 350 cap. Six decimal places are explicitly defined for the demo currency. This is unpaid negotiation.

## Compatibility and remaining work

Contracts remain proposed until both contributors review and accept them. VerificationRequest and VerificationResult are exported centrally, with example MOCK results; no verifier implementation was added to the CRE-owned package.

No dataset path exists yet: the event store and Parquet writer remain pending. Transcripts and provider quote state are not durable. Add canonical event recording and recovery before claiming sprint acceptance. Next slices are unpaid answer delivery, a gateway/SSE stream, dashboard, SQLite index/outbox and immutable Parquet files, followed by mock-verifier consumption.

No real 0G inference was executed. Configure provider endpoint, model and secret using `docs/COMPUTE.md`; testnet still requires available providers and funded test-token accounts. Inference is advisory and has no economic authority. Local agent cards and offers are unsigned `DEMO_UNTRUSTED`; do not expose this service publicly.
