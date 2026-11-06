# SKILLS.md — Data Leases: two-person parallel build plan

> **Read with `CLAUDE.md` and `specs.md`.** This is the master implementation brief for two coding agents / two human contributors working on the **same repository from the start**.
>
> **Sprint objective:** demonstrate genuine A2A discovery and bounded negotiation; persist each message/response in Parquet; build a separate CRE verifier against a frozen shared interface. **No Hedera payment required in this sprint.**

## 0. Roles, branch strategy and non-overlap

| Owner | Track / branch | Writes | Does **not** write | Deliverable |
|---|---|---|---|---|
| **Member A** | Agent network, `feat/agent-marketplace` | `apps/web`, `apps/agent-gateway`, `apps/provider-agent`, `packages/agents`, `packages/discovery`, `packages/negotiation`, `packages/event-store` | Chainlink workflow or the CRE SDK adapter | UI controls, real A2A exchanges, Parquet events, mock verification UI |
| **Member B** | CRE, `feat/cre-verifier` | `workflows/cre`, `packages/cre-adapter`, `tests/cre`, `docs/CRE_HANDOFF.md` | A2A transport, agent negotiation, dashboard and Parquet writer | Working CRE CLI simulation + versioned `VerificationClient` implementation |
| **Shared** | Contract bootstrap PR | `packages/contracts`, `docs/INTEGRATION_CONTRACT.md`, root scripts | Unreviewed incompatible changes | Zero-ambiguity schemas and fixtures that both import |

Before splitting: agree on `@data-leases/contracts` v1 fixtures. Once merged, **do not redefine shared types in individual apps**; propose breaking changes through a joint PR.

For direct task prompting with Claude Code, use the included actual skills:

- `/.claude/skills/agent-negotiation/SKILL.md` for Member A.
- `/.claude/skills/cre-verifier/SKILL.md` for Member B.

## 1. Bootstrap PR: the first dependency everyone shares

Create a `pnpm` workspace, strict TypeScript setup, Vitest, ESLint, `.env.example`, `packages/contracts`, sample fixtures, and schema tests. Pick a Node version compatible with the Parquet writer. Prefer Node 22 LTS or later (check library requirements) and pin `packageManager` and engines in the root.

**Shared project packages**:

```text
@data-leases/contracts      # Zod schemas, API types, canonical fixtures, schema versions
@data-leases/agents         # A2A buyer client + provider executor
@data-leases/discovery      # provider discovery adapters
@data-leases/negotiation    # deterministic negotiation and budget policy
@data-leases/event-store    # durable index, immutable Parquet exports
@data-leases/cre-adapter    # CRE verifier and mock verifier behind same interface
```

Define a `contracts` package public `index.ts`; consuming apps must never import another team's private internal paths. Create a fixture package (JSON files) or `packages/contracts/fixtures` with examples of:

- `provider-a.agent-card.json` and `provider-b.agent-card.json` — use exact schema validated by the installed official A2A SDK.
- `question.eth-liquidity.json` — `ETHEREUM_LENDING_LIQUIDITY`, chain `eip155:1`, asset and protocol identifiers, evidence policy.
- `offer.low-price.json`, `offer.countered.json`, `offer.rejected.json`.
- `answer.valid.json` and `answer.tampered.json`.
- `verification.accepted.json`, `verification.rejected.json`, `verification.inconclusive.json`.

Use `pnpm --filter @data-leases/contracts test` as the initial shared contract gate.

## 2. Member A: agent discovery, A2A negotiation, dashboard, Parquet

### Product behavior

The dashboard has one compact, functional console:

1. Pick **discovery mode**: `DIRECT_URL`, `LOCAL_REGISTRY`, `ARKIV` (feature-flagged until adapter is real), or `HYBRID` (local+Arkiv when enabled).
2. Choose a fixed **question template**: start with `ETHEREUM_LENDING_LIQUIDITY`, not arbitrary unsafely executable user instructions.
3. Set `maxPriceMinor`, currency, max answer age, deadline, eligible providers, and allowed negotiation rounds (default 3).
4. Click **Discover**. Render actual discovered agent cards, supported metric, price, endpoint, status, and provenance; indicate which source found each provider.
5. Click **Start negotiation**. Start a buyer-agent task that contacts a provider-agent server **over HTTP A2A**, exchanges structured terms, and shows a live transcript.
6. Render final `AGREED`, `REJECTED`, `EXPIRED` or `FAILED` outcome and its exact terms. For the base sprint, call the provider's **mock/unpaid** answer tool after agreement and store the structured response.
7. Click **Inspect run** to view event timeline, raw safe payloads, receipt placeholders and the status of the mock verifier.

