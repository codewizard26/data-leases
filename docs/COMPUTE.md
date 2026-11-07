# Compute adapters

`ComputeAdapter.generate` is the server-only boundary for optional text generation. The current implementations are `MockComputeAdapter` and `ZeroGComputeAdapter`. A future Claude adapter implements the same interface; selecting `claude` currently fails explicitly.

Generated text cannot select provider URLs, change budgets, authorize payments, or assert CRE verification. In AI negotiation mode, separate buyer and provider prompts propose structured price actions; deterministic guards validate each action before it becomes a protocol message. Do not persist raw prompts or credentials in conversation events.

## 0G Direct configuration

The implementation uses the [official 0G Direct HTTP API](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference), not the separate Router API. Configure the exact provider URL and model from the live provider catalog. Its base URL ends in `/v1/proxy`; the adapter posts to `/chat/completions` with a provider-scoped bearer token.

Use the 0G CLI outside this application to select testnet, fund the account with test tokens, and generate the provider secret:

```sh
0g-compute-cli setup-network
0g-compute-cli inference list-providers
0g-compute-cli inference get-secret --provider <PROVIDER_ADDRESS>
```

Account funding and provider acknowledgement are operator setup steps documented by 0G. The application never holds a wallet key, deposits funds, or enables automatic funding. Testnet does not imply unlimited inference: provider availability, balances, and pricing still apply.

Set these variables only on the server, for example in an ignored `.env` file loaded by your application:

```dotenv
COMPUTE_PROVIDER=0g
ZERO_G_BASE_URL=https://provider.example/v1/proxy
ZERO_G_MODEL=replace-with-provider-model
ZERO_G_API_KEY=replace-with-provider-secret
```

Use `createComputeAdapter(process.env)` for environment selection or inject an implementation directly. The default provider is `mock`; incomplete 0G configuration fails rather than silently falling back. No real 0G request has been tested without operator credentials.

The 0G adapter enforces HTTPS, disallows URL credentials and redirects, limits messages, caps output at 256 tokens, caps HTTP response data at 64 KiB, and applies a 15-second timeout. Error messages omit upstream response bodies and credentials. Responses are untrusted text; this adapter does not verify TEE signatures and never labels inference or answers verified.

Tests use an injected HTTP transport and require no tokens:

```sh
pnpm exec vitest run packages/agents/tests/compute.test.ts
```

## OpenRouter

Set `COMPUTE_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and optionally `OPENROUTER_MODEL` in the ignored root `.env`. The model defaults to `openrouter/free`; explicit models must end in `:free`. Paid models are rejected. Requests use the fixed OpenRouter endpoint with a 60-second timeout, a 1,024-token output cap, bounded response size, and sanitized errors. Free routing may select a different model for each request and remains subject to provider capacity and account quotas.

Run `pnpm dev` to load `.env` and start the local console at `http://127.0.0.1:3000` plus two provider processes. The AI panel submits prompts to OpenRouter. With Live mode selected, the negotiation panel uses separate buyer and provider model decisions over A2A. Deterministic mode remains available for offline tests. No secrets are sent to the browser. Only one AI request runs at a time; rate limits are reported without automatic retry loops.
