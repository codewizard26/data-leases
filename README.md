# Data Leases

Developer 1 updates: [setup and limits](docs/PAYMENTS.md), [audit and Developer 2 handoff](docs/DEVELOPER1_IMPLEMENTATION.md). `pnpm dev` starts the Next.js dashboard on3001 and existing gateway/tools on3000.

Rent the answer. Not the team.

## World Agent Pass buyer workspace

The dashboard's **Account** view supports World sign-in, owned leases, committed spending, and exact policy approval review. The backend uses OIDC authorization code flow with S256 PKCE, discovery, RS256 signature validation, issuer/audience/nonce checks, fresh authentication, and server-side flow binding. Sandbox identities are test identities; they do not establish production proof of humanity.

Register a client using the [official Agent Pass OIDC guide](https://auth.world.org/docs/guides/oidc). Set `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_ISSUER`, and the exact registered `WORLD_REDIRECT_URI` in your private environment. Set `WORLD_AUTH_ENABLED=true`. For loopback development only, explicitly set `WORLD_ALLOW_LOCAL_HTTP=true` and use `http://127.0.0.1:3001/api/auth/world/callback`. Use the same browser hostname throughout. Production requires HTTPS and secure cookies. Restart `pnpm dev`, open `/dashboard`, then choose **Account** and sign in.

Enabled mode protects lease and run reads, mutations, event streams, and Parquet history with buyer ownership checks. Session tokens are opaque, hashed in private SQLite storage, expiring, revocable, and carried in HttpOnly cookies. Authenticated mutations require CSRF tokens. Existing unowned demo resources are not adopted by a newly signed-in buyer. Legacy direct checkout is disabled in protected mode; paid execution uses an owned lease.

Authorizing a lease first creates a pending approval without enabling payment. Review its exact terms in Account, confirm, and complete fresh World authentication. Only the verified callback can atomically activate or revise the policy. Denial, expired approvals, altered bindings, replay, and stale revisions cannot increase authority. Lowering limits, pausing, and cancelling require the owner session without another World flow. Scheduled runs retain durable policy authorization after browser logout; logout closes interactive access. Settled and unresolved payment commitments remain counted after revisions.

`WORLD_AUTH_ENABLED=false` without World credentials preserves the existing **unsecured local demo**. It is not a private buyer workspace. Registering credentials also enables protection. Never expose the local demo as a private service. Authentication and approval tests use signed synthetic OIDC fixtures; a real registered-client browser journey and sponsor submission evidence remain pending. Buyer schemas remain proposed pending contributor signoff.

This first implementation slice includes shared Zod contracts, two independently running A2A providers, local discovery, and a buyer that negotiates over HTTP using the official `@a2a-js/sdk` 1.3.0 (A2A 1.0). Optional 0G inference uses a replaceable server-only adapter.

## Run

Use Node 22.13 or later and pnpm 10.28.1.

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

All providers are `DEMO_UNTRUSTED`. Current output proves transport and negotiation only. Mock answer delivery and a local development console are available. The Next.js console adds SSE, durable SQLite events, immutable Parquet, bounded leases and Hedera x402 integration. CRE uses the existing simulation adapter. Actual Arkiv integration is supplied by Developer 2. Live Hedera settlement still requires configured, explicitly authorized spending and has not been demonstrated by offline tests. Provider state also resets on restart. The local provider has no authentication; it binds only to loopback and is not ready for public hosting.

Contracts and fixtures are proposed v1 and still need both contributors' review. Read [CLAUDE.md](CLAUDE.md), [SKILLS.md](SKILLS.md), [AGENTS.md](AGENTS.md), and [integration contract](docs/INTEGRATION_CONTRACT.md) before expanding the implementation. CRE-owned paths remain separate.

## Browser test console

Configure OpenRouter in ignored `.env` as described in [compute setup](docs/COMPUTE.md), then run:

```sh
pnpm dev
```

Open `http://127.0.0.1:3001` for the landing page, then **Open dashboard** at `/dashboard`. Choose a utility card, select a task and spending limit, compare agent prices, then **Authorize & run once**. The limit is visible beside the action; no separate lease screen is needed. About is at `/about`, and the older diagnostic console is under `/developer`, on the same browser address. Port3000 also serves the landing page; old `/demo` links redirect to `/dashboard`. Provider processes run on4101/4102. See [payment and lease setup](docs/PAYMENTS.md).

## Mock use cases and communication walkthrough

The console follows the navy/amber visual direction in `specs.md` and exposes three question templates:

- Aave V3 USDC available liquidity: synthetic 1,250,000 USDC, encoded as raw six-decimal units.
- Aave V3 USDC utilization: synthetic 67.5%, encoded as 6,750 basis points.
- DAO treasury risk snapshot: illustrative synthetic score 32/100, extending the treasury-monitoring persona; no validated financial methodology.

Select a template, set a price ceiling, and choose **Discover & negotiate**. At 350 minor units Provider A counters and agrees; Provider B rejects. At 250 neither delivers an answer. At 700 both agree. Inspect either provider's recorded exchange and raw data parts. Accepted terms return a second structured A2A data part containing a correlated `AnswerEnvelope`; the browser displays it as **MOCK / delivered unverified**. No contract address, chain block, signature, payment receipt or CRE proof is fabricated.

The browser shows completed HTTP exchanges, not a live SSE stream. AI explanations are optional and separate from price decisions. **Use current run as context** prepares a summary prompt; sending it requires a separate click.

## CRE branch review

The teammate CRE branch was reviewed without merging. See [integration review](docs/CRE_REVIEW.md) for verified checks, contract reconciliation, supported metric limits, and remaining fixes.

## LINK decimals and CRE integration

The fourth question card negotiates LINK token decimals (`ERC20_TOKEN_METADATA`, `link-decimals-v1`). The synthetic answer is 18 decimal places and identifies the LINK contract, without fabricating a block reference. Gateway verification uses the shared `MockVerificationClient`; missing independent evidence returns `MOCK / INCONCLUSIVE`. Unsupported Aave/treasury methods also remain inconclusive. Expand the receipt to inspect individual checks.

All teammate CRE workflow, tooling and saved simulation evidence are included. See [CRE handoff](docs/CRE_HANDOFF.md) for Bun/CLI installation, authentication and fresh simulation reproduction. Recorded CLI results are historical evidence, not verification of a fresh buyer run.

## Model-driven price negotiation

Configure a real compute provider, run `pnpm dev`, and select **Live mode** in the workspace. **Mock mode** is the default and makes no negotiation inference calls. Buyer and seller use separate model prompts in separate processes to propose price actions; integer-budget, seller-floor, round and deadline guards remain authoritative. Model failures do not silently fall back to scripted agreement. The receipt identifies actual model decisions and public explanations by message ID.

Each negotiation can make multiple inference requests and consume the free provider quota. Only one negotiation run is accepted at a time. Financial metric answers remain synthetic and CRE checks remain explicitly MOCK unless supported execution evidence exists. See [AI negotiation](docs/AI_NEGOTIATION.md).

## Run CRE from the browser

Open the LINK decimals workspace and use **Run CRE simulation**. Choose a valid value, tampered value, or block mismatch. The backend prepares a fresh dedicated LINK verification job, invokes the authenticated local CRE CLI, validates its artifact, and returns only the public result. No CLI commands or credentials are required in the browser. One simulation runs at a time, with bounded execution and status polling.

This panel is separate from the selected negotiation mode and from its synthetic answer. Successful output is labeled `CRE_CLI_SIMULATION`, never DON deployment or fresh verification of an unrelated negotiation receipt. CRE CLI/Bun and local authentication must exist on the server.

Recurring execution: choose **Recurring lease** on `/dashboard` to set frequency, expiry, per-run cap and total budget. Discovered agents appear as compact cards. See [recurring lease behavior and safeguards](docs/RECURRING_LEASES.md). Schedules start only after explicit authorization.
