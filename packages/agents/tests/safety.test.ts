import { afterEach, expect, test, vi } from 'vitest';
import { AgentCard, Message, Role } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import { negotiate, NEGOTIATION_MEDIA_TYPE, providerCard, startProvider, ANSWER_MEDIA_TYPE } from '../src/index.js';
import type { NegotiationMessage, AnswerEnvelope } from '@data-leases/contracts';
afterEach(() => vi.unstubAllGlobals());
function maliciousProvider(change: (reply: NegotiationMessage) => NegotiationMessage, changeAnswer: (answer: AnswerEnvelope) => AnswerEnvelope = answer => answer) {
 vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).endsWith('agent-card.json')) return Response.json(AgentCard.toJSON(providerCard('http://127.0.0.1:4101', 'provider-a')));
  const rpc = JSON.parse(String(init?.body));
  const message = Message.fromJSON(rpc.params.message);
  const input = message.parts[0]?.content;
  if (input?.$case !== 'data') throw new Error('missing data');
  const reply = change({ ...input.value, action: input.value.action === 'ACCEPT' ? 'ACCEPT' : 'PROPOSE', fromAgentId: 'provider-a', toAgentId: 'buyer', priceMinor: '100', quoteId: 'quote', termsHash: 'hash' });
  const parts: Array<{ data: unknown; mediaType: string }> = [{ data: reply, mediaType: NEGOTIATION_MEDIA_TYPE }];
  if (reply.action === 'ACCEPT') parts.push({ mediaType: ANSWER_MEDIA_TYPE, data: changeAnswer({ schemaVersion: '1.0.0', sessionId: reply.sessionId, negotiationId: reply.negotiationId, runId: reply.runId!, questionTemplateId: reply.questionTemplateId, providerId: 'provider-a', acceptedQuoteId: reply.quoteId!, deliveredAt: new Date().toISOString(), chainId: 'eip155:1', metric: 'aave_v3.usdc.available_liquidity', value: '1250000000000', unit: 'USDC_RAW_6_DECIMALS', methodologyVersion: 'synthetic-demo-v1', evidenceRefs: ['mock:scenario:aave-usdc-liquidity'], evidencePolicyId: 'demo-policy-v1', demoTrustMode: 'UNTRUSTED_MOCK' }) });
  const output = Message.fromJSON({ messageId: 'reply', contextId: 'context', role: 'ROLE_AGENT', parts });
  return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { message: Message.toJSON(output) } });
 }));
}
const buyer = { baseUrl: 'http://127.0.0.1:4101', providerId: 'provider-a', maxPriceMinor: '200' };
test('buyer rejects expiry extending original deadline', async () => {
 maliciousProvider(reply => ({ ...reply, expiresAt: new Date(Date.now() + 120000).toISOString() }));
 await expect(negotiate(buyer)).rejects.toThrow('REPLY_BINDING_MISMATCH');
});
test('buyer rejects changed freshness requirement', async () => {
 maliciousProvider(reply => ({ ...reply, maxAgeSeconds: 9999 }));
 await expect(negotiate(buyer)).rejects.toThrow('REPLY_BINDING_MISMATCH');
});
test('buyer rejects cards without requested capability', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(AgentCard.toJSON({ ...providerCard('http://127.0.0.1:4101', 'provider-a'), skills: [] }))));
 await expect(negotiate(buyer)).rejects.toThrow('UNTRUSTED_CARD_ENDPOINT');
});
test('buyer rejects changed SLA', async () => {
 maliciousProvider(reply => ({ ...reply, deliverySlaSeconds: 9999 }));
 await expect(negotiate(buyer)).rejects.toThrow('REPLY_BINDING_MISMATCH');
});
test('buyer rejects changed accepted hash', async () => {
 maliciousProvider(reply => reply.action === 'ACCEPT' ? { ...reply, termsHash: 'changed' } : reply);
 await expect(negotiate(buyer)).rejects.toThrow('INVALID_ACCEPTANCE');
});
test('SDK requests reject redirects', async () => {
 maliciousProvider(reply => reply);
 await negotiate(buyer);
 const calls = vi.mocked(fetch).mock.calls;
 expect(calls.length).toBeGreaterThan(1);
 expect(calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
});
test('card body is capped while reading', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(32769))));
 await expect(negotiate(buyer)).rejects.toThrow('RESPONSE_TOO_LARGE');
});
test('invalid identity cannot erase an outstanding provider quote; accepted hash stays immutable', async () => {
 const provider = await startProvider({ port: 0, providerId: 'provider-a', askMinor: '100', floorMinor: '50' });
 try {
  const client = await new ClientFactory().createFromUrl(provider.baseUrl);
  const initial: NegotiationMessage = { schemaVersion: '1.0.0', sessionId: 'session', negotiationId: 'negotiation', runId: 'run', messageId: 'initial', action: 'REQUEST_FOR_QUOTE', fromAgentId: 'buyer', toAgentId: 'provider-a', round: 1, questionTemplateId: 'ETHEREUM_LENDING_LIQUIDITY', evidencePolicyId: 'demo-policy-v1', maxAgeSeconds: 60, currency: 'demo:USD6', expiresAt: new Date(Date.now() + 20000).toISOString() };
  async function send(value: NegotiationMessage) {
   const result = await client.sendMessage({ tenant: '', configuration: undefined, metadata: undefined, message: Message.fromJSON({ messageId: crypto.randomUUID(), role: Role.ROLE_USER, parts: [{ data: value, mediaType: NEGOTIATION_MEDIA_TYPE }] }) });
   if (!('parts' in result) || result.parts[0]?.content?.$case !== 'data') throw new Error('missing response');
   return result.parts[0].content.value as NegotiationMessage;
  }
  const missingRun = await send({ ...initial, negotiationId: 'missing-run', runId: undefined });
  expect(missingRun.action).toBe('REJECT');
  const quote = await send(initial);
  await send({ ...quote, fromAgentId: 'attacker', toAgentId: 'provider-a', sessionId: 'other', action: 'ACCEPT', round: 2 });
  const changedFreshness = await send({ ...quote, fromAgentId: 'buyer', toAgentId: 'provider-a', action: 'ACCEPT', round: 2, maxAgeSeconds: 9999 });
  expect(changedFreshness.action).toBe('REJECT');
  const changedExpiry = await send({ ...quote, fromAgentId: 'buyer', toAgentId: 'provider-a', action: 'ACCEPT', round: 2, expiresAt: new Date(Date.now() + 120000).toISOString() });
  expect(changedExpiry.action).toBe('REJECT');
  const acceptance = await send({ ...quote, fromAgentId: 'buyer', toAgentId: 'provider-a', action: 'ACCEPT', round: 2 });
  expect(acceptance.action).toBe('ACCEPT');
  expect(acceptance.termsHash).toBe(quote.termsHash);
 } finally { await provider.close(); }
});

for (const key of ['runId', 'sessionId', 'negotiationId', 'providerId', 'questionTemplateId', 'acceptedQuoteId', 'metric', 'unit'] as const) {
 test(`buyer rejects mismatched answer ${key}`, async () => {
  maliciousProvider(reply => reply, answer => ({ ...answer, [key]: 'different' }));
  await expect(negotiate(buyer)).rejects.toThrow('ANSWER_BINDING_MISMATCH');
 });
}
