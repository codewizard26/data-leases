# Provider diversity

`pnpm dev` runs Scout, Atlas, Sage, Quill, Beacon and Meridian as six separate A2A HTTP services. They use separate negotiation state, provider signing identities, rate tables and payment journals. The buyer compares eligible offers for the same task and chooses an acceptable negotiated price within its authorization.

Default local tariffs are illustrative seller settings, not model API costs, observed market prices or evidence of answer quality. One HBAR is 100,000,000 tinybars.

| Task | Scout :4101 | Atlas :4102 | Sage :4103 | Quill :4104 | Beacon :4105 | Meridian :4106 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| USDC available liquidity | 500 | 700 | 950 | 650 | 1,100 | 800 |
| USDC supply APY | 850 | 600 | 800 | 550 | 1,000 | 650 |
| LINK explanation | 1,400 | 1,000 | 1,800 | 1,200 | 2,200 | 900 |

Other tasks use each provider's base ask multiplied by that task's existing price multiplier. Floors remain private. Per-task overrides use `PROVIDER_A_UTILITY_RATES_JSON`, `PROVIDER_B_UTILITY_RATES_JSON`, and `PROVIDER_C_UTILITY_RATES_JSON`; each entry contains exact integer `askMinor` and `floorMinor` strings. Unknown services and invalid bounds fail startup.

Scout prefers an acceptable counteroffer, Atlas balances agreement with margin, and Sage prefers preserving margin. These instructions guide the configured model. Deterministic policy still rejects prices outside the bounds, limits rounds and prevents unauthorized spending.

## Configure different models

Keep the general buyer/agent backend in `COMPUTE_PROVIDER`. Each provider can override it with `PROVIDER_A_COMPUTE_PROVIDER`, `PROVIDER_B_COMPUTE_PROVIDER`, or `PROVIDER_C_COMPUTE_PROVIDER`. Supported backends are `openrouter`, `0g` and `claude`. Model overrides use the corresponding prefixed model variable, for example `PROVIDER_B_OPENROUTER_MODEL` or `PROVIDER_C_ANTHROPIC_MODEL`.

Place the Claude secret only in the ignored local `.env`:

```dotenv
ANTHROPIC_API_KEY=your_local_secret
ANTHROPIC_MODEL=claude-sonnet-5-5
COMPUTE_PROVIDER=openrouter
```

Sage selects Claude automatically when the Claude key exists, unless an explicit provider backend overrides that choice. Other providers keep their configured backends. Without a Claude key, Sage inherits the existing backend; the UI reports that actual configuration rather than pretending the model differs. An API configuration does not prove credentials, model availability or inference success. Actual A2A decision events retain the returned inference backend/model.

The direct adapter uses Anthropic's Messages API and JSON schema output for negotiation decisions. Truncated, refused, oversized and unavailable outputs fail closed. No API key is exposed through public profiles or logged events. [Messages API](https://platform.claude.com/docs/en/api/messages), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Compare and buy

Open the service's **Compare agents** tab. Arkiv supplies published offers; local drafts are labeled separately. Choose one eligible published provider, then set a reusable spending mandate with per-request and total caps and an expiry. Saving starts no work. **Request answer · pay with x402** starts one explicit purchase from that provider. Repeated requests share the mandate budget. Payment, verification and publication remain separate outcomes.

Every selling provider requires its configured `HEDERA_PROVIDER_X_ACCOUNT_ID`. Unconfigured providers stay quote-only; the application never silently reuses another merchant. Model variety and pricing do not establish independent data ownership or superior correctness.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

Integration tests start six separate HTTP providers, compare the same task's advertised and actual A2A asking rates, demonstrate a different cheapest provider for APY, and reject purchase acceptance without a merchant. Direct Claude transport tests use injected responses; they are not evidence of a real Anthropic inference call.

## On-demand requests

Opening the dashboard loads metadata and saved records, without starting source reads or inference. Each explicit answer request starts one run. New mandates have no schedule; previously authorized recurring leases retain their existing policy. See [testing workflow](TESTING_WORKFLOW.md).
