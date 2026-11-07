# Verification and shared evidence integration

This work connects the dashboard and gateway to the shared evidence layer and reuses `workflows/cre/verify-answer/main.ts`, the existing shared contracts and the existing gateway injection boundary. It does not rebuild A2A, payment settlement, the dashboard or Parquet persistence.

## CRE audit

| Question | Implementation |
| --- | --- |
| Blockchain | Ethereum mainnet, `eip155:1`, configured public RPC |
| Objective metric | LINK ERC-20 `decimals()` at `0x514910771af9ca656af840dff83e8264ecf986ca`; expected value 18 |
| External source | Uniswap default token list, `src/tokens/mainnet.json` from its GitHub repository |
| Compared values | Schema/correlation, chain/contract, source block/header, age, integer unit/decimals, onchain value and independent token-list value |
| Submission | Existing `VerificationClient.submit(VerificationRequest)`; asynchronous `getResult(verificationId)` |
| Execution | Actual local CRE CLI simulation with EVM and HTTP reads; explicitly `CRE_CLI_SIMULATION` |
| Not demonstrated | Live DON deployment, DON-signed report, or verification of arbitrary lending/AI metrics |

The v1 policy remains available. `link-decimals-v2` adds an operator-configured provider allowlist, required-evidence checks, explicit contradictory canonical block rejection and optional domain-separated Ed25519 origin signatures. Missing references cannot produce acceptance. The demo v2 configuration allows unsigned providers and is not cryptographic provider authentication. Signature mode requires trusted provider public keys configured by the operator.

The durable client stores immutable requests and completed results under `data/tmp/verification`. It correlates verification ID, run ID, provider ID and request digest. The existing artifact validator binds the request and transcript. A CLI runtime failure remains a failed/pending execution with no invented verification result. An unavailable independent reference produces `INCONCLUSIVE` when the workflow itself completes.

## Run the three scenarios

Requirements: Node compatible with the root engine, pnpm, Bun, installed authenticated CRE CLI and network access to Ethereum RPC/Uniswap. Run from repository root. Optional `CRE_BIN` and `BUN_BIN` select installed executables.

```bash
pnpm --filter @data-leases/cre-adapter exec bun scripts/prepare-v2.ts
CRE_TARGET=local-v2 pnpm cre:simulate data/tmp/cre/v2-request.json
CRE_TARGET=local-v2 pnpm cre:simulate data/tmp/cre/v2-tampered.json
CRE_TARGET=local-v2-unavailable pnpm cre:simulate data/tmp/cre/v2-unavailable.json
```

Expected policy outcomes are `ACCEPTED`, `REJECTED`, and `INCONCLUSIVE`. The unavailable target uses a fixed missing Uniswap resource to exercise external-source failure; the provider cannot select this URL. Run soon after preparation so freshness does not change the first scenario. A stale fixture is also generated as `v2-stale.json`.

Simulation writes a request-correlated `.artifact.json` and sanitized `.log` under ignored `data/tmp/cre`. These artifacts are local CLI evidence, not a decentralized oracle report. Only observed results should be copied into sponsor evidence.

## Arkiv setup

The official SDK is pinned to 1.0.1. Publication uses Rabdi chain ID 7794095. Configure a funded testnet wallet locally; never put a private key in the dashboard or repository. Existing wallet reuse is supported by naming its environment variable:

```dotenv
EVIDENCE_LAYER_ENABLED=true
PROVIDER_LINK_SOURCE_ENABLED=true
ARKIV_PRIVATE_KEY_ENV=ZERO_G_PRIVATE_KEY
ARKIV_PUBLISHER_ADDRESS=0xYourPublicWalletAddress
ARKIV_TRUSTED_PUBLISHERS=0xYourPublicWalletAddress
ARKIV_PUBLISHING_ENABLED=false
ARKIV_MAX_TRANSACTION_FEE_WEI=100000000000000000
ARKIV_MAX_TOTAL_FEE_WEI=500000000000000000
# ARKIV_ACCESS_KEY=
# ARKIV_JOURNAL_PATH=data/tmp/arkiv/publications.sqlite
# CRE_VERIFICATION_DIRECTORY=data/tmp/verification
```

The example fee caps are 0.1 tGLM per transaction and 0.5 tGLM total reserved maximum fees in this journal. They are Arkiv publication limits, separate from the buyer's Hedera lease budget. Keep the journal when restarting; deleting it discards idempotency and fee reservations. Enable publication explicitly only after configuring the intended testnet wallet.

```bash
node --env-file=.env --import tsx packages/arkiv/scripts/smoke.ts read
# Requires the existing gateway at 3000 and providers at 4101/4102:
node --env-file=.env --import tsx packages/arkiv/scripts/smoke.ts publish-offers
# Use paths printed by a completed CRE simulation:
node --env-file=.env --import tsx packages/arkiv/scripts/smoke.ts publish-verification <artifact.json> <log>
```

`publish-offers` makes real testnet writes and reads them back. `publish-verification` imports an already completed CLI proof, publishes a verification record and hash-only answer receipt, then queries latest accepted. It does not buy an answer or create a payment reference.

## Member 1 integration