### Discovery adapters

Expose one interface:

```ts
interface DiscoveryAdapter {
  discover(input: DiscoveryQuery): Promise<DiscoveredAgent[]>;
}
```

- `DirectUrlDiscovery`: retrieve a known agent card URL from a URL explicitly entered/allowlisted by developer. Validate HTTPS except explicitly permitted localhost in development. Bound redirects, timeouts, response size and IP ranges.
- `LocalRegistryDiscovery`: search at least two independently running local provider processes. Provider metadata must be fetched dynamically; no hardcoded negotiation outcome.
- `ArkivDiscovery`: initially return a clearly labeled `NOT_CONFIGURED` result. Later implement real Arkiv entity reads and source provenance, **not** local canned JSON pretending to be Arkiv.
- `HybridDiscovery`: combine real enabled adapters, deduplicate by provider ID + card URL, retain provenance and rank by capability and accepted price.

**Do not use an LLM to fabricate an endpoint, provider identity, supported metric or accepted price.** Discovery must return an actual reachable card and an agent with a live A2A endpoint.

### A2A transport and negotiation

- Use official `@a2a-js/sdk` compatible with the pinned A2A protocol release. Agent Card at `/.well-known/agent-card.json` and a real task endpoint. Buyer agent and seller agent MUST run as independent processes; enable third-party compatible clients later.
- Offer negotiation is a *Data Leases protocol extension* transported as A2A structured data parts. Do not describe custom negotiation events as native A2A protocol methods.
- Buyer states: `DISCOVERING → DISCOVERED → NEGOTIATING → AGREED | REJECTED | EXPIRED | FAILED`; delivered answer is a separate state.
- Negotiation message kinds: `REQUEST_FOR_QUOTE`, `PROPOSE`, `COUNTER`, `ACCEPT`, `REJECT`, `EXPIRE`, `ERROR`.
- Enforce `maxRounds = 3`, `deadlineAt`, quote TTL, capability match, source constraints, currency/token acceptance, and per-run price cap. Use exact integer-string minor units (`"30000"` for 3 cents if token has 6 decimals; *only after currency decimals are resolved*) and never `number` for balances.
- Negotiation is **deterministic by default**: a buyer may counter at a configured maximum; a seller may decline below floor; never let chat text override budget or policy. Optional LLM can suggest, but rules finalize.
- Quotes are immutable and include `offerId`, `negotiationId`, `quoteId`, `revision`, `expiresAt`, `providerId`, `metric`, `priceMinor`, `currency`, `evidencePolicy`, `deliverySlaSeconds`, `termsHash`.
- Bind accepted terms to one `runId`; user-facing sign-once budget is a **future** signed lease policy, not a working payment delegation in this sprint.
- Show real A2A request IDs/tasks in the transcript. Sign/verify provider-origin terms before any later payment integration; a local-dev unsigned mode must be visually marked `DEMO_UNTRUSTED`.

### Live event feed and Parquet

Every discovery result, outgoing/incoming A2A message, quote, rejection, negotiation outcome, answer request/response, verification request/result, timeout and error must go through **one canonical `ConversationEvent`** validator and storage path. The UI subscribes to the same committed event stream via `GET /api/sessions/:id/events` (SSE or durable polling) and does not invent independent UI events.

**Immutable dataset layout:**

```text
data/parquet/conversation_events/
  event_date=2026-11-06/
    session_id=<uuid-or-ulid>/
      part-<ulid>.parquet
```

`ConversationEvent` v1 columns (required unless marked optional):

