import { startProvider } from '@data-leases/agents';
const provider = await startProvider({ port: Number(process.env.PORT ?? '4101'), providerId: process.env.PROVIDER_ID ?? 'provider-a', askMinor: process.env.ASK_MINOR ?? '500', floorMinor: process.env.FLOOR_MINOR ?? '300' });
console.log(`DEMO_UNTRUSTED provider ready: ${provider.baseUrl}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void provider.close().then(() => process.exit(0)); });
