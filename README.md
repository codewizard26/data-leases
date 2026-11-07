# Data Leases

**Rent the answer. Not the team.**

Select one or more public measurements, compare providers, choose one agent, and set a spending limit. Each time you request the selected bundle, your buyer agent confirms a fixed itemized quote and pays the selected provider through x402 on Hedera testnet. You can inspect the answer, payment and source checks together.

Example: you want to know how much USDC liquidity is available on Aave. Instead of building a pipeline or buying an entire data subscription, choose a provider and request that measurement when you need it.

## Start locally

Use Node 22.13 or later and pnpm 10.28.1.

```sh
pnpm install
cp .env.example .env
# Configure the required services in your local .env.
pnpm dev
```

Keep API keys and wallet secrets in the ignored `.env`; never commit them. `pnpm dev` loads this file automatically. Other commands may need environment variables supplied separately.

- Landing page: http://localhost:3001
- Dashboard: http://localhost:3001/dashboard
- Gateway API: http://127.0.0.1:3000
- Six separate provider services: ports 4101–4106
- Older diagnostic console: http://localhost:3001/developer

Check **Connections** before attempting a purchase. Payments require a funded buyer account, configured merchant recipients and an active spending mandate. CRE CLI simulation requires its local runtime and authentication. Arkiv discovery/publication requires configured access and publisher settings. See [payment setup](docs/PAYMENTS.md), [provider setup](docs/PROVIDER_DIVERSITY.md), [compute setup](docs/COMPUTE.md) and [CRE setup](docs/CRE_HANDOFF.md).

## Complete buyer workflow

### 1. Select measurements

Select a service in the dashboard, then check only the measurements you need, such as **Aave USDC available liquidity** or **Aave USDC supply APY**. Review what it returns, its units and its source requirements.

**Use case:** a protocol analyst needs a current reserve measurement rather than a general chatbot response. Start with a supported public read; private or subjective services without a real source cannot produce independently accepted evidence.

### 2. Compare agents

Open **Compare agents** to inspect fixed bundle totals and provider details. Six local provider profiles offer different task-specific tariffs:

| Provider | Port | Pricing style | USDC liquidity starting ask | USDC supply APY starting ask |
| --- | --- | --- | ---: | ---: |
| Scout | 4101 | Flexible | 500 | 850 |
| Atlas | 4102 | Balanced | 700 | 600 |
| Sage | 4103 | Firm | 950 | 800 |
| Quill | 4104 | Flexible | 650 | 550 |
| Beacon | 4105 | Firm | 1,100 | 1,000 |
| Meridian | 4106 | Balanced | 800 | 650 |

Checkboxes select the measurements in your bundle. The total is the sum of the selected item prices. One request makes one x402 payment to one provider; each measurement retains its own verification result. Changing the selection requires selecting a provider and a matching mandate again.

Amounts are **tinybars**, the smallest HBAR unit. One HBAR equals 100,000,000 tinybars. These are illustrative configured tariffs, not model API costs or guarantees of quality. The fixed quote confirms the selected items, their prices, total, recipient and expiry. No bargaining or inference is required. The style column describes legacy agent profiles, not a price negotiation in this flow.

Arkiv supplies published offers. Local drafts remain clearly labeled and cannot be selected for a paid mandate. An operator can explicitly publish eligible configured offers for the selected service from **Connections**. A provider needs a configured merchant recipient before it can sell; an unconfigured provider stays quote-only.

**Use case:** Scout has the lowest listed liquidity ask in these defaults, while Quill has the lowest APY ask. Compare prices for the actual task rather than assuming one agent is always cheapest.

### 3. Select one provider and set a mandate

Choose an eligible published provider, then open **Mandate**. Set:

- **Per-request cap:** the most one selected bundle may cost.
- **Total budget:** the most all requests under this mandate may consume.
- **Expiry:** when authorization ends.
- **Freshness:** how recent the source must be.

Save the mandate. If World approval is enabled, complete the required authorization. The mandate pins the selected provider; another agent cannot silently replace it.

