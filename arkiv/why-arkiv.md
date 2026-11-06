# Why Arkiv

Data Leases needs shared provider discovery and reusable evidence metadata, beyond one buyer's private execution log. Arkiv provides a queryable network layer for those public product records.

Provider offers can be filtered by metric, provider, price and expiry. Receipt queries expose an answer hash, source block references and a policy-labeled verification checklist without distributing the paid answer itself. The latest-answer query selects only accepted, fresh, unexpired results from trusted publishers. Rejected and inconclusive attempts remain independently inspectable and cannot replace that result.

The local Parquet store remains the gateway's private execution history. The Arkiv publication journal is only a durable outbox. Neither substitutes for network queries: the smoke command performs official SDK writes and reads the stored entities back from Rabdi.

This implementation does not claim Arkiv proves correctness, provider honesty, payment settlement or decentralized Chainlink execution. Those guarantees depend on the separately recorded verification policy, origin authentication and payment evidence.
