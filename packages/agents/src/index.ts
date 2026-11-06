import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { AgentCard, Message, Role, type Part } from '@a2a-js/sdk';
import { ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { DefaultRequestHandler, InMemoryTaskStore, type AgentExecutor } from '@a2a-js/sdk/server';
import { jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { MinorUnitsSchema, NegotiationMessageSchema, AnswerEnvelopeSchema, type NegotiationMessage, type AnswerEnvelope } from '@data-leases/contracts';

import { DEMO_SCENARIOS, scenarioForTemplate } from './scenarios.js';

export const ANSWER_MEDIA_TYPE = 'application/vnd.data-leases.answer+json;v=1';
export const NEGOTIATION_MEDIA_TYPE = 'application/vnd.data-leases.negotiation+json;v=1';
export const QUESTION_TEMPLATE = 'ETHEREUM_LENDING_LIQUIDITY';
function makeMessage(input: Pick<Message, 'messageId' | 'role' | 'parts'> & Partial<Message>): Message { return { contextId: '', taskId: '', metadata: undefined, extensions: [], referenceTaskIds: [], ...input }; }
const dataPart = (value: NegotiationMessage): Part => ({ content: { $case: 'data', value }, mediaType: NEGOTIATION_MEDIA_TYPE, filename: '', metadata: undefined });
function payload(message: Message): NegotiationMessage {
 const part = message.parts.find(p => p.mediaType === NEGOTIATION_MEDIA_TYPE && p.content?.$case === 'data');
 if (!part || part.content?.$case !== 'data') throw new Error('NEGOTIATION_DATA_REQUIRED');
 return NegotiationMessageSchema.parse(part.content.value);
}
/** Bound reads before SDK JSON parsing; redirects never bypass the destination policy. */
async function boundedFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
 const response = await fetch(url, { ...init, redirect: 'error' });
 if (!response.body) return response;
 const reader = response.body.getReader();
 const chunks: Uint8Array[] = [];
 let size = 0;
 while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  size += value.byteLength;
  if (size > 32_768) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
  chunks.push(value);
 }
 return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
}
function hashTerms(value: NegotiationMessage): string {
 return createHash('sha256').update(JSON.stringify({ providerId: value.fromAgentId, sessionId: value.sessionId, negotiationId: value.negotiationId, runId: value.runId, quoteId: value.quoteId, offerId: value.offerId, priceMinor: value.priceMinor, currency: value.currency, expiresAt: value.expiresAt, questionTemplateId: value.questionTemplateId, evidencePolicyId: value.evidencePolicyId, maxAgeSeconds: value.maxAgeSeconds, deliverySlaSeconds: value.deliverySlaSeconds })).digest('hex');
}
export interface ProviderOptions { port: number; providerId: string; askMinor: string; floorMinor: string }
export function providerCard(baseUrl: string, providerId: string): AgentCard {
 return AgentCard.fromJSON({ name: providerId, description: 'DEMO_UNTRUSTED: deterministic unpaid negotiation provider', version: '0.1.0', supportedInterfaces: [{ url: `${baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], capabilities: {}, defaultInputModes: [NEGOTIATION_MEDIA_TYPE], defaultOutputModes: [NEGOTIATION_MEDIA_TYPE, ANSWER_MEDIA_TYPE], skills: [{ id: QUESTION_TEMPLATE, name: 'Ethereum lending liquidity', description: 'Mock data negotiation; no live financial data', tags: ['DEMO_UNTRUSTED'] }, ...DEMO_SCENARIOS.map(scenario => ({ id: scenario.questionTemplateId, name: scenario.title, description: scenario.description, tags: ['DEMO_UNTRUSTED', 'SYNTHETIC'] }))] });
}
export async function startProvider(options: ProviderOptions) {
 const ask = BigInt(MinorUnitsSchema.parse(options.askMinor));
 const floor = BigInt(MinorUnitsSchema.parse(options.floorMinor));
 if (floor > ask) throw new Error('FLOOR_EXCEEDS_ASK');
 const app = express();
 app.use(express.json({ limit: '32kb' }));
 const sessions = new Map<string, NegotiationMessage>();
 let baseUrl = '';
 const executor: AgentExecutor = {
  async execute(context, bus) {
   const input = payload(context.userMessage);
   const previous = sessions.get(input.negotiationId);
   let action: NegotiationMessage['action'] = 'REJECT';
   let reasonCode = 'INVALID_TERMS';
   let priceMinor = options.askMinor;
   const valid = Boolean(input.runId) && input.toAgentId === options.providerId && Boolean(scenarioForTemplate(input.questionTemplateId)) && input.currency === 'demo:USD6' && input.evidencePolicyId === 'demo-policy-v1';
   const bindingValid = !previous || (previous.fromAgentId === input.toAgentId && previous.toAgentId === input.fromAgentId && previous.sessionId === input.sessionId && previous.runId === input.runId && previous.questionTemplateId === input.questionTemplateId && previous.maxAgeSeconds === input.maxAgeSeconds && previous.deliverySlaSeconds === input.deliverySlaSeconds && previous.expiresAt === input.expiresAt);
   if (Date.parse(input.expiresAt) <= Date.now()) { action = 'EXPIRE'; reasonCode = 'DEADLINE_EXCEEDED'; }
   else if (valid && input.action === 'REQUEST_FOR_QUOTE' && !previous) { action = 'PROPOSE'; reasonCode = 'ASK'; }
   else if (valid && bindingValid && previous?.action === 'PROPOSE' && previous.fromAgentId === input.toAgentId && previous.toAgentId === input.fromAgentId && previous.sessionId === input.sessionId && previous.runId === input.runId && input.round === previous.round + 1 && Date.parse(previous.expiresAt) > Date.now()) {
    if (input.action === 'COUNTER' && input.priceMinor && BigInt(input.priceMinor) >= floor && BigInt(input.priceMinor) <= ask) { action = 'PROPOSE'; priceMinor = input.priceMinor; reasonCode = 'COUNTER_WITHIN_FLOOR'; }
    if (input.action === 'ACCEPT' && input.quoteId === previous.quoteId && input.termsHash === previous.termsHash && input.priceMinor === previous.priceMinor) { action = 'ACCEPT'; priceMinor = input.priceMinor!; reasonCode = 'AGREED'; }
   }
   const reply = NegotiationMessageSchema.parse({ ...input, messageId: randomUUID(), fromAgentId: options.providerId, toAgentId: input.fromAgentId, action, priceMinor, reasonCode, quoteId: action === 'ACCEPT' ? previous?.quoteId : randomUUID(), offerId: previous?.offerId ?? randomUUID(), revision: input.round, expiresAt: previous?.expiresAt ?? new Date(Math.min(Date.parse(input.expiresAt), Date.now() + 30_000)).toISOString() });
   reply.termsHash = action === 'ACCEPT' ? previous!.termsHash : hashTerms(reply);
   if (valid && bindingValid) sessions.set(input.negotiationId, reply);
   const parts = [dataPart(reply)];
   if (action === 'ACCEPT') {
    const scenario = scenarioForTemplate(input.questionTemplateId)!;
    const answer = AnswerEnvelopeSchema.parse({ schemaVersion: '1.0.0', sessionId: reply.sessionId, negotiationId: reply.negotiationId, runId: reply.runId, questionTemplateId: reply.questionTemplateId, providerId: options.providerId, acceptedQuoteId: reply.quoteId, deliveredAt: new Date().toISOString(), chainId: scenario.chainId, metric: scenario.metric, value: scenario.value, unit: scenario.unit, methodologyVersion: 'synthetic-demo-v1', evidenceRefs: [`mock:scenario:${scenario.id}`], evidencePolicyId: reply.evidencePolicyId, demoTrustMode: 'UNTRUSTED_MOCK' });
    parts.push({ content: { $case: 'data', value: answer }, mediaType: ANSWER_MEDIA_TYPE, filename: '', metadata: undefined });
   }
   bus.publish({ kind: 'message', data: makeMessage({ messageId: reply.messageId, contextId: context.contextId, role: Role.ROLE_AGENT, parts }) });
   bus.finished();
  },
  async cancelTask() { throw new Error('No long-running tasks supported'); }
 };
 // The card is served dynamically after the OS selects an ephemeral port in tests.
 const handler = new DefaultRequestHandler(providerCard('http://127.0.0.1', options.providerId), new InMemoryTaskStore(), executor);
 app.get('/.well-known/agent-card.json', (_request, response) => response.json(AgentCard.toJSON(providerCard(baseUrl, options.providerId))));
 app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
 const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(options.port, '127.0.0.1');
  instance.once('listening', () => resolve(instance));
  instance.once('error', reject);
 });
 baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 return { baseUrl, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

export interface BuyerOptions { baseUrl: string; providerId: string; maxPriceMinor: string; deadlineAt?: string; questionTemplateId?: string }
export async function negotiate(options: BuyerOptions) {
 const questionTemplateId = options.questionTemplateId ?? QUESTION_TEMPLATE;
 const scenario = scenarioForTemplate(questionTemplateId);
 if (!scenario) throw new Error('UNSUPPORTED_QUESTION_TEMPLATE');
 const cap = BigInt(MinorUnitsSchema.parse(options.maxPriceMinor));
 const url = new URL(options.baseUrl);
 if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('ONLY_EXPLICIT_LOCAL_PROVIDER_SUPPORTED');
 const originalDeadline = options.deadlineAt ?? new Date(Date.now() + 30_000).toISOString();
 const response = await boundedFetch(`${url.origin}/.well-known/agent-card.json`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
 if (!response.ok) throw new Error('CARD_FETCH_FAILED');
 const text = await response.text();
 if (text.length > 32_768) throw new Error('CARD_TOO_LARGE');
 const card = AgentCard.fromJSON(JSON.parse(text));
 if (!card.skills.some(skill => skill.id === questionTemplateId) || !card.defaultInputModes.includes(NEGOTIATION_MEDIA_TYPE) || !card.defaultOutputModes.includes(NEGOTIATION_MEDIA_TYPE) || card.name !== options.providerId || card.supportedInterfaces.length !== 1 || card.supportedInterfaces[0]?.protocolBinding !== 'JSONRPC' || card.supportedInterfaces[0]?.protocolVersion !== '1.0' || card.supportedInterfaces[0]?.url !== `${url.origin}/a2a`) throw new Error('UNTRUSTED_CARD_ENDPOINT');
 const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory({ fetchImpl: boundedFetch })] }).createFromAgentCard(card);
 const runId = randomUUID();
 const transcript: NegotiationMessage[] = [];
 let request: NegotiationMessage = NegotiationMessageSchema.parse({ schemaVersion: '1.0.0', sessionId: randomUUID(), negotiationId: randomUUID(), runId, messageId: randomUUID(), action: 'REQUEST_FOR_QUOTE', fromAgentId: 'buyer', toAgentId: options.providerId, round: 1, questionTemplateId, evidencePolicyId: 'demo-policy-v1', maxAgeSeconds: 60, currency: 'demo:USD6', expiresAt: originalDeadline });
 for (let round = 1; round <= 3; round++) {
  if (Math.min(Date.parse(originalDeadline), Date.parse(request.expiresAt)) <= Date.now()) return { status: 'EXPIRED' as const, runId, transcript };
  request = { ...request, round, messageId: randomUUID() };
  transcript.push(request);
  const result = await client.sendMessage({ tenant: '', configuration: undefined, metadata: undefined, message: makeMessage({ messageId: request.messageId, role: Role.ROLE_USER, parts: [dataPart(request)] }) }, { signal: AbortSignal.timeout(Math.max(1, Math.min(3000, Date.parse(request.expiresAt) - Date.now()))) });
  if (!('parts' in result)) throw new Error('EXPECTED_MESSAGE_RESPONSE');
  const reply = payload(result);
  if (reply.runId !== runId || reply.negotiationId !== request.negotiationId || reply.sessionId !== request.sessionId || reply.fromAgentId !== options.providerId || reply.toAgentId !== 'buyer' || reply.currency !== request.currency || reply.round !== round || reply.questionTemplateId !== request.questionTemplateId || reply.evidencePolicyId !== request.evidencePolicyId || reply.maxAgeSeconds !== request.maxAgeSeconds || reply.deliverySlaSeconds !== request.deliverySlaSeconds || Date.parse(reply.expiresAt) > Date.parse(request.expiresAt) || Date.parse(reply.expiresAt) > Date.parse(originalDeadline)) throw new Error('REPLY_BINDING_MISMATCH');
  transcript.push(reply);
  if (reply.action === 'REJECT' || reply.action === 'ERROR') return { status: 'REJECTED' as const, runId, transcript };
  if (reply.action === 'EXPIRE' || Date.parse(reply.expiresAt) <= Date.now()) return { status: 'EXPIRED' as const, runId, transcript };
  if (!reply.priceMinor || !reply.quoteId || !reply.termsHash) throw new Error('MISSING_QUOTE_TERMS');
  if (reply.action === 'ACCEPT') {
   if (request.action !== 'ACCEPT' || reply.quoteId !== request.quoteId || reply.priceMinor !== request.priceMinor || reply.termsHash !== request.termsHash || reply.offerId !== request.offerId || reply.expiresAt !== request.expiresAt || BigInt(reply.priceMinor) > cap) throw new Error('INVALID_ACCEPTANCE');
   const answerPart = result.parts.find(part => part.mediaType === ANSWER_MEDIA_TYPE && part.content?.$case === 'data');
   if (!answerPart || answerPart.content?.$case !== 'data') throw new Error('ANSWER_DATA_REQUIRED');
   const answer: AnswerEnvelope = AnswerEnvelopeSchema.parse(answerPart.content.value);
   if (answer.runId !== runId || answer.sessionId !== request.sessionId || answer.negotiationId !== request.negotiationId || answer.questionTemplateId !== questionTemplateId || answer.providerId !== options.providerId || answer.acceptedQuoteId !== request.quoteId || answer.evidencePolicyId !== request.evidencePolicyId || answer.chainId !== scenario.chainId || answer.metric !== scenario.metric || answer.unit !== scenario.unit || answer.demoTrustMode !== 'UNTRUSTED_MOCK') throw new Error('ANSWER_BINDING_MISMATCH');
   return { status: 'AGREED' as const, deliveryStatus: 'DELIVERED_UNVERIFIED' as const, priceMinor: reply.priceMinor, runId, transcript, answer };
  }
  if (reply.action !== 'PROPOSE') throw new Error('UNEXPECTED_NEGOTIATION_ACTION');
  request = { ...reply, fromAgentId: 'buyer', toAgentId: options.providerId, action: BigInt(reply.priceMinor) <= cap ? 'ACCEPT' : 'COUNTER', priceMinor: BigInt(reply.priceMinor) <= cap ? reply.priceMinor : cap.toString() };
 }
 return { status: 'REJECTED' as const, runId, transcript };
}

export * from './compute.js';

export * from './scenarios.js';
