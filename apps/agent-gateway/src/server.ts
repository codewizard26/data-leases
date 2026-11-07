import {publicAnalytics} from './public-analytics.js';
import {BuyerHttp,BuyerHttpError} from './buyer-http.js';
import {BuyerStore} from './buyer-store.js';
import {BuyerAuth,devLoginFromEnv,privyConfigFromEnv,privyVerifier,secureCookiesFromEnv} from './buyer-auth.js';
import {BuyerSessionStore} from './buyer-session-store.js';
import {AnalysisPersonaSchema,ANALYSIS_REQUIREMENTS,MeasurementIdsSchema} from '@data-leases/contracts';
import {registryOffers,syncRegistryOffers,registryServiceHistory,type MarketplaceQueries} from './arkiv-marketplace.js';
import {providerOffers} from './provider-directory.js';
import {PROVIDER_PROFILES,providerPrefix,providerRecipient} from '@data-leases/agents';
import {MarketFeed} from './market-feed.js';
import {readPlan,SERVICE_POLICIES} from '@data-leases/cre-adapter';
import {discloseRun} from './data-access.js';
import type {ArkivEvidenceClient} from '@data-leases/arkiv';
import {LeaseScheduler} from './lease-scheduler.js';
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
import { PaymentJournal, payHederaAnswer,reconcileHederaPayment, HEDERA_CURRENCY, createComputeAdapter, AiNegotiationStrategy, negotiate, DEMO_SCENARIOS, publicTaskTemplate, QUESTION_TEMPLATE } from '@data-leases/agents';

