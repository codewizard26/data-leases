import {PublicProviderProfileSchema} from '@data-leases/agents';
/** Profiles advertise asking rates only. A2A acceptance remains the source of binding terms. */
export async function providerOffers(providers:readonly {providerId:string;origin:string}[],questionTemplateId:string){
 return Promise.all(providers.map(async provider=>{
  try{
   const response=await fetch(provider.origin+'/provider-profile',{redirect:'error',signal:AbortSignal.timeout(4000)});if(!response.ok||!response.body)throw Error('PROFILE_UNAVAILABLE');
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
   try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>65536)throw Error('PROFILE_TOO_LARGE');parts.push(item.value);}}finally{await reader.cancel();}
   const profile=PublicProviderProfileSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));if(profile.providerId!==provider.providerId)throw Error('PROFILE_ID_MISMATCH');
   const service=profile.services.find(service=>service.questionTemplateId===questionTemplateId);
   return {providerId:provider.providerId,displayName:profile.displayName,description:profile.description,style:profile.style,compute:profile.compute,paymentReady:profile.paymentReady,questionTemplateId,available:Boolean(service),status:service?'AVAILABLE':'UNSUPPORTED',askMinor:service?.askMinor,currency:service?.currency,decimals:service?.decimals};
  }catch{return {providerId:provider.providerId,displayName:provider.providerId,questionTemplateId,available:false,paymentReady:false,status:'OFFLINE'};}
 }));
}
