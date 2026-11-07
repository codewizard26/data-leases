import {test,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventStore} from '@data-leases/event-store';
import {FixedBundleQuoteSchema,LeasePolicySchema,type VerificationRequest,type RunPublicationInput} from '@data-leases/contracts';
import {startProvider,PaymentJournal,bundleTermsHash} from '../../packages/agents/src/index.js';
import {RunOrchestrator} from '../../apps/agent-gateway/src/orchestrator.js';
import {LeaseStore} from '../../apps/agent-gateway/src/lease-store.js';
const ids=['AAVE_V3_USDC_AVAILABLE_LIQUIDITY','AAVE_V3_USDC_SUPPLY_APY'];
async function fixture(cap='1500',total='3000',unknown=false){
 const dir=await mkdtemp(join(tmpdir(),'fixed-bundle-')),journal=new PaymentJournal(':memory:'),leases=new LeaseStore(join(dir,'leases.sqlite')),store=new EventStore({directory:join(dir,'events')});
 let reads=0,payments=0,inference=0;const requests=new Map<string,VerificationRequest>(),published:RunPublicationInput[]=[];
 const provider=await startProvider({port:0,providerId:'provider-a',askMinor:'500',floorMinor:'300',payment:{payTo:'0.0.123',journal},sourceTemplates:ids,answerSource:async()=>{reads++;return {value:'123456789',sourceBlockNumber:'100',sourceBlockHash:'0x'+'1'.repeat(64),evidenceRefs:['test:fixture-source']};},strategy:{buyer:async()=>{inference++;throw Error('UNEXPECTED_INFERENCE');},seller:async()=>{inference++;throw Error('UNEXPECTED_INFERENCE');}}});
 const runner=new RunOrchestrator({store,leases,liveOnly:true,providers:[{providerId:'provider-a',origin:provider.baseUrl,payTo:'0.0.123'}],paymentReady:()=>true,verification:{submit:async request=>{requests.set(request.verificationId,request);return {verificationId:request.verificationId,state:'COMPLETED'};},getResult:async id=>{const req=requests.get(id);if(!req)return null;return {schemaVersion:'1.0.0',verificationId:id,runId:req.runId,providerId:req.providerId,executionMode:'CRE_CLI_SIMULATION',status:req.questionTemplateId===ids[0]?'ACCEPTED':'INCONCLUSIVE',checks:[{checkId:'TEST_INJECTED',status:req.questionTemplateId===ids[0]?'PASS':'UNKNOWN',reasonCode:'TEST_ONLY'}],executedAt:new Date().toISOString(),evidenceRefs:['test:injected-verifier']};}},arkiv:{findProviderOffers:async()=>[],getRunReceipts:async()=>[],publishVerifiedRun:async input=>{published.push(input);return {runId:input.runId,reference:'test:'+input.verification.verificationId};}},payment:async input=>{payments++;if(unknown)throw Error('PAYMENT_RECONCILIATION_REQUIRED');const record=journal.get('seller:'+input.quote.runId)!;return {answer:record.answer!,answers:record.answers,payment:{network:'hedera:testnet',transaction:'test:injected-settlement',success:true}};}});
 const leaseId=randomUUID();leases.authorize({leaseId,questionTemplateId:ids[0]!,measurementIds:ids,providerIds:['provider-a'],currency:'hedera:testnet/HBAR',perRequestTinybars:cap,totalTinybars:total,maxAgeSeconds:300,maxRounds:2,expiresAt:new Date(Date.now()+300000).toISOString()});
 return {provider,runner,leases,leaseId,journal,requests,published,get reads(){return reads;},get payments(){return payments;},get inference(){return inference;},async close(){await runner.drain();await provider.close();journal.close();leases.close();await store.close();await rm(dir,{recursive:true,force:true});}};
}
test('fixed bundle has one injected payment, no negotiation inference, and separate item evidence',async()=>{
 const f=await fixture();try{
  expect(f.reads).toBe(0);expect(f.payments).toBe(0);const runId=randomUUID();f.runner.start({runId,leaseId:f.leaseId,mode:'LOCAL_REGISTRY'});const result=await f.runner.wait(runId);
  expect(result).toMatchObject({status:'COMPLETED',paymentStatus:'SETTLED',deliveryStatus:'DELIVERED',verificationStatus:'INCONCLUSIVE',bundleQuote:{priceMinor:'1000'}});
  expect(f.payments).toBe(1);expect(f.reads).toBe(2);expect(f.inference).toBe(0);expect(f.requests.size).toBe(2);expect(result?.measurements?.map(i=>i.verification?.status)).toEqual(['ACCEPTED','INCONCLUSIVE']);expect(f.published).toHaveLength(1);
  f.runner.start({runId,leaseId:f.leaseId,mode:'LOCAL_REGISTRY'});await f.runner.wait(runId);expect(f.payments).toBe(1);expect(f.leases.get(f.leaseId).remainingTinybars).toBe('2000');
 }finally{await f.close();}
});
test('bundle over cap fails before source preparation or payment',async()=>{const f=await fixture('900');try{const runId=randomUUID();f.runner.start({runId,leaseId:f.leaseId,mode:'LOCAL_REGISTRY'});expect(await f.runner.wait(runId)).toMatchObject({status:'FAILED',error:'LEASE_BUDGET_EXCEEDED'});expect(f.payments).toBe(0);expect(f.reads).toBe(0);}finally{await f.close();}});
test('unknown bundle settlement keeps the total reserved',async()=>{const f=await fixture('1000','1000',true);try{const runId=randomUUID();f.runner.start({runId,leaseId:f.leaseId,mode:'LOCAL_REGISTRY'});expect(await f.runner.wait(runId)).toMatchObject({paymentStatus:'UNKNOWN'});expect(f.leases.get(f.leaseId).remainingTinybars).toBe('0');f.runner.start({runId,leaseId:f.leaseId,mode:'LOCAL_REGISTRY'});expect(f.payments).toBe(1);}finally{await f.close();}});
test('quote binds exact selected items and rejects tampering without reading sources',async()=>{const f=await fixture();try{
 const runId=randomUUID(),response=await fetch(f.provider.baseUrl+'/fixed-quotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,measurementIds:[ids[0]],maxAgeSeconds:60})});const quote=FixedBundleQuoteSchema.parse((await response.json()).quote);expect(quote.priceMinor).toBe('500');expect(quote.termsHash).toBe(bundleTermsHash(quote));expect(f.reads).toBe(0);
 const tampered={...quote,items:[{questionTemplateId:ids[1],priceMinor:'500'}]};tampered.termsHash=bundleTermsHash(tampered as typeof quote);const prepared=await fetch(f.provider.baseUrl+'/fixed-quotes/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tampered)});expect(prepared.status).toBe(409);expect(f.reads).toBe(0);
 expect(LeasePolicySchema.safeParse({...f.leases.get(f.leaseId).policy,measurementIds:[ids[0],ids[0]]}).success).toBe(false);
 }finally{await f.close();}});
test('expired or changed quote cannot prepare or charge and empty selections are rejected',async()=>{const f=await fixture();try{
 const post=(path:string,body:unknown)=>fetch(f.provider.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await post('/fixed-quotes',{runId:randomUUID(),measurementIds:[],maxAgeSeconds:60})).status).toBe(400);
 const runId=randomUUID(),quote=(await(await post('/fixed-quotes',{runId,measurementIds:ids,maxAgeSeconds:60})).json()).quote;
 const stored=f.journal.get('seller:'+runId)!;stored.quote.bundle!.expiresAt=new Date(Date.now()-1000).toISOString();stored.quote.bundle!.termsHash=bundleTermsHash(stored.quote.bundle!);f.journal.save('seller:'+runId,stored);
 expect((await post('/fixed-quotes/prepare',stored.quote.bundle)).status).toBe(409);expect(f.reads).toBe(0);expect(f.payments).toBe(0);
 expect((await post('/fixed-quotes',{runId,measurementIds:[ids[0]],maxAgeSeconds:60})).status).toBe(400);
 expect(quote.items).toHaveLength(2);
 }finally{await f.close();}});
