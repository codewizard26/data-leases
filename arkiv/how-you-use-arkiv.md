# How Data Leases uses Arkiv

`packages/arkiv` exposes the existing shared `ArkivClient` interface plus typed entity publication and query methods. It uses official SDK schema definitions, `createEntity`, owner-filtered queries and receipt reconciliation.

1. A provider offer is published with supported metrics, exact payment terms, an evidence policy and an endpoint reference.
2. A buyer discovers offers using metric, question template, currency, maximum price, freshness and expiration filters. The agent layer must still fetch and validate the live agent card.
3. The existing CRE adapter verifies an answer. Completed results are queued for publication without changing verification or payment state.
4. The outbox publishes a public verification record and hash-only answer receipt. A confirmed Hedera reference may be supplied separately by the payment owner.
5. Product queries find latest accepted answers, receipts by run, and provider history. The dashboard owner consumes those methods rather than querying network internals.

The journal stores the signed transaction before broadcast. An uncertain broadcast is reconciled by its original transaction hash and can rebroadcast the same signed transaction. It never replaces an uncertain transaction with a new charge-producing creation. Publication retries run independently of completed payment and verification state.

Run commands and exact application injection points are documented in [`docs/VERIFICATION_ARKIV.md`](../docs/VERIFICATION_ARKIV.md).
