# Arkiv entity schemas

Implementation: `packages/arkiv/src/schemas.ts`. The package uses the official `@arkiv-network/sdk` 1.0.1 and the Rabdi testnet (chain ID 7794095). These are application schemas, not changes to the shared verification contracts.

All four schemas store an allowlisted JSON body in a bytes column. Indexed columns are `publication_id`, `provider_id`, `run_id`, `verification_id`, `question_template_id`, `metric`, `status`, `execution_mode`, `created_at`, and `expires_at`. Missing identifiers use empty indexed strings. Times in indexes are Unix milliseconds. The body includes schema version, publisher, creation time and expiration time. Queries compare indexed fields against the parsed body and reject mismatches.

| SDK schema | Public body |
| --- | --- |
| `data-leases.provider-offer.v1` | Offer/provider IDs, supported metrics, question template, integer price and asset decimals, Hedera testnet payee, evidence policy, card/A2A endpoints, status, reachability and expiry |
| `data-leases.answer-receipt.v1` | Run/provider IDs, answer hash, metric/unit, source chain/contract/block references, verification ID/status/mode, methodology, origin trust and expiry |
| `data-leases.verification-record.v1` | Correlation IDs, answer hash, check IDs/status/reason codes, artifact hashes, reference hashes, execution mode and verification timestamp |
| `data-leases.payment-reference.v1` | Run/provider IDs, confirmed Hedera testnet transaction ID, integer tinybar amount and public HashScan reference |

Entities use Arkiv's read-only creation flag and native expiration. Application queries also enforce expiration. Provider updates create new immutable offers. A stable publication ID is scoped to entity kind, logical identity and publisher. A conflicting payload for the same ID is rejected.

Answer values are absent by default. Publishing a value requires explicit redistribution permission and a public license reference. Raw prompts, signed payment payloads, private keys, tokens, raw CLI logs and arbitrary provider metadata are not accepted fields. Verification check observations are omitted from public records. Reference hashes identify reference strings; they are not hashes of independently downloaded response bodies. Artifact hashes identify the validated local simulation artifact.

The trusted publisher allowlist is part of server configuration. Owner filtering and body/owner binding prevent another wallet's entity from becoming an application-trusted receipt. An accepted record is still explicitly labeled `CRE_CLI_SIMULATION`; publication does not turn a local result into a decentralized report.

`AnswerReceipt.dataClassification` is an optional backward-compatible public/private marker. A `PRIVATE` receipt is rejected by schema validation if it contains a value, redistribution permission, license URL, or source fields beyond the public chain ID. The private evidence policy also prevents the publisher from accepting a value-redistribution override. Existing receipts without the marker remain readable.
