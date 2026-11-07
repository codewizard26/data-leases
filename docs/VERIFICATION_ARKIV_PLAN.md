# Verification and shared evidence implementation

Checkpoint: `feat/recurring-leases-checkpoint`, commit0cf964f. Verification work continues on `feat/verification-arkiv`; the existing agents, payment client, dashboard and Parquet writer remain owned by Member1.

Audit: existing CRE workflow reads Ethereum mainnet LINK decimals at an explicit source block and compares Uniswap's public token list. Local CLI simulations, not live DON reports, are already demonstrated. Shared VerificationClient uses submit/getResult. The v1 policy deliberately marks ambiguous block references and unsupported provider signatures inconclusive. The current adapter stores jobs in process memory and imports trusted operator CLI artifacts. No Arkiv package or SDK integration exists on any remote branch inspected.

Plan: preserve v1 and recorded evidence; add a v2 deterministic policy with trusted provider allowlists, source/header contradiction checks, evidence availability and domain-separated Ed25519 signatures where configured. Provide a durable CLI client implementing the existing shared interface with request/result idempotency and immutable correlation. Add a reusable Arkiv package using current official SDK1.0.1 and Rabdi. Public entities contain selected allowlisted fields, answer hashes by default, and explicitly licensed values only. Trusted publisher identity is checked on all product queries.

The existing shared interfaces can be reused by resolving verification IDs through the durable client. New Arkiv entity schemas live in the Arkiv package. No shared-contract edit is planned; any insufficiency must be documented before requesting a backward-compatible change.

Publication uses a SQLite outbox and captures signed transaction identity before broadcasting. Unknown broadcasts reconcile the same transaction rather than create duplicates. Rejected/inconclusive results may be recorded but cannot replace latest accepted values. Public queries filter owner, metric/provider, status, freshness and expiry. Publishing cannot change or erase a completed Hedera payment. Member1 injects the exported adapter; no agent framework, payment settlement, dashboard or Parquet implementation is rebuilt.

Validation: existing + v2 policy cases, signed/invalid inputs, durable callback deduplication, Arkiv SDK reads/writes, publication retries, latest-accepted selection and privacy projection tests. Capture actual CLI and Arkiv evidence only. Network failures/funding limits remain explicit; no fake entity IDs or transaction proofs.
