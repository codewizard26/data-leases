import {z} from 'zod';
import {DEMO_SCENARIOS} from './scenarios.js';
export const PROVIDER_PROFILES=[
 {providerId:'provider-a',name:'Scout',tagline:'Low starting rates for public reads.',style:'FLEXIBLE',port:4101,askMinor:'500',floorMinor:'300'},
 {providerId:'provider-b',name:'Atlas',tagline:'Task-specific rates for reserve analysis.',style:'BALANCED',port:4102,askMinor:'700',floorMinor:'400'},
 {providerId:'provider-c',name:'Sage',tagline:'Firm pricing with a separately configured model.',style:'FIRM',port:4103,askMinor:'950',floorMinor:'650'},
 {providerId:'provider-d',name:'Quill',tagline:'Flexible rates for yield and reserve queries.',style:'FLEXIBLE',port:4104,askMinor:'650',floorMinor:'350'},
 {providerId:'provider-e',name:'Beacon',tagline:'Firm offers with a separately configured model.',style:'FIRM',port:4105,askMinor:'1100',floorMinor:'700'},
 {providerId:'provider-f',name:'Meridian',tagline:'Task-specific rates for model computation.',style:'BALANCED',port:4106,askMinor:'800',floorMinor:'450'},
] as const;
export type SellerStyle=typeof PROVIDER_PROFILES[number]['style'];
export function providerPrefix(providerId:string){if(!/^provider-[a-z]$/.test(providerId))throw new Error('INVALID_PROVIDER_ID');return providerId.replace('-','_').toUpperCase();}
export function providerRecipient(providerId:string,environment:Record<string,string|undefined>=process.env){const value=environment['HEDERA_'+providerPrefix(providerId)+'_ACCOUNT_ID'];return value&&/^0\.0\.[1-9][0-9]*$/.test(value)?value:undefined;}
/** Scope model selection to one server process. Secrets remain in the server environment. */
export function providerComputeEnvironment(providerId:string,environment:Record<string,string|undefined>=process.env){
 const prefix=providerPrefix(providerId),result={...environment};
 for(const key of ['COMPUTE_PROVIDER','OPENROUTER_MODEL','ZERO_G_MODEL','ZERO_G_BASE_URL','ANTHROPIC_MODEL'])if(environment[prefix+'_'+key])result[key]=environment[prefix+'_'+key];
 if(!environment[prefix+'_COMPUTE_PROVIDER']&&['provider-c','provider-e'].includes(providerId)&&(environment.ANTHROPIC_API_KEY||environment.CLAUDE_API_KEY))result.COMPUTE_PROVIDER='claude';
 if(providerId==='provider-e'&&result.COMPUTE_PROVIDER==='claude'&&!environment[prefix+'_ANTHROPIC_MODEL']&&!environment.ANTHROPIC_MODEL)result.ANTHROPIC_MODEL='claude-haiku-5-5';
 return result;
}
const Amount=z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const Rates=z.record(z.object({askMinor:Amount,floorMinor:Amount}).strict().refine(rate=>BigInt(rate.floorMinor)<=BigInt(rate.askMinor),'FLOOR_EXCEEDS_ASK'));
export function providerRates(providerId:string,environment:Record<string,string|undefined>=process.env){
 const raw=environment[providerPrefix(providerId)+'_UTILITY_RATES_JSON'];if(raw){const rates=Rates.parse(JSON.parse(raw));if(Object.keys(rates).some(id=>!DEMO_SCENARIOS.some(task=>!task.retired&&task.questionTemplateId===id)))throw new Error('UNKNOWN_RATE_SERVICE');return rates;}
 // Explicit local demonstration tariffs, not observed market prices or model API costs.
 const tariffs:Record<string,Record<string,[string,string]>>={
  'provider-a':{AAVE_V3_USDC_SUPPLY_APY:['850','500'],AI_LINK_EXPLANATION:['1400','850']},
  'provider-b':{AAVE_V3_USDC_SUPPLY_APY:['600','400'],AI_LINK_EXPLANATION:['1000','700']},
  'provider-c':{AAVE_V3_USDC_SUPPLY_APY:['800','600'],AI_LINK_EXPLANATION:['1800','1200']},
  'provider-d':{AAVE_V3_USDC_SUPPLY_APY:['550','350'],AI_LINK_EXPLANATION:['1200','700']},
  'provider-e':{AAVE_V3_USDC_SUPPLY_APY:['1000','700'],AI_LINK_EXPLANATION:['2200','1400']},
  'provider-f':{AAVE_V3_USDC_SUPPLY_APY:['650','400'],AI_LINK_EXPLANATION:['900','550']},
 };
 return Object.fromEntries(Object.entries(tariffs[providerId]??{}).map(([id,[askMinor,floorMinor]])=>[id,{askMinor,floorMinor}]));
}
export const PublicProviderProfileSchema=z.object({providerId:z.string().min(1).max(80),displayName:z.string().min(1).max(80),description:z.string().max(300),style:z.enum(['FLEXIBLE','BALANCED','FIRM']),compute:z.object({provider:z.enum(['mock','openrouter','0g','claude','unconfigured']),model:z.string().max(120),available:z.boolean()}),analysis:z.object({priceMinor:Amount,available:z.boolean()}).optional(),paymentReady:z.boolean(),services:z.array(z.object({questionTemplateId:z.string().max(120),askMinor:Amount,currency:z.literal('hedera:testnet/HBAR'),decimals:z.literal(8)})).max(100)});
export type PublicProviderProfile=z.infer<typeof PublicProviderProfileSchema>;
