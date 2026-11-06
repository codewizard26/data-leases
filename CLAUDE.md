# CLAUDE.md — Data Leases

> Root instructions for Claude Code and other coding assistants working in this **single shared monorepo**.
> Canonical product specification: [`specs.md`](./specs.md).
> Parallel work plans, frozen cross-team contracts, and definition of done: [`SKILLS.md`](./SKILLS.md).
> Read all three before touching application code. Follow this file for every task.

## Mission

Build **Data Leases: Rent the answer. Not the team.** Buyers select a question and discovery strategy; an autonomous buyer agent discovers external provider agents, negotiates machine-readable offers, and later purchases evidence-backed answers. The eventual prize stack is **Hedera x402 + Arkiv + Chainlink CRE**, with at most three sponsor submissions. **The immediate sprint is ONLY (A) agent discovery/negotiation + dashboard + Parquet event capture and (B) a separate CRE verification proof-of-concept**. Do not build payment rails, Arkiv integration, tokenomics, IoT, or full production leases unless the task explicitly expands scope.

## Non-negotiables

1. **One repository from day one.** `pnpm` workspace + TypeScript strict mode. Two contributors use separate branches/worktrees, NOT separate repos. A shared root `pnpm-lock.yaml` is maintained through normal PR merges.
2. **Follow folder ownership.** Agent owner: `apps/web`, `apps/agent-gateway`, `apps/provider-agent`, `packages/agents`, `packages/discovery`, `packages/negotiation`, `packages/event-store`. CRE owner: `workflows/cre`, `packages/cre-adapter`, `tests/cre`. Shared types: `packages/contracts` with jointly reviewed breaking changes.
3. **Freeze integration contracts first.** Both tracks import Zod schemas and TypeScript types from `@data-leases/contracts`. No duplicate `VerificationRequest`/`VerificationResult` definitions. Shared contract edits require both contributors' review.
4. **Real A2A, real separation.** Buyer and provider are separate HTTP services/processes, using the official `@a2a-js/sdk` (pin working version). Advertise an agent card and use supported A2A messages/tasks; do not label two local function calls “agent-to-agent communication.”
5. **Deterministic economics.** Negotiation is a bounded state machine. Optional LLM suggestions NEVER authorize spending, choose unrestricted URLs, alter budget rules, or bypass verification. Use integer minor units for money; never floating-point monetary arithmetic.
6. **Parquet is an immutable analytical artifact, not a transactional database.** Record every discovery, A2A turn, quote, decision, error and response as typed events in partitioned Parquet files; use SQLite (local dev) or a durable DB for event IDs, active state, crash-safe buffering and deduplication. A Parquet file is sealed on close; don't reopen an existing file to append rows.
7. **Honest evidence states.** `MOCK`, `SIMULATED_CRE`, `CRE_CLI_SIMULATION`, and `LIVE_CRE` are not interchangeable. A paid HTTP 402 response is not proof that the answer was correct. Never show `verified` without matching supported evidence.
8. **Security defaults.** No private keys, bearer tokens, passwords, wallet mnemonics, session secrets, or raw private buyer prompts in browser, Parquet, Arkiv, or git. Validate agent-card destinations; protect from SSRF and prompt injection; require explicit local-dev allowlists for loopback URLs. Paid requests are disabled until an explicit signed spending policy and payment adapter exist.
9. **Do not hallucinate SDK calls.** Check installed SDK types and official docs before implementing A2A or CRE method signatures. CRE local simulation is not decentralized DON execution. CRE deployment may need approval.
10. **One runnable vertical slice beats scaffolding.** Every PR should include executable behavior, a test, and a truthful README command.

## Repository layout (create only paths needed by the current sprint)

```text
data-leases/
├── CLAUDE.md                    # this document (auto-loaded by Claude Code)
├── SKILLS.md                    # work split + shared protocol/schema
├── specs.md                     # full product roadmap, context—not all in current scope
├── pnpm-workspace.yaml
├── package.json                 # dev, build, test, lint, typecheck, demo scripts
├── .env.example                 # no secrets
├── apps/
│   ├── web/                     # Next.js minimal discovery/negotiation console (Member A)
│   ├── agent-gateway/           # HTTP API + buyer agent + SSE event stream (Member A)
│   └── provider-agent/          # separately running A2A seller with published card (Member A)
├── packages/
│   ├── contracts/               # shared Zod schemas, types, fixtures (joint review)
│   ├── agents/                  # buyer agent and A2A transport (Member A)
│   ├── discovery/               # direct/local/Arkiv adapter boundary (Member A)
│   ├── negotiation/             # finite state machine and price policy (Member A)
│   ├── event-store/             # SQLite event index + Parquet export (Member A)
│   └── cre-adapter/             # VerificationClient & CRE runner bridge (Member B)
├── workflows/cre/
│   └── verify-answer/          # CRE project, workflow, config + simulations (Member B)
├── tests/
│   ├── integration/            # buyer↔provider and verifier adapter integration
│   └── cre/                    # CRE checks, fixtures, negative-path cases
├── data/parquet/                # local generated event dataset, gitignored
├── docs/
│   ├── INTEGRATION_CONTRACT.md  # actual types/message envelopes and ownership
│   └── CRE_HANDOFF.md          # Member B discovery notes and reproducible CLI evidence
└── .claude/skills/
    ├── agent-negotiation/SKILL.md
    └── cre-verifier/SKILL.md
```

## Contributor workflow

