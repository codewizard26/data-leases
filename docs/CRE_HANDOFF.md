# CRE handoff — Member B

Implemented on 2026-11-06; authenticated simulations completed on 2026-11-07 (Asia/Kolkata).
**Real CRE CLI simulations now demonstrate ACCEPTED, REJECTED and INCONCLUSIVE outcomes.**
The workflow reads Ethereum state and independent HTTP metadata, and every recorded result
passes the shared schema and adapter import. These are local CLI simulations, not deployed
or DON-attested executions.

## Versions and evidence

| Component | Pinned / observed |
| --- | --- |
| CRE CLI | `v1.39.0` (official Linux amd64 binary, SHA-256 verified) |
| `@chainlink/cre-sdk` | `1.23.0` in the shared pnpm lockfile |
| SDK Javy plugin / Javy | `1.7.0` / `8.1.0` |
| Bun used by the SDK compiler and helper scripts | `1.3.10` (SDK requires >=1.2.21) |
| pnpm | repository pin `10.28.1` |
| EVM | Ethereum mainnet, `eip155:1`, selector name `ethereum-mainnet` |

Evidence files:

- `tests/cre/evidence/wasm-build.txt`: successful SDK WASM compilation.
- `tests/cre/evidence/source-probe.txt`: successful **direct, non-CRE** EVM + HTTP probes.
- `tests/cre/evidence/cli-auth-blocked.txt`: historical failed attempt, resolved by local login.
- `tests/cre/evidence/{accepted,rejected,inconclusive}.log`: successful normalized, sanitized CLI evidence.
- `tests/cre/evidence/{accepted,rejected,inconclusive}.artifact.json`: correlated requests, results and SHA-256 hashes; replayed through the adapter by tests.
- `tests/cre/fixtures/request.json`, `result-{accepted,rejected,inconclusive}.json`: fabricated **MOCK** fixtures only.

## Research and exact integration surface

Official references checked, and installed SDK declarations inspected:

