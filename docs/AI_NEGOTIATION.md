# Selectable MOCK and LIVE negotiation

Choose `MOCK` or `LIVE` for each negotiation run. `MOCK` is the default and makes no model calls. `LIVE` uses a real compute adapter for buyer and provider price decisions. This is separate from the optional “Ask the AI about the result” panel. Financial answers remain synthetic fixtures, and the verification adapter remains in `MOCK` mode for fresh demo runs. No funds move.

## Run locally

Keep credentials in the ignored root `.env` file. To make LIVE available, configure a supported real compute provider:

```dotenv
COMPUTE_PROVIDER=openrouter
OPENROUTER_MODEL=openrouter/free
OPENROUTER_API_KEY=replace-with-your-private-key
```

Then run:

```sh
pnpm dev
```

Open `http://127.0.0.1:3000/demo`, select a question, choose MOCK or LIVE, set a price ceiling, and start negotiation. The development launcher starts the buyer gateway and two independent provider HTTP services. Configuration is read at process startup; restart after changing `.env`.

The browser always starts in MOCK mode. No environment toggle is needed to select a run mode. LIVE is disabled when the server reports missing provider configuration. Switching modes does not relabel previous receipts: each result retains the mode used for that run. The selector is locked while a request is active.

MOCK uses deterministic price rules over real local A2A HTTP. The separate AI explanation panel is disabled in MOCK, so ordinary MOCK use makes no inference requests. LIVE uses real models for negotiation and enables the separate explanation request. Both modes deliver synthetic financial answers and use the same mock verification flow.

The request body carries `mode: "MOCK"` or `mode: "LIVE"`; omitted mode defaults to MOCK. The browser labels the selected mode and each completed run. Missing or failed inference in LIVE must stop the run rather than silently switch to MOCK. LIVE does not mean live market data, paid settlement, or live CRE verification.

## What the model decides

The model proposes a structured price action: propose, counter, accept, or reject as appropriate for its role and current turn. The buyer aims for acceptable terms within its cap. The provider negotiates within its configured asking price and floor. A particular budget does not guarantee that either provider will agree.

Server validation remains authoritative. Model text cannot change destinations, identity, question, evidence policy, deadline, accepted quote, or run binding. A model choice cannot exceed the buyer’s cap or bypass the provider’s floor. Protocol acknowledgments and validation steps do not require a model call.

## Read the transcript

The page shows the actual returned HTTP exchange after it finishes. It is not a simulated live chat. Each recorded model decision is matched to its A2A message ID and displays:

- Compute provider and model.
- Chosen action and price in the actual message.
- A short public decision summary.

These summaries are not private reasoning or chain of thought. Raw prompts, API keys, and upstream error bodies must not appear in the public transcript. Protocol steps without recorded model output are labeled accordingly. The run receipt retains the complete public-safe result.

## Timing and free-model limits

LIVE runs allow up to 180 seconds; each model request may take up to 60 seconds. A run can require several model calls across the buyer and two providers. Free models remain subject to quota, capacity, rate limits, and availability. Repeated runs consume additional requests. A timeout, invalid structured decision, or unavailable model can stop negotiation before agreement.

In LIVE mode, the separate explanation panel makes its own request only when clicked. It is disabled in MOCK mode. It does not continue a failed negotiation or authorize an answer. Do not put private information into that panel.

## Evidence stays separate

A real model call proves only that inference occurred. It does not make a mock metric live data or establish financial correctness. Fresh demo answers remain `UNTRUSTED_MOCK`, and mock evidence checks may return `INCONCLUSIVE`. Recorded CRE CLI artifacts are historical simulation evidence, separate from a fresh agent run; they are not live DON attestations.

The `ComputeAdapter` interface permits another backend, including a future Claude implementation, without replacing A2A transport or budget validation. Selecting an adapter is independent of the metric’s evidence state.

For repeatable development, the local setup pins `recursive/flint-v1.0:free`, whose catalog entry was confirmed zero-priced. Negotiation requests use JSON-object mode and exclude reasoning from the returned response. The general free router may select models with different response behavior; invalid or empty completions fail the run instead of triggering a scripted fallback.
