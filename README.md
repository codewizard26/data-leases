# Data Leases

Rent the answer. Not the team.

This first implementation slice includes shared Zod contracts, two independently running A2A providers, local discovery, and a buyer that negotiates over HTTP using the official `@a2a-js/sdk` 1.3.0 (A2A 1.0). Optional 0G inference uses a replaceable server-only adapter.

## Run

Use Node 22 or later and pnpm 10.28.1.

```sh
pnpm install
pnpm demo:a2a
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

`demo:a2a` starts providers on `127.0.0.1:4101` and `:4102`, runs a separate buyer process, prints discovered cards and actual negotiation messages, then stops all three processes. Keep those ports available. Provider A asks 500 minor units, accepts a counteroffer of 350; Provider B has a floor of 400 and rejects the buyer's 350 cap. `demo:USD6` has six decimal places. Prices are exact integer strings compared with BigInt; no funds move.

For manual operation, run two terminals:

```sh
PORT=4101 PROVIDER_ID=provider-a ASK_MINOR=500 FLOOR_MINOR=300 pnpm dev:provider
PORT=4102 PROVIDER_ID=provider-b ASK_MINOR=700 FLOOR_MINOR=400 pnpm dev:provider
```

Then run `pnpm demo:buyer`. Cards are at `/.well-known/agent-card.json`; the JSON-RPC endpoint is `/a2a`. Negotiation is application-specific structured A2A data, not a new native protocol method. Responses are A2A Messages; this slice does not create long-running Tasks.

## Compute

See [0G setup](docs/COMPUTE.md). Default `COMPUTE_PROVIDER=mock` runs without credentials. With server environment variables configured, `COMPUTE_PROVIDER=0g pnpm demo:a2a` makes one optional advisory request after negotiation. Generated text does not choose destinations, prices, or verification outcomes. Copy `.env.example` to `.env` if useful, then load variables into your shell; commands do not automatically load `.env`.

A future Claude implementation plugs into `ComputeAdapter.generate` without changing A2A transport or deterministic budget enforcement. Claude calls are not implemented yet. 0G live inference requires provider credentials and a funded testnet account; no live request has been validated here.

## Status and boundaries

All providers are `DEMO_UNTRUSTED`. Current output proves transport and negotiation only. Mock answer delivery and a local development console are available. SSE, durable events, Parquet writing, CRE execution, payments, and Arkiv integration remain pending. Transcripts are in memory/stdout and disappear on restart. Provider state also resets on restart. The local provider has no authentication; it binds only to loopback and is not ready for public hosting.

Contracts and fixtures are proposed v1 and still need both contributors' review. Read [CLAUDE.md](CLAUDE.md), [SKILLS.md](SKILLS.md), [AGENTS.md](AGENTS.md), and [integration contract](docs/INTEGRATION_CONTRACT.md) before expanding the implementation. CRE-owned paths remain separate.

## Browser test console

Configure OpenRouter in ignored `.env` as described in [compute setup](docs/COMPUTE.md), then run:

```sh
pnpm dev
```

Open `http://127.0.0.1:3000` for the product landing page and brief plan. Select **Try the agent demo** or visit `http://127.0.0.1:3000/demo`. The local console provides negotiation transcripts and a separate AI prompt panel. Provider processes run on 4101 and 4102. This is a lightweight development console, not the planned Next.js dashboard. SSE, persistence, live data, and verification remain pending.

## Mock use cases and communication walkthrough

The console follows the navy/amber visual direction in `specs.md` and exposes three question templates:

- Aave V3 USDC available liquidity: synthetic 1,250,000 USDC, encoded as raw six-decimal units.
- Aave V3 USDC utilization: synthetic 67.5%, encoded as 6,750 basis points.
- DAO treasury risk snapshot: illustrative synthetic score 32/100, extending the treasury-monitoring persona; no validated financial methodology.

Select a template, set a price ceiling, and choose **Discover & negotiate**. At 350 minor units Provider A counters and agrees; Provider B rejects. At 250 neither delivers an answer. At 700 both agree. Inspect either provider's recorded exchange and raw data parts. Accepted terms return a second structured A2A data part containing a correlated `AnswerEnvelope`; the browser displays it as **MOCK / delivered unverified**. No contract address, chain block, signature, payment receipt or CRE proof is fabricated.

The browser shows completed HTTP exchanges, not a live SSE stream. AI explanations are optional and separate from price decisions. **Use current run as context** prepares a summary prompt; sending it requires a separate click.

## CRE branch review

The teammate CRE branch was reviewed without merging. See [integration review](docs/CRE_REVIEW.md) for verified checks, contract reconciliation, supported metric limits, and remaining fixes.
