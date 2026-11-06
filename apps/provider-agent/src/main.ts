import {readLinkSource} from './link-source.js';
import {resolve} from 'node:path';
import { startProvider, createComputeAdapter, AiNegotiationStrategy, PaymentJournal } from '@data-leases/agents';
let strategy: AiNegotiationStrategy | undefined;
if (['openrouter','0g'].includes(process.env.COMPUTE_PROVIDER ?? '')) {
  try { strategy = new AiNegotiationStrategy(createComputeAdapter()); } catch { console.warn('Live negotiation unavailable: compute configuration is incomplete. Mock mode remains available.'); }
}
const providerId=process.env.PROVIDER_ID??'provider-a';
const payTo=providerId==='provider-a'?process.env.HEDERA_PROVIDER_A_ACCOUNT_ID:process.env.HEDERA_PROVIDER_B_ACCOUNT_ID;
const journal=payTo&&/^0\.0\.[1-9][0-9]*$/.test(payTo)?new PaymentJournal(resolve('data/tmp/payments',providerId.replace(/[^a-z0-9_-]/gi,'_')+'.sqlite')):undefined;
const payment=journal&&payTo?{payTo,journal}:undefined;
const ratesJson=process.env[providerId==='provider-a'?'PROVIDER_A_UTILITY_RATES_JSON':'PROVIDER_B_UTILITY_RATES_JSON'];
const utilityRates=ratesJson?JSON.parse(ratesJson) as Record<string,{askMinor:string;floorMinor:string}>:undefined;
const provider = await startProvider({ strategy, payment, utilityRates,answerSource:process.env.PROVIDER_LINK_SOURCE_ENABLED==='true'?readLinkSource:undefined,compute:['openrouter','0g'].includes(process.env.COMPUTE_PROVIDER??'')?createComputeAdapter():undefined, port: Number(process.env.PORT ?? '4101'), providerId: process.env.PROVIDER_ID ?? 'provider-a', askMinor: process.env.ASK_MINOR ?? '500', floorMinor: process.env.FLOOR_MINOR ?? '300' });
console.log(`DEMO_UNTRUSTED provider ready: ${provider.baseUrl} · mock available · live=${Boolean(strategy)}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void provider.close().then(() => {journal?.close();process.exit(0)}); });
