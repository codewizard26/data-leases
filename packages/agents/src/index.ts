import {installFixedBundles} from './fixed-bundle.js';
import {HederaPaywall, paymentDigest,HEDERA_CURRENCY,type PaymentJournal,type PaymentQuote} from './payments.js';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { AgentCard, Message, Role, type Part } from '@a2a-js/sdk';
import { ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { DefaultRequestHandler, InMemoryTaskStore, type AgentExecutor } from '@a2a-js/sdk/server';
import { jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { MinorUnitsSchema, NegotiationMessageSchema, AnswerEnvelopeSchema, ComputationResultSchema, type NegotiationMessage, type AnswerEnvelope } from '@data-leases/contracts';

import type { NegotiationStrategy } from './strategy.js';
import type { ComputeOutput,ComputeAdapter } from './compute.js';
import { DEMO_SCENARIOS, scenarioForTemplate } from './scenarios.js';

export type NegotiationMode = 'MOCK' | 'LIVE';
export const NEGOTIATION_MODE_METADATA_KEY = 'data-leases.negotiationMode';
export const DECISION_MEDIA_TYPE = 'application/vnd.data-leases.decision+json;v=1';
export interface AgentDecision {
 messageId: string; actorRole: 'BUYER_AGENT' | 'PROVIDER_AGENT'; actorId: string;
 action: 'PROPOSE' | 'ACCEPT' | 'COUNTER' | 'REJECT'; priceMinor?: string;
 reason: string; provider: ComputeOutput['provider']; model: string;
}
type StrategyDecision = Omit<AgentDecision, 'messageId' | 'actorRole' | 'actorId'>;
function checkedDecision(value: StrategyDecision): StrategyDecision {
 if (!['PROPOSE','ACCEPT','COUNTER','REJECT'].includes(value.action) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 500 || !['0G','CLAUDE','OPENROUTER'].includes(value.provider) || typeof value.model !== 'string' || !value.model || value.model.length > 256) throw new Error('INVALID_AI_DECISION_METADATA');
 if (value.priceMinor !== undefined) MinorUnitsSchema.parse(value.priceMinor);
 return {action:value.action, ...(value.priceMinor === undefined ? {} : {priceMinor:value.priceMinor}), reason:value.reason, provider:value.provider, model:value.model};
}
function decisionPart(value: AgentDecision): Part { return {content:{$case:'data',value},mediaType:DECISION_MEDIA_TYPE,filename:'',metadata:undefined}; }
function receivedDecision(message: Message, bound: NegotiationMessage): AgentDecision | undefined {
 const parts = message.parts.filter(part => part.mediaType === DECISION_MEDIA_TYPE);
 if (!parts.length) return undefined;
 if (parts.length !== 1 || parts[0]?.content?.$case !== 'data') throw new Error('INVALID_AI_DECISION_PART');
 const value = parts[0].content.value as AgentDecision;
 if (!value || typeof value !== 'object' || value.messageId !== bound.messageId || value.actorRole !== 'PROVIDER_AGENT' || value.actorId !== bound.fromAgentId || value.action !== bound.action || value.priceMinor !== bound.priceMinor) throw new Error('AI_DECISION_BINDING_MISMATCH');
 return {...checkedDecision(value), messageId:bound.messageId, actorRole:'PROVIDER_AGENT', actorId:bound.fromAgentId};
}
async function withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
 const remaining = deadline - Date.now();
 if (remaining <= 0) throw new Error('AI_NEGOTIATION_DEADLINE_EXCEEDED');
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([operation(), new Promise<never>((_resolve,reject) => {timer=setTimeout(() => reject(new Error('AI_NEGOTIATION_DEADLINE_EXCEEDED')),remaining);})]); }
 finally { if(timer) clearTimeout(timer); }
}
export const PAYMENT_MEDIA_TYPE = 'application/vnd.data-leases.payment+json;v=1';
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
export function hashTerms(value: NegotiationMessage): string {
 return createHash('sha256').update(JSON.stringify({ providerId: value.fromAgentId, sessionId: value.sessionId, negotiationId: value.negotiationId, runId: value.runId, quoteId: value.quoteId, offerId: value.offerId, priceMinor: value.priceMinor, currency: value.currency, expiresAt: value.expiresAt, questionTemplateId: value.questionTemplateId, evidencePolicyId: value.evidencePolicyId, maxAgeSeconds: value.maxAgeSeconds, deliverySlaSeconds: value.deliverySlaSeconds })).digest('hex');
}
export interface ProviderOptions {profile?:{displayName:string;description:string;style:string;compute:{provider:string;model:string;available:boolean}};allowUnpaidQuotes?:boolean;sourceTemplates?:readonly string[]; liveOnly?:boolean; signAnswer?:(answer:AnswerEnvelope)=>string; port: number; providerId: string; askMinor: string; floorMinor: string; strategy?: NegotiationStrategy; payment?:{payTo:string;journal:PaymentJournal}; compute?:ComputeAdapter; utilityRates?:Record<string,{askMinor:string;floorMinor:string}>; answerSource?:(answer:AnswerEnvelope)=>Promise<Pick<AnswerEnvelope,'value'|'sourceBlockNumber'|'sourceBlockHash'|'evidenceRefs'>> }
export function providerCard(baseUrl: string, providerId: string, computationAvailable=false,linkSourceAvailable=false,liveOnly=false,sourceTemplates:readonly string[]=[]): AgentCard {
 return AgentCard.fromJSON({ name: providerId, description: liveOnly?'Live public Ethereum metrics and model computation':linkSourceAvailable?'Unsigned local A2A provider; Ethereum LINK reads, other synthetic demos, optional Hedera exact payments':'DEMO_UNTRUSTED: local A2A research provider; synthetic answers; optional Hedera exact payments', version: '0.1.0', supportedInterfaces: [{ url: `${baseUrl}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }], capabilities: {}, defaultInputModes: [NEGOTIATION_MEDIA_TYPE], defaultOutputModes: [NEGOTIATION_MEDIA_TYPE, ANSWER_MEDIA_TYPE], skills: [...(!liveOnly?[{ id: QUESTION_TEMPLATE, name: 'Ethereum lending liquidity', description: 'Mock data negotiation; no live financial data', tags: ['DEMO_UNTRUSTED'] }]:[]), ...DEMO_SCENARIOS.filter(s=>!s.retired&&(s.operation!=='COMPUTE'||computationAvailable)&&(!liveOnly||(((s.questionTemplateId==='ERC20_TOKEN_METADATA'||sourceTemplates.includes(s.questionTemplateId))&&linkSourceAvailable)||(s.operation==='COMPUTE'&&computationAvailable)))).map(scenario => ({ id: scenario.questionTemplateId, name: scenario.title, description: linkSourceAvailable&&(scenario.questionTemplateId==='ERC20_TOKEN_METADATA'||sourceTemplates.includes(scenario.questionTemplateId))?(liveOnly?'Read the advertised public Ethereum metric at an explicit block; answers carry provider signatures.':'Read the advertised public Ethereum metric at an explicit block; provider identity is unsigned.'):scenario.description, tags: linkSourceAvailable&&(scenario.questionTemplateId==='ERC20_TOKEN_METADATA'||sourceTemplates.includes(scenario.questionTemplateId))?(liveOnly?['SIGNED_PROVIDER','ETHEREUM_RPC']:['UNTRUSTED_UNSIGNED','ETHEREUM_RPC']):liveOnly?['SIGNED_PROVIDER','MODEL_COMPUTATION']:['DEMO_UNTRUSTED', 'SYNTHETIC'] }))] });
}
export async function startProvider(options: ProviderOptions) {
 if(options.liveOnly&&!options.signAnswer)throw new Error('PROVIDER_SIGNING_REQUIRED');
 const ask = BigInt(MinorUnitsSchema.parse(options.askMinor));
 const floor = BigInt(MinorUnitsSchema.parse(options.floorMinor));
 if (floor > ask) throw new Error('FLOOR_EXCEEDS_ASK');
 const rateFor=(id:string)=>{const multiplier=BigInt(scenarioForTemplate(id)?.dataAccess.priceMultiplier??1),rate=options.utilityRates?.[id];const askMinor=MinorUnitsSchema.parse(rate?.askMinor??(ask*multiplier).toString()),floorMinor=MinorUnitsSchema.parse(rate?.floorMinor??(floor*multiplier).toString());if(BigInt(floorMinor)>BigInt(askMinor))throw new Error('FLOOR_EXCEEDS_ASK');return {askMinor,floorMinor};};
 for(const id of Object.keys(options.utilityRates??{}))rateFor(id);
 const app = express();
 app.use(express.json({ limit: '32kb' }));
 installFixedBundles(app,options,rateFor,options.payment?.journal);
 const sessions = new Map<string, NegotiationMessage>();
 const sessionModes = new Map<string, NegotiationMode>();
 let baseUrl = '';
 let paywall:HederaPaywall|undefined;
 const executor: AgentExecutor = {
  async execute(context, bus) {
   const input = payload(context.userMessage);
   const task=scenarioForTemplate(input.questionTemplateId);const operation=task?.operation;
   const {askMinor:quotedAsk,floorMinor:quotedFloor}=rateFor(input.questionTemplateId);
   const activeAsk=BigInt(quotedAsk),activeFloor=BigInt(quotedFloor);
   const previous = sessions.get(input.negotiationId);
   const requestedMode: unknown = context.request.metadata?.[NEGOTIATION_MODE_METADATA_KEY] ?? (options.strategy ? 'LIVE' : 'MOCK');
   const modeValid = requestedMode === 'MOCK' || requestedMode === 'LIVE';
   const modeMatches = !previous || sessionModes.get(input.negotiationId) === requestedMode;
   const strategy = requestedMode === 'LIVE' ? options.strategy : undefined;
   if (modeValid && modeMatches && requestedMode === 'LIVE' && !strategy) throw new Error('LIVE_STRATEGY_REQUIRED');
   let action: NegotiationMessage['action'] = 'REJECT';
   let reasonCode = 'INVALID_TERMS';
   let priceMinor = quotedAsk;
   let aiDecision: StrategyDecision | undefined;
   const valid = Boolean(input.runId) && input.toAgentId === options.providerId && Boolean(task)&&!task?.retired && (!options.liveOnly||(requestedMode==='LIVE'&&(((task?.questionTemplateId==='ERC20_TOKEN_METADATA'||options.sourceTemplates?.includes(input.questionTemplateId))&&Boolean(options.answerSource))||(task?.operation==='COMPUTE'&&Boolean(options.compute))))) && !(task?.dataAccess.classification==='PRIVATE'&&input.action==='ACCEPT'&&input.currency!==HEDERA_CURRENCY) && (operation!=='COMPUTE'||Boolean(options.compute)) && (input.currency === 'demo:USD6' || ((Boolean(options.payment)||(options.allowUnpaidQuotes&&input.action!=='ACCEPT')) && input.currency === HEDERA_CURRENCY)) && input.evidencePolicyId === scenarioForTemplate(input.questionTemplateId)?.evidencePolicyId;
   const bindingValid = !previous || (previous.fromAgentId === input.toAgentId && previous.toAgentId === input.fromAgentId && previous.sessionId === input.sessionId && previous.runId === input.runId && previous.questionTemplateId === input.questionTemplateId && previous.currency === input.currency && previous.maxAgeSeconds === input.maxAgeSeconds && previous.deliverySlaSeconds === input.deliverySlaSeconds && previous.expiresAt === input.expiresAt);
   if (!modeValid) { action = 'REJECT'; reasonCode = 'INVALID_NEGOTIATION_MODE'; }
   else if (!modeMatches) { action = 'REJECT'; reasonCode = 'NEGOTIATION_MODE_MISMATCH'; }
   else if (Date.parse(input.expiresAt) <= Date.now()) { action = 'EXPIRE'; reasonCode = 'DEADLINE_EXCEEDED'; }
   else if (valid && input.action === 'REQUEST_FOR_QUOTE' && !previous) {
    if (strategy) aiDecision = checkedDecision(await withinDeadline(() => strategy!.seller({kind:'initial',askMinor:quotedAsk,floorMinor:quotedFloor,round:input.round}),Date.parse(input.expiresAt)));
    else { action = 'PROPOSE'; reasonCode = 'ASK'; }
   }
   else if (valid && bindingValid && previous?.action === 'PROPOSE' && input.round === previous.round + 1 && Date.parse(previous.expiresAt) > Date.now()) {
    if (input.action === 'REJECT') { action = 'REJECT'; reasonCode = 'BUYER_DECLINED'; }
    if (input.action === 'COUNTER' && input.priceMinor) {
     if (strategy) aiDecision = checkedDecision(await withinDeadline(() => strategy!.seller({kind:'counter',askMinor:quotedAsk,floorMinor:quotedFloor,incomingPriceMinor:input.priceMinor,round:input.round}),Date.parse(input.expiresAt)));
     else if (BigInt(input.priceMinor) >= activeFloor && BigInt(input.priceMinor) <= activeAsk) { action = 'PROPOSE'; priceMinor = input.priceMinor; reasonCode = 'COUNTER_WITHIN_FLOOR'; }
    }
    if (input.action === 'ACCEPT' && input.quoteId === previous.quoteId && input.termsHash === previous.termsHash && input.priceMinor === previous.priceMinor) { action = 'ACCEPT'; priceMinor = input.priceMinor!; reasonCode = 'AGREED'; }
   }
   if (aiDecision) {
    if (!['PROPOSE','REJECT'].includes(aiDecision.action) || (aiDecision.action === 'PROPOSE' && (!aiDecision.priceMinor || BigInt(aiDecision.priceMinor) < activeFloor || BigInt(aiDecision.priceMinor) > activeAsk))) throw new Error('INVALID_SELLER_DECISION');
    action = aiDecision.action; priceMinor = aiDecision.priceMinor ?? priceMinor; reasonCode = 'AI_DECISION';
   }
   if (Date.parse(input.expiresAt) <= Date.now()) { action = 'EXPIRE'; reasonCode = 'DEADLINE_EXCEEDED'; aiDecision = undefined; }
   const reply = NegotiationMessageSchema.parse({ ...input, messageId: randomUUID(), fromAgentId: options.providerId, toAgentId: input.fromAgentId, action, priceMinor, reasonCode, quoteId: action === 'ACCEPT' ? previous?.quoteId : randomUUID(), offerId: previous?.offerId ?? randomUUID(), revision: input.round, expiresAt: previous?.expiresAt ?? new Date(Math.min(Date.parse(input.expiresAt), Date.now() + (strategy || input.currency===HEDERA_CURRENCY ? 180_000 : 30_000))).toISOString() });
   reply.termsHash = action === 'ACCEPT' ? previous!.termsHash : hashTerms(reply);
   if (valid && bindingValid && modeValid && modeMatches) { sessions.set(input.negotiationId, reply); sessionModes.set(input.negotiationId, requestedMode); }
   const parts = [dataPart(reply)];
   if (aiDecision) parts.push(decisionPart({...aiDecision, priceMinor:reply.priceMinor, messageId:reply.messageId, actorRole:'PROVIDER_AGENT', actorId:options.providerId}));
   if (action === 'ACCEPT') {
    const scenario = scenarioForTemplate(input.questionTemplateId)!;
    const computation='computationPrompt' in scenario?ComputationResultSchema.parse(await withinDeadline(()=>options.compute!.generate({messages:[{role:'user',content:scenario.computationPrompt}]}),Date.parse(reply.expiresAt))):undefined;
    let answer = AnswerEnvelopeSchema.parse({ schemaVersion: '1.0.0', sessionId: reply.sessionId, negotiationId: reply.negotiationId, runId: reply.runId, questionTemplateId: reply.questionTemplateId, providerId: options.providerId, acceptedQuoteId: reply.quoteId, deliveredAt: new Date().toISOString(), chainId: scenario.chainId, metric: scenario.metric, value: scenario.value, unit: scenario.unit, methodologyVersion: scenario.methodologyVersion, sourceContract: scenario.sourceContract, evidenceRefs: [`mock:scenario:${scenario.id}`], evidencePolicyId: reply.evidencePolicyId, demoTrustMode: 'UNTRUSTED_MOCK' });
    if(options.answerSource&&(options.liveOnly||reply.currency===HEDERA_CURRENCY)&&(answer.questionTemplateId==='ERC20_TOKEN_METADATA'||options.sourceTemplates?.includes(answer.questionTemplateId))){const source=await options.answerSource(answer);answer=AnswerEnvelopeSchema.parse({...answer,value:source.value,sourceBlockNumber:source.sourceBlockNumber,sourceBlockHash:source.sourceBlockHash,evidenceRefs:source.evidenceRefs,deliveredAt:new Date().toISOString()});}
    if(options.liveOnly){if(!options.signAnswer)throw new Error('PROVIDER_SIGNING_REQUIRED');answer={...answer,demoTrustMode:'SIGNED_PROVIDER'};answer=AnswerEnvelopeSchema.parse({...answer,providerSignature:options.signAnswer(answer)});}
    if(reply.currency===HEDERA_CURRENCY){
     if(!paywall)throw new Error('PAYMENTS_NOT_CONFIGURED');
     const quote:PaymentQuote={runId:reply.runId!,quoteId:reply.quoteId!,termsHash:reply.termsHash!,priceMinor:reply.priceMinor!,currency:reply.currency,expiresAt:reply.expiresAt};paywall.register(quote,answer,computation);
     parts.push({content:{$case:'data',value:{quote,resourceUrl:baseUrl+'/paid-answers/'+encodeURIComponent(quote.runId),payTo:options.payment!.payTo}},mediaType:PAYMENT_MEDIA_TYPE,filename:'',metadata:undefined});
    }else {if(computation)parts.push({content:{$case:'data',value:computation},mediaType:'application/vnd.data-leases.computation+json;v=1',filename:'',metadata:undefined});parts.push({ content: { $case: 'data', value: answer }, mediaType: ANSWER_MEDIA_TYPE, filename: '', metadata: undefined });}
   }
   bus.publish({ kind: 'message', data: makeMessage({ messageId: reply.messageId, contextId: context.contextId, role: Role.ROLE_AGENT, parts }) });
   bus.finished();
  },
  async cancelTask() { throw new Error('No long-running tasks supported'); }
 };
 // The card is served dynamically after the OS selects an ephemeral port in tests.
 const handler = new DefaultRequestHandler(providerCard('http://127.0.0.1', options.providerId,Boolean(options.compute),Boolean(options.answerSource),Boolean(options.liveOnly),options.sourceTemplates), new InMemoryTaskStore(), executor);
 app.get('/.well-known/agent-card.json', (_request, response) => response.json(AgentCard.toJSON(providerCard(baseUrl, options.providerId,Boolean(options.compute),Boolean(options.answerSource),Boolean(options.liveOnly),options.sourceTemplates))));
 app.get('/provider-profile',(_request,response)=>{
  const card=providerCard(baseUrl,options.providerId,Boolean(options.compute),Boolean(options.answerSource),Boolean(options.liveOnly),options.sourceTemplates);
  response.set('Cache-Control','no-store').json({providerId:options.providerId,displayName:options.profile?.displayName??options.providerId,description:options.profile?.description??card.description,style:options.profile?.style??'BALANCED',compute:options.profile?.compute??{provider:'unconfigured',model:'not-configured',available:Boolean(options.strategy)},paymentReady:Boolean(options.payment),services:card.skills.map(skill=>({questionTemplateId:skill.id,askMinor:rateFor(skill.id).askMinor,currency:HEDERA_CURRENCY,decimals:8}))});
 });
 app.get('/paid-answers/:runId', async(request,response)=>{try{if(!paywall){response.status(503).json({error:'PAYMENTS_NOT_CONFIGURED'});return;}const result=await paywall.respond(request.params.runId,request.get('PAYMENT-SIGNATURE'));response.set({'Cache-Control':'no-store',...result.headers}).status(result.status).json(result.body);}catch(error){const code=error instanceof Error&&['PAYMENT_QUOTE_EXPIRED','PAYMENT_TERMS_MISMATCH','PAYMENT_PAYLOAD_TOO_LARGE'].includes(error.message)?error.message:'PAYMENT_REQUEST_FAILED';response.status(code==='PAYMENT_QUOTE_EXPIRED'?410:400).json({error:code});}});
 const publicReads=new Map<string,{at:number;work:Promise<AnswerEnvelope>}>();
 app.get('/public-observations/:template',async(request,response)=>{
  const id=request.params.template,scenario=scenarioForTemplate(id);
  if(!options.answerSource||!options.sourceTemplates?.includes(id)||!scenario||scenario.dataAccess.classification!=='PUBLIC'){response.status(404).json({error:'PUBLIC_SOURCE_UNAVAILABLE'});return;}
  let pending=publicReads.get(id);
  if(!pending||Date.now()-pending.at>15000){
   const work=(async()=>{
    const reference=AnswerEnvelopeSchema.parse({schemaVersion:'1.0.0',sessionId:randomUUID(),negotiationId:randomUUID(),runId:randomUUID(),questionTemplateId:id,providerId:options.providerId,acceptedQuoteId:randomUUID(),deliveredAt:new Date().toISOString(),chainId:scenario.chainId,metric:scenario.metric,value:'0',unit:scenario.unit,methodologyVersion:scenario.methodologyVersion,sourceContract:scenario.sourceContract,evidenceRefs:[],evidencePolicyId:scenario.evidencePolicyId,demoTrustMode:'UNTRUSTED_MOCK'});
    const source=await options.answerSource!(reference);
    const answer={...reference,...source,deliveredAt:new Date().toISOString(),demoTrustMode:options.signAnswer?'SIGNED_PROVIDER' as const:'UNTRUSTED_MOCK' as const};
    return AnswerEnvelopeSchema.parse({...answer,...(options.signAnswer?{providerSignature:options.signAnswer(answer)}:{})});
   })();pending={at:Date.now(),work};publicReads.set(id,pending);
  }
  try{response.set('Cache-Control','no-store').json({kind:'PUBLIC_SOURCE_OBSERVATION',paymentStatus:'NOT_REQUESTED',verificationStatus:'UNVERIFIED',answer:await pending.work});}
  catch{publicReads.delete(id);response.status(503).json({error:'PUBLIC_SOURCE_UNAVAILABLE'});}
 });
 app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
 const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(options.port, '127.0.0.1');
  instance.once('listening', () => resolve(instance));
  instance.once('error', reject);
 });
 baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 if(options.payment)paywall=new HederaPaywall({...options.payment,resourceOrigin:baseUrl});
 return { baseUrl, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

export interface BuyerOptions { baseUrl: string; providerId: string; maxPriceMinor: string; deadlineAt?: string; questionTemplateId?: string; currency?:string; quoteOnly?:boolean; deferAcceptance?:boolean; maxRounds?:number; maxAgeSeconds?:number; sessionId?:string; runId?:string; onMessage?:(message:NegotiationMessage,direction:'IN'|'OUT')=>void|Promise<void>; acceptQuote?:NegotiationMessage; strategy?: NegotiationStrategy; mode?: NegotiationMode }
export async function negotiate(options: BuyerOptions) {
 const mode = options.mode ?? (options.strategy ? 'LIVE' : 'MOCK');
 if (mode !== 'MOCK' && mode !== 'LIVE') throw new Error('INVALID_NEGOTIATION_MODE');
 const strategy = mode === 'LIVE' ? options.strategy : undefined;
 if (mode === 'LIVE' && !strategy) throw new Error('LIVE_STRATEGY_REQUIRED');
 const questionTemplateId = options.questionTemplateId ?? QUESTION_TEMPLATE;
 const scenario = scenarioForTemplate(questionTemplateId);
 if (!scenario) throw new Error('UNSUPPORTED_QUESTION_TEMPLATE');
 if(scenario.retired)throw new Error('TASK_RETIRED');
 const currency=options.currency??'demo:USD6';if(!['demo:USD6',HEDERA_CURRENCY].includes(currency))throw new Error('UNSUPPORTED_CURRENCY');
 const maxRounds=options.maxRounds??3;if(!Number.isInteger(maxRounds)||maxRounds<2||maxRounds>3)throw new Error('INVALID_MAX_ROUNDS');
 const cap = BigInt(MinorUnitsSchema.parse(options.maxPriceMinor));
 const url = new URL(options.baseUrl);
 if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('ONLY_EXPLICIT_LOCAL_PROVIDER_SUPPORTED');
 const originalDeadline = options.acceptQuote?.expiresAt ?? options.deadlineAt ?? new Date(Date.now() + (strategy || scenario.operation==='COMPUTE' || currency===HEDERA_CURRENCY ? 180_000 : 30_000)).toISOString();
 const response = await boundedFetch(`${url.origin}/.well-known/agent-card.json`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
 if (!response.ok) throw new Error('CARD_FETCH_FAILED');
 const text = await response.text();
 if (text.length > 32_768) throw new Error('CARD_TOO_LARGE');
 const card = AgentCard.fromJSON(JSON.parse(text));
 if (!card.skills.some(skill => skill.id === questionTemplateId) || !card.defaultInputModes.includes(NEGOTIATION_MEDIA_TYPE) || !card.defaultOutputModes.includes(NEGOTIATION_MEDIA_TYPE) || card.name !== options.providerId || card.supportedInterfaces.length !== 1 || card.supportedInterfaces[0]?.protocolBinding !== 'JSONRPC' || card.supportedInterfaces[0]?.protocolVersion !== '1.0' || card.supportedInterfaces[0]?.url !== `${url.origin}/a2a`) throw new Error('UNTRUSTED_CARD_ENDPOINT');
 const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory({ fetchImpl: boundedFetch })] }).createFromAgentCard(card);
 const runId = options.acceptQuote?.runId ?? options.runId ?? randomUUID();
 const transcript: NegotiationMessage[] = [];
 const decisions: AgentDecision[] = [];
 let pendingDecision: StrategyDecision | undefined;
 let request: NegotiationMessage = NegotiationMessageSchema.parse({ schemaVersion: '1.0.0', sessionId: options.sessionId??randomUUID(), negotiationId: randomUUID(), runId, messageId: randomUUID(), action: 'REQUEST_FOR_QUOTE', fromAgentId: 'buyer', toAgentId: options.providerId, round: 1, questionTemplateId, evidencePolicyId: scenario.evidencePolicyId, maxAgeSeconds: options.maxAgeSeconds??60, currency, expiresAt: originalDeadline });
 if(options.acceptQuote){const q=NegotiationMessageSchema.parse(options.acceptQuote);if(q.action!=='PROPOSE'||q.fromAgentId!==options.providerId||q.toAgentId!=='buyer'||q.currency!==currency||!q.priceMinor||BigInt(q.priceMinor)>cap||q.questionTemplateId!==questionTemplateId||q.runId!==runId||q.round>=3)throw new Error('INVALID_QUOTE_ACCEPTANCE');request={...q,fromAgentId:'buyer',toAgentId:options.providerId,action:'ACCEPT',round:q.round+1};}
 for (let round = request.round; round <= maxRounds; round++) {
  if (Math.min(Date.parse(originalDeadline), Date.parse(request.expiresAt)) <= Date.now()) return { status: 'EXPIRED' as const, runId, transcript, decisions, mode };
  request = { ...request, round, messageId: randomUUID() };
  transcript.push(request);
  await options.onMessage?.(request,'OUT');
  const outgoingParts = [dataPart(request)];
  if (pendingDecision) {
   const decision: AgentDecision = {...pendingDecision, messageId:request.messageId, actorRole:'BUYER_AGENT', actorId:'buyer'};
   decisions.push(decision); outgoingParts.push(decisionPart(decision)); pendingDecision=undefined;
  }
  const result = await client.sendMessage({ tenant: '', configuration: undefined, metadata: {[NEGOTIATION_MODE_METADATA_KEY]:mode}, message: makeMessage({ messageId: request.messageId, role: Role.ROLE_USER, parts: outgoingParts }) }, { signal: AbortSignal.timeout(Math.max(1, Math.min(strategy||scenario.operation==='COMPUTE' ? 60_000 : 3000, Date.parse(request.expiresAt) - Date.now()))) });
  if (!('parts' in result)) throw new Error('EXPECTED_MESSAGE_RESPONSE');
  const reply = payload(result);
  if (reply.runId !== runId || reply.negotiationId !== request.negotiationId || reply.sessionId !== request.sessionId || reply.fromAgentId !== options.providerId || reply.toAgentId !== 'buyer' || reply.currency !== request.currency || reply.round !== round || reply.questionTemplateId !== request.questionTemplateId || reply.evidencePolicyId !== request.evidencePolicyId || reply.maxAgeSeconds !== request.maxAgeSeconds || reply.deliverySlaSeconds !== request.deliverySlaSeconds || Date.parse(reply.expiresAt) > Date.parse(request.expiresAt) || Date.parse(reply.expiresAt) > Date.parse(originalDeadline)) throw new Error('REPLY_BINDING_MISMATCH');
  transcript.push(reply);
  await options.onMessage?.(reply,'IN');
  const peerDecision = receivedDecision(result, reply);
  if (peerDecision) decisions.push(peerDecision);
  if (reply.action === 'REJECT' || reply.action === 'ERROR') return { status: 'REJECTED' as const, runId, transcript, decisions, mode };
  if (reply.action === 'EXPIRE' || Date.parse(reply.expiresAt) <= Date.now()) return { status: 'EXPIRED' as const, runId, transcript, decisions, mode };
  if (!reply.priceMinor || !reply.quoteId || !reply.termsHash) throw new Error('MISSING_QUOTE_TERMS');
  if (reply.action === 'ACCEPT') {
   if (request.action !== 'ACCEPT' || reply.quoteId !== request.quoteId || reply.priceMinor !== request.priceMinor || reply.termsHash !== request.termsHash || reply.offerId !== request.offerId || reply.expiresAt !== request.expiresAt || BigInt(reply.priceMinor) > cap) throw new Error('INVALID_ACCEPTANCE');
   if(currency===HEDERA_CURRENCY){
    const part=result.parts.find(part=>part.mediaType===PAYMENT_MEDIA_TYPE);if(part?.content?.$case!=='data')throw new Error('PAYMENT_RESOURCE_REQUIRED');
    const info=part.content.value as {quote:PaymentQuote;resourceUrl:string;payTo:string};const expected:PaymentQuote={runId,quoteId:reply.quoteId,termsHash:reply.termsHash,priceMinor:reply.priceMinor,currency,expiresAt:reply.expiresAt};
    if(!info||paymentDigest(info.quote)!==paymentDigest(expected)||info.resourceUrl!==url.origin+'/paid-answers/'+encodeURIComponent(runId)||!/^0\.0\.[1-9][0-9]*$/.test(info.payTo))throw new Error('PAYMENT_RESOURCE_BINDING_MISMATCH');
    return {status:'AGREED' as const,deliveryStatus:'PAYMENT_REQUIRED' as const,priceMinor:reply.priceMinor,runId,transcript,decisions,mode,paymentRequired:{quote:expected,resourceUrl:info.resourceUrl,payTo:info.payTo}};
   }
   const answerPart = result.parts.find(part => part.mediaType === ANSWER_MEDIA_TYPE && part.content?.$case === 'data');
   if (!answerPart || answerPart.content?.$case !== 'data') throw new Error('ANSWER_DATA_REQUIRED');
   const answer: AnswerEnvelope = AnswerEnvelopeSchema.parse(answerPart.content.value);
   if (answer.runId !== runId || answer.sessionId !== request.sessionId || answer.negotiationId !== request.negotiationId || answer.questionTemplateId !== questionTemplateId || answer.providerId !== options.providerId || answer.acceptedQuoteId !== request.quoteId || answer.evidencePolicyId !== request.evidencePolicyId || answer.chainId !== scenario.chainId || answer.metric !== scenario.metric || answer.unit !== scenario.unit || answer.methodologyVersion !== scenario.methodologyVersion || answer.sourceContract !== scenario.sourceContract) throw new Error('ANSWER_BINDING_MISMATCH');
   const computationPart=result.parts.find(p=>p.mediaType==='application/vnd.data-leases.computation+json;v=1');
   const computation=computationPart?.content?.$case==='data'?ComputationResultSchema.parse(computationPart.content.value):undefined;
   if(scenario.operation==='COMPUTE'&&!computation)throw new Error('COMPUTATION_RESULT_REQUIRED');
   return { status: 'AGREED' as const, computation, deliveryStatus: 'DELIVERED_UNVERIFIED' as const, priceMinor: reply.priceMinor, runId, transcript, decisions, mode, answer };
  }
  if(reply.action==='PROPOSE'&&hashTerms(reply)!==reply.termsHash)throw new Error('INVALID_QUOTE_HASH');
  if (reply.action !== 'PROPOSE') throw new Error('UNEXPECTED_NEGOTIATION_ACTION');
  if(options.quoteOnly||(options.deferAcceptance&&BigInt(reply.priceMinor)<=cap&&round<maxRounds))return {status:'QUOTED' as const,runId,transcript,decisions,mode,quote:reply};
  if (round === maxRounds) return {status:'REJECTED' as const,runId,transcript,decisions,mode};
  if (strategy) {
   pendingDecision = checkedDecision(await withinDeadline(() => strategy!.buyer({quoteMinor:reply.priceMinor!,capMinor:cap.toString(),round}),Math.min(Date.parse(originalDeadline),Date.parse(reply.expiresAt))));
   if (!['ACCEPT','COUNTER','REJECT'].includes(pendingDecision.action) || (pendingDecision.action !== 'REJECT' && (!pendingDecision.priceMinor || BigInt(pendingDecision.priceMinor) > cap)) || (pendingDecision.action === 'ACCEPT' && pendingDecision.priceMinor !== reply.priceMinor) || (pendingDecision.action === 'COUNTER' && BigInt(pendingDecision.priceMinor!) >= BigInt(reply.priceMinor!))) throw new Error('INVALID_BUYER_DECISION');
   if (Math.min(Date.parse(originalDeadline),Date.parse(reply.expiresAt)) <= Date.now()) return {status:'EXPIRED' as const,runId,transcript,decisions,mode};
   request = {...reply,fromAgentId:'buyer',toAgentId:options.providerId,action:pendingDecision.action,priceMinor:pendingDecision.priceMinor ?? reply.priceMinor,reasonCode:'AI_DECISION'};
   pendingDecision = {...pendingDecision,priceMinor:request.priceMinor};
  } else request = { ...reply, fromAgentId: 'buyer', toAgentId: options.providerId, action: BigInt(reply.priceMinor) <= cap ? 'ACCEPT' : 'COUNTER', priceMinor: BigInt(reply.priceMinor) <= cap ? reply.priceMinor : cap.toString() };
 }
 return { status: 'REJECTED' as const, runId, transcript, decisions, mode };
}

export * from './compute.js';

export * from './scenarios.js';

export * from './strategy.js';

export * from './payments.js';
export {PROVIDER_PROFILES,providerPrefix,providerRecipient,providerComputeEnvironment,providerRates} from './provider-profiles.js';
export type {SellerStyle} from './provider-profiles.js';
export {PublicProviderProfileSchema} from './provider-profiles.js';
export type {PublicProviderProfile} from './provider-profiles.js';

export {bundleTermsHash,bundlePaymentQuote} from './fixed-bundle.js';
