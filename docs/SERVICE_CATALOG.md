# Specific service catalog

The dashboard sells one specified metric or computation per request. It does not sell access to an entire API, and it offers no write operation. There are 25 active services: the original four data services and one AI service, plus 20 new fixtures. The old write template remains retired only for interpreting historical records.

## Access and delivery

- Public source: a clearly labeled illustrative format is visible for free. Payment purchases the scoped result, freshness and execution work; it does not make public blockchain data proprietary.
- Private fixture: metadata only before settlement. The paid result is available in the local buyer run. Analytical events redact private values; public receipts contain hashes and safe metadata only.
- Each data request includes one metric. The AI service includes one explanation of at most 120 words. No whole dataset or permanent provider API access is included.
- All 20 added tasks use fabricated numeric fixtures. No private company/account dataset is connected. The existing LINK service alone can read Ethereum and receive the implemented independent CRE check. Other metrics stay unsupported/inconclusive, never falsely accepted.
- This is a single-operator localhost sandbox. A production private service still needs identity, entitlement and dataset-owner authorization; payment alone is not access authorization.

## Twenty added services

Provider A starts at 500 tinybars times the service multiplier; provider B starts at 700 times it. Negotiation floors use each provider’s own configured base floor. Per-service operator overrides take precedence. These are testnet service rates, not market valuations.

| Service | Access | Provider A initial tinybars | Provider B initial tinybars |
| --- | --- | ---: | ---: |
| Aave V3 · USDC supply APY | PUBLIC | 500 | 700 |
| Aave V3 · USDC variable borrow APY | PUBLIC | 500 | 700 |
| Aave V3 · USDC total variable debt | PUBLIC | 1000 | 1400 |
| Aave V3 · USDC liquidation threshold | PUBLIC | 500 | 700 |
| Aave V3 · USDC loan-to-value limit | PUBLIC | 500 | 700 |
| Aave V3 · WETH available liquidity | PUBLIC | 1000 | 1400 |
| Aave V3 · WETH reserve utilization | PUBLIC | 1000 | 1400 |
| USDC token · ERC-20 decimals | PUBLIC | 500 | 700 |
| WETH token · ERC-20 decimals | PUBLIC | 500 | 700 |
| Chainlink · ETH/USD feed decimals | PUBLIC | 1500 | 2100 |
| Private Aave position · health factor | PRIVATE | 2000 | 2800 |
| Private Aave position · collateral value | PRIVATE | 2000 | 2800 |
| Private Aave position · debt value | PRIVATE | 2000 | 2800 |
| Private Aave position · liquidation buffer | PRIVATE | 2500 | 3500 |
| Private treasury · USDC balance | PRIVATE | 2000 | 2800 |
| Private treasury · cash runway | PRIVATE | 3000 | 4200 |
| Private treasury · 30-day outflows | PRIVATE | 3000 | 4200 |
| Private portfolio · largest asset weight | PRIVATE | 2500 | 3500 |
| Private portfolio · stress-loss estimate | PRIVATE | 4000 | 5600 |
| Private portfolio · counterparty exposure | PRIVATE | 3500 | 4900 |

## Try it

Run `pnpm dev`, open http://localhost:3001/dashboard, choose Data services, then filter by access and family. Selecting a service sets a suggested budget and freshness; you can edit both. Compare prices creates real A2A quotes and Parquet history without accepting or paying. Authorize one run only when you want to buy that result. Recurring authorization repeats the selected service within one total spending cap.

Use Connected agents for all local fixtures. Arkiv discovery lists only offers that have actually been published; it does not invent registry listings for the new fixtures. Private fixture values never appear in `/api/templates`, unpaid A2A delivery, Parquet events or licensed public receipts. Buyer-local SQLite retains the purchased result; no automatic deletion schedule is claimed.

Observed validation: all 20 new services returned `QUOTES_READY` through the actual dashboard proxy and two local A2A providers. Every run retained `DISABLED_PREVIEW`; no payments were submitted during this catalog check. Private disclosure tests additionally exercise paid delivery with an explicitly injected test payment, Parquet redaction, history redaction and prevention of licensed public value publication. Those test injections are not live settlement evidence. The separate real connected LINK run is documented in `VERIFICATION_ARKIV.md`.
