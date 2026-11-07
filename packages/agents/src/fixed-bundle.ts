import {createHash,randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {AnswerEnvelopeSchema,FixedQuoteRequestSchema,FixedBundleQuoteSchema,type FixedBundleQuote} from '@data-leases/contracts';
import type {ProviderOptions} from './index.js';
import {scenarioForTemplate} from './scenarios.js';
import {HEDERA_CURRENCY,type PaymentQuote,type PaymentJournal} from './payments.js';
export function bundleTermsHash(quote:Omit<FixedBundleQuote,'termsHash'>){return createHash('sha256').update(JSON.stringify({runId:quote.runId,quoteId:quote.quoteId,providerId:quote.providerId,payTo:quote.payTo,currency:quote.currency,priceMinor:quote.priceMinor,expiresAt:quote.expiresAt,maxAgeSeconds:quote.maxAgeSeconds,items:quote.items})).digest('hex');}
export function bundlePaymentQuote(quote:FixedBundleQuote):PaymentQuote{return {runId:quote.runId,quoteId:quote.quoteId,termsHash:quote.termsHash,priceMinor:quote.priceMinor,currency:quote.currency,expiresAt:quote.expiresAt,bundle:quote};}
/** Fixed HTTP pricing API. This route performs no bargaining or inference. */
export function installFixedBundles(app:Express,options:ProviderOptions,rateFor:(id:string)=>{askMinor:string},journal?:PaymentJournal){
 const supported=(id:string)=>{const task=scenarioForTemplate(id);return task&&!task.retired&&task.operation==='READ'&&task.dataAccess.classification==='PUBLIC'&&options.answerSource&&options.sourceTemplates?.includes(id);};
 app.post('/fixed-quotes',(req,res)=>{try{
  if(!journal||!options.payment)throw Error('PAYMENTS_NOT_CONFIGURED');
  const input=FixedQuoteRequestSchema.parse(req.body);if(input.measurementIds.some(id=>!supported(id)))throw Error('UNSUPPORTED_MEASUREMENT');
  const prior=journal.get('seller:'+input.runId);if(prior){const q=prior.quote.bundle;if(!q||q.maxAgeSeconds!==input.maxAgeSeconds||JSON.stringify(q.items.map(i=>i.questionTemplateId))!==JSON.stringify([...input.measurementIds].sort()))throw Error('RUN_ID_CONFLICT');res.json({quote:q});return;}
  const items=[...input.measurementIds].sort().map(questionTemplateId=>({questionTemplateId,priceMinor:rateFor(questionTemplateId).askMinor}));
  const body={runId:input.runId,quoteId:randomUUID(),providerId:options.providerId,payTo:options.payment.payTo,currency:HEDERA_CURRENCY as 'hedera:testnet/HBAR',priceMinor:items.reduce((sum,i)=>sum+BigInt(i.priceMinor),0n).toString(),expiresAt:new Date(Date.now()+180000).toISOString(),maxAgeSeconds:input.maxAgeSeconds,items};
  const quote=FixedBundleQuoteSchema.parse({...body,termsHash:bundleTermsHash(body)});journal.register('seller:'+quote.runId,{quote:bundlePaymentQuote(quote),status:'QUOTED'});res.set('Cache-Control','no-store').json({quote});
 }catch(error){res.status(400).json({error:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_FIXED_QUOTE'});}});
 app.post('/fixed-quotes/prepare',async(req,res)=>{try{
  if(!journal)throw Error('PAYMENTS_NOT_CONFIGURED');const quote=FixedBundleQuoteSchema.parse(req.body);const id='seller:'+quote.runId,record=journal.get(id);
  if(!record||JSON.stringify(record.quote.bundle)!==JSON.stringify(quote)||quote.termsHash!==bundleTermsHash(quote))throw Error('QUOTE_TERMS_MISMATCH');
  if(record.status==='READY'||record.status==='SETTLED'){res.json({ready:true});return;}
  if(Date.parse(quote.expiresAt)<=Date.now())throw Error('PAYMENT_QUOTE_EXPIRED');
  if(!journal.claim(id,'QUOTED','PREPARING'))throw Error('QUOTE_ALREADY_PREPARING');
  try{
   const answers=[];
   for(const item of quote.items){if(!supported(item.questionTemplateId))throw Error('UNSUPPORTED_MEASUREMENT');const task=scenarioForTemplate(item.questionTemplateId)!;
    const base=AnswerEnvelopeSchema.parse({schemaVersion:'1.0.0',runId:quote.runId,sessionId:quote.runId,negotiationId:quote.quoteId,acceptedQuoteId:quote.quoteId,providerId:quote.providerId,questionTemplateId:item.questionTemplateId,deliveredAt:new Date().toISOString(),chainId:task.chainId,metric:task.metric,value:'0',unit:task.unit,methodologyVersion:task.methodologyVersion,sourceContract:task.sourceContract,evidencePolicyId:task.evidencePolicyId,evidenceRefs:[],demoTrustMode:'UNTRUSTED_MOCK'});
    const source=await options.answerSource!(base),answer={...base,...source,deliveredAt:new Date().toISOString(),demoTrustMode:options.signAnswer?'SIGNED_PROVIDER' as const:'UNTRUSTED_MOCK' as const};
    answers.push(AnswerEnvelopeSchema.parse({...answer,...(options.signAnswer?{providerSignature:options.signAnswer(answer)}:{})}));
   }
   if(Date.parse(quote.expiresAt)<=Date.now())throw Error('PAYMENT_QUOTE_EXPIRED');record.answers=answers;record.answer=answers[0];record.status='READY';journal.save(id,record);res.json({ready:true});
  }catch{record.status='PREPARATION_FAILED';journal.save(id,record);throw Error('BUNDLE_SOURCE_UNAVAILABLE');}
 }catch(error){res.status(409).json({error:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_FIXED_QUOTE'});}});
}
