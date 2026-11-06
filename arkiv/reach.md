# Observed reach and reproducibility

No user adoption, production traffic, grant eligibility or sponsor acceptance is claimed here. These files document the implemented integration; current Mumbai submission requirements still need organizer confirmation before submission.

At `2026-11-06T22:07:13.926Z`, the Rabdi smoke run published and read back two independent local provider offers using wallet `0xfAD2ebea1Ee7AB11ECCB803f1372e288705638c0`:

| Provider | Entity key | Transaction hash |
| --- | --- | --- |
| provider-a | `0x76cff9bb6d804e755cce7ba1faa962b3ffd52e4d24e7716b51d51d3e58dbd214` | `0x36a6846f5c34540a31bca9d076cacc94d1c01383ac160cb11bdd767119a1f964` |
| provider-b | `0x7e41fae37be9ea7ff759da776c3cc4cf7b955faf9933ce7c58f5839997055372` | `0x0f621153ba9eb04d674fa6654e49e9fd5e07e6c8cb3229439d073a0f2a231679` |

The read-back query returned both entity keys and provider IDs. Offers were built from the actual local agent cards and quote endpoint, not invented network providers. They expire after one day and advertise local development reachability. They may therefore no longer appear when this document is read.

Evidence source during execution: ignored local `data/tmp/arkiv/offers-evidence.json`. Reproduce a read using the documented smoke command; do not claim an expired offer is still discoverable without another network query. No Hedera settlement was performed to produce this offer evidence.

A subsequent accepted CRE CLI artifact publication also completed and was read back:

| Entity | Entity key | Transaction hash |
| --- | --- | --- |
| VerificationRecord | `0x3d5f4a6ccc50cef829b71e5d92cde27ea4f605465d08aad97721efde1802485b` | `0xb6e502f63d8e2b154dcbddcdff74e0d7af8ba4c4c180c1833b361b0850ef197e` |
| AnswerReceipt | `0xa8c3923a58f092148a5bf7e9d63724c2d88afe21c263993f19110515df7dc809` | `0x0723ab3212a7d8b4c1db085093a8ebb08e29d5c83ec570448f9cc16922605c36` |

The latest-accepted query returned that AnswerReceipt entity. The public answer value was absent. This proves publication and query read-back of a local CLI verification result, not a live decentralized CRE report or a paid answer delivery.

The subsequent rejected and inconclusive runs were also published and read back. All eight entity IDs and transaction hashes are preserved in [`evidence/publication-readback.json`](evidence/publication-readback.json). The latest accepted answer stayed `0xa8c3923a58f092148a5bf7e9d63724c2d88afe21c263993f19110515df7dc809` after both publications.
