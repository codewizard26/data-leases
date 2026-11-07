import {expect,test} from 'vitest';
import {startProvider,negotiate,HEDERA_CURRENCY,PROVIDER_PROFILES,providerRates,providerComputeEnvironment} from '../../packages/agents/src/index.js';
import {providerOffers} from '../../apps/agent-gateway/src/provider-directory.js';
test('six separately addressable providers publish different rates for the same task and a different cheapest agent by task',async()=>{
 const providers=await Promise.all(PROVIDER_PROFILES.map(profile=>startProvider({port:0,providerId:profile.providerId,askMinor:profile.askMinor,floorMinor:profile.floorMinor,allowUnpaidQuotes:true,utilityRates:providerRates(profile.providerId,{}),profile:{displayName:profile.name,description:profile.tagline,style:profile.style,compute:{provider:'unconfigured',model:'not-configured',available:false}}})));
 try{
  expect(new Set(providers.map(provider=>provider.baseUrl)).size).toBe(6);
  for(const [template,prices,cheapest] of [['AAVE_V3_USDC_AVAILABLE_LIQUIDITY',['500','700','950','650','1100','800'],'Scout'],['AAVE_V3_USDC_SUPPLY_APY',['850','600','800','550','1000','650'],'Quill']] as const){
   const directory=await providerOffers(providers.map((provider,index)=>({providerId:PROVIDER_PROFILES[index]!.providerId,origin:provider.baseUrl})),template);
   expect(directory.map(provider=>provider.askMinor)).toEqual(prices);expect(directory.filter(provider=>provider.available)).toHaveLength(6);
   const quotes=await Promise.all(providers.map((provider,index)=>negotiate({baseUrl:provider.baseUrl,providerId:PROVIDER_PROFILES[index]!.providerId,maxPriceMinor:'2000',questionTemplateId:template,currency:HEDERA_CURRENCY,quoteOnly:true,mode:'MOCK'})));
   expect(quotes.map(result=>result.status)).toEqual(Array(6).fill('QUOTED'));expect(quotes.map(result=>result.quote?.priceMinor)).toEqual(prices);
   expect(directory.toSorted((a,b)=>Number(BigInt(a.askMinor!)-BigInt(b.askMinor!)))[0]!.displayName).toBe(cheapest);
   expect(JSON.stringify(directory)).not.toContain('floorMinor');
  }
  const c=await negotiate({baseUrl:providers[2]!.baseUrl,providerId:'provider-c',maxPriceMinor:'2000',questionTemplateId:'AAVE_V3_USDC_AVAILABLE_LIQUIDITY',currency:HEDERA_CURRENCY,mode:'MOCK'});
  expect(c.status).toBe('REJECTED');expect(c.answer).toBeUndefined();
 }finally{await Promise.all(providers.map(provider=>provider.close()));}
});
test('provider model overrides and rate overrides are isolated and invalid rate bounds fail closed',()=>{
 const env={COMPUTE_PROVIDER:'openrouter',OPENROUTER_MODEL:'vendor/base:free',ANTHROPIC_API_KEY:'secret',PROVIDER_B_OPENROUTER_MODEL:'vendor/alternate:free'};
 expect(providerComputeEnvironment('provider-a',env).COMPUTE_PROVIDER).toBe('openrouter');expect(providerComputeEnvironment('provider-b',env).OPENROUTER_MODEL).toBe('vendor/alternate:free');expect(providerComputeEnvironment('provider-c',env).COMPUTE_PROVIDER).toBe('claude');
 expect(env.OPENROUTER_MODEL).toBe('vendor/base:free');expect(providerComputeEnvironment('provider-c',{...env,PROVIDER_C_COMPUTE_PROVIDER:'0g'}).COMPUTE_PROVIDER).toBe('0g');
 expect(()=>providerRates('provider-c',{PROVIDER_C_UTILITY_RATES_JSON:'{"ERC20_TOKEN_METADATA":{"askMinor":"10","floorMinor":"11"}}'})).toThrow();
 expect(()=>providerRates('provider-a',{PROVIDER_A_UTILITY_RATES_JSON:'{"NOT_A_TASK":{"askMinor":"10","floorMinor":"1"}}'})).toThrow('UNKNOWN_RATE_SERVICE');
});
