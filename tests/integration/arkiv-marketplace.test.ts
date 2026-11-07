import {afterEach,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startProvider,PaymentJournal} from '../../packages/agents/src/index.js';
import {startGateway} from '../../apps/agent-gateway/src/server.js';
import {registryOffers} from '../../apps/agent-gateway/src/arkiv-marketplace.js';
import {ProviderOfferSchema,type StoredEntity} from '../../packages/arkiv/src/index.js';
const cleanup:(()=>Promise<void>|void)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllEnvs();});
async function fixture(){
 vi.stubEnv('HEDERA_PROVIDER_A_ACCOUNT_ID','0.0.123');vi.stubEnv('HEDERA_PROVIDER_B_ACCOUNT_ID','0.0.124');vi.stubEnv('ARKIV_PUBLISHING_ENABLED','true');vi.stubEnv('PAYMENTS_ENABLED','false');
 const directory=await mkdtemp(join(tmpdir(),'registry-market-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
 const journals=[new PaymentJournal(':memory:'),new PaymentJournal(':memory:')];for(const journal of journals)cleanup.push(()=>journal.close());
 const providers=await Promise.all(journals.map((journal,index)=>startProvider({port:0,providerId:'provider-'+(index?'b':'a'),askMinor:index?'700':'500',floorMinor:'300',payment:{journal,payTo:index?'0.0.124':'0.0.123'},profile:{displayName:index?'Atlas':'Scout',description:'Offline test fixture',style:'BALANCED',compute:{provider:'unconfigured',model:'not-configured',available:false}}})));
 for(const provider of providers)cleanup.push(provider.close);
 const entities:StoredEntity[]=[];
 const queryProviderOffers=vi.fn(async()=>entities),queryProviderHistory=vi.fn(async()=>entities);
 const publishProviderOffer=vi.fn(async input=>{const record=ProviderOfferSchema.parse({...input,schemaVersion:'1.0.0',entityType:'ProviderOffer',publicationId:'a'.repeat(64),publisher:'0x'+'11'.repeat(20)});const entity={entityKey:('0x'+(entities.length+1)) as `0x${string}`,owner:record.publisher as `0x${string}`,record};entities.push(entity);return entity;});
 const registry={queryProviderOffers,queryProviderHistory,publishProviderOffer,async queryLatestAcceptedAnswer(){return null;},async queryReceiptsByRunId(){return [];}};
 const server=await startGateway({port:0,dataDirectory:directory,providerOrigins:providers.map(provider=>provider.baseUrl),evidenceQueries:registry});cleanup.push(server.close);
 return {server,registry,entities,providers};
}
test('comparison reads published Arkiv offers, registration is explicit and repeated sync reuses existing entities',async()=>{
 const f=await fixture(),template='AAVE_V3_USDC_AVAILABLE_LIQUIDITY';
 expect((await fetch(f.server.baseUrl+'/api/providers?questionTemplateId='+template).then(response=>response.json())).providers).toEqual([]);expect(f.registry.publishProviderOffer).not.toHaveBeenCalled();
 const sync=()=>fetch(f.server.baseUrl+'/api/registry/offers/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionTemplateId:template})});
 expect((await sync()).status).toBe(200);expect(f.registry.publishProviderOffer).toHaveBeenCalledTimes(2);
 expect((await sync()).status).toBe(200);expect(f.registry.publishProviderOffer).toHaveBeenCalledTimes(2);
 const response=await fetch(f.server.baseUrl+'/api/providers?questionTemplateId='+template).then(response=>response.json());expect(response.source).toBe('ARKIV');expect(response.providers.map((provider:{askMinor:string})=>provider.askMinor)).toEqual(['500','700']);expect(response.providers.every((provider:{entityKey:string})=>provider.entityKey.startsWith('0x'))).toBe(true);
 const history=await fetch(f.server.baseUrl+'/api/registry/history?questionTemplateId='+template).then(response=>response.json());expect(history.source).toBe('ARKIV');expect(history.entries).toHaveLength(2);expect(history.entries[0].entityType).toBe('ProviderOffer');
 const changed={...f.entities[0]!,record:{...f.entities[0]!.record,priceMinor:'499'}} as StoredEntity;
 const offers=await registryOffers(f.providers.map((provider,index)=>({providerId:'provider-'+(index?'b':'a'),origin:provider.baseUrl})),template,{async queryProviderOffers(){return [changed];}});
 expect(offers[0]).toMatchObject({askMinor:'499',available:false,status:'RATE_CHANGED'});
});
test('manual mandates persist without starting any runs and private owner filtering remains enforced',async()=>{
 const f=await fixture();vi.stubEnv('HEDERA_MAX_PAYMENT_TINYBARS','1000');
 const id=randomUUID();const saved=await fetch(f.server.baseUrl+'/api/leases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({leaseId:id,questionTemplateId:'ERC20_TOKEN_METADATA',currency:'hedera:testnet/HBAR',providerIds:['provider-a'],perRequestTinybars:'500',totalTinybars:'1000',maxAgeSeconds:60,maxRounds:3,paymentsAuthorized:true,expiresAt:new Date(Date.now()+3600000).toISOString()})});expect(saved.status).toBe(201);
 const mandates=await fetch(f.server.baseUrl+'/api/mandates').then(response=>response.json());expect(mandates.mandates).toHaveLength(1);expect(mandates.mandates[0]).toMatchObject({active:true,remainingTinybars:'1000',policy:{providerIds:['provider-a']}});
 expect((await fetch(f.server.baseUrl+'/api/runs').then(response=>response.json())).runs).toEqual([]);
});
