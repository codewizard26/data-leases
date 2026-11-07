import {randomUUID} from 'node:crypto';
import {AnswerEnvelopeSchema,type AnswerEnvelope,type ConversationEvent} from '@data-leases/contracts';
import {EventStore} from '@data-leases/event-store';
import {serviceFor} from '@data-leases/cre-adapter';
type Listener=(event:ConversationEvent)=>void;
interface Feed {sessionId:string;listeners:Set<Listener>;active?:Promise<void>}
/** Shared, bounded public telemetry. Opening another browser never starts another source poller. */
export class MarketFeed {
 private feeds=new Map<string,Feed>();
 private observations=new Map<string,AnswerEnvelope>();
 private closed=false;
 constructor(private readonly store:EventStore,private readonly providers:readonly {providerId:string;origin:string}[],private readonly request:typeof fetch=fetch){}
 snapshot(template:string,providerId:string){return this.observations.get(template+'|'+providerId);}
 /** Each subscription requests one batch. There is no recurring timer or automatic replay. */
 subscribe(template:string,listener:Listener,providerIds:readonly string[]=this.providers.map(provider=>provider.providerId)){
  if(this.closed)throw new Error('SOURCE_FEED_CLOSED');
  const selected=this.providers.filter(provider=>providerIds.includes(provider.providerId));
  if(!selected.length)throw new Error('NO_PROVIDERS_SELECTED');
  const key=JSON.stringify([template,...selected.map(provider=>provider.providerId).sort()]);
  let feed=this.feeds.get(key);
  if(!feed){feed={sessionId:randomUUID(),listeners:new Set()};this.feeds.set(key,feed);}
  feed.listeners.add(listener);
  if(!feed.active){
   const active=this.poll(template,feed,selected);feed.active=active;
   void active.finally(()=>{if(feed.active===active)feed.active=undefined;}).catch(()=>{});
  }
  return ()=>feed.listeners.delete(listener);
 }
 private async poll(template:string,feed:Feed,selected:readonly {providerId:string;origin:string}[]){
  const emit=(providerId:string,eventType:ConversationEvent['eventType'],status:string,payload:unknown)=>{
   const event=this.store.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId:feed.sessionId,occurredAt:new Date().toISOString(),eventType,actorRole:'PROVIDER_AGENT',actorId:providerId,providerId,direction:'IN',status,payload});
   for(const listener of feed.listeners)listener(event);
  };
  await Promise.all(selected.map(async provider=>{
   emit(provider.providerId,'ANSWER_REQUESTED','READING_PUBLIC_SOURCE',{questionTemplateId:template,notice:'Public source observation. No negotiation or payment.'});
   try{
    const response=await this.request(provider.origin+'/public-observations/'+encodeURIComponent(template),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('SOURCE_UNAVAILABLE');const raw=await response.text();if(raw.length>32768)throw new Error('SOURCE_TOO_LARGE');
    const answer=AnswerEnvelopeSchema.parse(JSON.parse(raw).answer),service=serviceFor(template);
    if(!service||answer.providerId!==provider.providerId||answer.questionTemplateId!==template||answer.metric!==service.metric||answer.unit!==service.unit||Date.now()-Date.parse(answer.deliveredAt)>60000||Date.parse(answer.deliveredAt)>Date.now()+5000)throw new Error('SOURCE_BINDING_MISMATCH');
    const observationKey=template+'|'+provider.providerId,prior=this.observations.get(observationKey);this.observations.set(observationKey,answer);
    emit(provider.providerId,'ANSWER_DELIVERED',prior&&prior.value!==answer.value?'SOURCE_CHANGED':'SOURCE_OBSERVED',{answer,previousValue:prior?.value,changed:Boolean(prior&&prior.value!==answer.value),verificationStatus:'UNVERIFIED',paymentStatus:'NOT_REQUESTED'});
   }catch{emit(provider.providerId,'ERROR','SOURCE_UNAVAILABLE',{questionTemplateId:template,notice:'Source unavailable. Last observation is retained with its timestamp.'});}
  }));
  const complete=this.store.append({schemaVersion:'1.0.0',eventId:randomUUID(),sessionId:feed.sessionId,occurredAt:new Date().toISOString(),eventType:'NEGOTIATION_OUTCOME',actorRole:'GATEWAY',actorId:'market-feed',direction:'INTERNAL',status:'SOURCE_REQUEST_COMPLETED',payload:{questionTemplateId:template,providerIds:selected.map(provider=>provider.providerId)}});
  await this.store.flush();feed.active=undefined;
  for(const listener of feed.listeners)listener(complete);
 }
 async close(){this.closed=true;await Promise.allSettled([...this.feeds.values()].map(feed=>feed.active));}
}