Existing exact contracts remain `VerificationClient.submit/getResult` and `ArkivClient.publishVerifiedRun/getRunReceipts/findProviderOffers` from `@data-leases/contracts`. The gateway already accepts injected clients through `startGateway` in `apps/agent-gateway/src/server.ts`:

```ts
import {createEvidenceLayerFromEnv} from '@data-leases/arkiv';
import {startGateway} from './server.js';

const evidence = createEvidenceLayerFromEnv();
const gateway = await startGateway({
  verificationClient: evidence.verification,
  arkivClient: evidence.arkiv,
});
await evidence.rawVerification.resumePending();
evidence.start();
// During shutdown, drain the gateway before closing its dependencies:
await gateway.close();
await evidence.close();
```

The gateway startup now adds the workspace dependency and wires these adapters when `EVIDENCE_LAYER_ENABLED=true`. Without that flag, the original gateway behavior remains available. Shutdown drains the gateway before closing the evidence layer. The dashboard polls pending verification and exposes public receipt links. The decorator queues completed verification metadata; a separate publication worker retries the outbox. Failed publication does not erase a completed verification or Hedera payment. The gateway remains the sole Parquet writer.

`publishVerifiedRun` resolves the original registered request, checks run/provider/quote/result bindings, and accepts a confirmed Hedera reference supplied by the payment owner. It does not settle or independently reconcile Hedera payments. Never supply a synthetic transaction as a real settlement reference.

Additional typed methods are `publishProviderOffer`, `queryProviderOffers`, `publishVerificationRecord`, `publishAnswerReceipt`, `publishPaymentReference`, `queryLatestAcceptedAnswer`, `queryReceiptsByRunId`, and `queryProviderHistory`. Product queries filter trusted owner, metric/provider, status, freshness and expiration. Only supported accepted CLI results with all required checks passing can enter latest accepted selection. Rejected and inconclusive records are queryable but cannot replace an accepted answer.

## Privacy and trust assumptions

Arkiv is publicly readable. Answer values require explicit licensing; hashes and source references are published by default. Strict public schemas omit private prompts, signing material, raw logs and arbitrary observations. Publishers are trusted through a configured allowlist, not a global reputation claim. Local simulator artifacts are trusted operator input; their hashes establish local binding, not DON authenticity. RPC and external-source availability affect reproducibility. Entity expiration limits availability, and current queries cap each page at 100 results.

See [`arkiv/schema.md`](../arkiv/schema.md) for entity fields and [`arkiv/reach.md`](../arkiv/reach.md) for observed network IDs. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before submitting changes; successful execution must be recorded by the implementer rather than inferred from these instructions.

## Observed validation

The three recorded v2 simulations are in `tests/cre/evidence/v2/`: correct LINK decimals returned `ACCEPTED`, manipulated decimals returned `REJECTED`, and the unavailable external source returned `INCONCLUSIVE`. `tests/cre/recorded-v2.test.ts` re-imports their exact sanitized transcripts and checks correlation.

`arkiv/evidence/publication-readback.json` records eight actual Rabdi entities: two provider offers and verification/answer receipts for each of the three outcomes. Latest-accepted queries after rejected and inconclusive publication returned the original accepted receipt. No answer values or Hedera payment references were published in these unpaid proofs.

Official references: [Arkiv SDK quick start](https://docs.arkiv.network/start-here/first-entity/), [Rabdi network](https://docs.arkiv.network/), and [CRE execution overview](https://docs.chain.link/cre/overview).

Final local validation: `pnpm typecheck` passed, `pnpm lint` passed, and `pnpm test` passed all 221 tests across 24 files on 2026-11-07. Network evidence was captured separately through real CRE CLI simulations and Rabdi transactions.

## Connected application proof

With `EVIDENCE_LAYER_ENABLED=true` and `PROVIDER_LINK_SOURCE_ENABLED=true`, `pnpm dev` starts the connected application. The provider reads the fixed Ethereum LINK contract at a recent block before registering the x402-protected answer. It records the block number/hash and checks that the header did not change. It cannot select another contract or method from a buyer prompt. This read is unsigned provider evidence; CRE independently re-reads it. Other demo metrics are not upgraded to verified financial data.

Open `http://localhost:3001/dashboard`. Choose **Read data**, **LINK token**, and **Run once**. Compare prices, then authorize within your cap. Arkiv discovery is available under **More options**. Comparing prices never pays. Each authorized run retains separate payment, delivery, verification and publication statuses. Public LINK evidence is a disclosure above the task controls; it is separate from the buyer's current request.

Observed real connected run `93932ffa-0e92-4226-bfc6-a1ab348a08cc` used a single-run lease capped at 500 tinybars total. Hedera mirror returned `SUCCESS`; CRE returned `CRE_CLI_SIMULATION:ACCEPTED`; Arkiv returned a published receipt. Parquet read-back contained 15 real events. The public-safe proof is [`arkiv/evidence/connected-run.json`](../arkiv/evidence/connected-run.json). No paid answer contents are included in that proof.

`GET /api/integrations` returns public configuration status. `GET /api/evidence/latest` reads the latest accepted LINK receipt and its public checklist through the shared Arkiv package. Offer expiry controls discovery listing validity; requested answer freshness is enforced during negotiation and verification, rather than incorrectly treating an offer's publication age as the answer's age.
