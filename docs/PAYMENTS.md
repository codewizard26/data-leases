# Testnet payments and lease console

Run Node >=22.13, pnpm10.28.1, `pnpm install`, then `pnpm dev`. The landing page is at http://127.0.0.1:3001; **Open dashboard** takes you to `/dashboard`. About and developer tools are available at `/about` and `/developer` on the same browser origin. Port3000 also serves the landing page. Old `/demo` links redirect to `/dashboard`. Two separate A2A provider processes run on4101/4102. Gateway and providers bind to loopback; this is a local trusted-development deployment, not a public authenticated service.

## Setup

Copy `.env.example` to ignored `.env` and set the Hedera testnet buyer account, corresponding private key and key type, distinct merchant recipient accounts, and your own `HEDERA_MAX_PAYMENT_TINYBARS`. Set `PAYMENTS_ENABLED=true` only after choosing that operator cap. No default spending authorization is supplied. Keep `.env` mode600. Obtain testnet accounts through https://portal.hedera.com/. Never expose keys through the browser or commit them.

HBAR uses eight decimals: 100000000tinybars=1HBAR. Demo USD amounts are never converted to HBAR. The official pinned SDK packages are `@x402/core` and `@x402/hedera`2.30.0. Facilitator: https://x402.org/facilitator; supported Hedera testnet mechanism must advertise exact v2 and a fee payer. Setup availability is not proof of successful settlement.

1. Discover providers by local registry or an explicitly configured direct card URL. Arkiv mode requires Developer2's adapter; hybrid reports local results when Arkiv is absent.
2. Choose a utility card, task, agent count and maximum spend. Compare prices, then click **Authorize & run once**. Gateway signs and persists a single-run policy with both spending caps equal to the displayed limit. `maxRuns:1` prevents a second funded run even when the first cost less than that limit. The server-side signing key is a local authorization mechanism, not a browser-wallet signature or onchain delegated spending contract.
3. Start the buyer. Actual A2A messages appear through durable SSE; each provider owns its negotiation state. Price then provider ID determines selection. Only the winner is accepted/paid. The buyer reserves total budget atomically before acceptance and rechecks cancellation before invoking payment.
4. x402 receives the exact final quote. It does not negotiate. The buyer validates merchant, resource, network, asset, price, quote hash, identifiers, deadline and cap, checks balance, signs a quote-bound policy and official SDK transaction, then retries the protected endpoint once with PAYMENT-SIGNATURE.
5. Read payment, delivery, CRE result and publication independently. A paid stale/rejected answer stays paid; no automatic refund is implied. HashScan links use the actual receipt transaction ID. The default CRE bridge passes the delivered answer to the existing simulation script; unsupported/synthetic evidence cannot become a live DON proof. Refresh CRE result after simulation finishes.
6. Publication calls only Developer2's injected shared Arkiv interface. Absent/unavailable Arkiv retains PENDING_RETRY after accepted non-mock verification, without changing payment. Retrying publication never submits another payment. Developer2's publisher must be idempotent by runId across ambiguous external timeouts.

## Provider pricing

Each provider can configure `ProviderOptions.utilityRates[questionTemplateId]` with independent integer ask/floor values. Defaults: providerA read500/floor300; providerB read700/floor400. Simulated write defaults are four times each provider's read rate. The write utility is explicitly synthetic; it does not make an external write or trade. The older `/developer` quote cards show each actual A2A quote as it arrives before a per-purchase approval. The new console uses a signed lease for autonomous payment within its limits.

## Recovery and persistence

SQLite WAL journals guard buyer/provider payment attempts and lease reservations. A repeated run ID never starts another payment. Unknown outcomes retain their reservation. Restart marks interrupted runs for reconciliation rather than replaying signing. `POST /api/payments/reconcile` with `{ "runId": "..." }` performs read-only Hedera testnet mirror lookup using the persisted SDK transaction ID and validates exact transfers. Missing data remains unknown; the service never treats an indexing delay as a failed transfer. Successful reconciliation updates payment independently of delivery; it does not auto-pay again or automatically release uncertain budget.

Events commit to SQLite before SSE. `data/tmp/runtime/events/conversation_events/event_date=.../session_id=.../part-....parquet` contains sealed immutable batches. `pnpm parquet:inspect --session <runId>` reads actual Parquet. The dashboard's Read Parquet history button uses the same reader. Private keys, model prompts and auth headers never enter this event pipeline. Only fixed public-safe answer templates are supported.

## Evidence limits

Local tests exercise real A2A HTTP and real Parquet. Payment, verification and publication dependencies in orchestrator tests are explicit test doubles. No live Hedera settlement is claimed by those tests. Current providers return synthetic measurements, unsigned origin terms (`DEMO_UNTRUSTED`), and cannot be treated as production financial data providers. Arkiv SDK/entities and CRE workflow enhancements remain exclusively Developer2's responsibility. The shared Arkiv interface remains proposed pending joint review.

## Request parameters and AI work

The simplified console uses three explanatory utility cards, a request form and a provider comparison table. Choose Read data, simulated Write report, or AI computation. Select the task, one or two eligible agents, price ceiling, maximum data age, discovery source and bargaining rounds. Request prices first; quote-only previews execute neither payments nor AI inference. One **Authorize & run once** action creates the bounded policy and starts that run. Freshness and discovery settings are under More options; conversation, receipts and history are expandable.

`AI_LINK_EXPLANATION` is a bounded AI utility with a fixed public prompt. Each provider uses its existing configured server-only `ComputeAdapter`. Providers without that adapter do not advertise the AI capability. Default compute ask/floor is twice that provider's read rate; `utilityRates` overrides it. Acceptance triggers the selected provider's real model call; its report is withheld behind the x402 endpoint for paid requests. Report text is displayed separately from the structured answer and independent verification. Generated text is not proof of blockchain facts. No unrestricted private prompts are written to Parquet. A new additive `ComputationResultSchema` remains proposed for shared-contract review.

Next.js compression is disabled because gzip buffering otherwise delays the proxied SSE stream. Durable event IDs support reconnection and replay.

Official scheme reference: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md. Runtime support is checked against the facilitator rather than assumed from this link.