export interface GatewayOptions {
  port?: number;
  buyerAuthEnabled?:boolean;
  buyerAuth?:BuyerAuth;
  liveOnly?:boolean;
  negotiationStrategy?:AiNegotiationStrategy;
  dataDirectory?:string;
  verificationClient?:VerificationClient;
  verificationStatus?:(id:string)=>string;
  arkivClient?:ArkivClient;
  evidenceQueries?:Pick<ArkivEvidenceClient,'queryLatestAcceptedAnswer'|'queryReceiptsByRunId'>&Partial<MarketplaceQueries>;
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
  const liveOnly=options.liveOnly??false;
  const liveTask=(id:string)=>!liveOnly||((Boolean(readPlan(id))&&process.env.PROVIDER_LINK_SOURCE_ENABLED==='true')||(id==='AI_LINK_EXPLANATION'&&Boolean(options.negotiationStrategy)));
  const creRunner = options.creRunner ?? createCreRunner();
  const origins = options.providerOrigins ?? PROVIDER_PROFILES.map(profile=>'http://127.0.0.1:'+(process.env[providerPrefix(profile.providerId)+'_PORT']??profile.port));
  if (!origins.length||origins.length>20) throw new Error('INVALID_PROVIDER_COUNT');
  const providers = origins.map((origin, index) => ({providerId: `provider-${String.fromCharCode(97+index)}`, origin: localOrigin(origin)}));
  const quotes=new Map<string,{providerId:string;origin:string;quote:NegotiationMessage;questionTemplateId:string;payTo:string}>();
  let buyerJournal:PaymentJournal|undefined;
  let paymentInFlight=false;
  const directory=options.dataDirectory??resolve(process.env.DATA_DIRECTORY??'data/tmp/runtime');
  buyerJournal=new PaymentJournal(resolve(directory,'buyer.sqlite'));
  const eventStore=new EventStore({directory:resolve(directory,'events')});
  const leaseStore=new LeaseStore(resolve(directory,'leases.sqlite'));
  const buyerSessions=options.buyerAuth?undefined:new BuyerSessionStore(resolve(directory,'buyer-auth.sqlite'));
  const privyConfig=privyConfigFromEnv();
  const buyerAuth=options.buyerAuth??new BuyerAuth(buyerSessions!,privyConfig?privyVerifier(privyConfig):undefined,{secureCookies:secureCookiesFromEnv(),devLogin:devLoginFromEnv()});
  const buyers=new BuyerStore(leaseStore);
  const buyerHttp=new BuyerHttp(buyerAuth,buyers,options.buyerAuthEnabled??(process.env.BUYER_AUTH_ENABLED==='true'||buyerAuth.configured),()=>getPaymentSetup().maxTinybars,(leaseId,status)=>scheduleEvent(leaseId,status,{}));
  const verificationClient=options.verificationClient??new RunVerificationClient();
  const market=new MarketFeed(eventStore,providers);
  const observationJobs=new Map<string,string>();
  const registrySyncs=new Map<string,Promise<unknown>>();
  const verificationStatus=options.verificationStatus??(verificationClient instanceof RunVerificationClient?verificationClient.getStatus.bind(verificationClient):()=> 'PENDING');
  const orchestrator=new RunOrchestrator({store:eventStore,leases:leaseStore,providers:providers.map(p=>({...p,payTo:providerRecipient(p.providerId)??''})),verification:verificationClient,arkiv:options.arkivClient,liveOnly,negotiationMode:liveOnly?'LIVE':'MOCK',strategy:options.negotiationStrategy,validateFixedQuote:async quote=>{if(!options.evidenceQueries?.queryProviderOffers)throw Error('ARKIV_NOT_CONFIGURED');for(const item of quote.items){const offers=await registryOffers(providers,item.questionTemplateId,{queryProviderOffers:options.evidenceQueries.queryProviderOffers.bind(options.evidenceQueries)});const offer=offers.find(o=>o.providerId===quote.providerId&&o.available&&o.paymentReady);if(!offer||offer.askMinor!==item.priceMinor||quote.analysis&&(!offer.analysis?.available||offer.analysis.priceMinor!==quote.analysis.priceMinor))throw Error('FIXED_RATE_CHANGED');}},paymentReady:()=>getPaymentSetup().ready,paymentRecord:runId=>buyerJournal?.get('buyer:'+runId),payment:async input=>{
    const setup=getPaymentSetup();if(!setup.ready)throw new Error('PAYMENT_SETUP_REQUIRED');buyerJournal??=new PaymentJournal(resolve(directory,'buyer.sqlite'));
    return payHederaAnswer({...input,config:{accountId:process.env.HEDERA_BUYER_ACCOUNT_ID!,privateKey:process.env.HEDERA_BUYER_PRIVATE_KEY!,keyType:process.env.HEDERA_BUYER_KEY_TYPE as 'ECDSA'|'ED25519',maxTinybars:setup.maxTinybars!,journal:buyerJournal,authorize:()=>{const run=leaseStore.run(input.quote.runId) as {leaseId:string}|undefined;if(!run)throw new Error('LEASE_EXPIRED_OR_CANCELLED');const lease=leaseStore.get(run.leaseId);if(!lease.active||Date.parse(lease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED_OR_CANCELLED');if(buyerHttp.enabled&&!leaseStore.buyerDatabase().prepare('SELECT 1 FROM buyer_lease_owners WHERE lease_id=? AND revision>0').get(run.leaseId))throw new Error('HUMAN_APPROVAL_REQUIRED');}}});
  }});
  const scheduleEvent=(leaseId:string,status:string,payload:unknown)=>{eventStore.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId:leaseId,occurredAt:new Date().toISOString(),eventType:'NEGOTIATION_OUTCOME',actorRole:'GATEWAY',actorId:'lease-scheduler',direction:'INTERNAL',status,payload:{leaseId,...(typeof payload==='object'&&payload!==null?payload:{})}});void eventStore.flush().catch(()=>{});};
  const scheduler=new LeaseScheduler({leases:leaseStore,runner:orchestrator,ready:()=>getPaymentSetup().ready,event:scheduleEvent});
  let baseUrl = '';
  let computeInFlight = false;
  let negotiationInFlight = false;
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Connection', 'close');
    const authority = new URL(baseUrl).host;
    const localhostAuthority = authority.replace('127.0.0.1', 'localhost');
    if (request.headers.host !== authority && request.headers.host !== localhostAuthority) throw new RequestError(403, 'HOST_NOT_ALLOWED');
    const path = new URL(request.url ?? '/', baseUrl).pathname;
    if(await buyerHttp.handle(request,response,path,baseUrl,()=>readBody(request),(status,value)=>json(response,status,value)))return;
    const privateRoute=/^\/api\/(leases|mandates|runs|sessions|payments\/(checkout|reconcile)|registry\/offers\/sync|preview|negotiate|compute)(\/|$)/.test(path);
    const buyer=buyerHttp.enabled&&privateRoute?buyerHttp.require(request,request.method!=='GET'):undefined;
    const ownsLease=(id:string)=>{if(buyer)buyers.assertOwner(buyer.buyerId,id);};
    const ownsRun=(id:string)=>{if(!buyer)return;const run=orchestrator.get(id);if(!run)throw new RequestError(404,'RUN_NOT_FOUND');try{buyers.assertOwner(buyer.buyerId,run.leaseId);}catch{buyers.assertResource(buyer.buyerId,'RUN',id);}};
    const ownsSession=(id:string)=>{if(!buyer)return;if(orchestrator.get(id)){ownsRun(id);return;}buyers.assertOwner(buyer.buyerId,id);};
    if(buyer&&['/api/payments/checkout','/api/negotiate'].includes(path))throw new RequestError(403,'OWNED_LEASE_REQUIRED');
    if(request.method==='GET'&&path==='/api/public/analytics'){
      if(!options.evidenceQueries?.queryProviderHistory)throw new RequestError(503,'ARKIV_NOT_CONFIGURED');
      try{json(response,200,await publicAnalytics(providers,{queryProviderHistory:options.evidenceQueries.queryProviderHistory.bind(options.evidenceQueries)}));}catch{throw new RequestError(503,'ARKIV_ANALYTICS_UNAVAILABLE');}return;
    }
    if(request.method==='GET'&&path==='/api/buyer/overview'){
      const session=buyerHttp.require(request);
      const spending=leaseStore.buyerSpending(session.buyerId);
      json(response,200,{...spending,runs:orchestrator.history().filter(run=>{try{buyers.assertOwner(session.buyerId,run.leaseId);return true;}catch{return false;}}).map(run=>discloseRun(run,true))});return;
    }
    if(request.method==='GET'&&path==='/api/integrations'){json(response,200,{liveOnly,negotiation:{mode:liveOnly?'LIVE':'MOCK',available:!liveOnly||Boolean(options.negotiationStrategy)},blockers:[],verification:{executionMode:'CRE_CLI_SIMULATION',available:true,durable:Boolean(options.evidenceQueries),notice:'Local CRE CLI simulation; no DON deployment required.',services:SERVICE_POLICIES.map(service=>({questionTemplateId:service.questionTemplateId,referenceAvailable:Boolean(readPlan(service.questionTemplateId)),reason:readPlan(service.questionTemplateId)?undefined:service.private?'AUTHORIZED_PRIVATE_SOURCE_REQUIRED':service.operation==='COMPUTE'?'COMPUTATION_OUTPUT_NOT_BOUND':'METHODOLOGY_REFERENCE_REQUIRED'}))},arkiv:{connected:Boolean(options.arkivClient),publishingEnabled:Boolean(options.arkivClient)&&process.env.ARKIV_PUBLISHING_ENABLED==='true',network:'Rabdi'},linkSource:{enabled:process.env.PROVIDER_LINK_SOURCE_ENABLED==='true',chainId:'eip155:1'}});return;}
    if(request.method==='GET'&&path==='/api/bundles/offers'){
      const params=new URL(request.url!,baseUrl).searchParams,ids=MeasurementIdsSchema.parse(params.getAll('measurementId')),analysisPersona=params.has('analysisPersona')?AnalysisPersonaSchema.parse(params.get('analysisPersona')):undefined;
      if(ids.some(id=>!readPlan(id)||!liveTask(id)))throw new RequestError(400,'UNSUPPORTED_MEASUREMENT');
      if(!options.evidenceQueries?.queryProviderOffers)throw new RequestError(503,'ARKIV_NOT_CONFIGURED');
      const groups=await Promise.all(ids.map(async id=>{const published=await registryOffers(providers,id,{queryProviderOffers:options.evidenceQueries!.queryProviderOffers!.bind(options.evidenceQueries)}).catch(arkivError);const drafts=(await providerOffers(providers,id)).filter(p=>!published.some(q=>q.providerId===p.providerId)).map(p=>({...p,source:'LOCAL_REGISTRY' as const}));return [...published,...drafts];}));
      const offers=providers.map(provider=>{const items=ids.map((id,index)=>({questionTemplateId:id,offer:groups[index]!.find(p=>p.providerId===provider.providerId)}));const first=items[0]!.offer;const analysis=analysisPersona?items[0]?.offer?.analysis:undefined;const analysisReady=!analysisPersona||Boolean(analysis?.available&&analysis.priceMinor&&items.every(i=>i.offer?.source==='ARKIV'&&i.offer.analysis?.priceMinor===analysis.priceMinor)&&ANALYSIS_REQUIREMENTS[analysisPersona].every(id=>ids.includes(id))&&ids.every(id=>id.startsWith('AAVE_V3_USDC_')));const published=items.every(i=>i.offer?.source==='ARKIV')&&analysisReady,available=items.every(i=>i.offer?.available&&i.offer.askMinor)&&analysisReady;return {...first,providerId:provider.providerId,questionTemplateId:ids[0],source:published?'ARKIV':'LOCAL_REGISTRY',available,paymentReady:items.every(i=>i.offer?.paymentReady),analysis:analysisPersona&&analysis?{...analysis,persona:analysisPersona}:undefined,askMinor:available?items.reduce((sum,i)=>sum+BigInt(i.offer!.askMinor!),BigInt(analysis?.priceMinor??'0')).toString():undefined,registryUrl:published&&first&&'registryUrl' in first?first.registryUrl:undefined,items:items.map(i=>({questionTemplateId:i.questionTemplateId,title:DEMO_SCENARIOS.find(s=>s.questionTemplateId===i.questionTemplateId)?.title,priceMinor:i.offer?.askMinor,source:i.offer?.source})),status:available?'AVAILABLE':analysisPersona&&!analysisReady?'ANALYSIS_NOT_LISTED':'UNAVAILABLE'};});
      json(response,200,{source:'ARKIV',providers:offers});return;
    }
    if(request.method==='GET'&&path==='/api/providers'){
      const template=new URL(request.url!,baseUrl).searchParams.get('questionTemplateId');if(!template||!DEMO_SCENARIOS.some(task=>!task.retired&&task.questionTemplateId===template))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');
      const source=new URL(request.url!,baseUrl).searchParams.get('source')??'ARKIV';
      if(source==='LOCAL_REGISTRY'){json(response,200,{source,providers:await providerOffers(providers,template),notice:'Local draft rates; these are not Arkiv listings.'});return;}
      if(source!=='ARKIV')throw new RequestError(400,'INVALID_DISCOVERY_SOURCE');
      if(!options.evidenceQueries?.queryProviderOffers)throw new RequestError(503,'ARKIV_MARKETPLACE_NOT_CONFIGURED');
      try{const listed=await registryOffers(providers,template,{queryProviderOffers:options.evidenceQueries.queryProviderOffers.bind(options.evidenceQueries)});const drafts=(await providerOffers(providers,template)).filter(profile=>!listed.some(offer=>offer.providerId===profile.providerId)).map(profile=>({...profile,source:'LOCAL_REGISTRY'}));json(response,200,{source:'ARKIV',providers:listed,drafts,notice:'Arkiv listings can be selected for mandates. Unlisted local agents are comparison-only drafts.'});}catch{throw new RequestError(503,'ARKIV_MARKETPLACE_UNAVAILABLE');}return;
    }
    if(request.method==='GET'&&path==='/api/registry/history'){
      const params=new URL(request.url!,baseUrl).searchParams,template=params.get('questionTemplateId'),providerId=params.get('providerId')??undefined;
      if(!template||!DEMO_SCENARIOS.some(task=>!task.retired&&task.questionTemplateId===template)||providerId&&!providers.some(provider=>provider.providerId===providerId))throw new RequestError(400,'INVALID_HISTORY_FILTER');
      if(!options.evidenceQueries?.queryProviderHistory)throw new RequestError(503,'ARKIV_HISTORY_NOT_CONFIGURED');
      try{json(response,200,{source:'ARKIV',entries:await registryServiceHistory(template,providerId,{queryProviderHistory:options.evidenceQueries.queryProviderHistory.bind(options.evidenceQueries),queryReceiptsByRunId:options.evidenceQueries.queryReceiptsByRunId.bind(options.evidenceQueries)},providers)});}catch{throw new RequestError(503,'ARKIV_HISTORY_UNAVAILABLE');}return;
    }
    if(request.method==='GET'&&path==='/api/market/events'){
      const params=new URL(request.url!,baseUrl).searchParams,template=params.get('questionTemplateId')??'AAVE_V3_USDC_AVAILABLE_LIQUIDITY';
      if(!readPlan(template)||!liveTask(template))throw new RequestError(409,'LIVE_SOURCE_NOT_AVAILABLE');
      const selected=params.getAll('providerId');if(selected.some(id=>!providers.some(provider=>provider.providerId===id)))throw new RequestError(400,'INVALID_PROVIDERS');
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});response.flushHeaders();
      const unsubscribe=market.subscribe(template,event=>{if(response.writableEnded)return;response.write('data: '+JSON.stringify(event)+'\n\n');if(event.status==='SOURCE_REQUEST_COMPLETED')response.end();},selected.length?selected:undefined);
      request.on('close',unsubscribe);return;
    }
    if(request.method==='GET'&&path.startsWith('/api/observations/verification/')){if(![...observationJobs.values()].includes(path.slice('/api/observations/verification/'.length)))throw new RequestError(404,'VERIFICATION_NOT_FOUND');const result=await verificationClient.getResult(path.slice('/api/observations/verification/'.length));json(response,200,{state:result?'COMPLETED':verificationStatus(path.slice('/api/observations/verification/'.length))==='FAILED'?'FAILED':'PENDING',result});return;}
    if(request.method==='GET'&&path==='/api/services/status'){json(response,200,{services:DEMO_SCENARIOS.filter(task=>!task.retired).map(task=>({questionTemplateId:task.questionTemplateId,title:task.title,available:liveTask(task.questionTemplateId),reason:liveTask(task.questionTemplateId)?undefined:task.dataAccess.classification==='PRIVATE'?'PRIVATE_SOURCE_NOT_CONFIGURED':'LIVE_SOURCE_NOT_IMPLEMENTED'}))});return;}
    if(request.method==='GET'&&path==='/api/evidence/latest'){
      if(!options.evidenceQueries)throw new RequestError(503,'ARKIV_NOT_CONFIGURED');
      const params=new URL(request.url!,baseUrl).searchParams;const metric=params.get('metric')??'ERC20_DECIMALS';
      if(!DEMO_SCENARIOS.some(task=>!task.retired&&task.metric===metric))throw new RequestError(400,'UNSUPPORTED_EVIDENCE_METRIC');
      try{const answer=await options.evidenceQueries.queryLatestAcceptedAnswer({metric,maxAgeSeconds:86400});const receipts=answer&&'runId' in answer.record?await options.evidenceQueries.queryReceiptsByRunId(answer.record.runId):[];json(response,200,{answer,receipts});}catch{throw new RequestError(503,'ARKIV_QUERY_UNAVAILABLE');}return;
    }
    if(request.method==='GET'&&path==='/api/runs'){json(response,200,{runs:orchestrator.history().filter(run=>{try{ownsRun(run.runId);return true;}catch{return false;}}).map(run=>discloseRun(run,true)),sessions:eventStore.sessions().filter(row=>{try{ownsSession(row.sessionId);return true;}catch{return false;}})});return;}
    if(request.method==='GET'&&path.startsWith('/api/runs/')){const id=path.slice('/api/runs/'.length);ownsRun(id);const run=orchestrator.get(id);if(!run)throw new RequestError(404,'RUN_NOT_FOUND');json(response,200,discloseRun(run));return;}
    if(request.method==='GET'&&path==='/api/mandates'){json(response,200,{mandates:leaseStore.mandates().filter(lease=>{try{ownsLease(lease.policy.leaseId);return true;}catch{return false;}})});return;}
    if(request.method==='GET'&&path==='/api/leases'){json(response,200,{leases:leaseStore.schedules().filter(row=>{try{ownsLease(row.leaseId);return true;}catch{return false;}}).map(row=>({...row,...leaseStore.get(row.leaseId)}))});return;}
    if(request.method==='GET'&&path.startsWith('/api/leases/')){try{ownsLease(path.slice('/api/leases/'.length));json(response,200,leaseStore.get(path.slice('/api/leases/'.length)));}catch{throw new RequestError(404,'LEASE_NOT_FOUND');}return;}
    const feed=path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/events$/);
    if(request.method==='GET'&&feed){const sessionId=feed[1]!;ownsSession(sessionId);const cursor=new URL(request.url!,baseUrl).searchParams.get('after')??request.headers['last-event-id']??'0';if(typeof cursor!=='string'||!/^\d{1,12}$/.test(cursor))throw new RequestError(400,'INVALID_CURSOR');let sequence=Number(cursor);
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const send=(event:import('@data-leases/contracts').ConversationEvent)=>{if(buyer&&!buyerHttp.session(request)){response.end();return;}if(event.sequence>sequence){sequence=event.sequence;response.write('id: '+sequence+'\ndata: '+JSON.stringify(event)+'\n\n');}};
      orchestrator.events.on(sessionId,send);for(const event of eventStore.list(sessionId,sequence))send(event);const timer=setInterval(()=>{if(buyer&&!buyerHttp.session(request))response.end();else response.write(': heartbeat\n\n');},15000);response.on('close',()=>{clearInterval(timer);orchestrator.events.off(sessionId,send);});return;
    }
    if(request.method==='GET'&&/^\/api\/sessions\/[a-zA-Z0-9-]+\/history$/.test(path)){const id=path.split('/')[3]!;ownsSession(id);await eventStore.flush();json(response,200,{events:await eventStore.inspectParquet(id),source:'PARQUET'});return;}
    if (request.method === 'GET' && path.startsWith('/api/cre/jobs/')) {
      const jobId = path.slice('/api/cre/jobs/'.length);
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(jobId)) throw new RequestError(404,'CRE_JOB_NOT_FOUND');
      const job = creRunner.get(jobId);
      if (!job) throw new RequestError(404,'CRE_JOB_NOT_FOUND');
      json(response,200,job);return;
    }
    if(request.method==='GET'&&path==='/api/payments/setup'){json(response,200,{...getPaymentSetup(),providers:providers.map(p=>({providerId:p.providerId,paymentReady:Boolean(providerRecipient(p.providerId))}))});return;}
    if (request.method === 'GET' && path === '/api/health') {
      const provider = process.env.COMPUTE_PROVIDER ?? 'mock';
      const model = provider === 'mock' ? 'deterministic' : provider === 'openrouter' ? (process.env.OPENROUTER_MODEL ?? 'openrouter/free') : provider==='claude'?(process.env.ANTHROPIC_MODEL??'claude-sonnet-5-5'):(process.env.ZERO_G_MODEL ?? 'not-configured');
      json(response, 200, {status:'ok', negotiation:{mode:liveOnly?'LIVE':'MOCK',liveAvailable:Boolean(options.negotiationStrategy)||['openrouter','0g'].includes(provider)&&Boolean(provider==='openrouter'?process.env.OPENROUTER_API_KEY:process.env.ZERO_G_API_KEY),provider,model,maxDurationSeconds:180}, compute:{provider: ['0g', 'mock', 'openrouter','claude'].includes(provider) ? provider : 'unsupported', model: /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) ? model : 'configured'}, providers});
      return;
    }
    if (request.method === 'GET' && path === '/api/templates') {
      json(response, 200, {templates: DEMO_SCENARIOS.filter(scenario=>!scenario.retired&&liveTask(scenario.questionTemplateId)).map(raw=>{const scenario=publicTaskTemplate(raw);return readPlan(scenario.questionTemplateId)&&process.env.PROVIDER_LINK_SOURCE_ENABLED==='true'?{...scenario,synthetic:false,verificationSupport:'SERVICE_CRE',description:'Public Ethereum read at an explicit block. CRE CLI simulation compares the same metric using EVM and HTTP RPC capabilities.'}:liveOnly&&scenario.operation==='COMPUTE'?{...scenario,synthetic:false}:scenario;})}); return;
    }
    if(request.method==='GET'&&['/demo','/demo/','/dashboard','/dashboard/'].includes(path)){response.writeHead(302,{Location:'http://127.0.0.1:3001/dashboard','Cache-Control':'no-store'});response.end();return;}
    if(liveOnly&&request.method==='GET'&&path==='/developer'){response.writeHead(302,{Location:'/dashboard'});response.end();return;}
    if (request.method === 'GET' && ['/', '/about', '/developer'].includes(path)) {
      const html = await readFile(new URL(path !== '/developer' ? '../../web/landing.html' : '../../web/index.html', import.meta.url));
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
      response.end(html); return;
    }
    if (request.method !== 'POST' || !['/api/negotiate', '/api/compute', '/api/cre/simulate','/api/quotes','/api/payments/checkout','/api/discovery','/api/leases','/api/leases/cancel','/api/leases/control','/api/runs','/api/runs/refresh','/api/runs/publication','/api/payments/reconcile','/api/preview','/api/observations/verify','/api/registry/offers/sync'].includes(path)) throw new RequestError(404, 'NOT_FOUND');
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== baseUrl && origin !== baseUrl.replace('127.0.0.1','localhost') && origin!=='http://127.0.0.1:3001' && origin!=='http://localhost:3001') throw new RequestError(403, 'ORIGIN_NOT_ALLOWED');
    const body = await readBody(request);
    if(liveOnly&&['/api/negotiate','/api/compute','/api/payments/checkout'].includes(path))throw new RequestError(503,'LIVE_ONLY_ENDPOINT_UNAVAILABLE');
    if(liveOnly&&['/api/preview','/api/discovery','/api/quotes','/api/leases'].includes(path)&&(typeof body.questionTemplateId!=='string'||!liveTask(body.questionTemplateId)))throw new RequestError(409,'LIVE_SOURCE_NOT_AVAILABLE');
    if(path==='/api/registry/offers/sync'){
      if(typeof body.questionTemplateId!=='string'||Object.keys(body).some(key=>key!=='questionTemplateId'))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');
      const registry=options.evidenceQueries;if(!registry?.publishProviderOffer||!registry.queryProviderOffers||!registry.queryProviderHistory)throw new RequestError(503,'ARKIV_MARKETPLACE_NOT_CONFIGURED');
      if(process.env.ARKIV_PUBLISHING_ENABLED!=='true')throw new RequestError(503,'ARKIV_PUBLISHING_DISABLED');
      const id=body.questionTemplateId;let task=registrySyncs.get(id);
      if(!task){task=syncRegistryOffers(providers,id,registry as MarketplaceQueries).finally(()=>registrySyncs.delete(id));registrySyncs.set(id,task);}
      try{json(response,200,await task);}catch{throw new RequestError(503,'ARKIV_OFFER_PUBLICATION_FAILED');}return;
    }
    if(path==='/api/observations/verify'){
      if(typeof body.questionTemplateId!=='string'||typeof body.providerId!=='string'||!readPlan(body.questionTemplateId))throw new RequestError(400,'INVALID_OBSERVATION');
      const answer=market.snapshot(body.questionTemplateId,body.providerId);if(!answer)throw new RequestError(409,'OBSERVATION_NOT_AVAILABLE');if(Date.now()-Date.parse(answer.deliveredAt)>60000)throw new RequestError(409,'OBSERVATION_STALE');
      const existing=observationJobs.get(answer.runId);if(existing&&verificationStatus(existing)!=='FAILED'){json(response,202,{verificationId:existing,state:await verificationClient.getResult(existing)?'COMPLETED':'PENDING'});return;}
      const verificationId=randomUUID();const submitted=await verificationClient.submit(VerificationRequestSchema.parse({schemaVersion:'1.0.0',verificationId,runId:answer.runId,sessionId:answer.sessionId,questionTemplateId:answer.questionTemplateId,providerId:answer.providerId,answer,policy:{policyId:answer.evidencePolicyId,version:'1.0.0',allowedChainIds:[answer.chainId],allowedMetricIds:[answer.metric],maxAgeSeconds:300,maxAbsDeltaRaw:'0'},requestedAt:new Date().toISOString()}));while(observationJobs.size>=200)observationJobs.delete(observationJobs.keys().next().value!);observationJobs.set(answer.runId,verificationId);json(response,202,submitted);return;
    }
    if(path==='/api/payments/reconcile'){if(typeof body.runId!=='string'||!buyerJournal)throw new RequestError(400,'PAYMENT_NOT_FOUND');try{ownsRun(body.runId);const record=await reconcileHederaPayment(buyerJournal,body.runId);orchestrator.reconciled(body.runId,record);json(response,200,{paymentStatus:record.status,payment:record.receipt});}catch{throw new RequestError(409,'PAYMENT_RECONCILIATION_REQUIRED');}return;}
    if(path==='/api/preview'){
      if(body.providerIds!==undefined&&(!Array.isArray(body.providerIds)||body.providerIds.length<1||body.providerIds.length>20||!body.providerIds.every(p=>typeof p==='string'&&providers.some(v=>v.providerId===p))))throw new RequestError(400,'INVALID_PROVIDERS');
      if(body.maxRounds!==undefined&&body.maxRounds!==2&&body.maxRounds!==3)throw new RequestError(400,'INVALID_MAX_ROUNDS');
      try{if(buyer&&typeof body.sessionId==='string'){if(leaseStore.buyerDatabase().prepare('SELECT 1 FROM buyer_lease_owners WHERE lease_id=? UNION ALL SELECT 1 FROM leases WHERE id=?').get(body.sessionId,body.sessionId))throw new RequestError(409,'RESOURCE_ID_CONFLICT');if(orchestrator.get(body.sessionId))ownsRun(body.sessionId);buyers.ownResource(buyer.buyerId,'RUN',body.sessionId);buyers.ownResource(buyer.buyerId,'SESSION',body.sessionId);}json(response,202,orchestrator.preview(Object.fromEntries(Object.entries(body).filter(([key])=>!['providerIds','maxRounds'].includes(key))),body.providerIds as string[]|undefined,body.maxRounds as number|undefined));}catch{throw new RequestError(400,'INVALID_PREVIEW');}return;
    }
    if(path==='/api/discovery'){try{json(response,200,{providers:await orchestrator.discover(body),arkivAvailable:Boolean(options.arkivClient)});}catch(error){throw new RequestError(400,error instanceof Error&&error.message==='ARKIV_NOT_CONFIGURED'?'ARKIV_NOT_CONFIGURED':'DISCOVERY_FAILED');}return;}
    if(path==='/api/leases'){const parsed=LeasePolicySchema.safeParse(body);if(!parsed.success)throw new RequestError(400,'INVALID_LEASE_POLICY');if(parsed.data.analysisPersona&&(!parsed.data.measurementIds||ANALYSIS_REQUIREMENTS[parsed.data.analysisPersona].some(id=>!parsed.data.measurementIds!.includes(id))||parsed.data.measurementIds.some(id=>!id.startsWith('AAVE_V3_USDC_'))))throw new RequestError(400,'ANALYSIS_INPUTS_INCOMPLETE');if(parsed.data.measurementIds&&(parsed.data.providerIds.length!==1||parsed.data.schedule||!parsed.data.measurementIds.includes(parsed.data.questionTemplateId)||parsed.data.measurementIds.some(id=>!readPlan(id)||!liveTask(id))))throw new RequestError(400,'INVALID_BUNDLE_MANDATE');if(!DEMO_SCENARIOS.some(s=>!s.retired&&s.questionTemplateId===parsed.data.questionTemplateId))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');const cap=getPaymentSetup().maxTinybars;if(!cap||BigInt(parsed.data.perRequestTinybars)>BigInt(cap))throw new RequestError(400,'OPERATOR_CAP_EXCEEDED');if(buyer){const approval=buyers.request(buyer.buyerId,parsed.data);scheduleEvent(parsed.data.leaseId,'HUMAN_APPROVAL_PENDING',{});json(response,202,{approval,requiresHumanApproval:true});return;}let authorizedId:string|undefined;try{const lease=leaseStore.authorize(parsed.data);authorizedId=lease.policy.leaseId;scheduleEvent(lease.policy.leaseId,lease.policy.schedule?'RECURRING_LEASE_AUTHORIZED':'LEASE_AUTHORIZED',{policy:lease.policy});json(response,201,lease);}catch{if(authorizedId){leaseStore.cancel(authorizedId);throw new RequestError(503,'LEASE_AUTHORIZATION_AUDIT_FAILED');}throw new RequestError(400,'INVALID_LEASE_POLICY');}return;}
    if(path==='/api/leases/control'){if(Object.keys(body).some(key=>!['leaseId','action'].includes(key))||typeof body.leaseId!=='string'||!['PAUSE','RESUME','CANCEL'].includes(String(body.action)))throw new RequestError(400,'INVALID_LEASE_ACTION');try{ownsLease(body.leaseId);leaseStore.controlSchedule(body.leaseId,body.action as 'PAUSE'|'RESUME'|'CANCEL');scheduleEvent(body.leaseId,'LEASE_'+body.action,{});json(response,200,{status:leaseStore.schedule(body.leaseId)?.state});}catch(error){throw new RequestError(409,error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'LEASE_CONTROL_FAILED');}return;}
    if(path==='/api/leases/cancel'){if(typeof body.leaseId!=='string')throw new RequestError(400,'INVALID_LEASE');ownsLease(body.leaseId);leaseStore.cancel(body.leaseId);scheduleEvent(body.leaseId,'LEASE_CANCELLED',{});json(response,200,{status:'CANCELLED'});return;}
    if(path==='/api/runs'){const input=RunInputSchema.safeParse(body);if(!input.success)throw new RequestError(400,'INVALID_RUN');try{ownsLease(input.data.leaseId);if(buyer&&leaseStore.buyerDatabase().prepare('SELECT 1 FROM buyer_lease_owners WHERE lease_id=? UNION ALL SELECT 1 FROM leases WHERE id=?').get(input.data.runId,input.data.runId))throw new RequestError(409,'RESOURCE_ID_CONFLICT');if(buyer&&orchestrator.get(input.data.runId))ownsRun(input.data.runId);json(response,202,discloseRun(orchestrator.start(input.data)));}catch{throw new RequestError(409,'RUN_NOT_STARTED');}return;}
    if(path==='/api/runs/refresh'||path==='/api/runs/publication'){if(typeof body.runId!=='string')throw new RequestError(400,'INVALID_RUN');try{ownsRun(body.runId);const result=path.endsWith('refresh')?await orchestrator.refreshVerification(body.runId):await orchestrator.retryPublication(body.runId);json(response,200,result?discloseRun(result):result);}catch{throw new RequestError(409,'RUN_RETRY_UNAVAILABLE');}return;}
    if (path === '/api/cre/simulate') {
      if (Object.keys(body).length !== 1 || typeof body.case !== 'string' || !['valid','tampered','inconclusive'].includes(body.case)) throw new RequestError(400,'INVALID_CRE_CASE');
      try { json(response,202,creRunner.start(body.case as 'valid'|'tampered'|'inconclusive')); }
      catch(error) { if(error instanceof Error && error.message === 'CRE_BUSY') throw new RequestError(409,'CRE_BUSY');throw new RequestError(503,'CRE_SIMULATION_UNAVAILABLE'); }
      return;
    }

    if(path==='/api/quotes'){
      if(Object.keys(body).some(k=>!['questionTemplateId','providerId'].includes(k))||typeof body.questionTemplateId!=='string'||!DEMO_SCENARIOS.some(s=>!s.retired&&s.questionTemplateId===body.questionTemplateId))throw new RequestError(400,'INVALID_QUESTION_TEMPLATE');
      const setup=getPaymentSetup();if(!setup.quotesAvailable)throw new RequestError(503,'PROVIDER_PAYMENT_SETUP_REQUIRED');
      const template=body.questionTemplateId;
      if(body.providerId!==undefined&&(typeof body.providerId!=='string'||!providers.some(p=>p.providerId===body.providerId)))throw new RequestError(400,'INVALID_PROVIDER');
      const requested=body.providerId?providers.filter(p=>p.providerId===body.providerId):providers;
      const results=await Promise.all(requested.map(async(provider)=>{
        const payTo=providerRecipient(provider.providerId)??'';
        try{const result=await negotiate({baseUrl:provider.origin,providerId:provider.providerId,maxPriceMinor:setup.maxTinybars??'0',questionTemplateId:template,currency:HEDERA_CURRENCY,mode:liveOnly?'LIVE':'MOCK',strategy:options.negotiationStrategy,quoteOnly:true});
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
      if (typeof questionTemplateId !== 'string' || (questionTemplateId !== QUESTION_TEMPLATE && !DEMO_SCENARIOS.some(item => !item.retired&&item.questionTemplateId === questionTemplateId))) throw new RequestError(400, 'INVALID_QUESTION_TEMPLATE');
      const mode = body.mode ?? 'MOCK';
      if (mode !== 'MOCK' && mode !== 'LIVE') throw new RequestError(400,'INVALID_NEGOTIATION_MODE');
      let strategy: AiNegotiationStrategy | undefined;
      if (mode === 'LIVE') {
        if (!['openrouter','0g','claude'].includes(process.env.COMPUTE_PROVIDER ?? '')) throw new RequestError(503,'AI_NEGOTIATION_NOT_CONFIGURED');
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
  /** Arkiv reads fail closed with a specific, user-actionable code instead of a generic REQUEST_FAILED. */
  const arkivError=(error:unknown):never=>{const text=error instanceof Error?error.message+String((error as {details?:unknown}).details??''):'';if(/\b429\b|ANON_COST_LIMITED|rate.?limit/i.test(text))throw new RequestError(503,'ARKIV_RATE_LIMITED');throw new RequestError(503,'ARKIV_UNAVAILABLE');};
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => {
      if (!response.headersSent) json(response, error instanceof RequestError||error instanceof BuyerHttpError ? error.status : buyerHttp.enabled?400:500, {error:error instanceof RequestError ? error.code : error instanceof BuyerHttpError?error.message:buyerHttp.enabled&&error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'REQUEST_FAILED'});
      else response.end();
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error',reject);server.listen(options.port ?? 3000,'127.0.0.1',resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  scheduler.start();
  return {baseUrl, close: () => new Promise<void>((resolve, reject) => {server.close(error => {void market.close().then(()=>scheduler.close()).then(()=>orchestrator.drain()).then(()=>verificationClient instanceof RunVerificationClient?verificationClient.close():undefined).then(()=>eventStore.close()).then(()=>{buyerSessions?.close();leaseStore.close();buyerJournal?.close();if(error)reject(error);else resolve();},reject);});server.closeAllConnections();})};
}