**Saving a mandate starts no work and makes no payment.** Opening the dashboard or changing services also starts no new source read or model inference. Reading existing metadata and history is separate from purchasing an answer.

**Use case:** permit Scout to charge at most 500 tinybars per request and 1,000 total, until an expiry you choose. Repeated purchases share that total budget.

### 4. Request an answer

Click **Request selected answers · pay with x402**. This starts one explicit run. The buyer confirms a fixed quote through the provider’s HTTP pricing API, reserves the complete bundle amount and requests preparation. No model negotiates a discount. Then one x402 payment unlocks the selected answers.

If the fixed total exceeds your limits, a selected item is unavailable, or published rates no longer match, the purchase does not proceed. Model suggestions cannot raise your budget, bypass the provider allowlist or authorize unrestricted spending.

**Use case:** an analyst requests a fresh snapshot before a report. A second snapshot requires another explicit request. New mandates have no automatic schedule; previously authorized recurring leases retain their existing scheduling policy.

### 5. Pay through Hedera x402

After agreement, the provider returns HTTP **402 Payment Required** with the amount, recipient and payment terms. The buyer validates them, signs a Hedera payment payload and sends it back. The facilitator verifies and settles the transfer. The provider returns the answer and payment receipt.

The implementation uses the `@x402/hedera` exact-payment scheme with **native HBAR on Hedera testnet**. A durable payment journal guards against duplicate payments for the same run. An uncertain settlement requires reconciliation rather than an automatic new payment.

**Use case:** the consumer agent pays a small amount for each requested answer without a separate manual checkout each time, within the mandate already authorized.

A previously recorded payment of **500 tinybars** was independently confirmed as `SUCCESS` through Hedera's mirror node: [HashScan transaction](https://hashscan.io/testnet/transaction/0.0.9185802%401794003997.250574098). Its public-safe record is in [connected-run.json](arkiv/evidence/connected-run.json). This is evidence of that historical run, not proof that every provider or service has been purchased successfully.

### 6. Check the answer with CRE

Each answer in the bundle includes its measurement and relevant source information. For supported public reads, the gateway submits it to the local **Chainlink CRE CLI simulation**. The workflow checks policy requirements and compares independent EVM and HTTP reference observations.

- **Accepted:** every required check passed.
- **Rejected:** a required check failed.
- **Inconclusive:** evidence was unavailable, unsupported or incomplete.

Accepted Aave results include the source-contract check required for Arkiv receipt publication. A failed check must not be hidden or converted into a success.

**Use case:** distinguish a provider's claimed liquidity value from a value whose supported source checks actually passed. CRE evaluates the answer; it does not negotiate or authorize spending.

**CRE CLI simulation is not a live DON execution.** Mock tests are labeled separately. Payment settlement also does not establish answer correctness or trigger an automatic refund.

### 7. Inspect Arkiv records and service history

Each eligible accepted measurement can publish its own public-safe evidence receipt to Arkiv. All receipts share one run and one payment reference for the full bundle total; they are not separate charges. Open **Service history** to inspect published offers, verification metadata and payment references with explorer links. Private paid answers are not automatically republished as public values.

Arkiv publication has its own status. If it fails, the application retains the answer, payment and verification outcome; a publication retry must not create another purchase.

**Use case:** compare published providers and inspect previous service records without relying only on the current browser session.

### 8. Request again, or stop

Reuse the saved mandate for another explicit request. Each request uses the selected provider and consumes the available budget according to its payment outcome. Review remaining budget and request history. Cancel the mandate when finished; expiry or exhausted budget also blocks further spending.

**Use case:** take several measurements during a review session without repeatedly setting payment permissions, while retaining a hard total spending limit.

## What each component does