- **Member A (agents/UI/Parquet)**: work on `feat/agent-marketplace`; follow `.claude/skills/agent-negotiation/SKILL.md`.
- **Member B (CRE)**: work on `feat/cre-verifier`; follow `.claude/skills/cre-verifier/SKILL.md`.
- **Shared setup PR**: land root scripts, empty workspace skeleton, `packages/contracts`, `docs/INTEGRATION_CONTRACT.md`, and deterministic fixtures **before** independently integrating the tracks. Member A can bootstrap this PR; Member B reviews and accepts contract v1.
- Work simultaneously from this same Git repository. Each member may use `git worktree add ../data-leases-cre feat/cre-verifier` (or separate clones), but both merge PRs into `main`.
- Do not have both contributors change the same package or create incompatible package managers. PR to shared types requires cross-review, a version bump, and fixture updates.
- `main` is protected by convention: PR, typecheck, unit tests, integration tests. Keep `pnpm-lock.yaml` changes in one PR at a time or coordinate rebases.

## Current sprint: exact acceptance criteria

**Member A** must demonstrate: choose a discovery mode on a small dashboard; discover ≥2 independently addressable A2A provider agents; retrieve agent cards; negotiate with propose/counter/accept/reject and bounded price rules; stream a readable transcript to the UI; write the structured transcript and provider response to valid, queryable Parquet files; restart without duplicate event IDs; show failures without fake success.

**Member B** must demonstrate: one legitimate CRE TypeScript workflow; a **successful local CRE CLI simulation** reading a real supported EVM source and calling an external HTTP endpoint; deterministic accepted + rejected/inconclusive fixtures; an adapter implementing shared `VerificationClient`; a saved redacted simulation transcript; and a runnable mock adapter so Member A remains unblocked.

**Integration** must demonstrate: negotiated `AnswerEnvelope` → `VerificationRequest` → adapter → `VerificationResult` → event stream/Parquet → UI status. Until actual CLI run, the UI must say `MOCK`. A real x402 transfer is an explicitly separate later milestone.

## Preferred technical defaults

- Node >=20.20.2, pnpm pinned via `packageManager` (choose and pin at bootstrap), TypeScript strict, Zod, Vitest, ESLint.
- Next.js App Router for UI, Hono for long-running Node API/provider service, SSE for live transcript. Avoid using serverless hosting for local Parquet persistence.
- Official `@a2a-js/sdk` v1 compatible binding; use Agent Card at `/.well-known/agent-card.json`, agent-scoped protocol extensions as **structured DataParts**, and version-negotiated metadata. Do not invent a nonstandard JSON-RPC envelope then claim it is A2A.
- Parquet writer: `@dsnp/parquetjs` (verify installed Node and library version), immutable partitioned output, one writer owner; DuckDB or Parquet reader smoke test. SQLite for local durable event index; no credentials in files.
- CRE TypeScript SDK/CLI from `docs.chain.link/cre`; follow current workflow configuration and simulation docs, not guessed code snippets.
- Arkiv offers and Hedera x402 are **future adapters**. Define clear interfaces but do not block the sprint on sponsor keys or testnet funds.

## Required root commands (wire them as implementations land)

```bash
pnpm install
pnpm dev                  # web + gateway + two provider agents; CRE optional
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm parquet:inspect      # reads actual generated .parquet files
pnpm cre:simulate         # instructions or wrapper for member B's real CLI simulation
```

Never claim a command works until it actually works. If a sponsor CLI requires login/secrets, document the requirement and keep local mock tests runnable without it.

## Hard boundaries between agents and verification

- Agent negotiates `QuestionSpec`, `OfferTerms`, price and source requirements. CRE **does not** negotiate or authorize payment.
- CRE evaluates a delivered `AnswerEnvelope` against its stated method/policy. It may return `ACCEPTED`, `REJECTED`, or `INCONCLUSIVE`; never `true` without check details.
- `runId` is the end-to-end correlation/idempotency key. `negotiationId` tracks A2A turns. `verificationId` tracks CRE attempts. Preserve all three in every artifact.
- Agent owner supplies a stable, read-only, mockable HTTP endpoint that CRE may fetch in simulation. CRE owner does not alter the agent transport.
- CRE owner implements the adapter, not the dashboard or persistent Parquet writer. Agent owner consumes the interface, not Chainlink SDK internal types.
- Provider response can exist before CRE verification and remain visible as **unverified**. A failed CRE run must not erase the original provider reply.

## Working style for all coding agents

1. Read `specs.md` relevant sections, `SKILLS.md`, your member's skill, and `docs/INTEGRATION_CONTRACT.md`.
2. State the intended file ownership, contract changes, implementation steps and tests before large edits.
3. Build one testable slice, inspect errors, fix rather than leaving pseudocode.
4. Never silently broaden scope or add new sponsor products.
5. Commit meaningful increments; provide exact commands and paths in the PR description.
6. Flag unknown SDK/chain details instead of inventing them. Show the source URL or code type that confirms a claim.

## Official references

- Product spec: `./specs.md`
- A2A v1 spec: https://a2a-protocol.org/latest/specification/
- Official A2A JS SDK: https://github.com/a2aproject/a2a-js
- CRE overview: https://docs.chain.link/cre/overview
- CRE getting started: https://docs.chain.link/cre/getting-started/overview
- Parquet Node writer: https://www.npmjs.com/package/@dsnp/parquetjs
- ETHGlobal Mumbai sponsor requirements: https://ethglobal.com/events/mumbai/prizes
