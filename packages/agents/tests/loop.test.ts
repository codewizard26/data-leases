import { describe, expect, test } from 'vitest';
import { Message, Role } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import type { NegotiationMessage } from '@data-leases/contracts';
import * as agents from '../src/index.js';
const modelSeller: agents.NegotiationStrategy = {async buyer(){throw new Error('unused');},async seller(input){return {action:'PROPOSE',priceMinor:input.kind === 'initial' ? input.askMinor : input.incomingPriceMinor!,reason:'Offer within seller range.',provider:'OPENROUTER',model:'test-seller'};}};
describe('buyer/provider A2A loop', () => {
 test('negotiates a counteroffer over real HTTP and never exceeds budget', async () => {
  expect(agents.startProvider).toBeTypeOf('function');
  const provider = await agents.startProvider({ port: 0, providerId: 'provider-a', askMinor: '500', floorMinor: '300' });
  try {
   const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'provider-a', maxPriceMinor: '350' });
   expect(result.status).toBe('AGREED');
   expect(result.priceMinor).toBe('350');
   expect(result.transcript.map(turn => turn.action)).toEqual(['REQUEST_FOR_QUOTE','PROPOSE','COUNTER','PROPOSE','ACCEPT','ACCEPT']);
   expect(result.transcript.every(turn => turn.runId === result.runId)).toBe(true);
  } finally { await provider.close(); }
 });
 test('rejects a seller floor above budget', async () => {
  const provider = await agents.startProvider({ port: 0, providerId: 'provider-b', askMinor: '500', floorMinor: '400' });
  try { expect((await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'provider-b', maxPriceMinor: '350' })).status).toBe('REJECTED'); }
  finally { await provider.close(); }
 });
});
test('expired buyer policy sends no negotiation messages', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'expired', askMinor: '100', floorMinor: '50' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'expired', maxPriceMinor: '100', deadlineAt: '2020-01-01T00:00:00Z' });
  expect(result.status).toBe('EXPIRED');
  expect(result.transcript).toEqual([]);
 } finally { await provider.close(); }
});
test('buyer rejects nonlocal destinations before fetching', async () => {
 await expect(agents.negotiate({ baseUrl: 'https://example.com', providerId: 'external', maxPriceMinor: '1' })).rejects.toThrow('ONLY_EXPLICIT_LOCAL_PROVIDER_SUPPORTED');
});
test('preserves integer prices beyond JavaScript safe integer range', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'large', askMinor: '9007199254740993999', floorMinor: '9007199254740993000' });
 try {
  const result = await agents.negotiate({ baseUrl: provider.baseUrl, providerId: 'large', maxPriceMinor: '9007199254740993123' });
  expect(result.status).toBe('AGREED');
  expect(result.priceMinor).toBe('9007199254740993123');
 } finally { await provider.close(); }
});
test('occupied provider port rejects with EADDRINUSE rather than address TypeError', async () => {
 const provider = await agents.startProvider({ port: 0, providerId: 'occupied', askMinor: '100', floorMinor: '50' });
 try {
  const port = Number(new URL(provider.baseUrl).port);
  await expect(agents.startProvider({ port, providerId: 'conflict', askMinor: '100', floorMinor: '50' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
 } finally { await provider.close(); }
});

test('model strategies choose both prices and publish bound public decisions over A2A', async () => {
 const seller = { async buyer() { throw new Error('unused'); }, async seller(input: {kind: string; incomingPriceMinor?: string}) { return {action:'PROPOSE' as const, priceMinor: input.kind === 'initial' ? '480' : input.incomingPriceMinor!, reason:'Offer fits seller range.', provider:'OPENROUTER' as const, model:'seller-model'}; } };
 const buyer = { async seller() { throw new Error('unused'); }, async buyer(input: {quoteMinor:string}) { return input.quoteMinor === '480' ? {action:'COUNTER' as const, priceMinor:'330', reason:'Offer a lower price.', provider:'OPENROUTER' as const, model:'buyer-model'} : {action:'ACCEPT' as const, priceMinor:input.quoteMinor, reason:'Price fits buyer budget.', provider:'OPENROUTER' as const, model:'buyer-model'}; } };
 const provider = await agents.startProvider({port:0, providerId:'ai-seller', askMinor:'500', floorMinor:'300', strategy:seller});
 try {
  const result = await agents.negotiate({baseUrl:provider.baseUrl, providerId:'ai-seller', maxPriceMinor:'350', strategy:buyer});
  expect(result.status).toBe('AGREED');
  expect(result.priceMinor).toBe('330');
  expect(result.decisions.map(decision => [decision.actorRole, decision.action, decision.priceMinor])).toEqual([['PROVIDER_AGENT','PROPOSE','480'], ['BUYER_AGENT','COUNTER','330'], ['PROVIDER_AGENT','PROPOSE','330'], ['BUYER_AGENT','ACCEPT','330']]);
  expect(result.decisions.every(decision => result.transcript.some(turn => turn.messageId === decision.messageId && turn.action === decision.action))).toBe(true);
  expect(result.decisions.every(decision => decision.provider === 'OPENROUTER')).toBe(true);
 } finally { await provider.close(); }
});
test('buyer model rejection reaches the provider without delivering an answer', async () => {
 const strategy = {async buyer() { return {action:'REJECT' as const, reason:'Decline this offer.', provider:'OPENROUTER' as const, model:'test'}; }, async seller() {throw new Error('unused');}};
 const provider = await agents.startProvider({port:0,providerId:'rejection',strategy:modelSeller,askMinor:'100',floorMinor:'50'});
 try {
  const result = await agents.negotiate({baseUrl:provider.baseUrl,providerId:'rejection',maxPriceMinor:'100',strategy});
  expect(result.status).toBe('REJECTED');
  expect(result.transcript.map(turn => turn.action)).toEqual(['REQUEST_FOR_QUOTE','PROPOSE','REJECT','REJECT']);
  expect(result.answer).toBeUndefined();
 } finally {await provider.close();}
});
test('model failure never silently falls back to deterministic negotiation', async () => {
 const strategy = {async buyer(): Promise<never> {throw new Error('MODEL_UNAVAILABLE');},async seller(): Promise<never> {throw new Error('MODEL_UNAVAILABLE');}};
 const provider = await agents.startProvider({port:0,providerId:'failure',strategy:modelSeller,askMinor:'100',floorMinor:'50'});
 try {await expect(agents.negotiate({baseUrl:provider.baseUrl,providerId:'failure',maxPriceMinor:'100',strategy})).rejects.toThrow('MODEL_UNAVAILABLE');}
 finally {await provider.close();}
});
test('transport independently rejects an injected buyer decision exceeding its cap', async () => {
 const strategy = {async buyer() {return {action:'ACCEPT' as const,priceMinor:'500',reason:'Accept.',provider:'OPENROUTER' as const,model:'test'};},async seller():Promise<never>{throw new Error('unused');}};
 const provider = await agents.startProvider({port:0,providerId:'guard',strategy:modelSeller,askMinor:'500',floorMinor:'300'});
 try {await expect(agents.negotiate({baseUrl:provider.baseUrl,providerId:'guard',maxPriceMinor:'350',strategy})).rejects.toThrow('INVALID_BUYER_DECISION');}
 finally {await provider.close();}
});
test('transport rejects a counteroffer that does not improve the quoted price', async () => {
 const strategy = {async buyer(){return {action:'COUNTER' as const,priceMinor:'100',reason:'Counter.',provider:'OPENROUTER' as const,model:'test'};},async seller():Promise<never>{throw new Error('unused');}};
 const provider = await agents.startProvider({port:0,providerId:'counter-guard',strategy:modelSeller,askMinor:'100',floorMinor:'50'});
 try {await expect(agents.negotiate({baseUrl:provider.baseUrl,providerId:'counter-guard',maxPriceMinor:'150',strategy})).rejects.toThrow('INVALID_BUYER_DECISION');}
 finally {await provider.close();}
});
test('transport rejects MOCK provenance in an injected model strategy', async () => {
 const strategy = {async buyer(){return {action:'ACCEPT',priceMinor:'100',reason:'Accept.',provider:'MOCK',model:'test'};},async seller():Promise<never>{throw new Error('unused');}} as unknown as agents.NegotiationStrategy;
 const provider = await agents.startProvider({port:0,providerId:'mock-guard',strategy:modelSeller,askMinor:'100',floorMinor:'50'});
 try {await expect(agents.negotiate({baseUrl:provider.baseUrl,providerId:'mock-guard',maxPriceMinor:'150',strategy})).rejects.toThrow('INVALID_AI_DECISION_METADATA');}
 finally {await provider.close();}
});
test('one model-capable provider serves per-run MOCK without calling either model', async () => {
 let calls = 0;
 const strategy = {async buyer(){calls++;return {action:'ACCEPT' as const,priceMinor:'100',reason:'Accept.',provider:'OPENROUTER' as const,model:'test'};},async seller(){calls++;return {action:'PROPOSE' as const,priceMinor:'100',reason:'Offer.',provider:'OPENROUTER' as const,model:'test'};}};
 const provider = await agents.startProvider({port:0,providerId:'dual-mode',askMinor:'100',floorMinor:'50',strategy});
 try {
  const mock = await agents.negotiate({baseUrl:provider.baseUrl,providerId:'dual-mode',maxPriceMinor:'100',strategy,mode:'MOCK'});
  expect(mock.status).toBe('AGREED'); expect(mock.mode).toBe('MOCK'); expect(mock.decisions).toEqual([]); expect(calls).toBe(0);
  const live = await agents.negotiate({baseUrl:provider.baseUrl,providerId:'dual-mode',maxPriceMinor:'100',strategy,mode:'LIVE'});
  expect(live.status).toBe('AGREED'); expect(live.mode).toBe('LIVE'); expect(live.decisions).toHaveLength(2); expect(calls).toBe(2);
 } finally {await provider.close();}
});
test('LIVE mode cannot silently fall back when buyer strategy is missing', async () => {
 await expect(agents.negotiate({baseUrl:'http://127.0.0.1:1',providerId:'none',maxPriceMinor:'100',mode:'LIVE'})).rejects.toThrow('LIVE_STRATEGY_REQUIRED');
});

test('provider rejects a mid-negotiation mode switch without erasing the original quote', async () => {
 let calls = 0;
 const strategy = {async buyer():Promise<never>{throw new Error('unused');},async seller(){calls++;return {action:'PROPOSE' as const,priceMinor:'100',reason:'Offer.',provider:'OPENROUTER' as const,model:'test'};}};
 const provider = await agents.startProvider({port:0,providerId:'mode-bound',askMinor:'100',floorMinor:'50',strategy});
 try {
  const client = await new ClientFactory().createFromUrl(provider.baseUrl);
  const initial: NegotiationMessage = {schemaVersion:'1.0.0',sessionId:'s-mode',negotiationId:'n-mode',runId:'r-mode',messageId:'first',action:'REQUEST_FOR_QUOTE',fromAgentId:'buyer',toAgentId:'mode-bound',round:1,questionTemplateId:'ETHEREUM_LENDING_LIQUIDITY',evidencePolicyId:'demo-policy-v1',maxAgeSeconds:60,currency:'demo:USD6',expiresAt:new Date(Date.now()+20_000).toISOString()};
  async function send(input:NegotiationMessage, mode:'MOCK'|'LIVE') {
   const result = await client.sendMessage({tenant:'',configuration:undefined,metadata:{'data-leases.negotiationMode':mode},message:Message.fromJSON({messageId:crypto.randomUUID(),role:Role.ROLE_USER,parts:[{data:input,mediaType:agents.NEGOTIATION_MEDIA_TYPE}]})});
   if(!('parts' in result)||result.parts[0]?.content?.$case!=='data')throw new Error('missing response');
   return result.parts[0].content.value as NegotiationMessage;
  }
  const quote = await send(initial,'MOCK');
  const acceptance:NegotiationMessage = {...quote,fromAgentId:'buyer',toAgentId:'mode-bound',round:2,action:'ACCEPT'};
  const switched = await send(acceptance,'LIVE');
  expect(switched.action).toBe('REJECT'); expect(switched.reasonCode).toBe('NEGOTIATION_MODE_MISMATCH');
  expect((await send(acceptance,'MOCK')).action).toBe('ACCEPT'); expect(calls).toBe(0);
 } finally {await provider.close();}
});