| Column | Type | Meaning |
|---|---|---|
| `schema_version` | UTF8 | `1.0.0` |
| `event_id` | UTF8 | Stable unique ID; idempotency key |
| `occurred_at` | TIMESTAMP_MILLIS | UTC timestamp |
| `ingested_at` | TIMESTAMP_MILLIS | UTC timestamp |
| `session_id` | UTF8 | Discovery/negotiation session |
| `negotiation_id` | UTF8 nullable | A2A conversation / bid round |
| `a2a_task_id` | UTF8 nullable | A2A task identifier |
| `run_id` | UTF8 nullable | End-to-end future answer run |
| `sequence` | INT64 | Monotonic session event ordering |
| `event_type` | UTF8 | `DISCOVERY_STARTED`, `CARD_FOUND`, `A2A_OUTBOUND`, `A2A_INBOUND`, `QUOTE_RECEIVED`, `COUNTER_SENT`, `AGREED`, `REJECTED`, `ANSWER_DELIVERED`, `VERIFICATION_RESULT`, `ERROR`, etc. |
| `actor_role` | UTF8 | `BUYER_AGENT`, `PROVIDER_AGENT`, `GATEWAY`, `CRE_ADAPTER` |
| `actor_id` | UTF8 | Stable agent or service ID |
| `provider_id` | UTF8 nullable | Target provider |
| `direction` | UTF8 | `IN`, `OUT`, or `INTERNAL` |
| `message_id` | UTF8 nullable | Transport message ID |
| `status` | UTF8 | Phase-specific outcome |
| `price_minor` | UTF8 nullable | Exact decimal integer string |
| `currency` | UTF8 nullable | Token/network identifier or demo currency |
| `payload_json` | UTF8 | Canonical, redacted, schema-validated JSON payload |
| `payload_sha256` | UTF8 | SHA-256 of `payload_json` |
| `error_code` | UTF8 nullable | Machine-readable safe error |

**Parquet correctness requirements**:

- Use `@dsnp/parquetjs` or a tested equivalent for valid Parquet. `appendRow()` appends only while the *new writer* is open; do not reopen a closed Parquet file to mutate it.
- First commit accepted events to a SQLite WAL/outbox with unique `event_id` and `sequence`. Only one writer exports batches to temporary `*.parquet.tmp`, closes them, then atomically renames to final `*.parquet`. Mark exported events in the index. On restart, re-export uncommitted batches idempotently and delete abandoned temps.
- Keep sealed files immutable. Partition by UTC event date/session, choose a small dev batch size (e.g., 5–20 rows or flush-on-run-complete). Do not create one file per event in production.
- `pnpm parquet:inspect --session <id>` must open **actual** files, validate count, filter by session and show agent turns/answers in order. Add a roundtrip test with `ParquetReader` or DuckDB.
- Store the actual response's **redacted structured payload** in `payload_json`; a hash-only log does **not** fulfill this sprint's requirement to store responses. Never put secret prompts, private keys, auth headers or proprietary unrestricted payloads into Parquet.
- Local dataset is an analytics/history sink. A future Arkiv publishing adapter will separately publish *public-safe* offers and receipts; **do not equate Parquet with Arkiv**.

### Member A API minimum

| Endpoint | Purpose |
|---|---|
| `POST /api/discovery` | DiscoveryQuery → provider list or not configured |
| `POST /api/negotiations` | Start negotiation; return `sessionId` + `negotiationId` |
| `GET /api/sessions/:id` | Current session and selected terms |
| `GET /api/sessions/:id/events` | Event stream or cursor-based polling |
| `POST /api/negotiations/:id/cancel` | Stop further negotiation safely |
| `GET /api/sessions/:id/export` | Local dev: downloadable Parquet shard(s) or ZIP |
| `GET /.well-known/agent-card.json` | Each provider agent publishes its own A2A Agent Card |

HTTP route names are app-local conventions. Do not confuse them with the official A2A SDK wire protocol endpoints.

### Member A success tests

- Two providers reachable on distinct ports, both with distinct agent cards, differing prices and SLA; buyer discovers both through the dashboard.
- One provider counteroffers and agreement succeeds without breaching cap; another rejects low offer; deadline and max rounds terminate negotiation.
- A fake card pointing to a forbidden internal address is rejected (unless explicitly permitted localhost dev); malicious provider text cannot change pricing policy.
- A negotiation response from a real network request appears in timeline and in actual Parquet row.
- Replaying the same event ID doesn't duplicate transcript or Parquet rows. Crashing during export then restarting yields a complete readable dataset.
- CRE adapter is mockable; `MOCK` is prominently labeled and no fake HashScan transaction or CRE report appears.

## 3. Member B: CRE research, workflow, integration adapter

### Discover and validate the actual CRE integration surface

Start with the official CRE TypeScript SDK getting-started tutorial. Record pinned CLI/SDK versions, CLI login and required environment variables, supported EVM chains, HTTP capability restrictions, trigger type, local simulation invocation, output format, cost/limits if relevant, and whether any interactive prompt remains. CRE workflows operate through **triggers, callbacks and capabilities**, not arbitrary Node.js functions called directly by an external web server. A working `cre workflow simulate` run is the sponsor-relevant milestone. Deployment may need separate approval.

