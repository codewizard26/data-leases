# CRE branch integration review

Reviewed `origin/feat/agent-cre` at `29301a5` against the agent marketplace implementation. The branch is a viable standalone proof of concept, but it is not ready to merge and verify the current Aave demo without reconciliation.

## Verified

An isolated checkout passed 36 tests, TypeScript checking, and ESLint. The workflow typechecks against pinned `@chainlink/cre-sdk` 1.23.0 and uses actual EVM and HTTP capabilities. It reads LINK token decimals at an explicit Ethereum block and compares independent Uniswap token-list metadata. Source destinations are fixed rather than provider-controlled.

The three recorded CLI simulation artifacts replay through the adapter, including with the current agent branch's shared validators. Their evidence mode remains `CRE_CLI_SIMULATION`; they are not DON-attested reports. This review did not independently run the CRE CLI or compile WASM because the local CRE/Bun tools were unavailable. Saved logs are normalized simulation artifacts, not cryptographic proof of execution.

## Findings

1. **Shared exports must be consolidated before merging.** `packages/contracts/src/index.ts:2` on the CRE branch exports verification schemas only. Preserve existing discovery, negotiation, and event exports and retain the current correlation/signature/accepted-result safeguards. Git's three-way preview identifies edits on both branches in root `package.json`, the contracts index, and `pnpm-lock.yaml`. Do not replace those files wholesale.
2. **Unsupported methods are marked rejected rather than inconclusive.** `packages/cre-adapter/src/policy.ts:47–54` creates failed checks for unsupported policy or methodology; line 83 converts any failure to `REJECTED`. Unsupported methods must produce `INCONCLUSIVE` so absence of support is distinguishable from a proven contradiction. Reproduced using an unsupported metric and policy.
3. **Artifact filenames permit directory traversal.** `packages/cre-adapter/scripts/simulate.ts:53–54` interpolates the request's unrestricted verification ID into `resolve()`. An ID such as `../../../name` escapes the artifact directory. Current preparation generates UUIDs and manual operation is trusted, but externally sourced jobs need safe identifiers or hashed filenames plus a containment check.

## Integration gaps

The implemented metric is `ERC20_TOKEN_METADATA` / `ERC20_DECIMALS` with `link-decimals-v1`. Our Aave and treasury demos use synthetic fixtures and `demo-policy-v1`. This narrow scope is appropriate for the CRE proof, but it cannot substantiate Aave liquidity or treasury verification. Add a dedicated LINK-metadata scenario for the first integration, or implement an independently sourced Aave method before displaying a verified Aave result.

Replacing the isolated branch's contracts entry point with our canonical current schemas results in 29 passing tests and 7 failures: malformed values, correlation mismatches, policy mismatch, and missing signed-provider signature now throw validation errors before evaluation. Keep the stronger validators and reconcile adapter error behavior/tests; do not weaken validation to make the old tests pass. All three recorded CLI artifacts still import under those validators.

## Recommended merge order

1. Consolidate shared contracts with both contributors and regenerate one workspace lockfile.
2. Fix unsupported-method semantics and artifact filename containment.
3. Reconcile malformed-input handling and run combined tests/typecheck/lint.
4. Integrate the adapter in the gateway for a supported metric, preserving run and verification IDs and explicit simulation labels.
5. Run a fresh authenticated CLI simulation locally and preserve redacted evidence before claiming a current successful simulation.

No teammate branch files were modified or merged during this review.
