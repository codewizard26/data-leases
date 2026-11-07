# Buyer workflow and testing

Run `pnpm install` and `pnpm dev` with your ignored local `.env` configured. Open http://localhost:3001. Inspect **Connections** for payment, CRE and Arkiv availability. Only publish configured merchant offers through the explicit operator action for the selected service.

1. Choose **Aave USDC available liquidity** and check the measurements needed. Try liquidity plus supply APY.
2. In **Compare agents**, review the itemized fixed totals and published versus draft labels. Choose one available Arkiv-listed provider. Six local profiles exist; profiles without merchant recipients cannot sell.
3. In **Mandate**, set a per-request ceiling, total cap, expiry and freshness requirement. Save the mandate. If World approval is enabled, complete its required authorization before proceeding.
4. Confirm saving created no new run or payment. Click **Request selected answers · pay with x402** once. Follow fixed-price confirmation and the single payment attempt.
5. Inspect each delivered answer and its independent CRE result and Arkiv publication separately. CRE uses local CLI simulation, not live DON execution. Only eligible accepted results can publish receipts.
6. Request another answer with the same mandate. Confirm the same provider is used and remaining budget decreases by settled spend. Inspect **Service history** for public records.

Start with small testnet caps: for Scout liquidity, 500 tinybars per request and 1,000 total permit at most two full-price purchases. Adding APY makes Scout’s configured bundle total 1,350 tinybars; raise the explicitly authorized cap if you want that bundle. One HBAR is 100,000,000 tinybars. Setting a cap does not guarantee an acceptable quote.

## Negative and recovery checks

- Below-total ceiling: the fixed bundle must fail without payment.
- Exhausted, expired or cancelled mandate: a new request must not spend.
- Change checkbox selection: verify itemized totals update and the old mandate no longer appears for the new selection.
- Duplicate run ID: retry must not create a second payment. Use a fresh run ID only for a deliberate new purchase.
- Quote-only draft: provider selection for a paid mandate remains unavailable.
- Unavailable RPC or verification source: show failure or inconclusive evidence; never claim verification or erase settled payment.
- Publication failure: retain answer, payment and verification, and report publication separately. Never pay again merely to retry publication.
- Restart: saved mandates and run history persist; opening a page starts no new purchase.
- Mobile: inspect landing, provider cards, mandate inputs and result views for readable text and horizontal overflow.

## Automated validation

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For a separate real CRE CLI simulation of one supported service:

```sh
pnpm cre:simulate:services AAVE_V3_USDC_AVAILABLE_LIQUIDITY
```

This requires the configured CRE CLI/runtime and reachable public sources. Local fixtures and automated tests do not prove live payment settlement, real inference or onchain publication. Preserve generated artifacts under ignored `data/tmp`; never commit credentials, private answers or generated datasets.

## Recorded live bundle smoke test

Run `333ceb95-c3dc-4d7c-9391-d4c0cf634f77` requested Scout's USDC available liquidity (500 tinybars) and supply APY (850 tinybars). One x402 transfer settled the 1,350 tinybar total; the mirror node returned `SUCCESS` with one buyer debit and merchant credit for that amount. Both measurements returned `CRE_CLI_SIMULATION / ACCEPTED` and published separate Arkiv answer receipts. The test mandate was cancelled after completion.

[Hedera transaction](https://hashscan.io/testnet/transaction/0.0.9185802%401794011948.801143632). This is historical test evidence, not proof of a fresh request or live DON execution.
