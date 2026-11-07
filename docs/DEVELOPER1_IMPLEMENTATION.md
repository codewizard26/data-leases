# Developer 1 implementation plan and audit

The existing official A2A transport, provider processes, bounded negotiation, and CRE package remain authoritative. Developer 1 owns gateway orchestration, provider pricing/discovery, buyer policies, dashboard and event persistence. Developer 2 owns CRE enhancements and all Arkiv implementation.

Audit: A2A is functional; discovery currently supports explicitly allowed local cards only. Negotiation has three rounds and per-provider state. Event-store and negotiation packages are empty placeholders. The dashboard is static HTML rather than Next.js. Payment work exists locally but has not executed a settlement. CRE exposes `VerificationClient.submit/getResult`, not `verify`. No Arkiv adapter or shared Arkiv interface exists.

Implementation: preserve current routes, add durable lease/run orchestration and SSE, extend existing negotiation with transcript callbacks and deferred acceptance, select quotes by exact price then provider ID, enforce signed lease limits atomically before signing. Implement actual Parquet export through a SQLite outbox. Add a Next.js dashboard consuming the gateway. Consume the existing verification interface; leave pending CRE results pending. Propose an additive shared Arkiv-facing contract for Developer 2 review, without implementing an Arkiv client, SDK or entity model.

Payment, delivery, verification and publication remain separate. Uncertain payments retain budget reservations and cannot be resubmitted. Publication failure cannot erase settlement. Testnet payments remain disabled until explicit budget configuration and user lease authorization. Tests inject adapters; simulated settlement tests are not evidence of a live transfer.

Validation: typecheck, lint, unit/integration tests, actual Parquet readback, dashboard build, and local HTTP smoke tests. Live settlement and Arkiv publication require configured services; report these separately.

## Shared interface handoff required

`packages/contracts/src/integrations.ts` is an additive **proposed** interface, not frozen. Developer 2 should review `ArkivClient` and `RunPublicationInput`, supply the implementation through `GatewayOptions.arkivClient`, and preserve run-ID publication idempotency (including ambiguous publish timeouts). No Arkiv SDK or entity code was added. Discovery only accepts destinations already in the gateway allowlist. Developer 2 can provide `GatewayOptions.verificationClient`; the default gateway bridge invokes the existing CRE simulation script for the actual delivered answer and imports its matching artifact through `CreSimulationVerificationClient`.

## Verification evidence

The full suite passed 182 tests after the request-form redesign and AI utility addition; build, lint and typecheck passed. An additional regression checks successful publication remains recorded even if receipt lookup is unavailable. Actual local smoke run `46edd389-3b67-4312-b02f-2e97655f0d3d` completed QUOTES_READY with12 SSE events and12 actual Parquet rows, selected providerA at1000tinybars, and DISABLED_PREVIEW. A separate unpaid development A2A request produced403characters from the configured free OpenRouter model. This is live inference evidence, not payment or CRE evidence. No Hedera transfer was executed.
