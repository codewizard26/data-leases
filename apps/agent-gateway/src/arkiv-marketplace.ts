import {ProviderOfferSchema,type ArkivEvidenceClient,type StoredEntity} from '@data-leases/arkiv';
import {scenarioForTemplate,providerRecipient,HEDERA_CURRENCY} from '@data-leases/agents';
import {createHash} from 'node:crypto';
import {providerOffers} from './provider-directory.js';
type Connection={providerId:string;origin:string};
export type MarketplaceQueries=Pick<ArkivEvidenceClient,'queryProviderOffers'|'queryProviderHistory'|'publishProviderOffer'>;
export async function registryOffers(connections:readonly Connection[],questionTemplateId:string,registry:Pick<MarketplaceQueries,'queryProviderOffers'>){
 const [entities,profiles]=await Promise.all([registry.queryProviderOffers({questionTemplateId,currency:HEDERA_CURRENCY,limit:100}),providerOffers(connections,questionTemplateId)]);
 const latest=new Map<string,{entity:StoredEntity;record:ReturnType<typeof ProviderOfferSchema.parse>}>();
 const score=(entity:StoredEntity)=>{const record=ProviderOfferSchema.parse(entity.record),profile=profiles.find(p=>p.providerId===record.providerId);return Number(profile?.askMinor===record.priceMinor)+2*Number(profile?.analysis?.priceMinor===record.analysisPriceMinor);};
 for(const entity of [...entities].sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt)||score(b)-score(a))){
  const record=ProviderOfferSchema.parse(entity.record),connection=connections.find(connection=>connection.providerId===record.providerId);
  if(!connection||record.questionTemplateId!==questionTemplateId||record.currency!==HEDERA_CURRENCY||record.status!=='ACTIVE'||Date.parse(record.expiresAt)<=Date.now()||Date.parse(record.createdAt)>Date.now()||record.cardUrl!==connection.origin+'/.well-known/agent-card.json'||record.a2aEndpoint!==connection.origin+'/a2a'||record.payTo!==providerRecipient(record.providerId))continue;
  if(!latest.has(record.providerId))latest.set(record.providerId,{entity,record});
 }
 return [...latest.values()].map(({entity,record})=>{
  const profile=profiles.find(profile=>profile.providerId===record.providerId)!;
  return {...profile,available:profile.available&&profile.askMinor===record.priceMinor,status:profile.askMinor!==record.priceMinor?'RATE_CHANGED':profile.status,askMinor:record.priceMinor,currency:record.currency,decimals:record.decimals,paymentReady:Boolean(profile.paymentReady),analysis:profile.analysis&&record.analysisPriceMinor===profile.analysis.priceMinor?{...profile.analysis,source:'ARKIV' as const}:undefined,analysisPriceMinor:record.analysisPriceMinor,source:'ARKIV' as const,entityKey:entity.entityKey,publisher:entity.owner,expiresAt:record.expiresAt,registryUrl:'https://rabdi.explorer.arkiv.network/entity/'+entity.entityKey};
 }).sort((a,b)=>BigInt(a.askMinor)<BigInt(b.askMinor)?-1:BigInt(a.askMinor)>BigInt(b.askMinor)?1:a.providerId.localeCompare(b.providerId));
}
/** Explicit operator registration of fixed, locally configured sellers; never starts inference or payment. */
export async function syncRegistryOffers(connections:readonly Connection[],questionTemplateId:string,registry:MarketplaceQueries){
 const task=scenarioForTemplate(questionTemplateId);if(!task||task.retired)throw new Error('INVALID_QUESTION_TEMPLATE');
 const profiles=await providerOffers(connections,questionTemplateId),existing=await registry.queryProviderOffers({questionTemplateId,currency:HEDERA_CURRENCY,limit:100});
 const published:{providerId:string;entityKey:string;reused:boolean}[]=[],skipped:{providerId:string;reason:string}[]=[];
 for(const profile of profiles){
  const connection=connections.find(connection=>connection.providerId===profile.providerId)!,payTo=providerRecipient(profile.providerId);
  if(!profile.available||!profile.askMinor||!profile.paymentReady||!payTo){skipped.push({providerId:profile.providerId,reason:!payTo?'MERCHANT_NOT_CONFIGURED':'SERVICE_UNAVAILABLE'});continue;}
  const cardUrl=connection.origin+'/.well-known/agent-card.json',a2aEndpoint=connection.origin+'/a2a';
  const prior=existing.find(entity=>{const record=ProviderOfferSchema.parse(entity.record);return record.providerId===profile.providerId&&record.questionTemplateId===questionTemplateId&&record.status==='ACTIVE'&&record.priceMinor===profile.askMinor&&record.analysisPriceMinor===(questionTemplateId.startsWith('AAVE_V3_USDC_')&&profile.analysis?.available?profile.analysis.priceMinor:undefined)&&record.currency===HEDERA_CURRENCY&&record.payTo===payTo&&record.cardUrl===cardUrl&&record.a2aEndpoint===a2aEndpoint&&Date.parse(record.expiresAt)>Date.now()+300000;});
  if(prior){published.push({providerId:profile.providerId,entityKey:prior.entityKey,reused:true});continue;}
  const bucket=Math.floor(Date.now()/3600000)*3600000,createdAt=new Date(bucket).toISOString(),expiresAt=new Date(bucket+86400000).toISOString();
  const analysisPriceMinor=questionTemplateId.startsWith('AAVE_V3_USDC_')&&profile.analysis?.available?profile.analysis.priceMinor:undefined;
  const revision=createHash('sha256').update(JSON.stringify({analysisPriceMinor,providerId:profile.providerId,questionTemplateId,price:profile.askMinor,payTo,cardUrl,createdAt})).digest('hex').slice(0,24);
  const entity=await registry.publishProviderOffer({offerId:profile.providerId+':'+revision,providerId:profile.providerId,questionTemplateId,metric:task.metric,supportedMetrics:[task.metric],priceMinor:profile.askMinor,...(analysisPriceMinor?{analysisPriceMinor}:{}),currency:HEDERA_CURRENCY,asset:'0.0.0',decimals:8,paymentNetwork:'hedera:testnet',payTo,evidencePolicyId:task.evidencePolicyId,cardUrl,a2aEndpoint,status:'ACTIVE',reachability:'LOCAL_DEVELOPMENT',createdAt,expiresAt});
  published.push({providerId:profile.providerId,entityKey:entity.entityKey,reused:false});
 }
 return {published,skipped};
}
export async function registryServiceHistory(questionTemplateId:string,providerId:string|undefined,registry:Pick<MarketplaceQueries,'queryProviderHistory'>&Partial<Pick<ArkivEvidenceClient,'queryReceiptsByRunId'>>,providers:readonly Connection[]){
 const ids=providerId?[providerId]:providers.map(provider=>provider.providerId);
 const groups=await Promise.all(ids.map(id=>registry.queryProviderHistory(id,{questionTemplateId,limit:50})));
 const matching=groups.flat().filter(entity=>ids.includes(entity.record.providerId)&&'questionTemplateId' in entity.record&&entity.record.questionTemplateId===questionTemplateId);
 const runIds=[...new Set(matching.flatMap(entity=>'runId' in entity.record?[entity.record.runId]:[]))].slice(0,20);
 const receipts=registry.queryReceiptsByRunId?await Promise.all(runIds.map(id=>registry.queryReceiptsByRunId!(id))):[];
 const payments=receipts.flat().filter(entity=>entity.record.entityType==='PaymentReference'&&runIds.includes(entity.record.runId)&&ids.includes(entity.record.providerId));
 return [...new Map([...matching,...payments].map(entity=>[entity.entityKey,entity])).values()].sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt)).slice(0,100).map(entity=>({entityKey:entity.entityKey,providerId:entity.record.providerId,entityType:entity.record.entityType,createdAt:entity.record.createdAt,status:'status' in entity.record?entity.record.status:entity.record.settlementStatus,executionMode:'executionMode' in entity.record?entity.record.executionMode:undefined,runId:'runId' in entity.record?entity.record.runId:undefined,priceMinor:'priceMinor' in entity.record?entity.record.priceMinor:undefined,answerHash:'answerHash' in entity.record?entity.record.answerHash:undefined,url:'https://rabdi.explorer.arkiv.network/entity/'+entity.entityKey}));
}
