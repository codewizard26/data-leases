---
name: agent-negotiation
description: Implement Data Leases A2A buyer-provider discovery, bounded offer negotiation, minimal Next.js console, and durable Parquet event capture. Use for Member A's portion of the shared monorepo.
---

# Skill: Data Leases — Agent network (Member A)

Read root `CLAUDE.md`, `SKILLS.md` sections 0–2, and `docs/INTEGRATION_CONTRACT.md` before coding. Read `specs.md` for product context only; **this sprint is a narrow negotiation prototype, not full payments**.

## Own only these paths

`apps/web`, `apps/agent-gateway`, `apps/provider-agent`, `packages/agents`, `packages/discovery`, `packages/negotiation`, `packages/event-store`, `tests/integration` relevant to A2A. Joint approval for `packages/contracts` changes. Never edit `workflows/cre` or `packages/cre-adapter` without explicit coordination.

## Build order

1. **Confirm the contract.** Create/import `DiscoveryQuery`, `DiscoveredAgent`, `NegotiationMessage`, `AnswerEnvelope`, `ConversationEvent`, `VerificationRequest`, `VerificationResult` with real Zod validation and fixtures. Add `pnpm typecheck` and `pnpm test`.
2. **Two real providers.** Start two provider-agent processes on distinct ports; each publishes a valid `/.well-known/agent-card.json`, advertises a priced metric skill, and accepts actual A2A tasks using the pinned official `@a2a-js/sdk`. Verify cards with a separate buyer client.
3. **Discovery.** Build `DIRECT_URL` and `LOCAL_REGISTRY` adapters and providers list. Select `ARKIV` or `HYBRID` only if a real adapter exists; otherwise show `Not connected` and a failure/disabled state, never fake discovery.
4. **Negotiation.** Buyer and sellers exchange structured quote/counter/accept/reject over network A2A messages. Deterministic 3-round cap, exact minor-unit money, TTL, allowed source/metric. Persist every message and quote with IDs. No LLM needed for v1.
5. **Answer.** Following agreement, provider responds with valid `AnswerEnvelope`. Return `DELIVERED_UNVERIFIED`. Invoke `MockVerificationClient` behind shared `VerificationClient` with `executionMode: MOCK`; save the result as separate event.
6. **Dashboard.** Add discovery mode select, question template select, price ceiling, max age, `Discover` and `Negotiate` actions, live SSE message timeline, current state, provider cards, response pane and "Export/inspect Parquet" indicator.
7. **Parquet.** Durable SQLite event index/outbox, single writer, immutable partitioned Parquet dataset. Validate and redact before writing. CLI inspect reads actual Parquet. Recovery and dedup tests.
8. **Integration.** Swap mock verification adapter for Member B's `CreSimulationVerificationClient` without modifying A2A negotiations. Keep execution mode displayed.

## Do not implement

- Hedera x402 transfer, real wallet signing, fake `PAID`, false `CRE VERIFIED`, secret-bearing dumps, speculative Arkiv writes, full investment dashboard, unrestricted LLM negotiation.
- Do not describe a server method call as A2A. There must be separately addressable A2A agent processes and inspectable network traffic.
- Never write to `data/parquet` from the browser or a serverless route; all persistence happens in durable Node service.

## Tests / definition of done

- Two provider cards resolve; direct and registry discovery provide real endpoints.
- Negotiation has actual counteroffer, acceptance, rejection, timeout and budget ceiling tests.
- Browser displays live A2A messages and one real provider answer.
- Every event and answer payload is in an actual, readable Parquet file; two event replays do not double-record; interrupted writer recovers.
- CRE mock interface is consumed but honestly labeled mock; all shared IDs survive the end-to-end flow.

## Report progress to team

At end of each PR give: changed files, startup commands, ports, test results, example session ID, Parquet dataset path, contract compatibility status, and remaining blockers. When stuck on A2A SDK methods, consult its installed types or official repo rather than handwaving behavior.