**Scope the first verification to an objectively reproducible metric.** Prefer a minimal fixed Ethereum read (e.g. supply/state for a known token or a specific supported lending-market value) and a provider's HTTP-reported value. Only move to the full Aave V3 liquidity metric once the exact contract, ABI, units, block semantics and available CRE EVM capabilities are confirmed.

### Frozen cross-team API

Implement `VerificationClient` from `@data-leases/contracts`:

```ts
type VerificationStatus = "ACCEPTED" | "REJECTED" | "INCONCLUSIVE";
type VerificationMode = "MOCK" | "CRE_CLI_SIMULATION" | "LIVE_CRE";
interface VerificationClient {
  submit(input: VerificationRequest): Promise<{ verificationId: string; state: "PENDING" | "COMPLETED" }>;
  getResult(verificationId: string): Promise<VerificationResult | null>;
}
```

Full Zod schemas, fields, and sample JSON live in `docs/INTEGRATION_CONTRACT.md`. Return `INCONCLUSIVE`, not accepted, for unavailable sources, simulation crashes, unsupported methods or missing signatures. Use deterministic rule/check arrays, not an LLM's confidence score.

### CRE workflow behavior

1. Accept a versioned `VerificationRequest` from an authenticated, bounded-size job source. The workflow may initially fetch a fixture or `GET /internal/verification-jobs/:id` from the local API. Mark all simulated fixtures clearly.
2. Read at least one actual supported EVM state value using CRE EVM capability. Persist the chain ID, block reference and contract/source in the output. Confirm how historical block reads work before claiming same-block consistency.
3. Fetch at least one external HTTP source using CRE HTTP capability (provider's signed answer endpoint or known reference API). Treat it as potentially untrusted.
4. Validate schema, allowed measurement method, units, freshness, source binding, and numeric tolerance. When a source block mismatch prevents comparison, return `INCONCLUSIVE` rather than silently comparing different blocks.
5. Produce `VerificationResult` with `checks[]`, reason codes, `evidenceRefs[]`, `executionMode`, and `rawArtifactRef` (safe local path/hash). Include validation for malformed, stale and malicious input.
6. Run `cre workflow simulate ...` successfully; save a redacted text log, committed workflow configs and exact reproduction commands. **Do not label simulation output DON-attested.**
7. Implement `MockVerificationClient` and a `CreSimulationVerificationClient` behind the same interface. If the live CLI integration can't be launched on-demand, document a reproducible simulation bridge: job fixture → manually/locally triggered CLI → normalized result imported by adapter. Do not pretend it's an always-on CRE API.
8. Deliver a sample `VerificationRequest`/`VerificationResult` fixture to Member A so the UI can integrate while CRE is under development.

### Integration alternatives to evaluate

- **CLI proof mode (required first):** manually run the simulator on saved job input, import its output; highest confidence sponsor demo and zero false claims.
- **Simulation listener (optional):** investigate officially supported `cre workflow simulate --listen` for HTTP triggers and verify whether it accepts the required input; avoid claiming production DON verification.
- **Production CRE DON (stretch):** if approved and supported, deploy and verify authentic signed reports; update `executionMode` only after proving it.

### Member B success tests

- Real local CLI simulation succeeds and reads **EVM + external HTTP**.
- A correct answer matches a supported source → `ACCEPTED` with actual check evidence.
- A tampered value or stale report → `REJECTED` (if objectively contradictory), unavailable source → `INCONCLUSIVE`.
- Adapter accepts exactly Member A's schema fixture; every `VerificationResult` roundtrips through shared Zod validators.
- `docs/CRE_HANDOFF.md` records CLI version, `cre` commands, env setup, RPC/source contracts, and limitations with no secrets.

## 4. Integration milestones (no blocker between teammates)

| Stage | Member A | Member B | Merge evidence |
|---|---|---|---|
| **D0 / shared** | Scaffold contracts, provider/answer fixtures | Review and accept schemas, seed verification fixtures | `pnpm --filter @data-leases/contracts test` |
| **D1 / independent** | Direct/local discovery + A2A provider servers | CRE hello-world + first EVM and HTTP reads | Both tasks run independently |
| **D2 / independent** | Deterministic negotiation + SSE + Parquet | CRE check logic + mocked client implementation | JSON fixtures pass shared validators |
| **D3 / merge** | Consume `VerificationClient` and display check result | Expose fixture/CLI adapter + docs | One end-to-end run retains IDs and event history |
| **D4 / after MVP** | Arkiv discovery; Hedera x402 payout after budget policy | Refine CRE sourcing and reporting | Real sponsor onchain/Arkiv receipts (separate deliverable) |

## 5. Integration, failure states and the invariant checklist

`DISCOVERY → NEGOTIATION → AGREED → ANSWER_REQUESTED → ANSWER_DELIVERED → VERIFYING → ACCEPTED | REJECTED | INCONCLUSIVE`.

- **No provider reachable**: display `DISCOVERY_FAILED`; create an event, not a fabricated agent.
- **No terms agreed**: `REJECTED`/`EXPIRED`; no answer request, no future payment.
- **Provider answers but CRE fails**: answer remains `DELIVERED_UNVERIFIED`, result `INCONCLUSIVE`.
- **CRE rejects**: never publish as verified; preserve original evidence for audit.
- **Duplicate network retry**: same `eventId`/`runId` does not create duplicated row, future charge, or verification job.
- **Seller changes price after acceptance**: quote invalid unless new revision and explicit re-acceptance.
- **Agent's prompt injection**: treated as untrusted data, cannot change budget, provider allowlist, endpoint authorization, or output status.
- **Agent process crashes**: session history and Parquet sink recover from durable index; live UI resumes from cursor.
- **Parquet export fails**: do not lose committed event; retry without writing duplicate finalized rows.
- **Future x402 paid-but-not-delivered**: record settled payment and failed delivery separately; do not silently retry a payment or claim refund.

## 6. Concrete demonstration script

1. Open dashboard and choose `LOCAL_REGISTRY`; discover two running seller agents with different asking prices.
2. Select question template `ETHEREUM_LENDING_LIQUIDITY`, max unit price and source freshness; press **Negotiate**.
3. Show agent card resolution and A2A request IDs. Seller 1 counters; buyer rejects if over budget. Seller 2 agrees inside cap.
4. Display the negotiated quote and structured answer from the remote seller process. Show event stream in real time.
5. Open an actual `.parquet` dataset with the inspection script; show outgoing, incoming, counteroffer, agreement, and answer records.
6. Send `VerificationRequest` to mocked adapter (`MOCK` label); then replace with Member B's recorded CRE CLI simulation and show accepted/rejected results with real check evidence.
7. Show one invalid answer and one forbidden-price attempt. The state machine must fail safely.

## 7. What is *not* done in this sprint

- No production Hedera spending or autonomous private key execution. Create a `PaymentClient` interface only; mark unavailable.
- No fake Arkiv `Offer` query. `ARKIV` discovery mode may display `Not connected yet` until genuinely implemented.
- No generic unrestricted browsing or open public agent registration without identity/SSRF protection.
- No "all answers verified" claim. CRE can only verify metrics with independently checkable sources.
- No investor recommendation engine, 0G, RWA tokens or extra sponsor submissions.
- No elaborate infrastructure beyond two agent processes, a thin gateway, a small UI, one event store, and one CRE workflow.

## 8. Acceptance checklist / shared definition of done

- [ ] `main` includes a working pnpm workspace and pinned dependencies.
- [ ] `packages/contracts` exports schema v1, validators and fixtures consumed by both tracks.
- [ ] Two independently running A2A agents publish valid agent cards and exchange negotiation messages over HTTP.
- [ ] Dashboard supports `DIRECT_URL` and `LOCAL_REGISTRY`; optional Arkiv mode truthfully labeled.
- [ ] Buyer/agent negotiation obeys deadlines, provider constraints, three-round cap and integer money rules.
- [ ] All inbound/outbound messages and actual answer responses survive restart and are readable from valid Parquet files.
- [ ] `pnpm parquet:inspect` reports matches and verifies event counts without duplicates.
- [ ] CRE workflow performs real EVM and HTTP reads in a reproducible local CLI simulation.
- [ ] Shared verification adapter correctly handles accepted, rejected, and inconclusive cases.
- [ ] End-to-end correlation IDs flow from discovery through verification; UI never labels a mock check real.
- [ ] README and `.env.example` list exact ports, commands, API keys (variable names only), limitations, and demo steps.

## Official sources checked while preparing this plan

- Official A2A SDK (stable v1): https://github.com/a2aproject/a2a-js
- Official A2A specification: https://a2a-protocol.org/latest/specification/
- CRE overview and simulation limitations: https://docs.chain.link/cre/overview
- CRE getting started: https://docs.chain.link/cre/getting-started/overview
- Parquet JS writer/reader: https://www.npmjs.com/package/@dsnp/parquetjs
- Original full product plan: [`specs.md`](./specs.md)
