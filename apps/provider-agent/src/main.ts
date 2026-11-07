import {loadAnswerSigner} from './provider-signing.js';
import {readPublicSource} from './public-source.js';
import {SERVICE_POLICIES,readPlan} from '@data-leases/cre-adapter';
import {resolve} from 'node:path';
import {startProvider,createComputeAdapter,AiNegotiationStrategy,PaymentJournal,PROVIDER_PROFILES,providerPrefix,providerRecipient,providerRates,providerComputeEnvironment,type ComputeAdapter} from '@data-leases/agents';
const providerId=process.env.PROVIDER_ID??'provider-a',prefix=providerPrefix(providerId);
const profile=PROVIDER_PROFILES.find(profile=>profile.providerId===providerId);
const environment=providerComputeEnvironment(providerId);
let compute:ComputeAdapter|undefined;
if(['openrouter','0g','claude'].includes(environment.COMPUTE_PROVIDER??'')){
 try{compute=createComputeAdapter(environment);}catch{console.warn('Live negotiation unavailable: this provider needs valid compute configuration.');}
}
const strategy=compute?new AiNegotiationStrategy(compute,profile?.style):undefined;
const liveOnly=!(process.env.NODE_ENV==='test'&&process.env.ALLOW_TEST_FIXTURES==='true');
const payTo=providerRecipient(providerId);
const journal=payTo?new PaymentJournal(resolve('data/tmp/payments',providerId+'.sqlite')):undefined;
const payment=journal&&payTo?{payTo,journal}:undefined;
const utilityRates=providerRates(providerId);
const signer=liveOnly?loadAnswerSigner(providerId):undefined;
if(process.env[prefix+'_ETH_RPC_URL'])process.env.PROVIDER_ETH_RPC_URL=process.env[prefix+'_ETH_RPC_URL'];
else if(providerId==='provider-c'&&!process.env.PROVIDER_ETH_RPC_URL)process.env.PROVIDER_ETH_RPC_URL='https://eth.drpc.org';
const model=environment.COMPUTE_PROVIDER==='claude'?environment.ANTHROPIC_MODEL??'claude-sonnet-5-5':environment.COMPUTE_PROVIDER==='openrouter'?environment.OPENROUTER_MODEL??'openrouter/free':environment.ZERO_G_MODEL;
const provider=await startProvider({analysisPriceMinor:process.env[prefix+'_ANALYSIS_TINYBARS'],profile:{displayName:profile?.name??providerId,description:profile?.tagline??'Independently configured provider.',style:profile?.style??'BALANCED',compute:{provider:environment.COMPUTE_PROVIDER??'mock',model:model&&/^[a-zA-Z0-9_./:-]{1,120}$/.test(model)?model:'not-configured',available:Boolean(compute)}},allowUnpaidQuotes:true,liveOnly,signAnswer:signer?.sign,strategy,payment,utilityRates,sourceTemplates:process.env.PROVIDER_LINK_SOURCE_ENABLED==='true'?SERVICE_POLICIES.filter(service=>readPlan(service.questionTemplateId)).map(service=>service.questionTemplateId):[],answerSource:process.env.PROVIDER_LINK_SOURCE_ENABLED==='true'?readPublicSource:undefined,compute,port:Number(process.env.PORT??'4101'),providerId,askMinor:process.env.ASK_MINOR??profile?.askMinor??'500',floorMinor:process.env.FLOOR_MINOR??profile?.floorMinor??'300'});
console.log(`${liveOnly?'LIVE_ONLY':'TEST_FIXTURE'} provider ready: ${provider.baseUrl} · model available=${Boolean(strategy)}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void provider.close().then(()=>{journal?.close();process.exit(0)});});
