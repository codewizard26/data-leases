# Integration friction and limits

Observed during this implementation:

- The installed SDK is 1.0.1. Its typed schema columns needed explicit exported `Column`/`Schema` annotations to produce TypeScript declarations without leaking an internal type.
- Current SDK Rabdi uses chain ID 7794095. A wallet funded on another Arkiv testnet does not establish Rabdi funding. The selected wallet was funded on Rabdi before the recorded writes.
- Public RPC access can emit an access-key warning. `ARKIV_ACCESS_KEY` is optional configuration; no access key is embedded in source or evidence.
- Indexed timestamp values are encoded explicitly as SDK `u64` Unix milliseconds. Native entity expiration is configured separately.
- Local provider cards use loopback endpoints. Their offers explicitly carry `LOCAL_DEVELOPMENT`; network publication does not make those endpoints remotely reachable.
- The existing shared publication interface supplies a verification result but not the answer. The implementation resolves the registered request by verification ID, avoiding a competing answer schema or a breaking contract change.
- Local CRE CLI evidence is operator-trusted. No live DON report or onchain verification contract has been deployed by this task.

Known operational limits: one application publisher should own a journal; do not share a wallet concurrently across unrelated publishers. Keep the journal on durable storage. Query pages currently cap results at 100 and do not provide a historical pagination API. Expired entities are excluded from product queries. A public receipt does not establish payment settlement merely because it contains a supplied transaction reference.
