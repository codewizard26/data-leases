import {EventStore} from '@data-leases/event-store';
import {RunVerificationClient} from './run-verification.js';
import {type ArkivClient,type VerificationClient} from '@data-leases/contracts';
import {LeaseStore,LeasePolicySchema} from './lease-store.js';
import {RunOrchestrator,RunInputSchema} from './orchestrator.js';
import {getPaymentSetup} from './payment-setup.js';
import {resolve} from 'node:path';
import { createCreRunner, type CreRunner } from './cre-runner.js';
import { randomUUID } from 'node:crypto';
import { MockVerificationClient } from '@data-leases/cre-adapter';
import { VerificationRequestSchema, VerificationResultSchema, type NegotiationMessage, type AnswerEnvelope, type VerificationResult } from '@data-leases/contracts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { PaymentJournal, payHederaAnswer,reconcileHederaPayment, HEDERA_CURRENCY, createComputeAdapter, AiNegotiationStrategy, negotiate, DEMO_SCENARIOS, QUESTION_TEMPLATE } from '@data-leases/agents';

export interface GatewayOptions {
  port?: number;
  dataDirectory?:string;
  verificationClient?:VerificationClient;
  arkivClient?:ArkivClient;
  creRunner?: CreRunner;
  providerOrigins?: readonly string[];
}
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new RequestError(415, 'JSON_REQUIRED');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.byteLength;
    if (bytes > 8192) throw new RequestError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(400, 'INVALID_JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RequestError(400, 'INVALID_INPUT');
  return value as Record<string, unknown>;
}
function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_LOCAL_PROVIDER_ORIGIN');
  return url.origin;
}
/** The live demo intentionally supplies no independent evidence to the mock verifier. */
async function verifyDeliveredAnswer(answer: AnswerEnvelope): Promise<VerificationResult> {
  const verificationId = randomUUID();
  try {
    const input = VerificationRequestSchema.parse({schemaVersion:'1.0.0', verificationId,
      runId:answer.runId, sessionId:answer.sessionId, providerId:answer.providerId,
      questionTemplateId:answer.questionTemplateId, answer,
      policy:{policyId:answer.evidencePolicyId,version:'1.0.0',allowedChainIds:[answer.chainId],
        allowedMetricIds:[answer.metric],maxAgeSeconds:60,maxAbsDeltaRaw:'0'},
      requestedAt:new Date().toISOString()});
    const client = new MockVerificationClient();
    await client.submit(input);
    const result = await client.getResult(verificationId);
    if (!result) throw new Error('VERIFICATION_RESULT_UNAVAILABLE');
    return VerificationResultSchema.parse(result);
  } catch {
    // Keep the delivered answer even if the adapter cannot evaluate it.
    return VerificationResultSchema.parse({schemaVersion:'1.0.0',verificationId,runId:answer.runId,
      providerId:answer.providerId,executionMode:'MOCK',status:'INCONCLUSIVE',
      checks:[{checkId:'VERIFICATION_ADAPTER_AVAILABLE',status:'UNKNOWN',reasonCode:'ADAPTER_UNAVAILABLE'}],
      executedAt:new Date().toISOString(),evidenceRefs:[]});
  }
}
export async function startGateway(options: GatewayOptions = {}) {
  const creRunner = options.creRunner ?? createCreRunner();
  const origins = options.providerOrigins ?? ['http://127.0.0.1:4101', 'http://127.0.0.1:4102'];
  if (!origins.length||origins.length>20) throw new Error('INVALID_PROVIDER_COUNT');
  const providers = origins.map((origin, index) => ({providerId: `provider-${String.fromCharCode(97+index)}`, origin: localOrigin(origin)}));
  const quotes=new Map<string,{providerId:string;origin:string;quote:NegotiationMessage;questionTemplateId:string;payTo:string}>();
  let buyerJournal:PaymentJournal|undefined;
  let paymentInFlight=false;
  const directory=options.dataDirectory??resolve(process.env.DATA_DIRECTORY??'data/tmp/runtime');
  buyerJournal=new PaymentJournal(resolve(directory,'buyer.sqlite'));
  const eventStore=new EventStore({directory:resolve(directory,'events')});
  const leaseStore=new LeaseStore(resolve(directory,'leases.sqlite'));
  const verificationClient=options.verificationClient??new RunVerificationClient();
  const orchestrator=new RunOrchestrator({store:eventStore,leases:leaseStore,providers:providers.map((p,i)=>({...p,payTo:getPaymentSetup().providerAccounts[i]??''})),verification:verificationClient,arkiv:options.arkivClient,paymentReady:()=>getPaymentSetup().ready,paymentRecord:runId=>buyerJournal?.get('buyer:'+runId),payment:async input=>{
    const setup=getPaymentSetup();if(!setup.ready)throw new Error('PAYMENT_SETUP_REQUIRED');buyerJournal??=new PaymentJournal(resolve(directory,'buyer.sqlite'));
    return payHederaAnswer({...input,config:{accountId:process.env.HEDERA_BUYER_ACCOUNT_ID!,privateKey:process.env.HEDERA_BUYER_PRIVATE_KEY!,keyType:process.env.HEDERA_BUYER_KEY_TYPE as 'ECDSA'|'ED25519',maxTinybars:setup.maxTinybars!,journal:buyerJournal}});
  }});
  let baseUrl = '';
  let computeInFlight = false;
  let negotiationInFlight = false;
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Connection', 'close');
    const authority = new URL(baseUrl).host;
    const localhostAuthority = authority.replace('127.0.0.1', 'localhost');
    if (request.headers.host !== authority && request.headers.host !== localhostAuthority) throw new RequestError(403, 'HOST_NOT_ALLOWED');
    const path = new URL(request.url ?? '/', baseUrl).pathname;
    if(request.method==='GET'&&path==='/api/runs'){json(response,200,{runs:orchestrator.history(),sessions:eventStore.sessions()});return;}
    if(request.method==='GET'&&path.startsWith('/api/runs/')){const id=path.slice('/api/runs/'.length);const run=orchestrator.get(id);if(!run)throw new RequestError(404,'RUN_NOT_FOUND');json(response,200,run);return;}
    if(request.method==='GET'&&path.startsWith('/api/leases/')){try{json(response,200,leaseStore.get(path.slice('/api/leases/'.length)));}catch{throw new RequestError(404,'LEASE_NOT_FOUND');}return;}
    const feed=path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/events$/);
    if(request.method==='GET'&&feed){const sessionId=feed[1]!;const cursor=new URL(request.url!,baseUrl).searchParams.get('after')??request.headers['last-event-id']??'0';if(typeof cursor!=='string'||!/^\d{1,12}$/.test(cursor))throw new RequestError(400,'INVALID_CURSOR');let sequence=Number(cursor);
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const send=(event:import('@data-leases/contracts').ConversationEvent)=>{if(event.sequence>sequence){sequence=event.sequence;response.write('id: '+sequence+'\ndata: '+JSON.stringify(event)+'\n\n');}};
      orchestrator.events.on(sessionId,send);for(const event of eventStore.list(sessionId,sequence))send(event);const timer=setInterval(()=>response.write(': heartbeat\n\n'),15000);response.on('close',()=>{clearInterval(timer);orchestrator.events.off(sessionId,send);});return;
    }
    if(request.method==='GET'&&/^\/api\/sessions\/[a-zA-Z0-9-]+\/history$/.test(path)){const id=path.split('/')[3]!;await eventStore.flush();json(response,200,{events:await eventStore.inspectParquet(id),source:'PARQUET'});return;}
    if (request.method === 'GET' && path.startsWith('/api/cre/jobs/')) {
      const jobId = path.slice('/api/cre/jobs/'.length);
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(jobId)) throw new RequestError(404,'CRE_JOB_NOT_FOUND');
      const job = creRunner.get(jobId);
      if (!job) throw new RequestError(404,'CRE_JOB_NOT_FOUND');
      json(response,200,job);return;
    }
    if(request.method==='GET'&&path==='/api/payments/setup'){json(response,200,{...getPaymentSetup(),providers:providers.map(p=>({providerId:p.providerId}))});return;}
    if (request.method === 'GET' && path === '/api/health') {
      const provider = process.env.COMPUTE_PROVIDER ?? 'mock';
      const model = provider === 'mock' ? 'deterministic' : provider === 'openrouter' ? (process.env.OPENROUTER_MODEL ?? 'openrouter/free') : (process.env.ZERO_G_MODEL ?? 'not-configured');
      json(response, 200, {status:'ok', negotiation:{mode:'MOCK',liveAvailable:['openrouter','0g'].includes(provider)&&Boolean(provider==='openrouter'?process.env.OPENROUTER_API_KEY:process.env.ZERO_G_API_KEY),provider,model,maxDurationSeconds:180}, compute:{provider: ['0g', 'mock', 'openrouter'].includes(provider) ? provider : 'unsupported', model: /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) ? model : 'configured'}, providers});
      return;
    }
    if (request.method === 'GET' && path === '/api/templates') {
      json(response, 200, {templates: DEMO_SCENARIOS}); return;
    }
    if(request.method==='GET'&&['/demo','/demo/','/dashboard','/dashboard/'].includes(path)){response.writeHead(302,{Location:'http://127.0.0.1:3001/dashboard','Cache-Control':'no-store'});response.end();return;}
    if (request.method === 'GET' && ['/', '/about', '/developer'].includes(path)) {
      const html = await readFile(new URL(path !== '/developer' ? '../../web/landing.html' : '../../web/index.html', import.meta.url));
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
      response.end(html); return;
    }
    if (request.method !== 'POST' || !['/api/negotiate', '/api/compute', '/api/cre/simulate','/api/quotes','/api/payments/checkout','/api/discovery','/api/leases','/api/leases/cancel','/api/runs','/api/runs/refresh','/api/runs/publication','/api/payments/reconcile','/api/preview'].includes(path)) throw new RequestError(404, 'NOT_FOUND');
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== baseUrl && origin !== baseUrl.replace('127.0.0.1','localhost') && origin!=='http://127.0.0.1:3001' && origin!=='http://localhost:3001') throw new RequestError(403, 'ORIGIN_NOT_ALLOWED');
    const body = await readBody(request);
    if(path==='/api/payments/reconcile'){if(typeof body.runId!=='string'||!buyerJournal)throw new RequestError(400,'PAYMENT_NOT_FOUND');try{const record=await reconcileHederaPayment(buyerJournal,body.runId);orchestrator.reconciled(body.runId,record);json(response,200,{paymentStatus:record.status,payment:record.receipt});}catch{throw new RequestError(409,'PAYMENT_RECONCILIATION_REQUIRED');}return;}
    if(path==='/api/preview'){
      if(body.providerIds!==undefined&&(!Array.isArray(body.providerIds)||body.providerIds.length<1||body.providerIds.length>20||!body.providerIds.every(p=>typeof p==='string'&&providers.some(v=>v.providerId===p))))throw new RequestError(400,'INVALID_PROVIDERS');
      if(body.maxRounds!==undefined&&body.maxRounds!==2&&body.maxRounds!==3)throw new RequestError(400,'INVALID_MAX_ROUNDS');
      try{json(response,202,orchestrator.preview(Object.fromEntries(Object.entries(body).filter(([key])=>!['providerIds','maxRounds'].includes(key))),body.providerIds as string[]|undefined,body.maxRounds as number|undefined));}catch{throw new RequestError(400,'INVALID_PREVIEW');}return;
    }
    if(path==='/api/discovery'){try{json(response,200,{providers:await orchestrator.discover(body),arkivAvailable:Boolean(options.arkivClient)});}catch(error){throw new RequestError(400,error instanceof Error&&error.message==='ARKIV_NOT_CONFIGURED'?'ARKIV_NOT_CONFIGURED':'DISCOVERY_FAILED');}return;}
    if(path==='/api/leases'){const parsed=LeasePolicySchema.safeParse(body);if(!parsed.success)throw new RequestError(400,'INVALID_LEASE_POLICY');if(!DEMO_SCENARIOS.some(s=>s.questionTemplateId===parsed.data.questionTemplateId))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');const cap=getPaymentSetup().maxTinybars;if(!cap||BigInt(parsed.data.perRequestTinybars)>BigInt(cap))throw new RequestError(400,'OPERATOR_CAP_EXCEEDED');try{json(response,201,leaseStore.authorize(parsed.data));}catch{throw new RequestError(400,'INVALID_LEASE_POLICY');}return;}
    if(path==='/api/leases/cancel'){if(typeof body.leaseId!=='string')throw new RequestError(400,'INVALID_LEASE');leaseStore.cancel(body.leaseId);json(response,200,{status:'CANCELLED'});return;}
    if(path==='/api/runs'){const input=RunInputSchema.safeParse(body);if(!input.success)throw new RequestError(400,'INVALID_RUN');try{json(response,202,orchestrator.start(input.data));}catch{throw new RequestError(409,'RUN_NOT_STARTED');}return;}
    if(path==='/api/runs/refresh'||path==='/api/runs/publication'){if(typeof body.runId!=='string')throw new RequestError(400,'INVALID_RUN');try{const result=path.endsWith('refresh')?await orchestrator.refreshVerification(body.runId):await orchestrator.retryPublication(body.runId);json(response,200,result);}catch{throw new RequestError(409,'RUN_RETRY_UNAVAILABLE');}return;}
    if (path === '/api/cre/simulate') {
      if (Object.keys(body).length !== 1 || typeof body.case !== 'string' || !['valid','tampered','inconclusive'].includes(body.case)) throw new RequestError(400,'INVALID_CRE_CASE');
      try { json(response,202,creRunner.start(body.case as 'valid'|'tampered'|'inconclusive')); }
      catch(error) { if(error instanceof Error && error.message === 'CRE_BUSY') throw new RequestError(409,'CRE_BUSY');throw new RequestError(503,'CRE_SIMULATION_UNAVAILABLE'); }
      return;
    }

    if(path==='/api/quotes'){
      if(Object.keys(body).some(k=>!['questionTemplateId','providerId'].includes(k))||typeof body.questionTemplateId!=='string'||!DEMO_SCENARIOS.some(s=>s.questionTemplateId===body.questionTemplateId))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');
      const setup=getPaymentSetup();if(!setup.quotesAvailable)throw new RequestError(503,'PROVIDER_PAYMENT_SETUP_REQUIRED');
      const template=body.questionTemplateId;
      if(body.providerId!==undefined&&(typeof body.providerId!=='string'||!providers.some(p=>p.providerId===body.providerId)))throw new RequestError(400,'INVALID_PROVIDER');
      const requested=body.providerId?providers.filter(p=>p.providerId===body.providerId):providers;
      const results=await Promise.all(requested.map(async(provider)=>{
        const index=providers.findIndex(p=>p.providerId===provider.providerId);
        const payTo=setup.providerAccounts[index]!;
        try{const result=await negotiate({baseUrl:provider.origin,providerId:provider.providerId,maxPriceMinor:setup.maxTinybars??'0',questionTemplateId:template,currency:HEDERA_CURRENCY,mode:'MOCK',quoteOnly:true});
          if(result.status!=='QUOTED'||!result.quote?.quoteId)throw new Error('NO_QUOTE');
          while(quotes.size>=100)quotes.delete(quotes.keys().next().value!);
          quotes.set(result.quote.quoteId,{...provider,quote:result.quote,questionTemplateId:template,payTo});
          return {providerId:provider.providerId,status:'QUOTED',quoteId:result.quote.quoteId,runId:result.runId,amountTinybars:result.quote.priceMinor,currency:HEDERA_CURRENCY,payTo,expiresAt:result.quote.expiresAt,transcript:result.transcript,operation:DEMO_SCENARIOS.find(s=>s.questionTemplateId===template)?.operation};
        }catch{return {providerId:provider.providerId,status:'FAILED',error:'QUOTE_REQUEST_FAILED'};}
      }));json(response,200,{results,paymentReady:setup.ready,maxTinybars:setup.maxTinybars});return;
    }
    if(path==='/api/payments/checkout'){
      if(Object.keys(body).some(k=>!['quoteId','approvedAmountTinybars'].includes(k))||typeof body.quoteId!=='string'||typeof body.approvedAmountTinybars!=='string')throw new RequestError(400,'INVALID_PAYMENT_APPROVAL');
      const setup=getPaymentSetup();if(!setup.ready)throw new RequestError(503,'PAYMENT_SETUP_REQUIRED');
      if(paymentInFlight)throw new RequestError(409,'PAYMENT_IN_PROGRESS');
      const selected=quotes.get(body.quoteId);if(!selected)throw new RequestError(404,'QUOTE_NOT_FOUND');
      if(body.approvedAmountTinybars!==selected.quote.priceMinor)throw new RequestError(400,'PAYMENT_AMOUNT_CHANGED');
      if(BigInt(body.approvedAmountTinybars)>BigInt(setup.maxTinybars!))throw new RequestError(400,'PAYMENT_BUDGET_EXCEEDED');
      if(Date.parse(selected.quote.expiresAt)<=Date.now())throw new RequestError(410,'QUOTE_EXPIRED');
      paymentInFlight=true;
      try{
        const accepted=await negotiate({baseUrl:selected.origin,providerId:selected.providerId,maxPriceMinor:setup.maxTinybars!,questionTemplateId:selected.questionTemplateId,currency:HEDERA_CURRENCY,mode:'MOCK',acceptQuote:selected.quote});
        if(accepted.status!=='AGREED'||!accepted.paymentRequired)throw new RequestError(409,'QUOTE_NOT_ACCEPTED');
        if(accepted.paymentRequired.payTo!==selected.payTo)throw new RequestError(400,'PAYMENT_RECIPIENT_CHANGED');
        buyerJournal??=new PaymentJournal(resolve('data/tmp/payments/buyer.sqlite'));
        const result=await payHederaAnswer({url:accepted.paymentRequired.resourceUrl,quote:accepted.paymentRequired.quote,payTo:selected.payTo,config:{accountId:process.env.HEDERA_BUYER_ACCOUNT_ID!,privateKey:process.env.HEDERA_BUYER_PRIVATE_KEY!,keyType:process.env.HEDERA_BUYER_KEY_TYPE as 'ED25519'|'ECDSA',maxTinybars:setup.maxTinybars!,journal:buyerJournal}});
        const verification=await verifyDeliveredAnswer(result.answer);
        json(response,200,{paymentStatus:'SETTLED',amountTinybars:selected.quote.priceMinor,payTo:selected.payTo,...result,verification});
      }catch(error){if(error instanceof RequestError)throw error;const runId=selected.quote.runId;const recorded=runId?buyerJournal?.get('buyer:'+runId):undefined;json(response,409,{error:'PAYMENT_NOT_CONFIRMED',paymentStatus:recorded?.status??'NOT_SUBMITTED',payment:recorded?.receipt});}
      finally{paymentInFlight=false;}return;
    }
    if (path === '/api/negotiate') {
      if (negotiationInFlight) throw new RequestError(429,'NEGOTIATION_BUSY');
      if (Object.keys(body).some(key => !['maxPriceMinor','questionTemplateId','mode'].includes(key)) || typeof body.maxPriceMinor !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(body.maxPriceMinor)) throw new RequestError(400, 'INVALID_PRICE');
      const questionTemplateId = body.questionTemplateId === undefined ? QUESTION_TEMPLATE : body.questionTemplateId;
      if (typeof questionTemplateId !== 'string' || (questionTemplateId !== QUESTION_TEMPLATE && !DEMO_SCENARIOS.some(item => item.questionTemplateId === questionTemplateId))) throw new RequestError(400, 'INVALID_QUESTION_TEMPLATE');
      const mode = body.mode ?? 'MOCK';
      if (mode !== 'MOCK' && mode !== 'LIVE') throw new RequestError(400,'INVALID_NEGOTIATION_MODE');
      let strategy: AiNegotiationStrategy | undefined;
      if (mode === 'LIVE') {
        if (!['openrouter','0g'].includes(process.env.COMPUTE_PROVIDER ?? '')) throw new RequestError(503,'AI_NEGOTIATION_NOT_CONFIGURED');
        try { strategy = new AiNegotiationStrategy(createComputeAdapter()); } catch { throw new RequestError(503,'AI_NEGOTIATION_NOT_CONFIGURED'); }
      }
      const maxPriceMinor = body.maxPriceMinor;
      negotiationInFlight = true;
      try {
      const results = await Promise.all(providers.map(async provider => {
        const connection = {providerId:provider.providerId, cardUrl:`${provider.origin}/.well-known/agent-card.json`, a2aEndpoint:`${provider.origin}/a2a`, protocol:'A2A 1.0 JSONRPC', discoverySource:'LOCAL_REGISTRY'};
        try {
          const sessionId=randomUUID();
          const record=(eventType:import('@data-leases/contracts').ConversationEvent['eventType'],status:string,payload:unknown,message?:NegotiationMessage,direction:'IN'|'OUT'|'INTERNAL'='INTERNAL')=>{const event=eventStore.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId,runId:sessionId,occurredAt:new Date().toISOString(),eventType,actorRole:message?(direction==='OUT'?'BUYER_AGENT':'PROVIDER_AGENT'):'GATEWAY',actorId:message?.fromAgentId??'gateway',providerId:provider.providerId,direction,status,messageId:message?.messageId,negotiationId:message?.negotiationId,priceMinor:message?.priceMinor,currency:message?.currency,payload});orchestrator.events.emit(sessionId,event);};
          record('DISCOVERY_STARTED','STARTED',connection);
          const result = await negotiate({baseUrl:provider.origin, providerId:provider.providerId, maxPriceMinor, questionTemplateId, strategy, mode,sessionId,runId:sessionId,onMessage:(message,direction)=>record(direction==='OUT'?'A2A_SENT':'A2A_RECEIVED',message.action,message,message,direction)});
          record('NEGOTIATION_OUTCOME',result.status,{status:result.status});
          if(result.answer)record('ANSWER_DELIVERED','UNPAID_DEVELOPMENT',{answer:result.answer,computation:result.computation});
          const verification = result.answer ? await verifyDeliveredAnswer(result.answer) : undefined;
          if(verification)record('VERIFICATION_RESULT',verification.executionMode+':'+verification.status,verification);
          leaseStore.claim(sessionId,{runId:sessionId,sessionId,leaseId:'UNPAID_DEVELOPMENT',status:result.status,paymentStatus:'UNPAID_DEVELOPMENT',deliveryStatus:result.deliveryStatus??'NOT_REQUESTED',verificationStatus:verification?verification.executionMode+':'+verification.status:'NOT_REQUESTED',publicationStatus:'NOT_REQUESTED',answer:result.answer,computation:result.computation,verification,quote:result.transcript.at(-1)});
          await eventStore.flush();
          return {...connection, ...result, negotiationMode:mode, ...(verification ? {verification} : {}), stages:{discovery:'DISCOVERED', negotiation:result.status, answer:result.answer ? 'DELIVERED_UNVERIFIED' : 'NOT_REQUESTED', verification:verification ? `${verification.executionMode}:${verification.status}` : 'NOT_REQUESTED', payment:'DISABLED'}};
        }
        catch { return {...connection, status:'FAILED', error:'NEGOTIATION_FAILED', transcript:[], stages:{discovery:'UNKNOWN', negotiation:'FAILED', answer:'NOT_REQUESTED', verification:'NOT_REQUESTED', payment:'DISABLED'}}; }
      }));
      json(response, 200, {results}); return;
      } finally { negotiationInFlight = false; }
    }
    if (Object.keys(body).length !== 1 || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 4000) throw new RequestError(400, 'INVALID_PROMPT');
    if (computeInFlight) throw new RequestError(429, 'COMPUTE_BUSY');
    computeInFlight = true;
    try {
      const adapter = createComputeAdapter();
      const result = await adapter.generate({messages:[{role:'user',content:body.prompt}]});
      json(response, 200, result);
    } catch (error) {
      if (error instanceof Error && error.message === 'COMPUTE_HTTP_429') throw new RequestError(429, 'COMPUTE_RATE_LIMITED');
      if (error instanceof Error && error.message === 'COMPUTE_HTTP_401') throw new RequestError(502, 'COMPUTE_AUTH_FAILED');
      throw new RequestError(502, 'COMPUTE_UNAVAILABLE');
    }
    finally { computeInFlight = false; }
  };
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => {
      if (!response.headersSent) json(response, error instanceof RequestError ? error.status : 500, {error:error instanceof RequestError ? error.code : 'REQUEST_FAILED'});
      else response.end();
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error',reject);server.listen(options.port ?? 3000,'127.0.0.1',resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {baseUrl, close: () => new Promise<void>((resolve, reject) => {server.close(error => {void orchestrator.drain().then(()=>verificationClient instanceof RunVerificationClient?verificationClient.close():undefined).then(()=>eventStore.close()).then(()=>{leaseStore.close();buyerJournal?.close();if(error)reject(error);else resolve();},reject);});server.closeAllConnections();})};
}
