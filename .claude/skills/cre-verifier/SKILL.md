---
name: cre-verifier
description: Research and implement Chainlink CRE workflow simulation with EVM and external HTTP reads, deterministic answer checks, and a VerificationClient adapter for Data Leases. Use for Member B's track in the shared monorepo.
---

# Skill: Data Leases — Chainlink CRE verification (Member B)

Read root `CLAUDE.md`, `SKILLS.md` sections 0 and 3–5, and `docs/INTEGRATION_CONTRACT.md`. Read `specs.md` §7 for verification intent. **You own only CRE workflows and the verification adapter, not the agent services or dashboard.**

## Own these paths

`workflows/cre/verify-answer`, `packages/cre-adapter`, `tests/cre`, `docs/CRE_HANDOFF.md`. Only edit `packages/contracts` through a shared, reviewed change. Never add new Parquet writes or build an independent server-side copy of the agent types.

## Build order

1. **Research the real SDK and CLI.** Confirm TypeScript CRE SDK version, CLI install/login/config, supported EVM chain, HTTP capability, local simulation setup, HTTP/cron triggers and the exact `cre workflow simulate` command. Read official docs, inspect installed types. Document what works versus what only exists in theory.
2. **Contract fixture.** Import `VerificationRequest` and `VerificationResult` from `@data-leases/contracts`, test JSON roundtrip. If bootstrap isn't merged, use its fixture JSON and continue without redefining a competing schema.
3. **Hello-world simulation.** Establish a runnable workflow with real EVM read + real external HTTP fetch. Choose a stable objective metric with explicit contract address/ABI/decimals/block. Don't assume a protocol address; verify official deployment.
4. **Policy checker.** Verify input schema, source, chain, timestamp, units, same-block comparability and numeric tolerance. Return `ACCEPTED` only with actual matching evidence; return `REJECTED` for proven contradiction and `INCONCLUSIVE` for unavailable/mismatched sources.
5. **CRE CLI proof.** Save sanitized reproducible CLI output and exact commands; record distinction between local single-node simulation and DON consensus. Simulations are not live production oracles.
6. **Adapter.** Build `MockVerificationClient` plus `CreSimulationVerificationClient` matching the shared `submit/getResult` interface. Start with fixture/manual CLI result import if necessary. Only automate listener-mode CLI if supported and actually tested.
7. **Integrate.** Give Member A test fixtures and package import; the agent gateway calls the adapter and writes a `VERIFICATION_RESULT` event. Do not write event files yourself.

## Minimal check vocabulary

`ANSWER_SCHEMA_VALID`, `SOURCE_CHAIN_SUPPORTED`, `SOURCE_BLOCK_REFERENCE_VALID`, `SOURCE_FRESHNESS_VALID`, `METRIC_UNITS_MATCH`, `ONCHAIN_REFERENCE_MATCH`, `EXTERNAL_HTTP_REFERENCE_MATCH`, `PROVIDER_SIGNATURE_VALID` (only if real).

Result fields include `verificationId`, `runId`, `providerId`, `status`, `executionMode`, `checks`, `evidenceRefs`, `executedAt`, and optional block and sanitized artifact refs. Return only true claims in `checks`.

## CRE integration caveats

- Do not imply arbitrary HTTP requests are automatically authenticated data. An HTTP source can lie; an onchain read and external result should be compared meaningfully.
- Don't presume historical EVM state queries, chain support or a deployed CRE webhook until proven with the installed SDK.
- If local simulation cannot be invoked from the app on-demand, make a replayable fixture → CLI command → signed/hashed result artifact → adapter ingestion. That is an honest MVP integration.
- Use official `cre workflow simulate`; record `--listen` possibility only if tested. Live DON deployment may require approval.
- Real reference source must not be the same provider response mirrored through another endpoint.
- Reject tampered data only when objective; mark source ambiguity `INCONCLUSIVE`.

## Definition of done

- One CRE workflow runs successfully under CLI against a supported EVM chain and an external HTTP API.
- Both accepted and tampered/unavailable responses have checked, reproducible outcomes.
- Shared Zod result schema accepts all produced reports, with matching IDs.
- `pnpm --filter @data-leases/cre-adapter test` passes without needing a CRE login; CLI simulation is separately documented.
- `docs/CRE_HANDOFF.md` includes versions, commands, source details, fixture IDs, redacted output, mock-vs-simulation distinction and limitations.
- Member A can consume the adapter without changing the dashboard, A2A transport, or Parquet format.

## Official references

- https://docs.chain.link/cre/overview
- https://docs.chain.link/cre/getting-started/overview
- https://github.com/smartcontractkit/cre-sdk-typescript (verify current repository/package names from official docs before installing)