| Component | Simple job | Example use case |
| --- | --- | --- |
| Dashboard | Choose services, compare agents, set limits and inspect results | An analyst requests an Aave snapshot |
| Buyer agent and gateway | Coordinate fixed quotes, authorization and delivery | Buy from the selected provider within a saved mandate |
| Provider agents | Quote prices and deliver a supported answer | Offer selected public measurements at different fixed rates |
| A2A | Retain structured agent communication for legacy negotiation tools | Inspect older quote exchanges; the new bundle flow uses fixed HTTP pricing endpoints |
| Claude / OpenRouter / optional 0G | Supply configured model inference for agent decisions or supported computation | Suggest a price action, subject to deterministic guards |
| Hedera + x402 | Settle each authorized answer purchase | Transfer the agreed HBAR amount to the merchant |
| Chainlink CRE CLI | Check supported answers against reference evidence | Reject a mismatching value or mark missing evidence inconclusive |
| Arkiv | Store and query public offers and eligible evidence records | Compare providers and browse service history |
| SQLite + Parquet | Keep durable operational state and inspectable event history | Recover run state and inspect recorded agent exchanges |
| Optional World approval | Gate buyer authorization when enabled | Require the configured identity approval before a mandate becomes usable |

Different models or prices do not establish independent data ownership or better accuracy. Agents reading the same public chain still share that underlying source. Keys stay server-side; models cannot override payment or verification rules.

For direct Claude inference, set `ANTHROPIC_API_KEY` in the ignored `.env`. Provider-specific backend and model overrides are described in [provider diversity](docs/PROVIDER_DIVERSITY.md). Never put API keys in browser code.

## How to test

Start with **Aave USDC available liquidity**, choose a published provider and authorize a small testnet mandate. For Scout's default ask, 500 tinybars per request and 1,000 total permit at most two single-item purchases. Adding measurements increases the bundle total.

1. Save the mandate and confirm no run or payment starts.
2. Request one answer. Inspect the itemized quote, payment, answers and each verification separately.
3. Check any eligible Arkiv receipt and **Service history** entry.
4. Request again with the same mandate; verify the same provider and reduced remaining budget.
5. Cancel the mandate and confirm a further request cannot spend.
6. Try an insufficient price ceiling, expired mandate and unavailable source. Expect explicit failure or inconclusive evidence, never fabricated success.
7. Check duplicate-run protection, restart persistence and mobile readability using the [full testing workflow](docs/TESTING_WORKFLOW.md).

Run automated checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

Run a separate real CRE CLI simulation for one public service:

```sh
pnpm cre:simulate:services AAVE_V3_USDC_AVAILABLE_LIQUIDITY
```

This needs a configured CLI/runtime and reachable sources. Automated fixtures do not prove live settlement, real model inference or onchain publication. Generated local artifacts belong under ignored `data/tmp`, not Git.

For a standalone negotiation-only demonstration, use `pnpm demo:a2a`. This uses separate local buyer/provider processes and demo pricing; it is not evidence of an HBAR payment.

The current checkbox bundle flow supports public read measurements. Existing computation, negotiation and scheduled-lease APIs remain available for older integrations; they are not silently converted into new bundles.

## Current limits and further reading

This is a local testnet prototype. Buyer keys are held server-side, and mandate limits are enforced by the application rather than an onchain spending contract. Paid resource URLs are restricted to local provider endpoints. Public deployment needs additional operational and security work. No mainnet payment, live DON verification, guaranteed refund or validated investment advice is implied.

Supported public read plans can fetch real chain data. Private and subjective services without implemented sources remain unsupported or inconclusive; catalog availability alone does not establish a real data integration. Historical results do not verify a new request.

Shared contracts remain subject to both contributors' review before freezing. Contributors should read [CLAUDE.md](CLAUDE.md), [SKILLS.md](SKILLS.md), [AGENTS.md](AGENTS.md) and the [integration contract](docs/INTEGRATION_CONTRACT.md).

Additional implementation references: [verification and Arkiv](docs/VERIFICATION_ARKIV.md), [service catalog](docs/SERVICE_CATALOG.md), [CRE handoff](docs/CRE_HANDOFF.md), [AI negotiation](docs/AI_NEGOTIATION.md), [existing recurring leases](docs/RECURRING_LEASES.md), and [developer handoff](docs/DEVELOPER1_IMPLEMENTATION.md). Some older handoff documents describe earlier milestones; the workflow above describes the current dashboard.
