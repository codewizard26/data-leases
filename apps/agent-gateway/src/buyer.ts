import { createComputeAdapter, negotiate } from '@data-leases/agents';
import { LocalRegistryDiscovery } from '@data-leases/discovery';
const origins = ['http://127.0.0.1:4101', 'http://127.0.0.1:4102'];
const cards = origins.map(origin => `${origin}/.well-known/agent-card.json`);
const discovery = new LocalRegistryDiscovery(cards, { allowedCardUrls: cards, allowedEndpointUrls: origins.map(origin => `${origin}/a2a`) });
const providers = await discovery.discover({ schemaVersion: '1.0.0', sessionId: crypto.randomUUID(), mode: 'LOCAL_REGISTRY', questionTemplateId: 'ETHEREUM_LENDING_LIQUIDITY', maxPriceMinor: '350', currency: 'demo:USD6', maxAgeSeconds: 60, requestedAt: new Date().toISOString() });
console.log(JSON.stringify({ trust: 'DEMO_UNTRUSTED', providers }, null, 2));
for (const provider of providers) {
 const result = await negotiate({ baseUrl: new URL(provider.cardUrl).origin, providerId: provider.providerId, maxPriceMinor: '350' });
 console.log(JSON.stringify(result, null, 2));
}
if (process.env.COMPUTE_PROVIDER === '0g') {
 const advisory = await createComputeAdapter().generate({ messages: [{ role: 'user', content: 'Explain bounded negotiation in one sentence. Do not propose prices or endpoints.' }] });
 console.log(JSON.stringify({ advisoryOnly: true, ...advisory }));
}
