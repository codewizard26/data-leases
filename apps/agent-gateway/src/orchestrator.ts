import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DiscoveryQuerySchema,VerificationRequestSchema,VerificationResultSchema,type ArkivClient,type VerificationClient,type DiscoveredAgent,type NegotiationMessage,type AnswerEnvelope,type VerificationResult,type ConversationEvent,type RunReceiptReference,type ComputationResult} from '@data-leases/contracts';
import {DirectUrlDiscovery,LocalRegistryDiscovery,type LocalDiscoveryPolicy} from '@data-leases/discovery';
import {negotiate,scenarioForTemplate,HEDERA_CURRENCY,type PaymentQuote} from '@data-leases/agents';
import {EventStore} from '@data-leases/event-store';
import {LeaseStore} from './lease-store.js';
export const RunInputSchema=z.object({runId:z.string().uuid(),leaseId:z.string().uuid(),mode:z.enum(['DIRECT_URL','LOCAL_REGISTRY','ARKIV','HYBRID']),directCardUrl:z.string().url().optional()}).strict();
export interface ProviderConnection {providerId:string;origin:string;payTo:string}
export interface PaymentResult {answer:AnswerEnvelope;computation?:ComputationResult;payment:{network:string;transaction:string;payer?:string;success:boolean}}
export interface RunState {runId:string;sessionId:string;leaseId:string;status:string;paymentStatus:string;deliveryStatus:string;verificationStatus:string;publicationStatus:string;providers?:DiscoveredAgent[];quote?:Readonly<NegotiationMessage>;resourceUrl?:string;payment?:PaymentResult['payment'];hashScanUrl?:string;answer?:AnswerEnvelope;computation?:ComputationResult;verification?:VerificationResult;receipts?:RunReceiptReference[];error?:string}
export class RunOrchestrator {
 readonly events=new EventEmitter();
 private publicationInFlight=new Map<string,Promise<void>>();
 private active=new Map<string,Promise<void>>();
 constructor(private readonly config:{store:EventStore;leases:LeaseStore;providers:ProviderConnection[];verification:VerificationClient;arkiv?:ArkivClient;payment:(input:{quote:PaymentQuote;url:string;payTo:string})=>Promise<PaymentResult>;paymentReady:()=>boolean;paymentRecord?:(runId:string)=>{status:string;receipt?:PaymentResult['payment']}|undefined}){
  for(const prior of this.config.leases.runs() as RunState[]){if(!['COMPLETED','FAILED','VERIFICATION_PENDING','QUOTES_READY'].includes(prior.status)){if(prior.paymentStatus==='IN_PROGRESS'){const record=this.config.paymentRecord?.(prior.runId);prior.paymentStatus=record?.receipt?'SETTLED':'UNKNOWN';if(record?.receipt)prior.payment=record.receipt;this.config.leases.mark(prior.runId,record?.receipt?'SETTLED':'UNKNOWN');}prior.error='RUN_INTERRUPTED_RECONCILE_REQUIRED';prior.status='FAILED';this.save(prior);}}
 }
 get(runId:string):RunState|undefined{return this.config.leases.run(runId) as RunState|undefined;}
 history(){return this.config.leases.runs() as RunState[];}
 private save(run:RunState){this.config.leases.save(run.runId,run);}
 private emit(run:RunState,eventType:ConversationEvent['eventType'],status:string,payload:unknown,providerId?:string,message?:NegotiationMessage,direction:ConversationEvent['direction']='INTERNAL'){
  const event=this.config.store.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId:run.sessionId,runId:run.runId,negotiationId:message?.negotiationId,messageId:message?.messageId,occurredAt:new Date().toISOString(),eventType,actorRole:message?(direction==='OUT'?'BUYER_AGENT':'PROVIDER_AGENT'):'GATEWAY',actorId:message?.fromAgentId??'orchestrator',providerId,direction,status,priceMinor:message?.priceMinor,currency:message?.currency,payload});this.events.emit(run.sessionId,event);
 }
 async discover(input:unknown):Promise<DiscoveredAgent[]>{
  const query=DiscoveryQuerySchema.parse(input);const urls=this.config.providers.map(p=>p.origin+'/.well-known/agent-card.json');const policy:LocalDiscoveryPolicy={allowedCardUrls:urls,allowedEndpointUrls:this.config.providers.map(p=>p.origin+'/a2a')};
  let candidates:DiscoveredAgent[]=[];
  if(query.mode==='DIRECT_URL')candidates=await new DirectUrlDiscovery(policy).discover(query);
  else if(query.mode==='LOCAL_REGISTRY'||query.mode==='HYBRID'){
   const settled=await Promise.allSettled(urls.map(url=>new LocalRegistryDiscovery([url],policy).discover({...query,mode:'LOCAL_REGISTRY'})));
   candidates=settled.flatMap(result=>result.status==='fulfilled'?result.value:[]);
  }
  if(query.mode==='ARKIV'||query.mode==='HYBRID'){
   if(!this.config.arkiv){if(query.mode==='ARKIV')throw new Error('ARKIV_NOT_CONFIGURED');}
   else {const offers=await this.config.arkiv.findProviderOffers(query);for(const offer of offers){
    // Developer 2 discovery cannot enlarge the payer's configured destination allowlist.
    if(!this.config.providers.some(p=>p.providerId===offer.providerId&&offer.cardUrl===p.origin+'/.well-known/agent-card.json'&&offer.a2aEndpoint===p.origin+'/a2a'))continue;
    const live=await new DirectUrlDiscovery(policy).discover({...query,mode:'DIRECT_URL',directCardUrl:offer.cardUrl});candidates.push(...live.map(card=>({...card,discoverySource:'ARKIV' as const})));
   }}
  }
  return [...new Map(candidates.filter(c=>c.capabilityMatched).map(c=>[c.providerId+'|'+c.cardUrl,c])).values()].sort((a,b)=>a.providerId.localeCompare(b.providerId));
 }
 start(input:unknown){const parsed=RunInputSchema.parse(input);const lease=this.config.leases.get(parsed.leaseId);if(!lease.active||Date.parse(lease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED_OR_CANCELLED');const prior=this.get(parsed.runId);if(prior){if(prior.leaseId!==parsed.leaseId)throw new Error('RUN_ID_CONFLICT');return prior;}
  if(lease.policy.schedule&&this.config.leases.schedule(parsed.leaseId)?.activeRunId!==parsed.runId)throw new Error('SCHEDULED_RUN_REQUIRED');
  const run:RunState={runId:parsed.runId,sessionId:parsed.runId,leaseId:parsed.leaseId,status:'DISCOVERING',paymentStatus:'NOT_REQUESTED',deliveryStatus:'NOT_REQUESTED',verificationStatus:'NOT_REQUESTED',publicationStatus:'NOT_REQUESTED'};
  if(!this.config.leases.claim(run.runId,run))return this.get(run.runId)!;
  const task=this.execute(run,parsed).finally(()=>this.active.delete(run.runId));this.active.set(run.runId,task);return structuredClone(run);
 }
 preview(input:unknown,providerIds?:string[],maxRounds=3){const query=DiscoveryQuerySchema.parse(input);if(!/^[1-9][0-9]{0,18}$/.test(query.maxPriceMinor))throw new Error('INVALID_PREVIEW_PRICE');const leaseId=randomUUID();this.config.leases.authorize({leaseId,questionTemplateId:query.questionTemplateId,currency:'hedera:testnet/HBAR',providerIds:providerIds??this.config.providers.map(p=>p.providerId),perRequestTinybars:query.maxPriceMinor,totalTinybars:query.maxPriceMinor,expiresAt:new Date(Date.now()+180000).toISOString(),maxAgeSeconds:Math.max(1,query.maxAgeSeconds),maxRounds,paymentsAuthorized:false});return this.start({runId:query.sessionId,leaseId,mode:query.mode,directCardUrl:query.directCardUrl});}
 async wait(runId:string){await this.active.get(runId);return this.get(runId);}
 private async execute(run:RunState,input:z.infer<typeof RunInputSchema>){let reserved=false;let submitted=false;
  try{
   const {policy}=this.config.leases.get(run.leaseId);
   this.emit(run,'DISCOVERY_STARTED','DISCOVERING',{mode:input.mode,questionTemplateId:policy.questionTemplateId});
   const discovered=await this.discover({schemaVersion:'1.0.0',sessionId:run.sessionId,mode:input.mode,directCardUrl:input.directCardUrl,questionTemplateId:policy.questionTemplateId,maxPriceMinor:policy.perRequestTinybars,currency:policy.currency,maxAgeSeconds:policy.maxAgeSeconds,requestedAt:new Date().toISOString()});
   run.providers=discovered.filter(p=>policy.providerIds.includes(p.providerId));this.save(run);for(const p of run.providers)this.emit(run,'DISCOVERY_RESULT','DISCOVERED',p,p.providerId);
   if(!run.providers.length)throw new Error('NO_ELIGIBLE_PROVIDERS');run.status='NEGOTIATING';this.save(run);
   const results=await Promise.all(run.providers.map(async provider=>{const connection=this.config.providers.find(p=>p.providerId===provider.providerId)!;try{
    const result=await negotiate({baseUrl:connection.origin,providerId:connection.providerId,maxPriceMinor:policy.perRequestTinybars,questionTemplateId:policy.questionTemplateId,currency:HEDERA_CURRENCY,mode:'MOCK',deferAcceptance:true,maxRounds:policy.maxRounds,maxAgeSeconds:policy.maxAgeSeconds,sessionId:run.sessionId,runId:run.runId,deadlineAt:new Date(Math.min(Date.parse(policy.expiresAt),Date.now()+180000)).toISOString(),onMessage:(message,direction)=>{this.emit(run,direction==='OUT'?'A2A_SENT':'A2A_RECEIVED',message.action,message,provider.providerId,message,direction);if(direction==='IN'&&message.action==='PROPOSE')this.emit(run,'QUOTE','RECEIVED',message,provider.providerId,message);}});
    this.emit(run,'NEGOTIATION_OUTCOME',result.status,{providerId:provider.providerId,status:result.status},provider.providerId);return {connection,result};
   }catch{this.emit(run,'ERROR','PROVIDER_NEGOTIATION_FAILED',{code:'PROVIDER_NEGOTIATION_FAILED'},provider.providerId);return undefined;}}));
   const offers=results.filter(r=>r?.result.status==='QUOTED'&&r.result.quote?.priceMinor&&BigInt(r.result.quote.priceMinor)<=BigInt(policy.perRequestTinybars)&&Date.parse(r.result.quote.expiresAt)>Date.now());
   offers.sort((a,b)=>{const delta=BigInt(a!.result.quote!.priceMinor!)-BigInt(b!.result.quote!.priceMinor!);return delta<0n?-1:delta>0n?1:a!.connection.providerId.localeCompare(b!.connection.providerId);});
   const chosen=offers[0];if(!chosen?.result.quote)throw new Error('NO_ACCEPTABLE_QUOTE');
   if(!policy.paymentsAuthorized){run.quote=Object.freeze(structuredClone(chosen.result.quote));run.status='QUOTES_READY';run.paymentStatus='DISABLED_PREVIEW';this.save(run);this.emit(run,'NEGOTIATION_OUTCOME','QUOTES_READY',{selectedQuote:run.quote,notice:'A2A pricing only. No quote accepted and no x402 payment.'});return;}
   if(!this.config.paymentReady())throw new Error('PAYMENT_SETUP_REQUIRED');
   const q=chosen.result.quote;this.config.leases.reserve(run.leaseId,run.runId,chosen.connection.providerId,q.priceMinor!);reserved=true;
   const accepted=await negotiate({baseUrl:chosen.connection.origin,providerId:chosen.connection.providerId,maxPriceMinor:policy.perRequestTinybars,questionTemplateId:policy.questionTemplateId,currency:HEDERA_CURRENCY,mode:'MOCK',acceptQuote:q,maxRounds:policy.maxRounds,onMessage:(message,direction)=>this.emit(run,direction==='OUT'?'A2A_SENT':'A2A_RECEIVED',message.action,message,chosen.connection.providerId,message,direction)});
   if(accepted.status!=='AGREED'||!accepted.paymentRequired||accepted.paymentRequired.payTo!==chosen.connection.payTo)throw new Error('INVALID_ACCEPTED_QUOTE');
   const acceptedMessage=accepted.transcript.at(-1)!;run.quote=Object.freeze(structuredClone(acceptedMessage));run.resourceUrl=accepted.paymentRequired.resourceUrl;run.status='PAYING';run.paymentStatus='IN_PROGRESS';this.save(run);this.emit(run,'QUOTE','ACCEPTED',{quote:run.quote,resourceUrl:run.resourceUrl,paymentNetwork:'hedera:testnet',payTo:chosen.connection.payTo});
   const currentLease=this.config.leases.get(run.leaseId);if(!currentLease.active||Date.parse(currentLease.policy.expiresAt)<=Date.now())throw new Error('LEASE_EXPIRED_OR_CANCELLED');
   submitted=true;this.emit(run,'ANSWER_REQUESTED','PAYMENT_ATTEMPT',{amountTinybars:q.priceMinor,providerId:chosen.connection.providerId});
   const paid=await this.config.payment({quote:accepted.paymentRequired.quote,url:run.resourceUrl,payTo:chosen.connection.payTo});
   run.payment=paid.payment;run.paymentStatus='SETTLED';run.hashScanUrl='https://hashscan.io/testnet/transaction/'+encodeURIComponent(paid.payment.transaction);this.config.leases.mark(run.runId,'SETTLED');this.save(run);this.emit(run,'NEGOTIATION_OUTCOME','PAYMENT_SETTLED',{payment:run.payment,hashScanUrl:run.hashScanUrl});
   run.computation=paid.computation;if(paid.computation)this.emit(run,'ANSWER_DELIVERED','COMPUTATION_COMPLETED',{computation:paid.computation},chosen.connection.providerId);
   const answer=paid.answer;run.answer=answer;run.deliveryStatus='DELIVERED_UNVERIFIED';this.save(run);this.emit(run,'ANSWER_DELIVERED',run.deliveryStatus,answer,chosen.connection.providerId);
   if(answer.runId!==q.runId||answer.acceptedQuoteId!==q.quoteId||answer.providerId!==chosen.connection.providerId||answer.questionTemplateId!==policy.questionTemplateId||answer.sessionId!==q.sessionId||answer.negotiationId!==q.negotiationId||answer.evidencePolicyId!==q.evidencePolicyId)throw new Error('ANSWER_BINDING_MISMATCH');
   const scenario=scenarioForTemplate(policy.questionTemplateId)!;if(answer.metric!==scenario.metric||answer.chainId!==scenario.chainId||answer.unit!==scenario.unit||answer.methodologyVersion!==scenario.methodologyVersion||answer.sourceContract!==scenario.sourceContract)throw new Error('ANSWER_BINDING_MISMATCH');
   const age=Date.now()-Date.parse(answer.deliveredAt);if(!Number.isFinite(age)||age< -5000||age>policy.maxAgeSeconds*1000){run.deliveryStatus='STALE';throw new Error('STALE_ANSWER');}
   run.status='VERIFYING';run.verificationStatus='PENDING';const request=VerificationRequestSchema.parse({schemaVersion:'1.0.0',verificationId:randomUUID(),runId:answer.runId,sessionId:answer.sessionId,providerId:answer.providerId,questionTemplateId:answer.questionTemplateId,answer,policy:{policyId:answer.evidencePolicyId,version:'1.0.0',allowedChainIds:[answer.chainId],allowedMetricIds:[answer.metric],maxAgeSeconds:policy.maxAgeSeconds,maxAbsDeltaRaw:'0'},requestedAt:new Date().toISOString()});this.save(run);this.emit(run,'VERIFICATION_REQUEST','PENDING',request);
   await this.config.verification.submit(request);await this.completeVerification(run,request.verificationId);
  }catch(error){const safe=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RUN_FAILED';run.error=safe;
   if(reserved&&run.paymentStatus!=='SETTLED'){const known=this.config.paymentRecord?.(run.quote?.runId??'');if(known?.receipt){run.payment=known.receipt;run.paymentStatus='SETTLED';run.hashScanUrl='https://hashscan.io/testnet/transaction/'+encodeURIComponent(known.receipt.transaction);this.config.leases.mark(run.runId,'SETTLED');}else if(submitted&&!['LEASE_EXPIRED_OR_CANCELLED','PAYMENT_NOT_SUBMITTED','INSUFFICIENT_BALANCE','PAYMENT_BUDGET_EXCEEDED','PAYMENT_TERMS_MISMATCH','PAYMENT_QUOTE_EXPIRED','HEDERA_BALANCE_UNAVAILABLE','EXPECTED_X402_PAYMENT_CHALLENGE'].includes(safe)){run.paymentStatus='UNKNOWN';this.config.leases.mark(run.runId,'UNKNOWN');}else{this.config.leases.mark(run.runId,'RELEASED');run.paymentStatus='NOT_SUBMITTED';}}
   run.status='FAILED';this.save(run);this.emit(run,'ERROR',safe,{code:safe,paymentStatus:run.paymentStatus});
  }finally{await this.config.store.flush();}
 }
 private async completeVerification(run:RunState,verificationId:string){
  const raw=await this.config.verification.getResult(verificationId);if(!raw){run.status='VERIFICATION_PENDING';this.save(run);return;}
  if(this.get(run.runId)?.verification?.verificationId===verificationId)return;
  const result=VerificationResultSchema.parse(raw);if(result.verificationId!==verificationId||result.runId!==run.answer?.runId||result.providerId!==run.answer.providerId)throw new Error('VERIFICATION_BINDING_MISMATCH');
  run.verification=result;run.verificationStatus=result.executionMode+':'+result.status;this.save(run);this.emit(run,'VERIFICATION_RESULT',run.verificationStatus,result);if(result.status==='ACCEPTED'&&result.executionMode!=='MOCK')await this.publish(run);else{run.publicationStatus='NOT_ELIGIBLE';run.status='COMPLETED';this.save(run);}
 }
 async refreshVerification(runId:string){const run=this.get(runId);if(!run||run.status!=='VERIFICATION_PENDING')return run;const events=this.config.store.list(run.sessionId);const last=events.filter(e=>e.eventType==='VERIFICATION_REQUEST').at(-1);if(last)await this.completeVerification(run,JSON.parse(last.payloadJson).verificationId);await this.config.store.flush();return this.get(runId);}
 async publish(run:RunState){const prior=this.publicationInFlight.get(run.runId);if(prior)return prior;const task=this.publishOnce(run).finally(()=>this.publicationInFlight.delete(run.runId));this.publicationInFlight.set(run.runId,task);return task;}
 private async publishOnce(run:RunState){
  const stored=this.get(run.runId);if(stored?.receipts?.length)run.receipts=stored.receipts;
  run.publicationStatus='PENDING';this.save(run);
  try{
   if(!this.config.arkiv)throw new Error('ARKIV_NOT_CONFIGURED');
   if(!run.receipts?.length){const receipt=await this.config.arkiv.publishVerifiedRun({runId:run.runId,providerId:run.quote!.fromAgentId,quoteId:run.quote!.quoteId!,payment:{network:'hedera:testnet',transactionId:run.payment!.transaction,amountTinybars:run.quote!.priceMinor!,hashScanUrl:run.hashScanUrl!},verification:run.verification!});if(receipt.runId!==run.runId||!receipt.reference)throw new Error('PUBLICATION_RECEIPT_MISMATCH');run.receipts=[receipt];run.publicationStatus='PUBLISHED';this.save(run);}
   try{const receipts=await this.config.arkiv.getRunReceipts(run.runId);run.receipts=[...new Map([...run.receipts!,...receipts.filter(r=>r.runId===run.runId)].map(r=>[r.reference,r])).values()];}catch{/* Saved publish receipt remains authoritative when receipt queries fail. */}
   run.publicationStatus='PUBLISHED';
  }catch{run.publicationStatus='PENDING_RETRY';}
  run.status='COMPLETED';this.save(run);this.emit(run,'NEGOTIATION_OUTCOME','PUBLICATION_'+run.publicationStatus,{receipts:run.receipts??[]});
 }
 reconciled(runId:string,record:{status:string;receipt?:PaymentResult['payment']}){const run=this.get(runId);if(!run||!record.receipt)return;run.payment=record.receipt;run.paymentStatus='SETTLED';run.hashScanUrl='https://hashscan.io/testnet/transaction/'+encodeURIComponent(record.receipt.transaction);if(!run.answer)run.deliveryStatus='DELIVERY_RECOVERY_REQUIRED';this.config.leases.mark(runId,'SETTLED');this.save(run);this.emit(run,'NEGOTIATION_OUTCOME','PAYMENT_RECONCILED',{payment:run.payment,deliveryStatus:run.deliveryStatus});void this.config.store.flush().catch(()=>{});}
 async drain(){await Promise.allSettled([...this.active.values(),...this.publicationInFlight.values()]);}
 async retryPublication(runId:string){const run=this.get(runId);if(!run||run.publicationStatus!=='PENDING_RETRY')throw new Error('PUBLICATION_NOT_PENDING');await this.publish(run);await this.config.store.flush();return this.get(runId);}
}