- [CLI release](https://github.com/smartcontractkit/cre-cli/releases/tag/v1.39.0), [installation](https://docs.chain.link/cre/getting-started/cli-installation/macos-linux).
- [SDK source](https://github.com/smartcontractkit/cre-sdk-typescript), [EVM client](https://docs.chain.link/cre/reference/sdk/evm-client-ts), [HTTP client](https://docs.chain.link/cre/reference/sdk/http-client-ts).
- [HTTP trigger](https://docs.chain.link/cre/reference/sdk/triggers/http-trigger-ts), [workflow CLI](https://docs.chain.link/cre/reference/cli/workflow), [project configuration](https://docs.chain.link/cre/reference/project-configuration-ts).
- [Service quotas](https://docs.chain.link/cre/service-quotas), [supported networks](https://docs.chain.link/cre/supported-networks-ts).

SDK calls used: `Runner.newRunner`, `handler`, `HTTPCapability.trigger`, `decodeJson`,
`EVMClient.headerByNumber` / `callContract`, `blockNumber`, `encodeCallMsg`, `bytesToHex`,
`protoBigIntToBigint`, `HTTPClient.sendRequest` and `consensusIdenticalAggregation`.
`runtime.now()` provides execution time. All capability calls use `.result()`.
The workflow has an HTTP trigger; cron is supported by CRE but is not wired here because
each attempt needs a specific request. This is a triggered WASM workflow, not a Node backend function.

The CLI's `--help` confirms `--non-interactive`, `--trigger-index`, `--http-payload`, and
`--listen`. **Listener mode was not tested and is not offered by this adapter.**
No deployment, report signature, onchain write, fee estimate or DON consensus is demonstrated.

## Metric and independent sources

The intentionally small proof verifies **LINK ERC-20 decimals**, not Aave liquidity or prices.
This follows the skill's instruction to prove an objective fixed Ethereum read first.

- Question: `ERC20_TOKEN_METADATA`; metric: `ERC20_DECIMALS`; unit: `decimal-places`.
- Contract: `0x514910771AF9Ca656af840dff83E8264EcF986CA`, verified against [Chainlink's LINK contract directory](https://docs.chain.link/resources/link-token-contracts).
- ABI: `function decimals() external view returns (uint8)`; selector `0x313ce567`; decode a 32-byte ABI word as an unsigned integer. Source observation: `18`.
- HTTP reference: [Uniswap's Ethereum token list](https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/mainnet.json), selecting the entry by chain ID **and address**, never by symbol alone.
- Fixed methodology and policy IDs: `link-decimals-v1`, policy version `1.0.0`. Exact integer equality; nonzero tolerance and freshness policies exceeding one hour are unsupported.

`cre:prepare` selects a real finalized block. CRE reads its header, calls `decimals()` at
that explicit block, then re-reads the header to detect a remapped block. The answer's
block number/hash must match. Header, delivery and request timestamps must be within
the requested age (at most 3,600 seconds), measured against execution time.
Missing/mismatched block references prevent a value comparison and yield `INCONCLUSIVE`.
Unavailable EVM/HTTP reads also yield `INCONCLUSIVE`; comparable contradictions yield `REJECTED`.

Uniswap metadata is independently maintained public HTTP data, not provider identity
authentication or a cryptographic oracle. It has **no historical block semantics**.
Comparing its current metadata with a recent block is appropriate only for this fixed
decimals methodology. This design must not be generalized to dynamic prices/liquidity.
Provider signatures are unsupported and explicitly `UNKNOWN` if requested. Neither a
provider allowlist nor signature authentication is claimed by this metadata policy.

Destinations are fixed by code, never taken from provider evidence URLs. Inputs are bounded
to 32 KB. The HTTP source was about 129 KB at research time, below CRE's documented
250 KB response cap. The workflow logs only short status/digest markers to respect
the 1 KB log-line cap. Its authoritative callback return carries the complete result and
request digest. Repeated real runs showed that user-log chunks can be dropped at shutdown,
so ingestion does not rely on user logs.

## Reproduce

Install Node >=22, Bun >=1.2.21, the repository-pinned pnpm, and the official CLI v1.39.0.
For Linux amd64, the release asset is `cre_linux_amd64.tar.gz`; its published archive
SHA-256 is `e840ee945d3741fbc76a3cae73749bc9a1730cc58c6babc5e65c2567413c7af0`.
The CLI tested here is temporarily at `/tmp/data-leases-cre-cli/cre_v1.39.0_linux_amd64`.
Install `cre` on your PATH or set `CRE_BIN` to its absolute path for the wrapper.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @data-leases/cre-adapter test

# This compilation command succeeded without CRE authentication:
pnpm --filter @data-leases/cre-workflow exec cre-compile main.ts /tmp/data-leases-verify-answer.wasm

# Authenticate locally; never paste credentials into chat or git:
cre login

# Prepare real, fresh block references; this command succeeded:
pnpm cre:prepare

# All three commands succeeded with local CRE authentication:
pnpm cre:simulate
pnpm cre:simulate data/tmp/cre/tampered.json
pnpm cre:simulate data/tmp/cre/inconclusive.json
```

`CRE_API_KEY` is an officially supported noninteractive authentication alternative; keep
it in the local environment. No private key, paid transaction or provider secret is needed
by this workflow. CRE deployment is a separate, approval-gated milestone.

Equivalent direct command, from `workflows/cre`:

```bash
cre workflow simulate verify-answer --target local-simulation \
  --non-interactive --trigger-index 0 \
  --http-payload ../../data/tmp/cre/request.json
```

The CLI reads `project.yaml` and `verify-answer/workflow.yaml`; the workflow config is `{}`.
The HTTP trigger deliberately has no authorized keys for **local simulation only**.
A deployment would require authorized keys and separate operational work.

The wrapper checks CLI version, enforces a timeout/output bound, and requires exit code zero,
exactly one `✓ Workflow Simulation Result:` callback return, its embedded matching request
digest, and the actual `[SIMULATION] Execution finished signal received` line. It validates
the returned shared result before importing. The initially assumed workflow-telemetry
success marker was not emitted by these real runs and is no longer accepted as completion
evidence. The callback envelope is a CLI bridge format, not a new shared request/result schema.
It writes normalized, sanitized logs and artifacts under gitignored `data/tmp/cre`.
It discards arbitrary raw diagnostic logs to avoid saving credentials in RPC errors.
On failure it records only a safe failure code and exits nonzero. No success artifact is made.

## Member A integration

The shared package was empty at handoff time. `packages/contracts/src/verification.ts`
now contains a **proposed verification-only v1 baseline** matching the documented fields.
It has no agent schemas or transport changes. **Both contributors must review this addition
before freezing contracts.** This is not a claim of completed cross-review.

```ts
import { MockVerificationClient, CreSimulationVerificationClient } from '@data-leases/cre-adapter';
import type { VerificationClient } from '@data-leases/contracts';

const mock: VerificationClient = new MockVerificationClient();
await mock.submit(request); // COMPLETED; unavailable evidence => MOCK / INCONCLUSIVE
const result = await mock.getResult(request.verificationId);

const cli = new CreSimulationVerificationClient();
await cli.submit(request); // PENDING
// Operator loads the artifact JSON and associated normalized .log from the wrapper:
cli.importArtifact(artifact, transcript);
const simulated = await cli.getResult(request.verificationId);
```

Pass synthetic `VerificationEvidence` and a fixed clock to the mock constructor for
offline accepted/rejected fixtures. The result is always `MOCK`, even when accepted.
No mock observation is used by the actual workflow: it builds evidence from capabilities.

Simulation import is a **trusted local operator action**, not an authenticated public endpoint.
SHA-256 binds the whole request, including answer/session/negotiation/policy, to the
workflow log; another hash binds the normalized transcript. Hashes provide integrity and
correlation, **not authenticity**. A trusted operator could fabricate a transcript; this
adapter cannot establish DON execution. Only `CRE_CLI_SIMULATION` is accepted on this path;
signed report claims are rejected. The adapter validates IDs, required checks, status,
transcript correspondence and immutable completion. Identical retries reuse the job/result;
changed content under the same verification ID throws `VERIFICATION_ID_CONFLICT`.

Storage is process-local memory, not a durable queue. Persist/reload submitted requests and
artifacts in Member A's existing infrastructure if restart recovery is needed. A different
verification ID represents a new attempt. The gateway owns events/Parquet and consumes the
complete shared `VerificationResult`; the adapter writes no events or datasets.

## Recorded authenticated outcomes

All three simulations used Ethereum block `26357614`, hash
`0xbdfa29a990cca9cad1d00ce7670d40d2ddb59e2fda6eb92ed3cd9bb4697457c5`,
and fetched Uniswap metadata through the CRE HTTP capability. Observed decimals were `18`.
The adapter imported each artifact successfully, preserving the run/provider/verification IDs.

| Case | Verification ID | Result | Decisive check |
| --- | --- | --- | --- |
| Matching value `18` | `f02d7533-2801-4e6e-856a-9667042d6a6b` | `ACCEPTED` | All required checks `PASS` |
| Tampered value `19` | `89e7d94e-8cb3-4b8f-9281-47bd8973b427` | `REJECTED` | `ONCHAIN_REFERENCE_MATCH: FAIL`, `VALUE_MISMATCH` |
| All-zero claimed block hash | `6f32bbb8-6726-4561-9d2c-53a6d029098a` | `INCONCLUSIVE` | `SOURCE_BLOCK_REFERENCE_VALID: UNKNOWN`, `BLOCK_HASH_MISMATCH` |

The committed transcripts are normalized evidence, not verbatim raw CLI logs. They record
observed exit code, callback request digest and result, and completion. Artifact hashes bind
the normalized files. They contain no credentials or private keys. Original mock fixtures
remain explicitly `MOCK`. Replaying recorded artifacts in tests does not execute CRE again.

## Remaining integration work

The authenticated CLI simulation gate is satisfied. Both contributors still need to review
the proposed verification-only contract baseline before freezing it. Member A can then wire
`VerificationClient` into the existing gateway/event sink; no agent infrastructure was changed.
Existing lending-template answers will be rejected as an unsupported methodology until a
separately reviewed lending policy and its exact source calculations are implemented.
Listener mode, deployed DON execution, provider-signature verification and durable queue
storage remain outside this proof. Unavailable-reference handling is covered by deterministic
offline tests; the real third simulation demonstrates block ambiguity, not an induced outage.
