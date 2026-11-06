import { startProvider, createComputeAdapter, AiNegotiationStrategy } from '@data-leases/agents';
let strategy: AiNegotiationStrategy | undefined;
if (['openrouter','0g'].includes(process.env.COMPUTE_PROVIDER ?? '')) {
  try { strategy = new AiNegotiationStrategy(createComputeAdapter()); } catch { console.warn('Live negotiation unavailable: compute configuration is incomplete. Mock mode remains available.'); }
}
const provider = await startProvider({ strategy, port: Number(process.env.PORT ?? '4101'), providerId: process.env.PROVIDER_ID ?? 'provider-a', askMinor: process.env.ASK_MINOR ?? '500', floorMinor: process.env.FLOOR_MINOR ?? '300' });
console.log(`DEMO_UNTRUSTED provider ready: ${provider.baseUrl} · mock available · live=${Boolean(strategy)}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void provider.close().then(() => process.exit(0)); });
