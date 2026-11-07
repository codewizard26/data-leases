import type {StoredEntity,ArkivEvidenceClient} from '@data-leases/arkiv';

/** Aggregate public receipts only. Never return buyer identities, answer values, or private policies. */
export function summarizePublicEntities(entities:readonly StoredEntity[],providerIds:readonly string[],now=Date.now()){
 const allowed=new Set(providerIds);
 const unique=[...new Map(entities.filter(entity=>allowed.has(entity.record.providerId)&&Date.parse(entity.record.expiresAt)>now&&Date.parse(entity.record.createdAt)<=now).map(entity=>[entity.entityKey,entity])).values()];
 const usage=new Map<string,Set<string>>(),payments=new Map<string,{amount:string;createdAt:string}>(),conflicts=new Set<string>();
 const days=new Map<string,bigint>();
 for(const {record} of unique){
  if(record.entityType==='AnswerReceipt'){
   const runs=usage.get(record.questionTemplateId)??new Set<string>();runs.add(record.providerId+':'+record.runId);usage.set(record.questionTemplateId,runs);
  }
  if(record.entityType==='PaymentReference'&&record.settlementStatus==='CONFIRMED'&&record.network==='hedera:testnet'){
   const key=record.network+':'+record.transactionId,prior=payments.get(key);
   if(prior&&prior.amount!==record.amountTinybars)conflicts.add(key);
   else if(!prior||record.createdAt<prior.createdAt)payments.set(key,{amount:record.amountTinybars,createdAt:record.createdAt});
  }
 }
 let total=0n,count=0;
 for(const [key,payment] of payments){if(conflicts.has(key))continue;const amount=BigInt(payment.amount);total+=amount;count++;const date=payment.createdAt.slice(0,10);days.set(date,(days.get(date)??0n)+amount);}
 return {source:'ARKIV' as const,network:'Rabdi',paymentNetwork:'hedera:testnet',currency:'HBAR',decimals:8,queriedAt:new Date(now).toISOString(),scope:'Unexpired records returned for configured providers; bounded queries, not lifetime network totals.',limitPerEntityTypePerProvider:100,entities:unique.length,providers:new Set(unique.map(entity=>entity.record.providerId)).size,offers:unique.filter(entity=>entity.record.entityType==='ProviderOffer').length,answers:unique.filter(entity=>entity.record.entityType==='AnswerReceipt').length,confirmedPurchases:count,totalTinybars:total.toString(),conflictingPayments:conflicts.size,usage:[...usage].map(([questionTemplateId,runs])=>({questionTemplateId,answerRuns:runs.size})).sort((a,b)=>b.answerRuns-a.answerRuns||a.questionTemplateId.localeCompare(b.questionTemplateId)),spendingByPublicationDate:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,amount])=>({date,amountTinybars:amount.toString()}))};
}
export async function publicAnalytics(providers:readonly {providerId:string}[],registry:Pick<ArkivEvidenceClient,'queryProviderHistory'>){
 const groups=await Promise.all(providers.map(provider=>registry.queryProviderHistory(provider.providerId,{limit:100})));
 return summarizePublicEntities(groups.flat(),providers.map(provider=>provider.providerId));
}
